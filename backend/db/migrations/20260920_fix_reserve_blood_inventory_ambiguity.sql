CREATE OR REPLACE FUNCTION public.reserve_blood_inventory(
  p_request_id uuid,
  p_blood_group public.blood_group,
  p_component_type public.component_type,
  p_quantity integer
)
RETURNS TABLE(inventory_id uuid, blood_bank_id uuid, allocated_units integer, remaining_request_units integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_remaining integer := p_quantity;
  v_already_reserved integer := 0;
  v_row record;
  v_take integer;
  v_request_status public.request_status;
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'quantity must be greater than zero';
  END IF;

  SELECT er.status INTO v_request_status
  FROM public.emergency_requests er
  WHERE er.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'emergency request not found';
  END IF;

  IF v_request_status NOT IN ('OPEN'::public.request_status, 'PARTIALLY_FULFILLED'::public.request_status) THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'emergency request is not open for allocation';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.emergency_requests er
    WHERE er.id = p_request_id
      AND er.blood_group = p_blood_group
      AND er.resource_type = p_component_type
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'request resource does not match allocation';
  END IF;

  SELECT COALESCE(SUM(ria.allocated_units), 0)
  INTO v_already_reserved
  FROM public.request_inventory_allocations ria
  WHERE ria.request_id = p_request_id
    AND ria.status = 'RESERVED';

  v_remaining := GREATEST(0, p_quantity - v_already_reserved);

  IF v_remaining = 0 THEN
    UPDATE public.emergency_requests er
    SET status = 'FULFILLED'::public.request_status,
        completed_at = COALESCE(er.completed_at, now())
    WHERE er.id = p_request_id;
    RETURN;
  END IF;

  FOR v_row IN
    SELECT bi.id, bi.blood_bank_id, bi.available_units
    FROM public.blood_inventory bi
    JOIN public.blood_banks bb ON bb.id = bi.blood_bank_id
    WHERE bi.blood_group = p_blood_group
      AND bi.component_type = p_component_type
      AND bi.available_units > 0
      AND bi.expiry_date > now()
      AND bb.verified = true
    ORDER BY bi.expiry_date ASC, bi.last_updated ASC, bi.id
    FOR UPDATE OF bi
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := LEAST(v_remaining, v_row.available_units);

    UPDATE public.blood_inventory bi
    SET available_units = bi.available_units - v_take,
        reserved_units = bi.reserved_units + v_take,
        last_updated = now()
    WHERE bi.id = v_row.id;

    INSERT INTO public.request_inventory_allocations(request_id, inventory_id, blood_bank_id, allocated_units)
    VALUES (p_request_id, v_row.id, v_row.blood_bank_id, v_take);

    inventory_id := v_row.id;
    blood_bank_id := v_row.blood_bank_id;
    allocated_units := v_take;
    v_remaining := v_remaining - v_take;
    remaining_request_units := v_remaining;
    RETURN NEXT;
  END LOOP;

  UPDATE public.emergency_requests er
  SET status = CASE
      WHEN v_remaining = 0 THEN 'FULFILLED'::public.request_status
      ELSE 'PARTIALLY_FULFILLED'::public.request_status
    END,
    completed_at = CASE WHEN v_remaining = 0 THEN now() ELSE NULL END
  WHERE er.id = p_request_id;

  RETURN;
END;
$function$;