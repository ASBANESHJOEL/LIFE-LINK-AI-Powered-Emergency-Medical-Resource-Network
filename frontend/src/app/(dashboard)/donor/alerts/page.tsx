'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AlertOctagon, Check, X, Navigation, RefreshCw, Clock, MapPin, Building2 } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { api } from '../../../../lib/api/client';
import { DonorDispatch } from '../../../../types/dispatch';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { UrgencyBadge } from '../../../../components/shared/UrgencyBadge';
import { Alert, AlertTitle, AlertDescription } from '../../../../components/ui/alert';

export default function DonorAlertsPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [alerts, setAlerts] = useState<DonorDispatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const fetchAlerts = async () => {
    if (!user) return;
    try {
      setLoading(true);
      // Get donor record
      const { data: donor } = await supabase
        .from('donors')
        .select('id')
        .eq('user_id', user.id)
        .single();

      if (donor) {
        const { data: dispatches, error } = await supabase
          .from('donor_dispatches')
          .select('*, emergency_requests(*, hospitals:hospital_id(name))')
          .eq('donor_id', donor.id)
          .eq('status', 'NOTIFIED')
          .order('notified_at', { ascending: false });

        if (error) throw error;
        setAlerts((dispatches as unknown as DonorDispatch[]) || []);
      }
    } catch (err) {
      console.error('Failed to load alerts:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, [user]);

  const handleRespond = async (dispatchId: string, response: 'ACCEPT' | 'DECLINE') => {
    setRespondingId(dispatchId);
    setErrorMessage(null);
    try {
      const result = await api.donorDispatches.respond(dispatchId, response);
      if (response === 'ACCEPT') {
        router.push(`/donor/dispatches/${dispatchId}`);
      } else {
        await fetchAlerts();
      }
    } catch (err: unknown) {
      console.error('Response error:', err);
      const message = err instanceof Error ? err.message : 'Failed to register dispatch response.';
      setErrorMessage(message);
    } finally {
      setRespondingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-red-500" />
            Active Trauma Dispatch Alerts
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Emergency requests requiring immediate volunteer response and transit commitment
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchAlerts} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Alerts
        </Button>
      </div>

      {errorMessage && (
        <Alert variant="destructive">
          <AlertOctagon className="w-4 h-4" />
          <AlertTitle>Action Failed</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {loading ? (
        <div className="p-12 text-center text-xs text-slate-400">Scanning active alert channel...</div>
      ) : alerts.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/80 p-12 text-center">
          <AlertOctagon className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h3 className="text-base font-bold text-white">No Pending Trauma Alerts</h3>
          <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
            You currently have zero pending alerts. Keep notifications enabled to receive real-time match requests.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {alerts.map((alert) => {
            const req = alert.emergency_requests;
            const isResponding = respondingId === alert.id;

            return (
              <Card
                key={alert.id}
                className="border-red-900/60 bg-gradient-to-br from-red-950/30 via-slate-900 to-slate-900 shadow-2xl backdrop-blur-md"
              >
                <CardHeader className="flex flex-row items-center justify-between pb-3">
                  <div className="flex items-center gap-3">
                    <BloodTypeBadge bloodGroup={req?.blood_group || 'O-'} size="md" />
                    <div>
                      <CardTitle className="text-base text-white">
                        Urgent Trauma Request: {req?.quantity || 1} Unit(s) {req?.resource_type?.replace(/_/g, ' ')}
                      </CardTitle>
                      <CardDescription className="text-xs text-slate-400 flex items-center gap-1.5 mt-0.5">
                        <Building2 className="w-3.5 h-3.5 text-slate-500" />
                        Facility: {(req as any)?.hospitals?.name || 'Emergency Trauma Center'}
                      </CardDescription>
                    </div>
                  </div>
                  {req?.urgency && <UrgencyBadge urgency={req.urgency} />}
                </CardHeader>

                <CardContent className="py-2 border-t border-slate-800/60 text-xs text-slate-300">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-3 rounded-lg bg-slate-950/60">
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Batch Priority</span>
                      <span className="font-bold text-sky-400 font-mono">
                        {alert.priority_score ? (alert.priority_score * 100).toFixed(1) + '%' : 'Top Tier'}
                      </span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Batch Group</span>
                      <span className="font-bold text-white">Batch #{alert.batch_number}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Estimated Transit</span>
                      <span className="font-bold text-white">{alert.eta ? `${alert.eta} mins` : 'Direct Route'}</span>
                    </div>
                    <div>
                      <span className="text-slate-400 block text-[10px] uppercase">Alert Logged</span>
                      <span className="text-slate-300">
                        {new Date(alert.notified_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </CardContent>

                <CardFooter className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800/40">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isResponding}
                    onClick={() => handleRespond(alert.id, 'DECLINE')}
                    className="text-xs text-slate-400 hover:text-red-400"
                  >
                    <X className="w-3.5 h-3.5 mr-1" />
                    Decline
                  </Button>
                  <Button
                    variant="default"
                    size="sm"
                    isLoading={isResponding}
                    onClick={() => handleRespond(alert.id, 'ACCEPT')}
                    className="text-xs font-bold gap-1.5 bg-red-600 hover:bg-red-500 shadow-md shadow-red-950/50"
                  >
                    <Check className="w-4 h-4" />
                    Accept & Begin Transit
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
