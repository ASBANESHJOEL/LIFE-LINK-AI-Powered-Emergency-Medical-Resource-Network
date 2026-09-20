CREATE OR REPLACE FUNCTION public.is_active_hospital_member(p_hospital_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_type = 'HOSPITAL'::public.organization_type
      AND om.hospital_id = p_hospital_id
      AND om.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_blood_bank_member(p_blood_bank_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_type = 'BLOOD_BANK'::public.organization_type
      AND om.blood_bank_id = p_blood_bank_id
      AND om.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_hospital_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_type = 'HOSPITAL'::public.organization_type
      AND om.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_blood_bank_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_type = 'BLOOD_BANK'::public.organization_type
      AND om.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = (SELECT auth.uid())
      AND u.role = 'ADMIN'::public.user_role
      AND u.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_donor_owner(p_donor_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.donors d
    WHERE d.id = p_donor_id
      AND d.user_id = (SELECT auth.uid())
  );
$$;

DROP POLICY IF EXISTS "allow_authenticated_read_own_user" ON public.users;
CREATE POLICY "allow_authenticated_read_own_user" ON public.users FOR SELECT TO authenticated
USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS "allow_authenticated_read_hospital_directory" ON public.hospitals;
CREATE POLICY "allow_authenticated_read_hospital_directory" ON public.hospitals FOR SELECT TO authenticated
USING (verified = true OR (SELECT public.is_active_hospital_member(id)) OR (SELECT public.is_active_admin()));

DROP POLICY IF EXISTS "allow_authenticated_read_blood_bank_directory" ON public.blood_banks;
CREATE POLICY "allow_authenticated_read_blood_bank_directory" ON public.blood_banks FOR SELECT TO authenticated
USING (verified = true OR (SELECT public.is_active_blood_bank_member(id)) OR (SELECT public.is_active_admin()));

DROP POLICY IF EXISTS "allow_authenticated_read_own_donor" ON public.donors;
CREATE POLICY "allow_authenticated_read_own_donor" ON public.donors FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_active_admin()));

DROP POLICY IF EXISTS "allow_authenticated_read_emergency_requests" ON public.emergency_requests;
CREATE POLICY "allow_authenticated_read_emergency_requests" ON public.emergency_requests FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR (SELECT public.is_active_hospital_member(hospital_id))
  OR (status IN ('OPEN'::public.request_status, 'PARTIALLY_FULFILLED'::public.request_status) AND (SELECT public.is_active_blood_bank_user()))
);

DROP POLICY IF EXISTS "allow_authenticated_read_dispatches" ON public.donor_dispatches;
CREATE POLICY "allow_authenticated_read_dispatches" ON public.donor_dispatches FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR (SELECT public.is_active_donor_owner(donor_id))
  OR EXISTS (
    SELECT 1 FROM public.emergency_requests er
    WHERE er.id = donor_dispatches.request_id
      AND (SELECT public.is_active_hospital_member(er.hospital_id))
  )
);

DROP POLICY IF EXISTS "allow_authenticated_read_inventory" ON public.blood_inventory;
CREATE POLICY "allow_authenticated_read_inventory" ON public.blood_inventory FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR (SELECT public.is_active_blood_bank_member(blood_bank_id))
  OR (available_units > 0 AND (SELECT public.is_active_hospital_user()))
);

DROP POLICY IF EXISTS "allow_authenticated_read_notifications" ON public.notifications;
CREATE POLICY "allow_authenticated_read_notifications" ON public.notifications FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()) OR (SELECT public.is_active_admin()));

DROP POLICY IF EXISTS "allow_authenticated_read_allocations" ON public.request_inventory_allocations;
CREATE POLICY "allow_authenticated_read_allocations" ON public.request_inventory_allocations FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR EXISTS (
    SELECT 1 FROM public.emergency_requests er
    WHERE er.id = request_inventory_allocations.request_id
      AND (SELECT public.is_active_hospital_member(er.hospital_id))
  )
  OR (SELECT public.is_active_blood_bank_member(blood_bank_id))
);

DROP POLICY IF EXISTS "allow_authenticated_read_transfer_offers" ON public.blood_bank_transfer_offers;
CREATE POLICY "allow_authenticated_read_transfer_offers" ON public.blood_bank_transfer_offers FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR (SELECT public.is_active_blood_bank_member(blood_bank_id))
  OR EXISTS (
    SELECT 1 FROM public.emergency_requests er
    WHERE er.id = blood_bank_transfer_offers.request_id
      AND (SELECT public.is_active_hospital_member(er.hospital_id))
  )
);

DROP POLICY IF EXISTS "allow_authenticated_read_live_locations" ON public.live_locations;
CREATE POLICY "allow_authenticated_read_live_locations" ON public.live_locations FOR SELECT TO authenticated
USING (
  (SELECT public.is_active_admin())
  OR (SELECT public.is_active_donor_owner(donor_id))
  OR EXISTS (
    SELECT 1 FROM public.emergency_requests er
    WHERE er.id = live_locations.request_id
      AND (SELECT public.is_active_hospital_member(er.hospital_id))
  )
);