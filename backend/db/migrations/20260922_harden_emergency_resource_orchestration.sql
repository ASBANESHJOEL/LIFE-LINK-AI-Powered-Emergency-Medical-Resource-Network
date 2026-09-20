-- ============================================================================
-- LIFE-LINK PHASE 5: Emergency Resource Orchestration & Production Hardening
-- Migration: 20260922_harden_emergency_resource_orchestration.sql
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. STATE MACHINE TRANSITION ENFORCEMENT TRIGGER
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_enforce_emergency_request_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_allocated_units integer := 0;
BEGIN
  -- Allow idempotent updates (same status)
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Terminal statuses: FULFILLED, CANCELLED, and EXPIRED cannot transition to any other status
  IF OLD.status IN ('FULFILLED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION USING
      errcode = '55000',
      message = 'Invalid emergency request status transition: cannot transition from terminal status ' || OLD.status || ' to ' || NEW.status;
  END IF;

  -- Allowed active transitions:
  -- From OPEN: PARTIALLY_FULFILLED, FULFILLED, CANCELLED, EXPIRED
  -- From PARTIALLY_FULFILLED: OPEN, FULFILLED, CANCELLED, EXPIRED
  -- All other combinations are rejected
  IF OLD.status = 'OPEN' AND NEW.status NOT IN ('PARTIALLY_FULFILLED', 'FULFILLED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION USING
      errcode = '55000',
      message = 'Invalid emergency request status transition from OPEN to ' || NEW.status;
  END IF;

  IF OLD.status = 'PARTIALLY_FULFILLED' AND NEW.status NOT IN ('OPEN', 'FULFILLED', 'CANCELLED', 'EXPIRED') THEN
    RAISE EXCEPTION USING
      errcode = '55000',
      message = 'Invalid emergency request status transition from PARTIALLY_FULFILLED to ' || NEW.status;
  END IF;

  -- Authoritative resource allocation integrity checks
  -- Fulfilment and partial fulfilment must be backed by actual allocations in request_inventory_allocations
  IF NEW.status IN ('PARTIALLY_FULFILLED', 'FULFILLED', 'OPEN') THEN
    SELECT coalesce(sum(ria.allocated_units), 0)
    INTO v_allocated_units
    FROM public.request_inventory_allocations ria
    WHERE ria.request_id = NEW.id
      AND ria.status IN ('RESERVED', 'CONSUMED');

    IF NEW.status = 'FULFILLED' THEN
      IF v_allocated_units < NEW.quantity THEN
        RAISE EXCEPTION USING
          errcode = '55000',
          message = 'Cannot transition emergency request to FULFILLED: allocated units (' || v_allocated_units || ') do not satisfy requested quantity (' || NEW.quantity || ')';
      END IF;
    END IF;

    IF NEW.status = 'PARTIALLY_FULFILLED' THEN
      IF v_allocated_units <= 0 THEN
        RAISE EXCEPTION USING
          errcode = '55000',
          message = 'Cannot transition emergency request to PARTIALLY_FULFILLED: request has zero allocated units';
      END IF;
      IF v_allocated_units >= NEW.quantity THEN
        RAISE EXCEPTION USING
          errcode = '55000',
          message = 'Cannot transition emergency request to PARTIALLY_FULFILLED: allocated units (' || v_allocated_units || ') fully satisfy requested quantity (' || NEW.quantity || ')';
      END IF;
    END IF;

    IF OLD.status = 'PARTIALLY_FULFILLED' AND NEW.status = 'OPEN' THEN
      IF v_allocated_units > 0 THEN
        RAISE EXCEPTION USING
          errcode = '55000',
          message = 'Cannot transition emergency request to OPEN: request still has ' || v_allocated_units || ' active allocated units';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emergency_request_status_transition ON public.emergency_requests;
CREATE TRIGGER trg_emergency_request_status_transition
  BEFORE UPDATE OF status ON public.emergency_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_emergency_request_status_transition();

-- ----------------------------------------------------------------------------
-- 2. HARDENED cancel_emergency_request RPC (WITH INVENTORY RELEASE & OFFER CANCELLATION)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.cancel_emergency_request(uuid, uuid);
CREATE OR REPLACE FUNCTION public.cancel_emergency_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (
  request_id uuid,
  request_status public.request_status,
  released_dispatch_count integer,
  released_inventory_units integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request record;
  v_released_dispatches integer := 0;
  v_released_units integer := 0;
  v_alloc record;
  v_now timestamptz := now();
BEGIN
  -- 1. Lock emergency request row exclusively
  SELECT * INTO v_request
  FROM public.emergency_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Emergency request not found';
  END IF;

  -- Idempotent check
  IF v_request.status = 'CANCELLED' THEN
    RETURN QUERY SELECT v_request.id, v_request.status, 0, 0;
    RETURN;
  END IF;

  -- Disallow cancellation of terminal states
  IF v_request.status = 'FULFILLED' THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'Cannot cancel an emergency request that is already fulfilled';
  END IF;

  IF v_request.status = 'EXPIRED' THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'Cannot cancel an emergency request that has expired';
  END IF;

  -- 2. Transition request status to CANCELLED
  UPDATE public.emergency_requests
  SET status = 'CANCELLED'::public.request_status
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- 3. Release any RESERVED inventory allocations back to blood_inventory
  FOR v_alloc IN
    SELECT ria.id, ria.inventory_id, ria.allocated_units
    FROM public.request_inventory_allocations ria
    WHERE ria.request_id = p_request_id
      AND ria.status = 'RESERVED'
    FOR UPDATE
  LOOP
    UPDATE public.blood_inventory bi
    SET available_units = bi.available_units + v_alloc.allocated_units,
        reserved_units = greatest(0, bi.reserved_units - v_alloc.allocated_units),
        last_updated = v_now
    WHERE bi.id = v_alloc.inventory_id;

    UPDATE public.request_inventory_allocations ria
    SET status = 'RELEASED',
        released_at = v_now
    WHERE ria.id = v_alloc.id;

    v_released_units := v_released_units + v_alloc.allocated_units;
  END LOOP;

  -- 4. Cancel pending peer transfer offers
  UPDATE public.blood_bank_transfer_offers
  SET status = 'CANCELLED'
  WHERE blood_bank_transfer_offers.request_id = p_request_id
    AND blood_bank_transfer_offers.status = 'OFFERED';

  -- 5. Release all active/non-terminal donor dispatches
  WITH updated_dispatches AS (
    UPDATE public.donor_dispatches
    SET status = 'CANCELLED'::public.dispatch_status,
        cancellation_reason = 'REQUEST_CANCELLED',
        cancelled_at = v_now
    WHERE donor_dispatches.request_id = p_request_id
      AND donor_dispatches.status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED')
    RETURNING donor_dispatches.id
  )
  SELECT count(*) INTO v_released_dispatches FROM updated_dispatches;

  -- 6. Structured audit log entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) VALUES (
    p_actor_user_id,
    'EMERGENCY_REQUEST_CANCELLED',
    'emergency_request',
    p_request_id,
    jsonb_build_object(
      'released_dispatch_count', v_released_dispatches,
      'released_inventory_units', v_released_units
    ),
    false
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_released_dispatches, v_released_units;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_emergency_request(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_emergency_request(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 3. HARDENED expire_emergency_request RPC (WITH INVENTORY RELEASE & DISPATCH CLEANUP)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.expire_emergency_request(uuid, uuid);
CREATE OR REPLACE FUNCTION public.expire_emergency_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (
  request_id uuid,
  request_status public.request_status,
  released_dispatch_count integer,
  released_inventory_units integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request record;
  v_released_dispatches integer := 0;
  v_released_units integer := 0;
  v_alloc record;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request
  FROM public.emergency_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Emergency request not found';
  END IF;

  -- Idempotent check
  IF v_request.status = 'EXPIRED' THEN
    RETURN QUERY SELECT v_request.id, v_request.status, 0, 0;
    RETURN;
  END IF;

  IF v_request.status IN ('FULFILLED', 'CANCELLED') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'Cannot expire an emergency request that is already in status ' || v_request.status;
  END IF;

  -- Transition status to EXPIRED
  UPDATE public.emergency_requests
  SET status = 'EXPIRED'::public.request_status
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Release any RESERVED inventory allocations back to blood_inventory
  FOR v_alloc IN
    SELECT ria.id, ria.inventory_id, ria.allocated_units
    FROM public.request_inventory_allocations ria
    WHERE ria.request_id = p_request_id
      AND ria.status = 'RESERVED'
    FOR UPDATE
  LOOP
    UPDATE public.blood_inventory bi
    SET available_units = bi.available_units + v_alloc.allocated_units,
        reserved_units = greatest(0, bi.reserved_units - v_alloc.allocated_units),
        last_updated = v_now
    WHERE bi.id = v_alloc.inventory_id;

    UPDATE public.request_inventory_allocations ria
    SET status = 'RELEASED',
        released_at = v_now
    WHERE ria.id = v_alloc.id;

    v_released_units := v_released_units + v_alloc.allocated_units;
  END LOOP;

  -- Expire pending peer transfer offers
  UPDATE public.blood_bank_transfer_offers
  SET status = 'EXPIRED'
  WHERE blood_bank_transfer_offers.request_id = p_request_id
    AND blood_bank_transfer_offers.status = 'OFFERED';

  -- Release active dispatches with reason REQUEST_EXPIRED
  WITH updated_dispatches AS (
    UPDATE public.donor_dispatches
    SET status = 'CANCELLED'::public.dispatch_status,
        cancellation_reason = 'REQUEST_EXPIRED',
        cancelled_at = v_now
    WHERE donor_dispatches.request_id = p_request_id
      AND donor_dispatches.status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED')
    RETURNING donor_dispatches.id
  )
  SELECT count(*) INTO v_released_dispatches FROM updated_dispatches;

  -- Structured audit log entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) VALUES (
    p_actor_user_id,
    'EMERGENCY_REQUEST_EXPIRED',
    'emergency_request',
    p_request_id,
    jsonb_build_object(
      'released_dispatch_count', v_released_dispatches,
      'released_inventory_units', v_released_units
    ),
    false
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_released_dispatches, v_released_units;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_emergency_request(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_emergency_request(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 4. HARDENED accept_blood_bank_transfer_offer RPC (SECURITY DEFINER + AUDIT)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.accept_blood_bank_transfer_offer(
  p_offer_id uuid,
  p_blood_bank_id uuid
)
RETURNS TABLE (
  offer_id uuid,
  request_id uuid,
  blood_bank_id uuid,
  reserved_units integer,
  remaining_request_units integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_offer public.blood_bank_transfer_offers%rowtype;
  v_request public.emergency_requests%rowtype;
  v_remaining integer;
  v_reserved integer := 0;
  v_row record;
  v_take integer;
  v_allocated integer := 0;
  v_transferable integer;
  v_now timestamptz := now();
BEGIN
  -- 1. Lock offer row
  SELECT * INTO v_offer
  FROM public.blood_bank_transfer_offers
  WHERE id = p_offer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'transfer offer not found';
  END IF;

  IF v_offer.blood_bank_id <> p_blood_bank_id THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'transfer offer does not belong to this blood bank';
  END IF;

  IF v_offer.status <> 'OFFERED' THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'transfer offer is no longer available';
  END IF;

  -- 2. Lock emergency request row
  SELECT * INTO v_request
  FROM public.emergency_requests
  WHERE id = v_offer.request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'emergency request not found';
  END IF;

  IF v_request.status NOT IN ('OPEN', 'PARTIALLY_FULFILLED') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'emergency request is not open for transfer acceptance';
  END IF;

  IF v_request.blood_group <> v_offer.blood_group OR v_request.resource_type <> v_offer.component_type THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'transfer offer resource does not match emergency request';
  END IF;

  -- 3. Calculate remaining need
  SELECT coalesce(sum(ria.allocated_units), 0)
  INTO v_reserved
  FROM public.request_inventory_allocations ria
  WHERE ria.request_id = v_offer.request_id AND ria.status = 'RESERVED';

  v_remaining := greatest(0, v_request.quantity - v_reserved);
  IF v_remaining = 0 THEN
    UPDATE public.blood_bank_transfer_offers
    SET status = 'EXPIRED'
    WHERE id = v_offer.id;
    RAISE EXCEPTION USING errcode = '55000', message = 'emergency request is already fully reserved';
  END IF;

  v_take := least(v_offer.offered_units, v_remaining);

  -- 4. Deterministic row locking order on source blood_inventory
  FOR v_row IN
    SELECT bi.id, bi.available_units, bi.critical_level
    FROM public.blood_inventory bi
    WHERE bi.blood_bank_id = p_blood_bank_id
      AND bi.blood_group = v_offer.blood_group
      AND bi.component_type = v_offer.component_type
      AND bi.expiry_date > v_now
      AND bi.available_units > bi.critical_level
    ORDER BY bi.expiry_date ASC, bi.last_updated ASC, bi.id
    FOR UPDATE
  LOOP
    EXIT WHEN v_allocated >= v_take;
    v_transferable := greatest(0, v_row.available_units - v_row.critical_level);
    IF v_transferable <= 0 THEN
      CONTINUE;
    END IF;

    v_transferable := least(v_transferable, v_take - v_allocated);
    UPDATE public.blood_inventory bi
    SET available_units = bi.available_units - v_transferable,
        reserved_units = bi.reserved_units + v_transferable,
        last_updated = v_now
    WHERE bi.id = v_row.id;

    INSERT INTO public.request_inventory_allocations(request_id, inventory_id, blood_bank_id, allocated_units)
    VALUES (v_offer.request_id, v_row.id, p_blood_bank_id, v_transferable);

    v_allocated := v_allocated + v_transferable;
  END LOOP;

  IF v_allocated < v_take THEN
    RAISE EXCEPTION USING errcode = '40001', message = 'insufficient transferable inventory for this offer';
  END IF;

  UPDATE public.blood_bank_transfer_offers bbto
  SET status = 'ACCEPTED', accepted_at = v_now
  WHERE bbto.id = v_offer.id AND bbto.status = 'OFFERED';

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '40001', message = 'transfer offer changed during acceptance';
  END IF;

  v_reserved := v_reserved + v_allocated;

  UPDATE public.emergency_requests er
  SET status = CASE WHEN v_reserved >= v_request.quantity THEN 'FULFILLED'::public.request_status ELSE 'PARTIALLY_FULFILLED'::public.request_status END,
      completed_at = CASE WHEN v_reserved >= v_request.quantity THEN coalesce(er.completed_at, v_now) ELSE NULL END
  WHERE er.id = v_request.id;

  -- 5. Audit log entry
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) VALUES (
    NULL,
    'PEER_TRANSFER_ACCEPTED',
    'blood_bank_transfer_offer',
    v_offer.id,
    jsonb_build_object(
      'request_id', v_offer.request_id,
      'blood_bank_id', p_blood_bank_id,
      'reserved_units', v_allocated,
      'remaining_units', greatest(0, v_request.quantity - v_reserved)
    ),
    false
  );

  offer_id := v_offer.id;
  request_id := v_offer.request_id;
  blood_bank_id := p_blood_bank_id;
  reserved_units := v_allocated;
  remaining_request_units := greatest(0, v_request.quantity - v_reserved);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.accept_blood_bank_transfer_offer(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_blood_bank_transfer_offer(uuid, uuid) TO service_role;

-- ----------------------------------------------------------------------------
-- 5. HARDENED reserve_blood_inventory RPC (WITH AUDIT LOGGING)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reserve_blood_inventory(
  p_request_id uuid,
  p_blood_group public.blood_group,
  p_component_type public.component_type,
  p_quantity integer
)
RETURNS TABLE (
  inventory_id uuid,
  blood_bank_id uuid,
  allocated_units integer,
  remaining_request_units integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_remaining integer := p_quantity;
  v_already_reserved integer := 0;
  v_row record;
  v_take integer;
  v_request_status public.request_status;
  v_request_quantity integer;
  v_total_taken integer := 0;
  v_total_reserved integer := 0;
  v_now timestamptz := now();
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'quantity must be greater than zero';
  END IF;

  -- Lock target emergency request row exclusively
  SELECT er.status, er.quantity INTO v_request_status, v_request_quantity
  FROM public.emergency_requests er
  WHERE er.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'emergency request not found';
  END IF;

  IF v_request_status NOT IN ('OPEN', 'PARTIALLY_FULFILLED') THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'emergency request is not open for allocation';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.emergency_requests er
    WHERE er.id = p_request_id
      AND er.blood_group = p_blood_group
      AND er.resource_type = p_component_type
  ) THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'request resource does not match allocation';
  END IF;

  SELECT coalesce(sum(ria.allocated_units), 0) INTO v_already_reserved
  FROM public.request_inventory_allocations ria
  WHERE ria.request_id = p_request_id
    AND ria.status = 'RESERVED';

  -- Remaining units needed for this request (cannot reserve more than request needs or p_quantity requested)
  v_remaining := least(p_quantity, greatest(0, v_request_quantity - v_already_reserved));

  -- Idempotency check: if all requested units already reserved, return
  IF (v_request_quantity - v_already_reserved) <= 0 THEN
    UPDATE public.emergency_requests er
    SET status = 'FULFILLED'::public.request_status,
        completed_at = coalesce(er.completed_at, v_now)
    WHERE er.id = p_request_id;
    RETURN;
  END IF;

  -- Deterministic row locking order prevents deadlocks
  FOR v_row IN
    SELECT bi.id, bi.blood_bank_id, bi.available_units
    FROM public.blood_inventory bi
    JOIN public.blood_banks bb ON bb.id = bi.blood_bank_id
    WHERE bi.blood_group = p_blood_group
      AND bi.component_type = p_component_type
      AND bi.available_units > 0
      AND bi.expiry_date > v_now
      AND bb.verified = true
    ORDER BY bi.expiry_date ASC, bi.last_updated ASC, bi.id
    FOR UPDATE OF bi
  LOOP
    EXIT WHEN v_remaining <= 0;
    v_take := least(v_remaining, v_row.available_units);

    UPDATE public.blood_inventory bi
    SET available_units = bi.available_units - v_take,
        reserved_units = bi.reserved_units + v_take,
        last_updated = v_now
    WHERE bi.id = v_row.id;

    INSERT INTO public.request_inventory_allocations(
      request_id,
      inventory_id,
      blood_bank_id,
      allocated_units
    )
    VALUES (
      p_request_id,
      v_row.id,
      v_row.blood_bank_id,
      v_take
    );

    v_total_taken := v_total_taken + v_take;
    inventory_id := v_row.id;
    blood_bank_id := v_row.blood_bank_id;
    allocated_units := v_take;
    v_remaining := v_remaining - v_take;
    remaining_request_units := greatest(0, v_request_quantity - (v_already_reserved + v_total_taken));
    RETURN NEXT;
  END LOOP;

  v_total_reserved := v_already_reserved + v_total_taken;

  -- Status transition based on actual inventory allocation vs request quantity
  UPDATE public.emergency_requests er
  SET status = CASE
        WHEN v_total_reserved >= v_request_quantity THEN 'FULFILLED'::public.request_status
        WHEN v_total_reserved > 0 THEN 'PARTIALLY_FULFILLED'::public.request_status
        ELSE v_request_status
      END,
      completed_at = CASE
        WHEN v_total_reserved >= v_request_quantity THEN coalesce(er.completed_at, v_now)
        ELSE NULL
      END
  WHERE er.id = p_request_id;

  IF v_total_taken > 0 THEN
    INSERT INTO public.audit_logs (
      actor_user_id,
      action,
      entity_type,
      entity_id,
      metadata,
      is_synthetic
    ) VALUES (
      NULL,
      'INVENTORY_RESERVED',
      'emergency_request',
      p_request_id,
      jsonb_build_object(
        'blood_group', p_blood_group,
        'component_type', p_component_type,
        'allocated_units', v_total_taken,
        'remaining_units', greatest(0, v_request_quantity - v_total_reserved)
      ),
      false
    );
  END IF;

  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_blood_inventory(uuid, public.blood_group, public.component_type, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_blood_inventory(uuid, public.blood_group, public.component_type, integer) TO service_role;
