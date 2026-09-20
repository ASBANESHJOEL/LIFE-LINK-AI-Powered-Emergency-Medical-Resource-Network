-- ============================================================================
-- LIFE-LINK PHASE 3: Inventory Reservation Transaction Hardening
-- Migration: 20260920_harden_inventory_reservation_transaction.sql
--
-- Goals:
-- 1. Disambiguate PL/pgSQL column references (ria.allocated_units) to prevent
--    PostgreSQL runtime error 42702.
-- 2. Correct request status lifecycle: requests with 0 allocated units must
--    remain in their existing status (OPEN) rather than prematurely transitioning
--    to PARTIALLY_FULFILLED.
-- 3. Maintain deterministic row locking order (expiry_date, last_updated, id)
--    to guarantee deadlock-free concurrency across competing allocations.
-- 4. Preserve existing service-role EXECUTE grants and security definer boundary.
-- ============================================================================

create or replace function public.reserve_blood_inventory(
  p_request_id uuid,
  p_blood_group public.blood_group,
  p_component_type public.component_type,
  p_quantity integer
)
returns table (
  inventory_id uuid,
  blood_bank_id uuid,
  allocated_units integer,
  remaining_request_units integer
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remaining integer := p_quantity;
  v_already_reserved integer := 0;
  v_row record;
  v_take integer;
  v_request_status public.request_status;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'quantity must be greater than zero';
  end if;

  -- Lock target emergency request row exclusively to serialize resolution on this request
  select er.status into v_request_status
  from public.emergency_requests er
  where er.id = p_request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'emergency request not found';
  end if;

  if v_request_status not in ('OPEN', 'PARTIALLY_FULFILLED') then
    raise exception using errcode = '55000', message = 'emergency request is not open for allocation';
  end if;

  if not exists (
    select 1
    from public.emergency_requests er
    where er.id = p_request_id
      and er.blood_group = p_blood_group
      and er.resource_type = p_component_type
  ) then
    raise exception using errcode = '22023', message = 'request resource does not match allocation';
  end if;

  -- Disambiguate table column ria.allocated_units from output parameter allocated_units
  select coalesce(sum(ria.allocated_units), 0) into v_already_reserved
  from public.request_inventory_allocations ria
  where ria.request_id = p_request_id
    and ria.status = 'RESERVED';

  v_remaining := greatest(0, p_quantity - v_already_reserved);

  -- Idempotency check: if all requested units are already reserved, mark fulfilled if needed and return
  if v_remaining = 0 then
    update public.emergency_requests er
    set status = 'FULFILLED'::public.request_status,
        completed_at = coalesce(er.completed_at, now())
    where er.id = p_request_id;
    return;
  end if;

  -- Deterministic row locking order prevents deadlocks across competing reservation transactions
  for v_row in
    select bi.id, bi.blood_bank_id, bi.available_units
    from public.blood_inventory bi
    join public.blood_banks bb on bb.id = bi.blood_bank_id
    where bi.blood_group = p_blood_group
      and bi.component_type = p_component_type
      and bi.available_units > 0
      and bi.expiry_date > now()
      and bb.verified = true
    order by bi.expiry_date asc, bi.last_updated asc, bi.id
    for update of bi
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_row.available_units);

    update public.blood_inventory
    set available_units = available_units - v_take,
        reserved_units = reserved_units + v_take,
        last_updated = now()
    where id = v_row.id;

    insert into public.request_inventory_allocations(
      request_id,
      inventory_id,
      blood_bank_id,
      allocated_units
    )
    values (
      p_request_id,
      v_row.id,
      v_row.blood_bank_id,
      v_take
    );

    inventory_id := v_row.id;
    blood_bank_id := v_row.blood_bank_id;
    allocated_units := v_take;
    v_remaining := v_remaining - v_take;
    remaining_request_units := v_remaining;
    return next;
  end loop;

  -- Consistent status transition:
  -- Only mark PARTIALLY_FULFILLED if at least 1 unit was allocated.
  -- If 0 units were allocated, keep request in its prior status (OPEN).
  update public.emergency_requests er
  set status = case
        when v_remaining = 0 then 'FULFILLED'::public.request_status
        when (p_quantity - v_remaining) > 0 then 'PARTIALLY_FULFILLED'::public.request_status
        else v_request_status
      end,
      completed_at = case
        when v_remaining = 0 then coalesce(er.completed_at, now())
        else null
      end
  where er.id = p_request_id;

  return;
end;
$$;

revoke all on function public.reserve_blood_inventory(uuid, public.blood_group, public.component_type, integer) from public, anon, authenticated;
grant execute on function public.reserve_blood_inventory(uuid, public.blood_group, public.component_type, integer) to service_role;
