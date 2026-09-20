'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertOctagon,
  Heart,
  Navigation,
  ShieldCheck,
  Clock,
  MapPin,
  Calendar,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { MetricCard } from '../../../../components/shared/MetricCard';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { DonorDispatch } from '../../../../types/dispatch';
import { api } from '../../../../lib/api/client';
import { AlertCircle, ToggleLeft, ToggleRight } from 'lucide-react';

export default function DonorDashboardPage() {
  const { user } = useAuth();
  const [donorRecord, setDonorRecord] = useState<any>(null);
  const [activeDispatches, setActiveDispatches] = useState<DonorDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [showWithdrawConfirmModal, setShowWithdrawConfirmModal] = useState(false);
  const [availabilityMessage, setAvailabilityMessage] = useState<string | null>(null);

  async function loadDonorData() {
    if (!user) return;
    try {
      setLoading(true);
      // Load donor profile by user_id
      const { data: donor } = await supabase
        .from('donors')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (donor) {
        setDonorRecord(donor);

        // Availability is changed through the authenticated backend API/RPC.
        // Reconcile the UI with that authoritative value after the read-only
        // donor profile query.
        try {
          const availability = await api.donors.getAvailability();
          setDonorRecord((prev: any) => prev ? {
            ...prev,
            availability_status: availability.availabilityStatus,
            eligibility_status: availability.eligibilityStatus
          } : prev);
        } catch (availabilityError) {
          console.error('Failed to load authoritative donor availability:', availabilityError);
        }

        // Load active dispatches for this donor
        const { data: dispatches } = await supabase
          .from('donor_dispatches')
          .select('*, emergency_requests(id, blood_group, urgency, hospital_id, hospitals:hospital_id(hospital_name))')
          .eq('donor_id', donor.id)
          .order('notified_at', { ascending: false })
          .limit(10);

        if (dispatches) {
          setActiveDispatches(dispatches as unknown as DonorDispatch[]);
        }
      }
    } catch (err) {
      console.error('Failed to load donor data:', err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDonorData();
  }, [user]);

  const hasActiveTransitDispatch = activeDispatches.some((d) =>
    ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'].includes(d.status)
  );

  const handleToggleAvailability = async () => {
    if (!donorRecord) return;
    const currentStatus = donorRecord.availability_status;

    if (currentStatus === 'AVAILABLE') {
      // If donor has an active dispatch, require confirmation
      if (hasActiveTransitDispatch) {
        setShowWithdrawConfirmModal(true);
        return;
      }
      // Otherwise directly switch to UNAVAILABLE
      await executeAvailabilityChange('UNAVAILABLE', false);
    } else {
      // Switch back to AVAILABLE
      await executeAvailabilityChange('AVAILABLE', false);
    }
  };

  const executeAvailabilityChange = async (newStatus: 'AVAILABLE' | 'UNAVAILABLE', confirmWithdraw: boolean) => {
    setAvailabilityLoading(true);
    setAvailabilityMessage(null);
    try {
      const res = await api.donors.setAvailability(newStatus, confirmWithdraw);
      setDonorRecord((prev: any) => ({ ...prev, availability_status: res.availabilityStatus }));
      setShowWithdrawConfirmModal(false);
      setAvailabilityMessage(
        newStatus === 'AVAILABLE'
          ? 'You are now AVAILABLE for emergency dispatches.'
          : confirmWithdraw
          ? 'Active dispatch withdrawn. You are now UNAVAILABLE.'
          : 'You are now UNAVAILABLE for new dispatches.'
      );
      await loadDonorData();
    } catch (err: any) {
      console.error('Failed to update availability:', err);
      if (err?.details?.error === 'ACTIVE_DISPATCH_CONFIRMATION_REQUIRED') {
        setShowWithdrawConfirmModal(true);
      } else {
        setAvailabilityMessage(
          err instanceof Error
            ? err.message
            : 'Unable to change availability right now. Please try again.'
        );

        // Reconcile with the server so a failed/stale write never leaves the
        // button showing an assumed state.
        try {
          const current = await api.donors.getAvailability();
          setDonorRecord((prev: any) => prev ? {
            ...prev,
            availability_status: current.availabilityStatus,
            eligibility_status: current.eligibilityStatus
          } : prev);
        } catch (reconcileError) {
          console.error('Failed to reconcile donor availability:', reconcileError);
        }
      }
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const isAvailable = donorRecord?.availability_status === 'AVAILABLE';

  const notifiedAlerts = activeDispatches.filter((d) => d.status === 'NOTIFIED');
  const enRouteDispatches = activeDispatches.filter((d) => d.status === 'EN_ROUTE' || d.status === 'ACCEPTED');

  return (
    <div className="space-y-6">
      {/* Active Alert Urgent Banner if NOTIFIED */}
      {notifiedAlerts.length > 0 && (
        <div className="p-6 rounded-2xl bg-gradient-to-r from-red-600 via-rose-700 to-red-800 text-white shadow-2xl shadow-red-950/80 animate-pulse-subtle">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <AlertOctagon className="w-5 h-5 animate-spin" />
                <span className="text-xs font-black uppercase tracking-widest bg-black/30 px-2 py-0.5 rounded">
                  CRITICAL TRAUMA DISPATCH
                </span>
              </div>
              <h2 className="text-2xl font-black">Urgent Blood Match Required</h2>
              <p className="text-xs text-red-100 mt-1">
                You have been matched by the LIFE-LINK Logistic Regression model for an immediate trauma surgery.
              </p>
            </div>
            <Link href="/donor/alerts">
              <Button size="lg" className="bg-white text-red-700 hover:bg-slate-100 font-black shadow-lg">
                View & Respond Now
              </Button>
            </Link>
          </div>
        </div>
      )}

      {/* Donor Profile Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center gap-4">
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white shadow-lg shadow-red-950/50">
            <Heart className="w-7 h-7 fill-current" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-white">
                {donorRecord ? `Verified Volunteer Donor` : user?.email}
              </h1>
              {donorRecord?.verified && (
                <span title="Verified Medical Clearance">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">
              Available for trauma response in regional emergency network
            </p>
          </div>
        </div>

        {donorRecord && (
          <div className="flex items-center gap-3">
            <BloodTypeBadge bloodGroup={donorRecord.blood_group} size="lg" />
          </div>
        )}
      </div>

      {availabilityMessage && (
        <div className="p-3 rounded-xl bg-sky-950/40 border border-sky-800 text-xs text-sky-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-sky-400 shrink-0" />
          {availabilityMessage}
        </div>
      )}

      {/* Donor Availability Control */}
      <Card className="border-slate-800 bg-slate-900/90 overflow-hidden shadow-lg">
        <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl flex items-center justify-center border ${
              isAvailable
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-slate-800 border-slate-700 text-slate-400'
            }`}>
              <div className={`h-3.5 w-3.5 rounded-full ${isAvailable ? 'bg-emerald-400 animate-pulse' : 'bg-slate-400'}`} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-semibold text-slate-400">
                  Donor Availability
                </span>
                <span className={`text-xs font-black px-2 py-0.5 rounded-full ${
                  isAvailable ? 'bg-emerald-950 text-emerald-300 border border-emerald-800' : 'bg-slate-800 text-slate-300'
                }`}>
                  {isAvailable ? '🟢 AVAILABLE' : '⚪ UNAVAILABLE'}
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-1">
                {isAvailable
                  ? 'You can receive emergency requests.'
                  : "You won't receive new emergency requests until you become available."}
              </p>
            </div>
          </div>

          <Button
            onClick={handleToggleAvailability}
            isLoading={availabilityLoading}
            variant={isAvailable ? 'outline' : 'medical'}
            className={`font-bold text-xs h-9 ${
              isAvailable
                ? 'border-slate-700 hover:bg-slate-800 text-slate-200'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white'
            }`}
          >
            {isAvailable ? 'Switch to Unavailable' : 'Switch to Available'}
          </Button>
        </CardContent>
      </Card>

      {/* Active Dispatch Withdrawal Confirmation Modal */}
      {showWithdrawConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertCircle className="w-6 h-6 shrink-0" />
              <h3 className="text-lg font-bold text-white">Active Emergency Assignment</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              You are currently assigned to an emergency request.
              Changing your availability will withdraw this assignment
              and allow another donor to be selected.
            </p>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWithdrawConfirmModal(false)}
                disabled={availabilityLoading}
              >
                Stay Available
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => executeAvailabilityChange('UNAVAILABLE', true)}
                isLoading={availabilityLoading}
                className="bg-red-600 hover:bg-red-500 text-white font-semibold"
              >
                Withdraw & Become Unavailable
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Eligibility Status"
          value={donorRecord?.eligible !== false ? 'ELIGIBLE' : 'COOLDOWN'}
          subtext={donorRecord?.eligible !== false ? 'Cleared for immediate donation' : '90-day recovery window active'}
          urgency={donorRecord?.eligible !== false ? 'normal' : 'warning'}
          icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          label="Active Alerts"
          value={notifiedAlerts.length}
          urgency={notifiedAlerts.length > 0 ? 'critical' : 'normal'}
          subtext="Pending immediate response"
          icon={<AlertOctagon className="w-5 h-5 text-red-400" />}
        />
        <MetricCard
          label="In-Transit Deliveries"
          value={enRouteDispatches.length}
          urgency={enRouteDispatches.length > 0 ? 'warning' : 'normal'}
          subtext="Active navigation to trauma center"
          icon={<Navigation className="w-5 h-5 text-sky-400" />}
        />
      </div>

      {/* Recent Dispatches */}
      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-white">Your Dispatch History</CardTitle>
          <Link
            href="/donor/alerts"
            className="text-xs text-sky-400 hover:text-sky-300 font-semibold"
          >
            Manage Alerts
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {activeDispatches.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">
              No emergency dispatches recorded. You will be notified automatically when an urgent match occurs.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="p-3">Dispatch ID</th>
                    <th className="p-3">Trauma Center</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">Notified Date</th>
                    <th className="p-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {activeDispatches.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-mono text-slate-300">{d.id.slice(0, 8)}...</td>
                      <td className="p-3 font-semibold text-white">
                        {(d as any).emergency_requests?.hospitals?.hospital_name || (d as any).emergency_requests?.hospitals?.name || 'Regional Hospital'}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="p-3 text-slate-400">
                        {new Date(d.notified_at).toLocaleString()}
                      </td>
                      <td className="p-3 text-right">
                        {d.status === 'NOTIFIED' ? (
                          <Link href="/donor/alerts">
                            <Button size="sm" variant="default" className="h-7 text-xs">
                              Respond
                            </Button>
                          </Link>
                        ) : (
                          <Link href={`/donor/dispatches/${d.id}`}>
                            <Button size="sm" variant="outline" className="h-7 text-xs">
                              Track Route
                            </Button>
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
