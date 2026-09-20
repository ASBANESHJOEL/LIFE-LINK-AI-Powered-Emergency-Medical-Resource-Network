'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertOctagon,
  PlusCircle,
  Database,
  Building2,
  Users,
  Clock,
  ArrowUpRight,
  ExternalLink,
  ShieldCheck,
  Navigation,
} from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { MetricCard } from '../../../../components/shared/MetricCard';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { UrgencyBadge } from '../../../../components/shared/UrgencyBadge';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { EmergencyRequest } from '../../../../types/requests';

export default function HospitalDashboardPage() {
  const { user, organization } = useAuth();
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({
    activeCount: 0,
    criticalCount: 0,
    fulfilledToday: 0,
    totalReservedUnits: 0,
  });

  useEffect(() => {
    async function loadHospitalData() {
      try {
        setLoading(true);
        // Query emergency requests for this hospital or global network
        let query = supabase
          .from('emergency_requests')
          .select('*, hospital:hospitals(id, hospital_name)')
          .order('created_at', { ascending: false })
          .limit(20);

        if (organization?.hospitalId) {
          query = query.eq('hospital_id', organization.hospitalId);
        }

        const { data, error } = await query;
        if (error) throw error;

        if (data) {
          setRequests(data.map((row: any) => ({
            ...row,
            hospital: row.hospital
              ? { id: row.hospital.id, name: row.hospital.hospital_name }
              : undefined,
          })) as EmergencyRequest[]);

          const active = data.filter((r) => r.status !== 'FULFILLED' && r.status !== 'CANCELLED' && r.status !== 'EXPIRED');
          const critical = data.filter((r) => r.urgency === 'CRITICAL' && !['FULFILLED', 'CANCELLED', 'EXPIRED'].includes(r.status));
          const fulfilled = data.filter((r) => r.status === 'FULFILLED');

          const requestIds = data.map((r) => r.id);
          let reservedUnits = 0;
          if (requestIds.length > 0) {
            const { data: allocations, error: allocationError } = await supabase
              .from('request_inventory_allocations')
              .select('request_id, allocated_units, status')
              .in('request_id', requestIds);

            if (!allocationError && allocations) {
              reservedUnits = allocations
                .filter((a: any) => a.status === 'RESERVED' || a.status === 'CONSUMED')
                .reduce((sum: number, a: any) => sum + Number(a.allocated_units || 0), 0);
            }
          }

          setStats({
            activeCount: active.length,
            criticalCount: critical.length,
            fulfilledToday: fulfilled.length,
            totalReservedUnits: reservedUnits,
          });
        }
      } catch (err) {
        console.error('Failed to load emergency requests:', err);
      } finally {
        setLoading(false);
      }
    }

    loadHospitalData();
  }, [organization?.hospitalId]);

  return (
    <div className="space-y-6">
      {/* Top Banner / Hospital Context */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-red-950/40 via-slate-900 to-slate-900 border border-red-900/40 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-red-500 animate-ping"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-red-400">
              Trauma Operations Active
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            {organization?.hospital?.name || 'Trauma Center Command Center'}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time emergency blood resource coordination & automated multi-tier dispatch
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Link href="/hospital/tracking">
              <Button size="lg" variant="outline" className="gap-2">
                <Navigation className="w-5 h-5" />
                Live Tracking
              </Button>
            </Link>
            <Link href="/hospital/requests/new">
              <Button size="lg" variant="default" className="gap-2 shadow-lg shadow-red-950/60">
                <PlusCircle className="w-5 h-5" />
                Initiate Emergency Request
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* KPI Metrics Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Active Emergencies"
          value={stats.activeCount}
          urgency={stats.activeCount > 0 ? 'warning' : 'normal'}
          subtext="Under active resolution"
          icon={<AlertOctagon className="w-5 h-5" />}
        />
        <MetricCard
          label="Critical Priority"
          value={stats.criticalCount}
          urgency={stats.criticalCount > 0 ? 'critical' : 'normal'}
          subtext="SLA < 15 min dispatch"
          icon={<Activity className="w-5 h-5" />}
        />
        <MetricCard
          label="Fulfilled Requests"
          value={stats.fulfilledToday}
          subtext="Bedside deliveries confirmed"
          icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          label="Reserved Units"
          value={`${stats.totalReservedUnits} Units`}
          subtext="Secured across bank nodes"
          icon={<Database className="w-5 h-5 text-sky-400" />}
        />
      </div>

      {/* Active Emergency Requests Table */}
      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base text-white">Active Emergency Requests</CardTitle>
            <p className="text-xs text-slate-400 mt-0.5">
              Live tracking of trauma requests currently in the 3-tier pipeline
            </p>
          </div>
          <Link
            href="/hospital/requests"
            className="text-xs font-semibold text-sky-400 hover:text-sky-300 flex items-center gap-1"
          >
            View All ({requests.length})
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading emergency telemetry...</div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center">
              <ShieldCheck className="w-10 h-10 text-emerald-500/50 mx-auto mb-3" />
              <p className="text-sm font-semibold text-white">No Active Emergency Requests</p>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                All trauma resource pipelines are currently quiescent. Use the button above to log an urgent request.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Request ID</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Component</th>
                    <th className="py-3 px-4">Units</th>
                    <th className="py-3 px-4">Urgency</th>
                    <th className="py-3 px-4">Pipeline Status</th>
                    <th className="py-3 px-4">Logged At</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {requests.slice(0, 8).map((req) => (
                    <tr key={req.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-3.5 px-4 font-mono text-xs text-slate-300">
                        {req.id.slice(0, 8)}...
                      </td>
                      <td className="py-3.5 px-4">
                        <BloodTypeBadge bloodGroup={req.blood_group} size="sm" />
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-300 font-medium">
                        {req.resource_type.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3.5 px-4 font-bold text-white text-sm">
                        {req.quantity}
                      </td>
                      <td className="py-3.5 px-4">
                        <UrgencyBadge urgency={req.urgency} />
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="py-3.5 px-4 text-xs text-slate-400">
                        {new Date(req.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <Link href={`/hospital/requests/${req.id}`}>
                          <Button size="sm" variant="outline" className="text-xs h-7 gap-1">
                            Resolve
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
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
