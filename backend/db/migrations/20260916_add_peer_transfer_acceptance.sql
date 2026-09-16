create or replace function public.accept_blood_bank_transfer_offer(
  p_offer_id uuid,
  p_blood_bank_id uuid
)
returns table (
  offer_id uuid,
  request_id uuid,
  blood_bank_id uuid,
  reserved_units integer,
  remaining_request_units integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_offer public.blood_bank_transfer_offers%rowtype;
  v_request public.emergency_requests%rowtype;
  v_remaining integer;
  v_reserved integer := 0;
  v_row record;
  v_take integer;
  v_transferable integer;
begin
  select * into v_offer
  from public.blood_bank_transfer_offers
  where id = p_offer_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'transfer offer not found';
  end if;

  if v_offer.blood_bank_id <> p_blood_bank_id then
    raise exception using errcode = '42501', message = 'transfer offer does not belong to this blood bank';
  end if;

  if v_offer.status <> 'OFFERED' then
    raise exception using errcode = '55000', message = 'transfer offer is no longer available';
  end if;

  select * into v_request
  from public.emergency_requests
  where id = v_offer.request_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'emergency request not found';
  end if;

  if v_request.status not in ('OPEN', 'PARTIALLY_FULFILLED') then
    raise exception using errcode = '55000', message = 'emergency request is not open for transfer acceptance';
  end if;

  if v_request.blood_group <> v_offer.blood_group or v_request.resource_type <> v_offer.component_type then
    raise exception using errcode = '22023', message = 'transfer offer resource does not match emergency request';
  end if;

  select coalesce(sum(allocated_units), 0)
  into v_reserved
  from public.request_inventory_allocations
  where request_id = v_offer.request_id and status = 'RESERVED';

  v_remaining := greatest(0, v_request.quantity - v_reserved);
  if v_remaining = 0 then
    update public.blood_bank_transfer_offers
    set status = 'EXPIRED'
    where id = v_offer.id;
    raise exception using errcode = '55000', message = 'emergency request is already fully reserved';
  end if;

  v_take := least(v_offer.offered_units, v_remaining);

  for v_row in
    select bi.id, bi.available_units, bi.critical_level
    from public.blood_inventory bi
    where bi.blood_bank_id = p_blood_bank_id
      and bi.blood_group = v_offer.blood_group
      and bi.component_type = v_offer.component_type
      and bi.expiry_date > now()
      and bi.available_units > bi.critical_level
    order by bi.expiry_date asc, bi.last_updated asc, bi.id
    for update
  loop
    exit when v_take <= 0;
    v_transferable := greatest(0, v_row.available_units - v_row.critical_level);
    if v_transferable <= 0 then
      continue;
    end if;

    v_take := v_take - least(v_take, v_transferable);
  end loop;

  v_take := least(v_offer.offered_units, v_remaining);
  declare
    v_allocated integer := 0;
  begin
    for v_row in
      select bi.id, bi.available_units, bi.critical_level
      from public.blood_inventory bi
      where bi.blood_bank_id = p_blood_bank_id
        and bi.blood_group = v_offer.blood_group
        and bi.component_type = v_offer.component_type
        and bi.expiry_date > now()
        and bi.available_units > bi.critical_level
      order by bi.expiry_date asc, bi.last_updated asc, bi.id
      for update
    loop
      exit when v_allocated >= v_take;
      v_transferable := greatest(0, v_row.available_units - v_row.critical_level);
      if v_transferable <= 0 then
        continue;
      end if;

      v_take := least(v_offer.offered_units, v_remaining);
      v_transferable := least(v_transferable, v_take - v_allocated);
      if v_transferable <= 0 then
        continue;
      end if;

      update public.blood_inventory
      set available_units = available_units - v_transferable,
          reserved_units = reserved_units + v_transferable,
          last_updated = now()
      where id = v_row.id;

      insert into public.request_inventory_allocations(request_id, inventory_id, blood_bank_id, allocated_units)
      values (v_offer.request_id, v_row.id, p_blood_bank_id, v_transferable);

      v_allocated := v_allocated + v_transferable;
    end loop;

    if v_allocated < v_take then
      raise exception using errcode = '40001', message = 'insufficient transferable inventory for this offer';
    end if;

    update public.blood_bank_transfer_offers
    set status = 'ACCEPTED', accepted_at = now()
    where id = v_offer.id and status = 'OFFERED';

    if not found then
      raise exception using errcode = '40001', message = 'transfer offer changed during acceptance';
    end if;

    v_reserved := v_reserved + v_allocated;
    update public.emergency_requests
    set status = case when v_reserved >= v_request.quantity then 'FULFILLED'::request_status else 'PARTIALLY_FULFILLED'::request_status end,
        completed_at = case when v_reserved >= v_request.quantity then coalesce(completed_at, now()) else null end
    where id = v_request.id;

    offer_id := v_offer.id;
    request_id := v_offer.request_id;
    blood_bank_id := p_blood_bank_id;
    reserved_units := v_allocated;
    remaining_request_units := greatest(0, v_request.quantity - v_reserved);
    return next;
  end;
end;
$$;

revoke all on function public.accept_blood_bank_transfer_offer(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accept_blood_bank_transfer_offer(uuid, uuid) to service_role;
