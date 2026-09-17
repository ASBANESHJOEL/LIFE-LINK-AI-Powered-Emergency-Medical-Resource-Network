-- Prevent the same donor from receiving multiple active dispatches for one request.
-- Terminal dispatches may remain historical and can be recreated if operationally needed.
CREATE UNIQUE INDEX IF NOT EXISTS uq_donor_dispatch_active_request_donor
  ON public.donor_dispatches (request_id, donor_id)
  WHERE status IN ('PENDING', 'NOTIFIED', 'RESPONDED', 'ACCEPTED');

-- Support deterministic batch-number allocation and request-scoped dispatch queries.
CREATE INDEX IF NOT EXISTS idx_donor_dispatch_request_batch
  ON public.donor_dispatches (request_id, batch_number, created_at);
