-- Migration: Add atomic donor dispatch response RPC
-- Atomically handles donor ACCEPT/DECLINE responses with row-level locking,
-- prevents race conditions, enforces state machine transitions, and updates request fulfillment.

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
AS $$
DECLARE
  v_donor_id uuid;
  v_dispatch record;
  v_request record;
  v_reserved_inventory integer;
  v_accepted_donors integer;
  v_total_covered integer;
  v_remaining integer;
  v_new_remaining integer;
  v_norm_response text;
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
    -- Idempotent handling if already accepted
    IF v_dispatch.status = 'ACCEPTED' THEN
      SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

      SELECT coalesce(sum(allocated_units), 0) INTO v_reserved_inventory
      FROM public.request_inventory_allocations
      WHERE request_id = v_request.id AND status = 'RESERVED';

      SELECT count(*) INTO v_accepted_donors
      FROM public.donor_dispatches
      WHERE request_id = v_request.id AND status IN ('ACCEPTED', 'COMPLETED');

      v_total_covered := v_reserved_inventory + v_accepted_donors;
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

    -- Disallow invalid transition from DECLINED
    IF v_dispatch.status = 'DECLINED' THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot accept a dispatch that has already been declined';
    END IF;

    -- Disallow acceptance from terminal or unexpected states
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

    IF v_request.status NOT IN ('OPEN', 'PARTIALLY_FULFILLED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Emergency request is no longer open for donor acceptance';
    END IF;

    -- Calculate current coverage
    SELECT coalesce(sum(allocated_units), 0) INTO v_reserved_inventory
    FROM public.request_inventory_allocations
    WHERE request_id = v_request.id AND status = 'RESERVED';

    SELECT count(*) INTO v_accepted_donors
    FROM public.donor_dispatches
    WHERE request_id = v_request.id AND status IN ('ACCEPTED', 'COMPLETED');

    v_total_covered := v_reserved_inventory + v_accepted_donors;
    v_remaining := greatest(0, v_request.quantity - v_total_covered);

    IF v_remaining <= 0 THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Emergency request is already fully fulfilled';
    END IF;

    -- Transition dispatch to ACCEPTED
    UPDATE public.donor_dispatches
    SET status = 'ACCEPTED'::dispatch_status,
        responded_at = coalesce(responded_at, now()),
        accepted_at = now()
    WHERE id = p_dispatch_id
    RETURNING * INTO v_dispatch;

    -- Re-evaluate remaining shortage
    v_new_remaining := greatest(0, v_remaining - 1);

    -- Update emergency request status
    UPDATE public.emergency_requests
    SET status = CASE WHEN v_new_remaining = 0 THEN 'FULFILLED'::request_status ELSE 'PARTIALLY_FULFILLED'::request_status END,
        completed_at = CASE WHEN v_new_remaining = 0 THEN coalesce(completed_at, now()) ELSE null END
    WHERE id = v_request.id
    RETURNING * INTO v_request;

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
    -- Idempotent handling if already declined
    IF v_dispatch.status = 'DECLINED' THEN
      SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

      SELECT coalesce(sum(allocated_units), 0) INTO v_reserved_inventory
      FROM public.request_inventory_allocations
      WHERE request_id = v_request.id AND status = 'RESERVED';

      SELECT count(*) INTO v_accepted_donors
      FROM public.donor_dispatches
      WHERE request_id = v_request.id AND status IN ('ACCEPTED', 'COMPLETED');

      v_total_covered := v_reserved_inventory + v_accepted_donors;
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

    -- Disallow declining a dispatch that was already accepted or completed
    IF v_dispatch.status IN ('ACCEPTED', 'COMPLETED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot decline a dispatch that is already accepted or completed';
    END IF;

    IF v_dispatch.status NOT IN ('PENDING', 'NOTIFIED', 'RESPONDED') THEN
      RAISE EXCEPTION USING errcode = '55000', message = 'Cannot decline dispatch in status ' || v_dispatch.status;
    END IF;

    -- Transition dispatch to DECLINED
    UPDATE public.donor_dispatches
    SET status = 'DECLINED'::dispatch_status,
        responded_at = coalesce(responded_at, now())
    WHERE id = p_dispatch_id
    RETURNING * INTO v_dispatch;

    -- Load request for status check without mutating request
    SELECT * INTO v_request FROM public.emergency_requests WHERE id = v_dispatch.request_id;

    SELECT coalesce(sum(allocated_units), 0) INTO v_reserved_inventory
    FROM public.request_inventory_allocations
    WHERE request_id = v_request.id AND status = 'RESERVED';

    SELECT count(*) INTO v_accepted_donors
    FROM public.donor_dispatches
    WHERE request_id = v_request.id AND status IN ('ACCEPTED', 'COMPLETED');

    v_total_covered := v_reserved_inventory + v_accepted_donors;
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

-- Secure access privileges: strictly restrict execution to backend service_role
REVOKE ALL ON FUNCTION public.respond_to_donor_dispatch(uuid, uuid, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_donor_dispatch(uuid, uuid, text) TO service_role;
