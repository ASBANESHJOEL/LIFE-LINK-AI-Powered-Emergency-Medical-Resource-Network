-- Migration: Add donor notifications table, indexes, RLS, and Realtime publication
-- Supports IN_APP and EMAIL channels with strict idempotency and user-scoped access control.

CREATE TABLE IF NOT EXISTS public.notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  donor_dispatch_id UUID NULL REFERENCES public.donor_dispatches(id) ON DELETE SET NULL,
  request_id UUID NULL REFERENCES public.emergency_requests(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('IN_APP', 'EMAIL')),
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED')),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ NULL,
  read_at TIMESTAMPTZ NULL,
  failed_at TIMESTAMPTZ NULL,
  failure_reason TEXT NULL
);

-- Idempotency: Prevent duplicate notifications per dispatch and channel
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_dispatch_channel
  ON public.notifications (donor_dispatch_id, channel)
  WHERE donor_dispatch_id IS NOT NULL;

-- Performance Indexes for user notification feeds and unread counters
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON public.notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, read_at)
  WHERE channel = 'IN_APP';

CREATE INDEX IF NOT EXISTS idx_notifications_request
  ON public.notifications (request_id)
  WHERE request_id IS NOT NULL;

-- Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_anon_notifications ON public.notifications;
CREATE POLICY deny_anon_notifications ON public.notifications
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS select_own_notifications ON public.notifications;
CREATE POLICY select_own_notifications ON public.notifications
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS update_own_notifications ON public.notifications;
CREATE POLICY update_own_notifications ON public.notifications
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS deny_authenticated_insert_notifications ON public.notifications;
CREATE POLICY deny_authenticated_insert_notifications ON public.notifications
  FOR INSERT TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS deny_authenticated_delete_notifications ON public.notifications;
CREATE POLICY deny_authenticated_delete_notifications ON public.notifications
  FOR DELETE TO authenticated
  USING (false);

-- Realtime publication configuration
ALTER TABLE public.notifications REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
