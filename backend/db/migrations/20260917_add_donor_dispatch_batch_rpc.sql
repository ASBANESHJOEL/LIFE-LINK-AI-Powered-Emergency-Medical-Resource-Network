-- Migration: Add atomic donor dispatch batch allocation and audit procedure
-- Ensures row-level lock on emergency_requests to prevent concurrent batch_number collisions
-- and executes dispatch insertion and audit log within the same database transaction.

create or replace function public.create_donor_dispatch_batch(
  p_request_id uuid,
  p_actor_user_id uuid,
  p_donor_ids uuid[],
  p_priority_scores double precision[],
  p_model_version text
)
returns table (
  id uuid,
  request_id uuid,
  donor_id uuid,
  batch_number integer,
  priority_score double precision,
  eta integer,
  status public.dispatch_status,
  notified_at timestamp with time zone,
  responded_at timestamp with time zone,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_status public.request_status;
  v_batch_number integer;
  v_idx integer;
begin
  -- 1. Lock the emergency request row to serialize concurrent dispatch batches
  select er.status into v_request_status
  from public.emergency_requests er
  where er.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'emergency request not found';
  end if;

  if v_request_status::text not in ('OPEN', 'PARTIALLY_FULFILLED') then
    raise exception using errcode = '55000', message = 'emergency request is not open for donor dispatch';
  end if;

  -- 2. Determine next batch number atomically under the row lock
  select coalesce(max(d.batch_number), 0) + 1
  into v_batch_number
  from public.donor_dispatches d
  where d.request_id = p_request_id;

  -- 3. Insert dispatches
  for v_idx in 1 .. coalesce(array_length(p_donor_ids, 1), 0) loop
    return query
    insert into public.donor_dispatches (
      request_id,
      donor_id,
      batch_number,
      priority_score,
      status,
      is_synthetic
    ) values (
      p_request_id,
      p_donor_ids[v_idx],
      v_batch_number,
      p_priority_scores[v_idx],
      'PENDING'::public.dispatch_status,
      false
    )
    returning
      donor_dispatches.id,
      donor_dispatches.request_id,
      donor_dispatches.donor_id,
      donor_dispatches.batch_number,
      donor_dispatches.priority_score,
      donor_dispatches.eta,
      donor_dispatches.status,
      donor_dispatches.notified_at,
      donor_dispatches.responded_at,
      donor_dispatches.accepted_at,
      donor_dispatches.created_at;
  end loop;

  -- 4. Atomically record audit log in same transaction
  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) values (
    p_actor_user_id,
    'DONOR_DISPATCH_BATCH_CREATED',
    'emergency_request',
    p_request_id,
    jsonb_build_object(
      'batch_number', v_batch_number,
      'dispatch_count', coalesce(array_length(p_donor_ids, 1), 0),
      'donor_ids', p_donor_ids,
      'model_version', p_model_version
    ),
    false
  );

  return;
end;
$$;

revoke all on function public.create_donor_dispatch_batch(uuid, uuid, uuid[], double precision[], text) from public, anon, authenticated;
grant execute on function public.create_donor_dispatch_batch(uuid, uuid, uuid[], double precision[], text) to service_role;
