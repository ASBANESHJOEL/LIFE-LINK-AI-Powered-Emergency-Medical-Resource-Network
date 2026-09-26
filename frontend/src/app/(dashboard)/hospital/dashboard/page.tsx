'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  AlertOctagon,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock3,
  Database,
  ExternalLink,
  Navigation,
  Plus,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { MetricCard } from '../../../../components/shared/MetricCard';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { UrgencyBadge } from '../../../../components/shared/UrgencyBadge';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { EmergencyRequest } from '../../../../types/requests';

const formatTime = (value: string) => new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const isToday = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  return date.getFullYear() === today.getFullYear() && date.getMonth() === today.getMonth() && date.getDate() === today.getDate();
};

export default function HospitalDashboardPage() {
  const { organization } = useAuth();
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState({ activeCount: 0, criticalCount: 0, fulfilledToday: 0, totalReservedUnits: 0 });

  useEffect(() => {
    async function loadHospitalData() {
      try {
        setLoading(true);
        let query = supabase.from('emergency_requests').select('*, hospital:hospitals(id, hospital_name)').order('created_at', { ascending: false }).limit(20);
        if (organization?.hospitalId) query = query.eq('hospital_id', organization.hospitalId);
        const { data, error } = await query;
        if (error) throw error;
        if (!data) return;

        setRequests(data.map((row: any) => ({ ...row, hospital: row.hospital ? { id: row.hospital.id, name: row.hospital.hospital_name } : undefined })) as EmergencyRequest[]);
        const active = data.filter((r) => !['FULFILLED', 'CANCELLED', 'EXPIRED'].includes(r.status));
        const critical = active.filter((r) => r.urgency === 'CRITICAL');
        const fulfilledToday = data.filter((r) => r.status === 'FULFILLED' && r.completed_at && isToday(r.completed_at));
        let reservedUnits = 0;
        if (data.length) {
          const { data: allocations } = await supabase.from('request_inventory_allocations').select('request_id, allocated_units, status').in('request_id', data.map((r) => r.id));
          reservedUnits = (allocations || []).filter((a: any) => ['RESERVED', 'CONSUMED'].includes(a.status)).reduce((sum: number, a: any) => sum + Number(a.allocated_units || 0), 0);
        }
        setStats({ activeCount: active.length, criticalCount: critical.length, fulfilledToday: fulfilledToday.length, totalReservedUnits: reservedUnits });
      } catch (err) {
        console.error('Failed to load emergency requests:', err);
      } finally {
        setLoading(false);
      }
    }
    loadHospitalData();
  }, [organization?.hospitalId]);

  const activeRequests = requests.filter((request) => !['FULFILLED', 'CANCELLED', 'EXPIRED'].includes(request.status));

  return (
    <div className="flex flex-col gap-7">
      <section className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-[#0067B8]"><span className="size-2 rounded-full bg-[#0067B8]" /> Network overview</div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">Emergency operations overview</h1>
          <p className="mt-2 max-w-xl text-sm leading-6 text-slate-500">Coordinate blood resources, monitor active requests, and keep every response moving from one secure workspace.</p>
          <div className="mt-5 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-500"><span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-emerald-700"><span className="size-2 rounded-full bg-emerald-500" /> Network status</span><span className="inline-flex items-center gap-2"><Building2 className="size-4 text-slate-400" /> {organization?.hospital?.name || 'Hospital workspace'}</span></div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/hospital/tracking"><Button variant="outline" className="gap-2"><Navigation data-icon="inline-start" /> Live tracking</Button></Link>
          <Link href="/hospital/requests/new"><Button className="gap-2"><Plus data-icon="inline-start" /> Create request</Button></Link>
        </div>
      </section>

      <section aria-labelledby="overview-heading">
        <div className="mb-3 flex items-center justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">At a glance</p><h2 id="overview-heading" className="mt-1 text-lg font-bold text-slate-900">Emergency overview</h2></div><span className="text-xs text-slate-400">Current request data</span></div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Active requests" value={stats.activeCount} urgency={stats.activeCount ? 'warning' : 'normal'} subtext="Under active resolution" icon={<AlertOctagon className="size-5" />} />
          <MetricCard label="Critical requests" value={stats.criticalCount} urgency={stats.criticalCount ? 'critical' : 'normal'} subtext="Prioritize within 15 min" icon={<Activity className="size-5" />} />
          <MetricCard label="Fulfilled today" value={stats.fulfilledToday} subtext="Deliveries confirmed" icon={<CheckCircle2 className="size-5 text-emerald-600" />} />
          <MetricCard label="Units secured" value={stats.totalReservedUnits} subtext="Reserved across network" icon={<Database className="size-5 text-[#0067B8]" />} />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="overflow-hidden border-slate-200 shadow-sm">
          <CardHeader className="flex flex-col gap-3 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Response queue</p><CardTitle className="mt-1 text-lg text-slate-950">Active emergencies</CardTitle><p className="mt-1 text-xs text-slate-500">Requests requiring coordination across the response network.</p></div><Link href="/hospital/requests" className="inline-flex items-center gap-1 text-xs font-bold text-[#0067B8] hover:underline">View all <ArrowUpRight className="size-3.5" /></Link></CardHeader>
          <CardContent className="p-0">
            {loading ? <div className="flex flex-col gap-3 p-5">{[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-lg bg-slate-100" />)}</div> : activeRequests.length === 0 ? <div className="flex flex-col items-center px-6 py-14 text-center"><CheckCircle2 className="size-10 text-emerald-500" /><h3 className="mt-3 text-sm font-bold text-slate-900">No active emergencies</h3><p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">All emergency requests are currently resolved.</p><Link href="/hospital/requests/new" className="mt-4"><Button size="sm">Create request</Button></Link></div> : <>
              <div className="hidden overflow-x-auto md:block"><table className="w-full text-left"><thead className="bg-slate-50 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400"><tr><th className="px-5 py-3">Request</th><th className="px-3 py-3">Need</th><th className="px-3 py-3">Urgency</th><th className="px-3 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead><tbody className="divide-y divide-slate-100">{activeRequests.slice(0, 8).map((req) => <tr key={req.id} className="transition-colors hover:bg-slate-50"><td className="px-5 py-4"><div className="flex items-center gap-3"><BloodTypeBadge bloodGroup={req.blood_group} size="sm" /><div><p className="text-sm font-bold text-slate-900">{req.quantity} units <span className="font-normal text-slate-500">{req.resource_type.replace(/_/g, ' ')}</span></p><p className="mt-0.5 font-mono text-[10px] text-slate-400">#{req.id.slice(0, 8)}</p></div></div></td><td className="px-3 py-4 text-xs font-semibold text-slate-600">{req.blood_group.replace('_', ' ')}</td><td className="px-3 py-4"><UrgencyBadge urgency={req.urgency} /></td><td className="px-3 py-4"><StatusBadge status={req.status} /></td><td className="px-5 py-4 text-right"><Link href={`/hospital/requests/${req.id}`}><Button size="sm" variant="outline" className="gap-1 text-xs">Open <ExternalLink data-icon="inline-end" /></Button></Link></td></tr>)}</tbody></table></div>
              <div className="flex flex-col gap-3 p-4 md:hidden">{activeRequests.slice(0, 8).map((req) => <Link key={req.id} href={`/hospital/requests/${req.id}`} className="rounded-xl border border-slate-200 p-4 transition-colors hover:border-[#0067B8] hover:bg-blue-50/30"><div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><BloodTypeBadge bloodGroup={req.blood_group} size="sm" /><div><p className="text-sm font-bold text-slate-900">{req.quantity} units</p><p className="text-xs text-slate-500">{req.resource_type.replace(/_/g, ' ')}</p></div></div><UrgencyBadge urgency={req.urgency} /></div><div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3"><StatusBadge status={req.status} /><span className="text-xs font-bold text-[#0067B8]">Open request</span></div></Link>)}</div>
            </>}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-5">
          <Card className="border-slate-200 shadow-sm"><CardHeader className="pb-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Network resources</p><CardTitle className="mt-1 text-lg text-slate-950">Resource availability</CardTitle></CardHeader><CardContent><div className="flex items-end justify-between"><div><p className="text-3xl font-bold text-slate-950">{stats.totalReservedUnits}</p><p className="text-xs text-slate-500">units currently secured</p></div><Database className="size-8 text-blue-100" /></div><p className="mt-5 text-xs text-slate-500">Reserved and consumed allocations across current requests.</p><Link href="/hospital/inventory" className="mt-5 inline-flex items-center gap-1 text-xs font-bold text-[#0067B8]">Review inventory <ArrowUpRight className="size-3.5" /></Link></CardContent></Card>
          <Card className="border-slate-200 shadow-sm"><CardHeader className="pb-3"><p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Operational feed</p><CardTitle className="mt-1 text-lg text-slate-950">Recent activity</CardTitle></CardHeader><CardContent className="flex flex-col gap-4">{requests.slice(0, 3).map((request) => <div key={request.id} className="flex gap-3"><span className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[#0067B8]"><Clock3 className="size-3.5" /></span><div><p className="text-xs font-semibold text-slate-700">Request <span className="font-mono text-slate-400">#{request.id.slice(0, 6)}</span> updated</p><p className="mt-1 text-[11px] text-slate-400">{formatTime(request.created_at)} · {request.status.replace(/_/g, ' ')}</p></div></div>)}{!requests.length && <p className="text-xs text-slate-500">Activity will appear here as requests move through the network.</p>}</CardContent></Card>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-xs text-blue-900"><span className="inline-flex items-center gap-2 font-semibold"><ShieldCheck className="size-4 text-[#0067B8]" /> Secure coordination workspace</span><span className="inline-flex items-center gap-2 text-blue-800/70"><Users className="size-4" /> Multi-tier dispatch enabled</span></div>
    </div>
  );
}
