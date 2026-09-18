'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Navigation, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { DonorDispatch } from '../../../../types/dispatch';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { StatusBadge } from '../../../../components/shared/StatusBadge';

export default function DonorDispatchesListPage() {
  const { user } = useAuth();
  const [dispatches, setDispatches] = useState<DonorDispatch[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchDispatches = async () => {
    if (!user) return;
    try {
      setLoading(true);
      const { data: donor } = await supabase.from('donors').select('id').eq('user_id', user.id).single();
      if (donor) {
        const { data, error } = await supabase
          .from('donor_dispatches')
          .select('*, emergency_requests(id, blood_group, urgency, hospital_id, hospitals:hospital_id(name))')
          .eq('donor_id', donor.id)
          .order('notified_at', { ascending: false });

        if (error) throw error;
        setDispatches((data as unknown as DonorDispatch[]) || []);
      }
    } catch (err) {
      console.error('Failed to load dispatches:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDispatches();
  }, [user]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Navigation className="w-6 h-6 text-sky-400" />
            Your Emergency Dispatches
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Tracking records of volunteer donations, live transit, and facility completions
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchDispatches} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">Dispatches History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading dispatches...</div>
          ) : dispatches.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No dispatches assigned yet.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Dispatch ID</th>
                    <th className="py-3 px-4">Destination Facility</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Notified At</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {dispatches.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">{d.id.slice(0, 8)}...</td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {(d as any).emergency_requests?.hospitals?.name || 'Trauma Hospital'}
                      </td>
                      <td className="py-3 px-4">
                        <BloodTypeBadge bloodGroup={(d as any).emergency_requests?.blood_group || 'O-'} size="sm" />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={d.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(d.notified_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link href={`/donor/dispatches/${d.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            Live Route
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
