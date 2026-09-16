create table if not exists public.request_inventory_allocations (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.emergency_requests(id) on delete cascade,
  inventory_id uuid not null references public.blood_inventory(id),
  blood_bank_id uuid not null references public.blood_banks(id),
  allocated_units integer not null check (allocated_units > 0),
  status text not null default 'RESERVED' check (status in ('RESERVED','RELEASED','CONSUMED')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  consumed_at timestamptz
);

create index if not exists idx_request_inventory_allocations_request on public.request_inventory_allocations(request_id);
create index if not exists idx_request_inventory_allocations_inventory on public.request_inventory_allocations(inventory_id);

create table if not exists public.blood_bank_transfer_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.emergency_requests(id) on delete cascade,
  blood_bank_id uuid not null references public.blood_banks(id),
  blood_group blood_group not null,
  component_type component_type not null,
  offered_units integer not null check (offered_units > 0),
  distance_km numeric(10,2),
  status text not null default 'OFFERED' check (status in ('OFFERED','ACCEPTED','IN_TRANSIT','DELIVERED','CANCELLED','EXPIRED')),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  completed_at timestamptz
);

create index if not exists idx_blood_bank_transfer_offers_request on public.blood_bank_transfer_offers(request_id);
create index if not exists idx_blood_bank_transfer_offers_bank on public.blood_bank_transfer_offers(blood_bank_id);

alter table public.request_inventory_allocations enable row level security;
alter table public.blood_bank_transfer_offers enable row level security;

drop policy if exists deny_anon_request_inventory_allocations on public.request_inventory_allocations;
drop policy if exists deny_authenticated_request_inventory_allocations on public.request_inventory_allocations;
create policy deny_anon_request_inventory_allocations on public.request_inventory_allocations for all to anon using (false) with check (false);
create policy deny_authenticated_request_inventory_allocations on public.request_inventory_allocations for all to authenticated using (false) with check (false);

drop policy if exists deny_anon_blood_bank_transfer_offers on public.blood_bank_transfer_offers;
drop policy if exists deny_authenticated_blood_bank_transfer_offers on public.blood_bank_transfer_offers;
create policy deny_anon_blood_bank_transfer_offers on public.blood_bank_transfer_offers for all to anon using (false) with check (false);
create policy deny_authenticated_blood_bank_transfer_offers on public.blood_bank_transfer_offers for all to authenticated using (false) with check (false);

create or replace function public.reserve_blood_inventory(
  p_request_id uuid,
  p_blood_group blood_group,
  p_component_type component_type,
  p_quantity integer
)
returns table (inventory_id uuid, blood_bank_id uuid, allocated_units integer, remaining_request_units integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_remaining integer := p_quantity;
  v_already_reserved integer := 0;
  v_row record;
  v_take integer;
  v_request_status request_status;
begin
  if p_quantity is null or p_quantity <= 0 then
    raise exception using errcode = '22023', message = 'quantity must be greater than zero';
  end if;

  select status into v_request_status from public.emergency_requests where id = p_request_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'emergency request not found'; end if;
  if v_request_status not in ('OPEN', 'PARTIALLY_FULFILLED') then
    raise exception using errcode = '55000', message = 'emergency request is not open for allocation';
  end if;

  if not exists (
    select 1 from public.emergency_requests
    where id = p_request_id and blood_group = p_blood_group and resource_type = p_component_type
  ) then
    raise exception using errcode = '22023', message = 'request resource does not match allocation';
  end if;

  select coalesce(sum(allocated_units), 0) into v_already_reserved
  from public.request_inventory_allocations
  where request_id = p_request_id and status = 'RESERVED';
  v_remaining := greatest(0, p_quantity - v_already_reserved);

  if v_remaining = 0 then
    update public.emergency_requests set status = 'FULFILLED'::request_status, completed_at = coalesce(completed_at, now()) where id = p_request_id;
    return;
  end if;

  for v_row in
    select bi.id, bi.blood_bank_id, bi.available_units
    from public.blood_inventory bi
    join public.blood_banks bb on bb.id = bi.blood_bank_id
    where bi.blood_group = p_blood_group and bi.component_type = p_component_type
      and bi.available_units > 0 and bi.expiry_date > now() and bb.verified = true
    order by bi.expiry_date asc, bi.last_updated asc, bi.id
    for update of bi
  loop
    exit when v_remaining <= 0;
    v_take := least(v_remaining, v_row.available_units);
    update public.blood_inventory
      set available_units = available_units - v_take, reserved_units = reserved_units + v_take, last_updated = now()
      where id = v_row.id;
    insert into public.request_inventory_allocations(request_id, inventory_id, blood_bank_id, allocated_units)
      values (p_request_id, v_row.id, v_row.blood_bank_id, v_take);
    inventory_id := v_row.id; blood_bank_id := v_row.blood_bank_id; allocated_units := v_take;
    v_remaining := v_remaining - v_take; remaining_request_units := v_remaining;
    return next;
  end loop;

  update public.emergency_requests
    set status = case when v_remaining = 0 then 'FULFILLED'::request_status else 'PARTIALLY_FULFILLED'::request_status end,
        completed_at = case when v_remaining = 0 then now() else null end
    where id = p_request_id;
  return;
end;
$$;

revoke all on function public.reserve_blood_inventory(uuid, blood_group, component_type, integer) from public, anon, authenticated;
grant execute on function public.reserve_blood_inventory(uuid, blood_group, component_type, integer) to service_role;
