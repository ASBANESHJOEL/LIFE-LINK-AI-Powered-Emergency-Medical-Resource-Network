-- ============================================================================
-- LIFE-LINK PHASE 4: Emergency Critical Path & Donor Resilience
-- Migration: 20260921_add_phase4_emergency_resilience.sql
-- ============================================================================

-- 1. Schema Extensions on public.donor_dispatches
ALTER TABLE public.donor_dispatches
  ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ NULL;

-- 2. Drop unconditional unique constraint (request_id, donor_id) if present
-- so a donor with a past CANCELLED/COMPLETED dispatch can receive a new dispatch
-- when appropriate, while preserving the partial unique index on active states.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'donor_dispatches_request_id_donor_id_key'
      AND conrelid = 'public.donor_dispatches'::regclass
  ) THEN
    ALTER TABLE public.donor_dispatches
      DROP CONSTRAINT donor_dispatches_request_id_donor_id_key;
  END IF;
END $$;

-- 3. Ensure active dispatch unique index on request + donor
DROP INDEX IF EXISTS public.uq_donor_dispatch_active_request_donor;
CREATE UNIQUE INDEX IF NOT EXISTS uq_donor_dispatch_active_request_donor
  ON public.donor_dispatches (request_id, donor_id)
  WHERE status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED');

-- 4. Global single-active-dispatch constraint per donor
-- A donor cannot be concurrently active (ACCEPTED, EN_ROUTE, ARRIVED) on more than one emergency request.
-- Terminal states (COMPLETED, CANCELLED, DECLINED, etc.) do not block.
DROP INDEX IF EXISTS public.uq_donor_active_dispatch;
CREATE UNIQUE INDEX IF NOT EXISTS uq_donor_active_dispatch
  ON public.donor_dispatches (donor_id)
  WHERE status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

