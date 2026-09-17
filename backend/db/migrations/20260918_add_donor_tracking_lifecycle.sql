-- Migration: Add donor tracking lifecycle (EN_ROUTE, ARRIVED, COMPLETED),
-- live_locations schema extensions, RLS policies, indexes, and Realtime publication.

-- 1. Extend dispatch_status enum with tracking lifecycle states
ALTER TYPE public.dispatch_status ADD VALUE IF NOT EXISTS 'EN_ROUTE' AFTER 'ACCEPTED';
ALTER TYPE public.dispatch_status ADD VALUE IF NOT EXISTS 'ARRIVED' AFTER 'EN_ROUTE';

-- 2. Add milestone timestamp columns to donor_dispatches
ALTER TABLE public.donor_dispatches ADD COLUMN IF NOT EXISTS en_route_at TIMESTAMPTZ NULL;
ALTER TABLE public.donor_dispatches ADD COLUMN IF NOT EXISTS arrived_at TIMESTAMPTZ NULL;
ALTER TABLE public.donor_dispatches ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ NULL;

-- 3. Extend live_locations with dispatch foreign key
ALTER TABLE public.live_locations ADD COLUMN IF NOT EXISTS dispatch_id UUID NULL REFERENCES public.donor_dispatches(id) ON DELETE CASCADE;

-- 4. High-performance lookup indexes
CREATE INDEX IF NOT EXISTS idx_live_locations_dispatch
  ON public.live_locations (dispatch_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_live_locations_request_recorded
  ON public.live_locations (request_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_donor_dispatches_status
  ON public.donor_dispatches (status);

-- 5. Extend active dispatch unique partial index to include in-transit states (EN_ROUTE, ARRIVED)
DROP INDEX IF EXISTS public.uq_donor_dispatch_active_request_donor;
CREATE UNIQUE INDEX IF NOT EXISTS uq_donor_dispatch_active_request_donor
  ON public.donor_dispatches (request_id, donor_id)
  WHERE status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED');

-- 6. Row Level Security (RLS) for public.live_locations
ALTER TABLE public.live_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon_live_locations ON public.live_locations;
CREATE POLICY deny_anon_live_locations ON public.live_locations
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS donor_select_own_locations ON public.live_locations;
CREATE POLICY donor_select_own_locations ON public.live_locations
  FOR SELECT TO authenticated
  USING (
    donor_id IN (
      SELECT id FROM public.donors WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS donor_insert_own_locations ON public.live_locations;
CREATE POLICY donor_insert_own_locations ON public.live_locations
  FOR INSERT TO authenticated
  WITH CHECK (
    donor_id IN (
      SELECT id FROM public.donors WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS hospital_select_request_locations ON public.live_locations;
CREATE POLICY hospital_select_request_locations ON public.live_locations
  FOR SELECT TO authenticated
  USING (
    request_id IN (
      SELECT er.id FROM public.emergency_requests er
      JOIN public.organization_members om ON om.hospital_id = er.hospital_id
      WHERE om.user_id = auth.uid()
        AND om.organization_type = 'HOSPITAL'
        AND om.is_active = true
    )
  );

DROP POLICY IF EXISTS deny_authenticated_update_live_locations ON public.live_locations;
CREATE POLICY deny_authenticated_update_live_locations ON public.live_locations
  FOR UPDATE TO authenticated
  USING (false);

DROP POLICY IF EXISTS deny_authenticated_delete_live_locations ON public.live_locations;
CREATE POLICY deny_authenticated_delete_live_locations ON public.live_locations
  FOR DELETE TO authenticated
  USING (false);

-- 7. Realtime publication configuration
ALTER TABLE public.live_locations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.live_locations;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
