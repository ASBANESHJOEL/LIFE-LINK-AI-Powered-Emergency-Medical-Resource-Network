'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Navigation, MapPin, AlertTriangle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { DonorDispatch } from '../../../../types/dispatch';
import { Card, CardContent, CardHeader, CardTitle } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { StatusBadge } from '../../../../components/shared/StatusBadge';

export default function DonorTrackingPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [dispatches, setDispatches] = useState<DonorDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const { data: donor, error: donorError } = await supabase
        .from('donors')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (donorError) throw donorError;

      const { data, error: dispatchError } = await supabase
        .from('donor_dispatches')
        .select('*, emergency_requests(id, blood_group, urgency, hospital_id, hospitals:hospital_id(hospital_name))')
        .eq('donor_id', donor.id)
        .in('status', ['ACCEPTED', 'EN_ROUTE', 'ARRIVED'])
        .order('updated_at', { ascending: false });

      if (dispatchError) throw dispatchError;
      setDispatches((data || []) as unknown as DonorDispatch[]);
    } catch (err) {
      console.error('Failed to load donor tracking:', err);
      setError(err instanceof Error ? err.message : 'Unable to load active tracking.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [user]);

  const active = dispatches[0];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Navigation className="w-6 h-6 text-sky-500" />
            Donor Live Tracking
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Follow the OSRM emergency route to the assigned hospital and share your live GPS position.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="p-4 text-sm text-red-700 flex gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </CardContent>
        </Card>
      )}

      {loading ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">Loading active emergency tracking...</CardContent></Card>
      ) : active ? (
        <Card className="border-sky-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Active Emergency Dispatch</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <div className="text-sm font-bold text-slate-900">Hospital destination</div>
                <div className="text-xs text-slate-500 mt-1">
                  {(active as any).emergency_requests?.hospitals?.hospital_name || 'Assigned Emergency Hospital'}
                </div>
              </div>
              <StatusBadge status={active.status} />
            </div>
            <div className="rounded-xl border border-sky-200 bg-sky-50 p-4">
              <div className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-sky-600 mt-0.5" />
                <div>
                  <div className="text-sm font-bold text-slate-900">OSRM route navigation</div>
                  <p className="text-xs text-slate-600 mt-1">
                    Open the active dispatch to view the route geometry, hospital destination, ETA, GPS telemetry and transit controls.
                  </p>
                </div>
              </div>
            </div>
            <Link href={`/donor/dispatches/${active.id}`}>
              <Button className="w-full sm:w-auto gap-2">
                <Navigation className="w-4 h-4" />
                Open Live Route & GPS Tracking
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-slate-200 bg-white">
          <CardContent className="p-10 text-center">
            <Navigation className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h2 className="text-base font-bold text-slate-900">No active route</h2>
            <p className="text-xs text-slate-500 mt-1">
              Accept an emergency dispatch to unlock live OSRM navigation and GPS tracking.
            </p>
            <Link href="/donor/alerts" className="inline-block mt-4">
              <Button variant="outline">View Emergency Alerts</Button>
            </Link>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
