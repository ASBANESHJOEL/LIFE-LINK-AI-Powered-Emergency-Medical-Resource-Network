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

export default function DonorDashboardPage() {
  const { user } = useAuth();
  const [donorRecord, setDonorRecord] = useState<any>(null);
  const [activeDispatches, setActiveDispatches] = useState<DonorDispatch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
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

          // Load active dispatches for this donor
          const { data: dispatches } = await supabase
            .from('donor_dispatches')
            .select('*, emergency_requests(id, blood_group, urgency, hospital_id, hospitals:hospital_id(name))')
            .eq('donor_id', donor.id)
            .order('notified_at', { ascending: false })
            .limit(5);

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

    loadDonorData();
  }, [user]);

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
                        {(d as any).emergency_requests?.hospitals?.name || 'Regional Hospital'}
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
