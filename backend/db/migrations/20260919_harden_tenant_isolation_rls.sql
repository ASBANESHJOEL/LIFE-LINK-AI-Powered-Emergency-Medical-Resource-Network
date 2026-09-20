-- Migration: Harden Tenant Isolation Row Level Security (RLS) - Revised
-- File: 20260919_harden_tenant_isolation_rls.sql
--
-- Security Enhancements:
--   1. Hardened SECURITY DEFINER helper functions with SET search_path = ''
--      and fully schema-qualified object references to eliminate search_path hijacking.
--   2. Strict user privilege escalation prevention: denied direct client UPDATE on public.users
--      so users cannot self-escalate role to ADMIN or alter is_active / identity fields.
--   3. Strict inventory mutation lockdown: denied direct client INSERT/UPDATE/DELETE on blood_inventory;
--      inventory alterations must exclusively occur via atomic backend RPCs (reserve_blood_inventory,
--      accept_blood_bank_transfer_offer) or backend service_role.
--   4. Preserved existing correct policies on live_locations, notifications,
--      blood_bank_transfer_offers, and request_inventory_allocations.
--   5. Guaranteed service_role administrative bypass across all operational tables.

-- ============================================================================
-- 1. HARDENED SECURITY DEFINER HELPERS (SET search_path = '')
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_auth_hospital_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.hospital_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_type = 'HOSPITAL'::public.organization_type
    AND om.is_active = true
    AND om.hospital_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_auth_hospital_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_hospital_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_auth_blood_bank_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT om.blood_bank_id
  FROM public.organization_members om
  WHERE om.user_id = auth.uid()
    AND om.organization_type = 'BLOOD_BANK'::public.organization_type
    AND om.is_active = true
    AND om.blood_bank_id IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_auth_blood_bank_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_blood_bank_ids() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_auth_donor_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT d.id
  FROM public.donors d
  WHERE d.user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_auth_donor_ids() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_auth_donor_ids() TO authenticated, service_role;

-- ============================================================================
-- 2. USERS TABLE (PREVENT SELF-ESCALATION)
-- ============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.users;
DROP POLICY IF EXISTS deny_direct_client_access_users ON public.users;
DROP POLICY IF EXISTS deny_anon_users ON public.users;
DROP POLICY IF EXISTS user_select_own_profile ON public.users;
DROP POLICY IF EXISTS user_update_own_profile ON public.users;
DROP POLICY IF EXISTS deny_authenticated_update_users ON public.users;
DROP POLICY IF EXISTS deny_authenticated_insert_users ON public.users;
DROP POLICY IF EXISTS deny_authenticated_delete_users ON public.users;

CREATE POLICY deny_anon_users ON public.users
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- User can read own user identity record
CREATE POLICY user_select_own_profile ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Deny direct client UPDATE to prevent role escalation to ADMIN or altering is_active/email
CREATE POLICY deny_authenticated_update_users ON public.users
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_insert_users ON public.users
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_delete_users ON public.users
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 3. ORGANIZATION MEMBERS TABLE
-- ============================================================================

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.organization_members;
DROP POLICY IF EXISTS deny_direct_client_access_organization_members ON public.organization_members;
DROP POLICY IF EXISTS deny_anon_organization_members ON public.organization_members;
DROP POLICY IF EXISTS member_select_own_membership ON public.organization_members;
DROP POLICY IF EXISTS deny_authenticated_insert_organization_members ON public.organization_members;
DROP POLICY IF EXISTS deny_authenticated_update_organization_members ON public.organization_members;
DROP POLICY IF EXISTS deny_authenticated_delete_organization_members ON public.organization_members;

CREATE POLICY deny_anon_organization_members ON public.organization_members
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY member_select_own_membership ON public.organization_members
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY deny_authenticated_insert_organization_members ON public.organization_members
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_update_organization_members ON public.organization_members
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_delete_organization_members ON public.organization_members
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 4. HOSPITALS DIRECTORY TABLE
-- ============================================================================

ALTER TABLE public.hospitals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.hospitals;
DROP POLICY IF EXISTS deny_direct_client_access_hospitals ON public.hospitals;
DROP POLICY IF EXISTS deny_anon_hospitals ON public.hospitals;
DROP POLICY IF EXISTS authenticated_select_verified_hospitals ON public.hospitals;
DROP POLICY IF EXISTS deny_authenticated_insert_hospitals ON public.hospitals;
DROP POLICY IF EXISTS deny_authenticated_update_hospitals ON public.hospitals;
DROP POLICY IF EXISTS deny_authenticated_delete_hospitals ON public.hospitals;

CREATE POLICY deny_anon_hospitals ON public.hospitals
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY authenticated_select_verified_hospitals ON public.hospitals
  FOR SELECT TO authenticated
  USING (verified = true OR id IN (SELECT public.get_auth_hospital_ids()));

