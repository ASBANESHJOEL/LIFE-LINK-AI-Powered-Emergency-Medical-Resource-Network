'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { ShieldAlert, Activity, RefreshCw, Database, Building2, CheckCircle2 } from 'lucide-react';
import { supabase } from '../../../../lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { MetricCard } from '../../../../components/shared/MetricCard';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { UrgencyBadge } from '../../../../components/shared/UrgencyBadge';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { EmergencyRequest } from '../../../../types/requests';

export default function RegulatorDashboardPage() {
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAuditData = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('emergency_requests')
        .select('*, hospital:hospitals(id, name)')
        .order('created_at', { ascending: false })
        .limit(25);

      if (error) throw error;
      setRequests((data as unknown as EmergencyRequest[]) || []);
    } catch (err) {
      console.error('Failed to load audit data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAuditData();
  }, []);

  const totalRequests = requests.length;
  const criticalRequests = requests.filter((r) => r.urgency === 'CRITICAL').length;
  const fulfilledRequests = requests.filter((r) => r.status === 'FULFILLED').length;
  const escalatedRequests = requests.filter((r) => r.status === 'ESCALATED').length;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-6 h-6 text-sky-400" />
            Regional Blood Resource Regulatory Console
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Global network oversight, SLA compliance auditing, and emergency escalations
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchAuditData} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Audit
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <MetricCard
          label="Total Trauma Requests"
          value={totalRequests}
          subtext="Audited on platform"
          icon={<Activity className="w-5 h-5" />}
        />
        <MetricCard
          label="Critical Triage (SLA)"
          value={criticalRequests}
          urgency={criticalRequests > 0 ? 'critical' : 'normal'}
          subtext="High urgency trauma surgeries"
          icon={<ShieldAlert className="w-5 h-5 text-red-400" />}
        />
        <MetricCard
          label="Fulfilled Deliveries"
          value={fulfilledRequests}
          subtext="Completed successfully"
          icon={<CheckCircle2 className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          label="Escalated Incidents"
          value={escalatedRequests}
          urgency={escalatedRequests > 0 ? 'warning' : 'normal'}
          subtext="Shortfall escalation events"
          icon={<ShieldAlert className="w-5 h-5 text-amber-400" />}
        />
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">System Audit Log</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Auditing network telemetry...</div>
          ) : requests.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No emergency requests currently recorded in the registry.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Request ID</th>
                    <th className="py-3 px-4">Facility</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Units</th>
                    <th className="py-3 px-4">Urgency</th>
                    <th className="py-3 px-4">Resolution Status</th>
                    <th className="py-3 px-4 text-right">Logged Time</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">
                        <Link href={`/hospital/requests/${r.id}`} className="hover:underline text-sky-400">
                          {r.id.slice(0, 8)}...
                        </Link>
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {r.hospital?.name || 'Regional Hospital'}
                      </td>
                      <td className="py-3 px-4">
                        <BloodTypeBadge bloodGroup={r.blood_group} size="sm" />
                      </td>
                      <td className="py-3 px-4 font-bold text-white">{r.quantity} Units</td>
                      <td className="py-3 px-4">
                        <UrgencyBadge urgency={r.urgency} />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-400 text-right">
                        {new Date(r.created_at).toLocaleString()}
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