-- 5. Hardened respond_to_donor_dispatch RPC
CREATE OR REPLACE FUNCTION public.respond_to_donor_dispatch(
  p_dispatch_id uuid,
  p_donor_user_id uuid,
  p_response text
)
RETURNS TABLE (
  dispatch_id uuid,
  request_id uuid,
  donor_id uuid,
  dispatch_status dispatch_status,
  request_status request_status,
  remaining_units integer,
  is_already_responded boolean,
  responded_at timestamp with time zone,
  accepted_at timestamp with time zone
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_donor_id uuid;
  v_dispatch record;
  v_request record;
  v_reserved_inventory integer;
  v_active_accepted_donors integer;
  v_total_covered integer;
  v_remaining integer;
  v_new_remaining integer;
  v_norm_response text;
  v_now timestamptz := now();
BEGIN
  -- 1. Validate response parameter
  v_norm_response := upper(trim(coalesce(p_response, '')));
  IF v_norm_response NOT IN ('ACCEPT', 'DECLINE') THEN
    RAISE EXCEPTION USING errcode = '22023', message = 'Response must be either ACCEPT or DECLINE';
  END IF;

  -- 2. Resolve donor record from authenticated donor user_id
  SELECT id INTO v_donor_id
  FROM public.donors
  WHERE user_id = p_donor_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Donor profile not found for authenticated user';
  END IF;

  -- 3. Lock and retrieve dispatch record for update
  SELECT * INTO v_dispatch
  FROM public.donor_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Donor dispatch not found';
  END IF;

  -- 4. Verify ownership: dispatch must belong to this donor
  IF v_dispatch.donor_id <> v_donor_id THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Unauthorized: dispatch does not belong to this donor';
  END IF;

  -- 5. Handle ACCEPT
  IF v_norm_response = 'ACCEPT' THEN
    -- Idempotent handling if already accepted/en_route/arrived
    IF v_dispatch.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED') THEN
      SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

      SELECT coalesce(sum(ria.allocated_units), 0) INTO v_reserved_inventory
      FROM public.request_inventory_allocations ria
      WHERE ria.request_id = v_request.id AND ria.status = 'RESERVED';

      SELECT count(*) INTO v_active_accepted_donors
      FROM public.donor_dispatches dd
      WHERE dd.request_id = v_request.id AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

      v_total_covered := v_reserved_inventory + v_active_accepted_donors;
      v_remaining := greatest(0, v_request.quantity - v_total_covered);

      RETURN QUERY SELECT
        v_dispatch.id,
        v_dispatch.request_id,
        v_dispatch.donor_id,
        v_dispatch.status,
        v_request.status,
        v_remaining,
        true,
        v_dispatch.responded_at,
        v_dispatch.accepted_at;
      RETURN;
    END IF;

    -- Disallow invalid transition from terminal states
    IF v_dispatch.status = 'DECLINED' THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot accept a dispatch that has already been declined';
    END IF;

    IF v_dispatch.status IN ('COMPLETED', 'CANCELLED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot accept dispatch in status ' || v_dispatch.status;
    END IF;

    IF v_dispatch.status NOT IN ('PENDING', 'NOTIFIED', 'RESPONDED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot accept dispatch in status ' || v_dispatch.status;
    END IF;

    -- Lock emergency request to evaluate fulfillment and shortage atomically
    SELECT * INTO v_request
    FROM public.emergency_requests
    WHERE id = v_dispatch.request_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING errcode = 'P0002', message = 'Emergency request not found';
    END IF;

    -- Check if request is still open
    IF v_request.status NOT IN ('OPEN', 'PARTIALLY_FULFILLED') THEN
      -- Request is already FULFILLED or CANCELLED: release this surplus dispatch cleanly
      UPDATE public.donor_dispatches
      SET status = 'CANCELLED'::public.dispatch_status,
          cancellation_reason = 'REQUEST_FULFILLED',
          cancelled_at = v_now,
          responded_at = coalesce(donor_dispatches.responded_at, v_now)
      WHERE donor_dispatches.id = p_dispatch_id
      RETURNING * INTO v_dispatch;

      RAISE EXCEPTION USING errcode = '55000', message = 'Emergency request is no longer open for donor acceptance';
    END IF;

    -- Calculate current coverage: reserved inventory + active accepted donors
    -- COMPLETED is NOT an active dispatch.
    SELECT coalesce(sum(ria.allocated_units), 0) INTO v_reserved_inventory
    FROM public.request_inventory_allocations ria
    WHERE ria.request_id = v_request.id AND ria.status = 'RESERVED';

    SELECT count(*) INTO v_active_accepted_donors
    FROM public.donor_dispatches dd
    WHERE dd.request_id = v_request.id AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

    v_total_covered := v_reserved_inventory + v_active_accepted_donors;
    v_remaining := greatest(0, v_request.quantity - v_total_covered);

    -- CASE A: Surplus Acceptance
    -- If request capacity is already satisfied by other accepted donors/inventory,
    -- safely release this surplus dispatch without over-allocation.
    IF v_remaining <= 0 THEN
      UPDATE public.donor_dispatches
      SET status = 'CANCELLED'::public.dispatch_status,
          cancellation_reason = 'REQUEST_FULFILLED',
          cancelled_at = v_now,
          responded_at = coalesce(donor_dispatches.responded_at, v_now)
      WHERE donor_dispatches.id = p_dispatch_id
      RETURNING * INTO v_dispatch;

      RAISE EXCEPTION USING errcode = '55000', message = 'Emergency request is already fully fulfilled';
    END IF;

    -- CASE B: Legitimate acceptance (remaining > 0)
    UPDATE public.donor_dispatches
    SET status = 'ACCEPTED'::public.dispatch_status,
        responded_at = coalesce(donor_dispatches.responded_at, v_now),
        accepted_at = v_now
    WHERE donor_dispatches.id = p_dispatch_id
    RETURNING * INTO v_dispatch;

    v_new_remaining := greatest(0, v_remaining - 1);

    -- Request status is derived strictly from actual resource fulfilment (inventory allocations),
    -- NOT manufactured from donor coordination/acceptance.
    -- If this acceptance satisfies the required donor assignment capacity,
    -- release any remaining unaccepted PENDING/NOTIFIED dispatches for this request as surplus:
    IF v_new_remaining = 0 THEN
      UPDATE public.donor_dispatches
      SET status = 'CANCELLED'::public.dispatch_status,
          cancellation_reason = 'SURPLUS_CAPACITY',
          cancelled_at = v_now
      WHERE donor_dispatches.request_id = v_request.id
        AND donor_dispatches.id <> p_dispatch_id
        AND donor_dispatches.status IN ('PENDING', 'NOTIFIED', 'RESPONDED');
    END IF;

    RETURN QUERY SELECT
      v_dispatch.id,
      v_dispatch.request_id,
      v_dispatch.donor_id,
      v_dispatch.status,
      v_request.status,
      v_new_remaining,
      false,
      v_dispatch.responded_at,
      v_dispatch.accepted_at;
    RETURN;
  END IF;

  -- 6. Handle DECLINE
  IF v_norm_response = 'DECLINE' THEN
    IF v_dispatch.status = 'DECLINED' THEN
      SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

      SELECT coalesce(sum(ria.allocated_units), 0) INTO v_reserved_inventory
      FROM public.request_inventory_allocations ria
      WHERE ria.request_id = v_request.id AND ria.status = 'RESERVED';

      SELECT count(*) INTO v_active_accepted_donors
      FROM public.donor_dispatches dd
      WHERE dd.request_id = v_request.id AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

      v_total_covered := v_reserved_inventory + v_active_accepted_donors;
      v_remaining := greatest(0, v_request.quantity - v_total_covered);

      RETURN QUERY SELECT
        v_dispatch.id,
        v_dispatch.request_id,
        v_dispatch.donor_id,
        v_dispatch.status,
        v_request.status,
        v_remaining,
        true,
        v_dispatch.responded_at,
        v_dispatch.accepted_at;
      RETURN;
    END IF;

    IF v_dispatch.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'COMPLETED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot decline a dispatch that is already accepted or completed';
    END IF;

    IF v_dispatch.status NOT IN ('PENDING', 'NOTIFIED', 'RESPONDED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot decline dispatch in status ' || v_dispatch.status;
    END IF;

    UPDATE public.donor_dispatches
    SET status = 'DECLINED'::public.dispatch_status,
        responded_at = coalesce(donor_dispatches.responded_at, v_now)
    WHERE donor_dispatches.id = p_dispatch_id
    RETURNING * INTO v_dispatch;

    SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

    SELECT coalesce(sum(ria.allocated_units), 0) INTO v_reserved_inventory
    FROM public.request_inventory_allocations ria
    WHERE ria.request_id = v_request.id AND ria.status = 'RESERVED';

    SELECT count(*) INTO v_active_accepted_donors
    FROM public.donor_dispatches dd
    WHERE dd.request_id = v_request.id AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

    v_total_covered := v_reserved_inventory + v_active_accepted_donors;
    v_remaining := greatest(0, v_request.quantity - v_total_covered);

    RETURN QUERY SELECT
      v_dispatch.id,
      v_dispatch.request_id,
      v_dispatch.donor_id,
      v_dispatch.status,
      v_request.status,
      v_remaining,
      false,
      v_dispatch.responded_at,
      v_dispatch.accepted_at;
    RETURN;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_donor_dispatch(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_donor_dispatch(uuid, uuid, text) TO service_role;

-- 6. RPC: release_donor_dispatch
-- Releases an active dispatch with a specified reason (GPS_TIMEOUT, DONOR_WITHDREW, ETA_EXCEEDED, etc.)
-- Re-evaluates request status based strictly on existing allocations and remaining active donors.
-- Leaves donor.eligibility_status completely untouched.
CREATE OR REPLACE FUNCTION public.release_donor_dispatch(
  p_dispatch_id uuid,
  p_actor_user_id uuid,
  p_reason text
)
RETURNS TABLE (
  dispatch_id uuid,
  request_id uuid,
  donor_id uuid,
  dispatch_status dispatch_status,
  request_status request_status,
  cancellation_reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_dispatch record;
  v_request record;
  v_reserved_inventory integer;
  v_active_donors integer;
  v_total_covered integer;
  v_now timestamptz := now();
  v_new_req_status public.request_status;
BEGIN
  -- 1. Lock dispatch row
  SELECT * INTO v_dispatch
  FROM public.donor_dispatches
  WHERE id = p_dispatch_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Donor dispatch not found';
  END IF;

  -- Idempotency check: if already cancelled
  IF v_dispatch.status = 'CANCELLED' THEN
    SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;
    RETURN QUERY SELECT
      v_dispatch.id,
      v_dispatch.request_id,
      v_dispatch.donor_id,
      v_dispatch.status,
      v_request.status,
      v_dispatch.cancellation_reason;
    RETURN;
  END IF;

  IF v_dispatch.status = 'COMPLETED' THEN
    RAISE EXCEPTION USING errcode = '55000', message = 'Cannot release a completed dispatch';
  END IF;

  -- 2. Release dispatch
  UPDATE public.donor_dispatches
  SET status = 'CANCELLED'::public.dispatch_status,
      cancellation_reason = p_reason,
      cancelled_at = v_now
  WHERE id = p_dispatch_id
  RETURNING * INTO v_dispatch;

  -- 3. Lock emergency request to update status based on actual remaining coverage
  SELECT * INTO v_request
  FROM public.emergency_requests
  WHERE id = v_dispatch.request_id
  FOR UPDATE;

  IF FOUND AND v_request.status <> 'CANCELLED' THEN
    IF p_reason = 'REQUEST_FULFILLED' THEN
      v_new_req_status := v_request.status;
    ELSE
      SELECT coalesce(sum(ria.allocated_units), 0) INTO v_reserved_inventory
      FROM public.request_inventory_allocations ria
      WHERE ria.request_id = v_request.id AND ria.status = 'RESERVED';

      -- Request status is derived strictly from actual resource fulfilment (inventory allocations),
      -- NOT manufactured from donor dispatch coordination state.
      IF v_reserved_inventory >= v_request.quantity THEN
        v_new_req_status := 'FULFILLED'::public.request_status;
      ELSIF v_reserved_inventory > 0 THEN
        v_new_req_status := 'PARTIALLY_FULFILLED'::public.request_status;
      ELSE
        v_new_req_status := 'OPEN'::public.request_status;
      END IF;

      IF v_request.status <> v_new_req_status THEN
        UPDATE public.emergency_requests
        SET status = v_new_req_status,
            completed_at = CASE WHEN v_new_req_status = 'FULFILLED' THEN coalesce(completed_at, v_now) ELSE NULL END
        WHERE id = v_request.id
        RETURNING * INTO v_request;
      END IF;
    END IF;
  END IF;

  -- 4. Audit log event
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) VALUES (
    p_actor_user_id,
    'DONOR_DISPATCH_RELEASED',
    'donor_dispatch',
    p_dispatch_id,
    jsonb_build_object(
      'request_id', v_dispatch.request_id,
      'donor_id', v_dispatch.donor_id,
      'reason', p_reason
    ),
    false
  );

  RETURN QUERY SELECT
    v_dispatch.id,
    v_dispatch.request_id,
    v_dispatch.donor_id,
    v_dispatch.status,
    v_request.status,
    v_dispatch.cancellation_reason;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.release_donor_dispatch(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_donor_dispatch(uuid, uuid, text) TO service_role;

-- 7. RPC: cancel_emergency_request
-- Hospital cancels request, releasing all active dispatches.
CREATE OR REPLACE FUNCTION public.cancel_emergency_request(
  p_request_id uuid,
  p_actor_user_id uuid
)
RETURNS TABLE (
  request_id uuid,
  request_status request_status,
  released_dispatch_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_request record;
  v_released_count integer := 0;
  v_now timestamptz := now();
BEGIN
  SELECT * INTO v_request
  FROM public.emergency_requests
  WHERE id = p_request_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = 'P0002', message = 'Emergency request not found';
  END IF;

  IF v_request.status = 'CANCELLED' THEN
    RETURN QUERY SELECT v_request.id, v_request.status, 0;
    RETURN;
  END IF;

  -- Update request to CANCELLED
  UPDATE public.emergency_requests
  SET status = 'CANCELLED'::public.request_status
  WHERE id = p_request_id
  RETURNING * INTO v_request;

  -- Release all non-terminal dispatches
  WITH updated_rows AS (
    UPDATE public.donor_dispatches
    SET status = 'CANCELLED'::public.dispatch_status,
        cancellation_reason = 'REQUEST_CANCELLED',
        cancelled_at = v_now
    WHERE donor_dispatches.request_id = p_request_id
      AND donor_dispatches.status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED')
    RETURNING donor_dispatches.id
  )
  SELECT count(*) INTO v_released_count FROM updated_rows;

  -- Audit log
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
      'released_dispatch_count', v_released_count
    ),
    false
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_released_count;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_emergency_request(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_emergency_request(uuid, uuid) TO service_role;

-- 8. RPC: set_donor_availability
-- Authenticated donor updates availability status.
-- If switching to UNAVAILABLE with active dispatches, requires explicit confirmation.
CREATE OR REPLACE FUNCTION public.set_donor_availability(
  p_donor_user_id uuid,
  p_new_status availability_status,
  p_confirm_withdraw boolean DEFAULT false
)
RETURNS TABLE (
  donor_id uuid,
  user_id uuid,
  availability_status availability_status,
  eligibility_status eligibility_status,
  active_dispatches_withdrawn integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_donor record;
  v_active_count integer := 0;
  v_now timestamptz := now();
  v_disp record;
BEGIN
  -- Resolve donor profile
  SELECT * INTO v_donor
  FROM public.donors d
  WHERE d.user_id = p_donor_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING errcode = '42501', message = 'Donor profile not found for user';
  END IF;

  IF p_new_status = 'UNAVAILABLE' THEN
    -- Count active dispatches
    SELECT count(*) INTO v_active_count
    FROM public.donor_dispatches dd
    WHERE dd.donor_id = v_donor.id
      AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED');

    IF v_active_count > 0 AND NOT p_confirm_withdraw THEN
      RAISE EXCEPTION USING errcode = '55001', message = 'Active dispatch withdrawal confirmation required';
    END IF;

    -- If confirmed withdrawal of active dispatches
    IF v_active_count > 0 AND p_confirm_withdraw THEN
      FOR v_disp IN
        SELECT dd.id FROM public.donor_dispatches dd
        WHERE dd.donor_id = v_donor.id
          AND dd.status IN ('ACCEPTED', 'EN_ROUTE', 'ARRIVED')
      LOOP
        PERFORM public.release_donor_dispatch(v_disp.id, p_donor_user_id, 'DONOR_UNAVAILABLE');
      END LOOP;
    END IF;
  END IF;

  -- Update donor availability_status (leaving eligibility_status untouched)
  UPDATE public.donors d
  SET availability_status = p_new_status
  WHERE d.id = v_donor.id
  RETURNING * INTO v_donor;

  -- Audit log
  INSERT INTO public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    metadata,
    is_synthetic
  ) VALUES (
    p_donor_user_id,
    'DONOR_AVAILABILITY_CHANGED',
    'donor',
    v_donor.id,
    jsonb_build_object(
      'new_status', p_new_status,
      'dispatches_withdrawn', v_active_count
    ),
    false
  );

  RETURN QUERY SELECT
    v_donor.id,
    v_donor.user_id,
    v_donor.availability_status,
    v_donor.eligibility_status,
    v_active_count;
  RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.set_donor_availability(uuid, availability_status, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_donor_availability(uuid, availability_status, boolean) TO service_role;