CREATE POLICY deny_authenticated_insert_hospitals ON public.hospitals
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_update_hospitals ON public.hospitals
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_delete_hospitals ON public.hospitals
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 5. BLOOD BANKS DIRECTORY TABLE
-- ============================================================================

ALTER TABLE public.blood_banks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.blood_banks;
DROP POLICY IF EXISTS deny_direct_client_access_blood_banks ON public.blood_banks;
DROP POLICY IF EXISTS deny_anon_blood_banks ON public.blood_banks;
DROP POLICY IF EXISTS authenticated_select_verified_blood_banks ON public.blood_banks;
DROP POLICY IF EXISTS deny_authenticated_insert_blood_banks ON public.blood_banks;
DROP POLICY IF EXISTS deny_authenticated_update_blood_banks ON public.blood_banks;
DROP POLICY IF EXISTS deny_authenticated_delete_blood_banks ON public.blood_banks;

CREATE POLICY deny_anon_blood_banks ON public.blood_banks
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY authenticated_select_verified_blood_banks ON public.blood_banks
  FOR SELECT TO authenticated
  USING (verified = true OR id IN (SELECT public.get_auth_blood_bank_ids()));

CREATE POLICY deny_authenticated_insert_blood_banks ON public.blood_banks
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_update_blood_banks ON public.blood_banks
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_delete_blood_banks ON public.blood_banks
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 6. DONORS TABLE (PROTECT VERIFICATION AND OWNERSHIP)
-- ============================================================================

ALTER TABLE public.donors ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.donors;
DROP POLICY IF EXISTS deny_direct_client_access_donors ON public.donors;
DROP POLICY IF EXISTS deny_anon_donors ON public.donors;
DROP POLICY IF EXISTS donor_select_own_profile ON public.donors;
DROP POLICY IF EXISTS donor_update_own_profile ON public.donors;
DROP POLICY IF EXISTS deny_authenticated_update_donors ON public.donors;
DROP POLICY IF EXISTS deny_authenticated_insert_donors ON public.donors;
DROP POLICY IF EXISTS deny_authenticated_delete_donors ON public.donors;

CREATE POLICY deny_anon_donors ON public.donors
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

CREATE POLICY donor_select_own_profile ON public.donors
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Deny direct client UPDATE to prevent tampering with verified status, eligibility, or user_id
CREATE POLICY deny_authenticated_update_donors ON public.donors
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_insert_donors ON public.donors
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_delete_donors ON public.donors
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 7. EMERGENCY REQUESTS TABLE
-- ============================================================================

ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.emergency_requests;
DROP POLICY IF EXISTS deny_direct_client_access_emergency_requests ON public.emergency_requests;
DROP POLICY IF EXISTS deny_anon_emergency_requests ON public.emergency_requests;
DROP POLICY IF EXISTS hospital_select_own_requests ON public.emergency_requests;
DROP POLICY IF EXISTS blood_bank_select_open_requests ON public.emergency_requests;
DROP POLICY IF EXISTS hospital_insert_own_requests ON public.emergency_requests;
DROP POLICY IF EXISTS hospital_update_own_requests ON public.emergency_requests;
DROP POLICY IF EXISTS deny_authenticated_delete_emergency_requests ON public.emergency_requests;

CREATE POLICY deny_anon_emergency_requests ON public.emergency_requests
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Hospital can read its own emergency requests
CREATE POLICY hospital_select_own_requests ON public.emergency_requests
  FOR SELECT TO authenticated
  USING (hospital_id IN (SELECT public.get_auth_hospital_ids()));

-- Blood banks can read open requests for fulfillment matching and transfer support
CREATE POLICY blood_bank_select_open_requests ON public.emergency_requests
  FOR SELECT TO authenticated
  USING (
    status IN ('OPEN'::public.request_status, 'PARTIALLY_FULFILLED'::public.request_status)
    AND EXISTS (SELECT 1 FROM public.get_auth_blood_bank_ids())
  );

-- Hospital can insert requests only for its own hospital
CREATE POLICY hospital_insert_own_requests ON public.emergency_requests
  FOR INSERT TO authenticated
  WITH CHECK (hospital_id IN (SELECT public.get_auth_hospital_ids()));

-- Hospital can update only its own requests
CREATE POLICY hospital_update_own_requests ON public.emergency_requests
  FOR UPDATE TO authenticated
  USING (hospital_id IN (SELECT public.get_auth_hospital_ids()))
  WITH CHECK (hospital_id IN (SELECT public.get_auth_hospital_ids()));

CREATE POLICY deny_authenticated_delete_emergency_requests ON public.emergency_requests
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 8. DONOR DISPATCHES TABLE
-- ============================================================================

