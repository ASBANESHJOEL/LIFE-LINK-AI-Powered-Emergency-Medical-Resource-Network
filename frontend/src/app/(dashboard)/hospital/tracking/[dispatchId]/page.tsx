'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, MapPin, RefreshCw, Activity } from 'lucide-react';
import { api } from '../../../../../../lib/api/client';
import { Button } from '../../../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../../../components/ui/card';
import { StatusBadge } from '../../../../../../components/shared/StatusBadge';
import { RouteTrackingMap } from '../../../../../../components/shared/RouteTrackingMap';

export default function HospitalTrackingDetailPage() {
  const params = useParams();
  const dispatchId = params?.dispatchId as string;

  const [tracking, setTracking] = useState<any>(null);
  const [route, setRoute] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!dispatchId) return;
    setLoading(true);
    setErrorMessage(null);

    try {
      const [trackingResult, routeResult] = await Promise.all([
        api.donorDispatches.getTracking(dispatchId),
        api.donorDispatches.getRoute(dispatchId).catch(() => null),
      ]);
      setTracking(trackingResult);
      setRoute(routeResult);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to load donor tracking.');
    } finally {
      setLoading(false);
    }
  }, [dispatchId]);

  useEffect(() => {
    load();
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [load]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/hospital/tracking">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Tracking
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <MapPin className="w-5 h-5 text-blue-600" />
              Emergency Route Tracking
            </h1>
            <p className="text-xs text-slate-500 font-mono">{dispatchId}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={load} className="gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {errorMessage}
        </div>
      )}

      {loading && !tracking ? (
        <div className="p-10 text-center text-sm text-slate-500">Synchronizing donor telemetry...</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Card><CardContent className="p-4"><span className="text-[10px] uppercase text-slate-500">Status</span><div className="mt-2"><StatusBadge status={tracking?.status || 'UNKNOWN'} /></div></CardContent></Card>
            <Card><CardContent className="p-4"><span className="text-[10px] uppercase text-slate-500">Telemetry</span><p className="mt-2 text-sm font-semibold text-slate-800">{tracking?.trackingStatus || 'UNAVAILABLE'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><span className="text-[10px] uppercase text-slate-500">ETA</span><p className="mt-2 text-sm font-semibold text-slate-800">{tracking?.currentLocation?.eta ? `${tracking.currentLocation.eta} mins` : '—'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><span className="text-[10px] uppercase text-slate-500">Last GPS</span><p className="mt-2 text-xs text-slate-700">{tracking?.currentLocation?.recordedAt ? new Date(tracking.currentLocation.recordedAt).toLocaleString() : 'Waiting for location'}</p></CardContent></Card>
            <Card><CardContent className="p-4"><span className="text-[10px] uppercase text-slate-500">Route</span><p className="mt-2 text-xs font-semibold text-slate-700">{route?.routingProvider || 'OSRM'}</p></CardContent></Card>
          </div>

          <Card className="overflow-hidden">
            <CardHeader>
              <CardTitle className="text-base">Live Route</CardTitle>
              <CardDescription>Telemetry refreshes automatically every 15 seconds.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {route?.geometry ? (
                <RouteTrackingMap
                  geometry={route.geometry}
                  donorLocation={route.donorLocation}
                  hospitalLocation={route.hospitalLocation}
                  routingProvider={route.routingProvider}
                  fallback={route.fallback}
                />
              ) : (
                <div className="h-[380px] flex flex-col items-center justify-center text-center text-slate-500 bg-slate-50">
                  <Activity className="w-10 h-10 mb-3 text-slate-300" />
                  <p className="text-sm font-semibold">Waiting for donor GPS telemetry</p>
                  <p className="text-xs mt-1 max-w-md">
                    The route map will populate when the donor accepts the dispatch and starts transmitting a location.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
