'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { Activity, ArrowLeft, ExternalLink, MapPin, RefreshCw } from 'lucide-react';
import { supabase } from '../../../../lib/supabase/client';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { api } from '../../../../lib/api/client';
import { Button } from '../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../components/ui/card';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';

type TrackingRow = {
  id: string;
  request_id: string;
  status: string;
  eta: number | null;
  priority_score: number | null;
  emergency_requests?: {
    id: string;
    blood_group: string;
    urgency: string;
    hospital_id: string;
  } | null;
};

export default function HospitalTrackingPage() {
  const { organization } = useAuth();
  const [dispatches, setDispatches] = useState<TrackingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const loadDispatches = async () => {
    if (!organization?.hospitalId) return;

    setLoading(true);
    setErrorMessage(null);

    const { data, error } = await supabase
      .from('donor_dispatches')
      .select('id, request_id, status, eta, priority_score, emergency_requests!inner(id, blood_group, urgency, hospital_id)')
      .eq('emergency_requests.hospital_id', organization.hospitalId)
      .in('status', ['PENDING', 'NOTIFIED', 'ACCEPTED', 'EN_ROUTE', 'ARRIVED'])
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      setErrorMessage(error.message);
      setDispatches([]);
    } else {
      setDispatches((data || []) as TrackingRow[]);
    }

    setLoading(false);
  };

  useEffect(() => {
    loadDispatches();
  }, [organization?.hospitalId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/hospital/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Live Donor Tracking
            </h1>
            <p className="text-xs text-slate-500">
              Monitor donor dispatches assigned to your emergency requests.
            </p>
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={loadDispatches} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load tracking data: {errorMessage}
        </div>
      )}

      <Card className="border-slate-200">
        <CardHeader>
          <CardTitle className="text-base">Active Dispatches</CardTitle>
          <CardDescription>
            Select a dispatch to view route geometry, ETA, GPS telemetry, and lifecycle state.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-10 text-center text-sm text-slate-500">Loading live dispatches...</div>
          ) : dispatches.length === 0 ? (
            <div className="p-10 text-center">
              <Activity className="w-9 h-9 mx-auto mb-3 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No active donor dispatches</p>
              <p className="text-xs text-slate-500 mt-1">
                Donor tracking will appear here after a dispatch is created for an open emergency request.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500 border-y border-slate-200">
                  <tr>
                    <th className="p-3">Dispatch</th>
                    <th className="p-3">Blood Group</th>
                    <th className="p-3">Urgency</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">ETA</th>
                    <th className="p-3 text-right">Tracking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dispatches.map((dispatch) => (
                    <tr key={dispatch.id} className="hover:bg-slate-50">
                      <td className="p-3 font-mono text-slate-700">{dispatch.id.slice(0, 8)}...</td>
                      <td className="p-3">
                        <BloodTypeBadge bloodGroup={dispatch.emergency_requests?.blood_group || 'O-'} size="sm" />
                      </td>
                      <td className="p-3 font-semibold text-slate-700">{dispatch.emergency_requests?.urgency || '—'}</td>
                      <td className="p-3"><StatusBadge status={dispatch.status} /></td>
                      <td className="p-3 text-slate-600">{dispatch.eta ? `${dispatch.eta} mins` : 'Waiting for GPS'}</td>
                      <td className="p-3 text-right">
                        <Link href={`/hospital/tracking/${dispatch.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            Track Live
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