ALTER TABLE public.donor_dispatches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.donor_dispatches;
DROP POLICY IF EXISTS deny_direct_client_access_donor_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS deny_anon_donor_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS donor_select_own_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS hospital_select_request_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS deny_authenticated_insert_donor_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS deny_authenticated_update_donor_dispatches ON public.donor_dispatches;
DROP POLICY IF EXISTS deny_authenticated_delete_donor_dispatches ON public.donor_dispatches;

CREATE POLICY deny_anon_donor_dispatches ON public.donor_dispatches
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Donors can read dispatches sent to their own donor ID
CREATE POLICY donor_select_own_dispatches ON public.donor_dispatches
  FOR SELECT TO authenticated
  USING (donor_id IN (SELECT public.get_auth_donor_ids()));

-- Hospitals can read dispatches associated with their emergency requests
CREATE POLICY hospital_select_request_dispatches ON public.donor_dispatches
  FOR SELECT TO authenticated
  USING (
    request_id IN (
      SELECT er.id FROM public.emergency_requests er
      WHERE er.hospital_id IN (SELECT public.get_auth_hospital_ids())
    )
  );

CREATE POLICY deny_authenticated_insert_donor_dispatches ON public.donor_dispatches
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_update_donor_dispatches ON public.donor_dispatches
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_delete_donor_dispatches ON public.donor_dispatches
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 9. BLOOD INVENTORY TABLE (STRICT MUTATION LOCKDOWN)
-- ============================================================================

ALTER TABLE public.blood_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deny_direct_client_access ON public.blood_inventory;
DROP POLICY IF EXISTS deny_direct_client_access_blood_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS deny_anon_blood_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS blood_bank_select_own_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS hospital_select_available_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS blood_bank_insert_own_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS blood_bank_update_own_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS blood_bank_delete_own_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS deny_authenticated_insert_blood_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS deny_authenticated_update_blood_inventory ON public.blood_inventory;
DROP POLICY IF EXISTS deny_authenticated_delete_blood_inventory ON public.blood_inventory;

CREATE POLICY deny_anon_blood_inventory ON public.blood_inventory
  FOR ALL TO anon
  USING (false)
  WITH CHECK (false);

-- Blood banks can read their own complete inventory
CREATE POLICY blood_bank_select_own_inventory ON public.blood_inventory
  FOR SELECT TO authenticated
  USING (blood_bank_id IN (SELECT public.get_auth_blood_bank_ids()));

-- Hospitals can discover available inventory for emergency request planning
CREATE POLICY hospital_select_available_inventory ON public.blood_inventory
  FOR SELECT TO authenticated
  USING (
    available_units > 0
    AND EXISTS (SELECT 1 FROM public.get_auth_hospital_ids())
  );

-- Direct client mutations are strictly denied to preserve reservation and concurrency guarantees.
-- Inventory allocation/deduction must occur via atomic RPCs or backend service_role.
CREATE POLICY deny_authenticated_insert_blood_inventory ON public.blood_inventory
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE POLICY deny_authenticated_update_blood_inventory ON public.blood_inventory
  FOR UPDATE TO authenticated
  USING (false);

CREATE POLICY deny_authenticated_delete_blood_inventory ON public.blood_inventory
  FOR DELETE TO authenticated
  USING (false);

-- ============================================================================
-- 10. BACKEND-ONLY OPERATIONAL TABLES (PRESERVE STRICT CLIENT DENIAL)
-- ============================================================================

-- Audit logs: strictly server-side / service_role
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_direct_client_access ON public.audit_logs;
DROP POLICY IF EXISTS deny_direct_client_access_audit_logs ON public.audit_logs;
DROP POLICY IF EXISTS deny_anon_audit_logs ON public.audit_logs;
DROP POLICY IF EXISTS deny_authenticated_audit_logs ON public.audit_logs;

CREATE POLICY deny_anon_audit_logs ON public.audit_logs
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY deny_authenticated_audit_logs ON public.audit_logs
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- Refill requests: internal replenishment managed via backend
ALTER TABLE public.refill_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_direct_client_access ON public.refill_requests;
DROP POLICY IF EXISTS deny_direct_client_access_refill_requests ON public.refill_requests;
DROP POLICY IF EXISTS deny_anon_refill_requests ON public.refill_requests;
DROP POLICY IF EXISTS deny_authenticated_refill_requests ON public.refill_requests;

CREATE POLICY deny_anon_refill_requests ON public.refill_requests
  FOR ALL TO anon USING (false) WITH CHECK (false);

CREATE POLICY deny_authenticated_refill_requests ON public.refill_requests
  FOR ALL TO authenticated USING (false) WITH CHECK (false);
