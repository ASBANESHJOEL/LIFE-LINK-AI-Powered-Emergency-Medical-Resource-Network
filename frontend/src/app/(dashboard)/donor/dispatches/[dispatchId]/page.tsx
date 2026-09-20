'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Truck,
  ArrowLeft,
  Navigation,
  CheckCircle2,
  Clock,
  MapPin,
  RefreshCw,
  Building2,
  Heart,
  AlertTriangle,
  Radio,
} from 'lucide-react';
import { supabase } from '../../../../../lib/supabase/client';
import { api } from '../../../../../lib/api/client';
import { Button } from '../../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../../../../components/ui/alert';
import { StatusBadge } from '../../../../../components/shared/StatusBadge';
import { BloodTypeBadge } from '../../../../../components/shared/BloodTypeBadge';
import { RouteTrackingMap } from '../../../../../components/shared/RouteTrackingMap';
import { DonorDispatch, RouteInfo } from '../../../../../types/dispatch';

export default function DonorDispatchTrackingPage() {
  const params = useParams();
  const router = useRouter();
  const dispatchId = params?.dispatchId as string;

  const [dispatch, setDispatch] = useState<DonorDispatch | null>(null);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [trackingTelemetry, setTrackingTelemetry] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showWithdrawModal, setShowWithdrawModal] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState('');

  const loadDispatchData = useCallback(async () => {
    if (!dispatchId) return;
    try {
      setLoading(true);
      // Fetch dispatch details
      const { data, error } = await supabase
        .from('donor_dispatches')
        .select('*, donor:donors(*), emergency_requests(*, hospitals:hospital_id(id, hospital_name))')
        .eq('id', dispatchId)
        .single();

      if (error) throw error;
      setDispatch(data as unknown as DonorDispatch);

      // Fetch OSRM Route telemetry from backend
      try {
        const route = await api.donorDispatches.getRoute(dispatchId);
        setRouteInfo(route);
      } catch (routeErr) {
        console.warn('Could not load live OSRM route:', routeErr);
      }

      // Fetch tracking telemetry status
      try {
        const tracking = await api.donorDispatches.getTracking(dispatchId);
        setTrackingTelemetry(tracking);
      } catch (tErr) {
        console.warn('Could not load tracking telemetry:', tErr);
      }
    } catch (err: unknown) {
      console.error('Failed to load dispatch:', err);
      const msg = err instanceof Error ? err.message : 'Error fetching dispatch record';
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  }, [dispatchId]);

  useEffect(() => {
    loadDispatchData();
  }, [loadDispatchData]);

  // Milestone Action: Withdraw from Dispatch
  const handleWithdraw = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      await api.donorDispatches.withdraw(dispatchId, false, withdrawReason || 'DONOR_WITHDREW');
      setShowWithdrawModal(false);
      setStatusMessage('You have withdrawn from this dispatch. Your donor eligibility remains 100% ELIGIBLE and unharmed.');
      await loadDispatchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to withdraw from dispatch';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Milestone Action 1: Start Transit
  const handleStartTransit = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      await api.donorDispatches.startTracking(dispatchId);
      setStatusMessage('Transit started! Your live coordinates are now tracked.');
      await loadDispatchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to start transit';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Milestone Action 2: Transmit GPS Location Update
  const handleTransmitLocation = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      // Use browser geolocation if available or donor's recorded latitude
      let lat = dispatch?.donor?.current_latitude || 12.965;
      let lng = dispatch?.donor?.current_longitude || 77.585;

      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            lat = pos.coords.latitude;
            lng = pos.coords.longitude;
            await api.donorDispatches.updateLocation(dispatchId, lat, lng);
            setStatusMessage(`GPS Transmitted: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            await loadDispatchData();
            setActionLoading(false);
          },
          async () => {
            // Fallback to donor coords
            await api.donorDispatches.updateLocation(dispatchId, lat, lng);
            setStatusMessage(`GPS Transmitted from registered coordinates: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
            await loadDispatchData();
            setActionLoading(false);
          }
        );
      } else {
        await api.donorDispatches.updateLocation(dispatchId, lat, lng);
        setStatusMessage(`GPS Transmitted: ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
        await loadDispatchData();
        setActionLoading(false);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to transmit GPS location';
      setErrorMessage(msg);
      setActionLoading(false);
    }
  };

  // Milestone Action 3: Arrived At Hospital
  const handleArrive = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      await api.donorDispatches.arrive(dispatchId);
      setStatusMessage('Arrival confirmed at trauma facility! Report to blood bank receiving.');
      await loadDispatchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to record arrival';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  // Milestone Action 4: Confirm Donation Completed
  const handleComplete = async () => {
    setActionLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.donorDispatches.complete(dispatchId);
      setStatusMessage('Donation procedure complete! Request is now FULFILLED.');
      await loadDispatchData();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to complete donation';
      setErrorMessage(msg);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading && !dispatch) {
    return (
      <div className="p-12 text-center">
        <div className="h-8 w-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-xs text-slate-400">Synchronizing live OSRM navigation route...</p>
      </div>
    );
  }

  if (!dispatch) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-red-400">Dispatch record not found.</p>
        <Link href="/donor/dashboard" className="mt-4 inline-block">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const req = dispatch.emergency_requests;
  const hospitalName = (req as any)?.hospitals?.hospital_name || (req as any)?.hospitals?.name || 'Trauma Emergency Facility';

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/donor/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Live Transit & Emergency Route Tracking
            </h1>
            <p className="text-xs text-slate-400">Destination: {hospitalName}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadDispatchData} className="text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Telemetry
          </Button>
          <StatusBadge status={dispatch.status} />
        </div>
      </div>

      {/* GPS Warning Banner if location missing during ACCEPTED/EN_ROUTE */}
      {['ACCEPTED', 'EN_ROUTE'].includes(dispatch.status) && (!dispatch.current_latitude || trackingTelemetry?.status === 'WAITING_FOR_LOCATION') && (
        <Alert variant="warning" className="bg-amber-950/40 border-amber-800 text-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-400" />
          <AlertTitle className="font-bold">Turn on GPS to Enable Emergency Routing</AlertTitle>
          <AlertDescription className="text-xs text-amber-300/90">
            Emergency route telemetry requires live coordinates. Grace period active (5m timeout). Please transmit your location or start transit.
          </AlertDescription>
        </Alert>
      )}

      {/* Cancelled / Released Dispatch Alert */}
      {dispatch.status === 'CANCELLED' && (
        <Alert variant="destructive" className="bg-red-950/50 border-red-800">
          <AlertTriangle className="w-5 h-5 text-red-400" />
          <AlertTitle className="font-bold">Dispatch Released ({dispatch.cancellation_reason || 'CANCELLED'})</AlertTitle>
          <AlertDescription className="text-xs text-red-200">
            This dispatch has been safely released back to the emergency network. Your donor profile remains <strong>100% ELIGIBLE</strong> for future matching.
          </AlertDescription>
        </Alert>
      )}

      {statusMessage && (
        <Alert variant="success">
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Milestone Updated</AlertTitle>
          <AlertDescription>{statusMessage}</AlertDescription>
        </Alert>
      )}

      {errorMessage && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Action Error</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {/* Transit Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
        <div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Distance to Trauma Unit</span>
          <span className="text-xl font-bold text-white mt-1 block">
            {routeInfo?.distanceKm ? `${routeInfo.distanceKm.toFixed(1)} km` : '—'}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Estimated Transit Time</span>
          <span className="text-xl font-bold text-sky-400 mt-1 block">
            {routeInfo?.etaMinutes ? `${routeInfo.etaMinutes} mins` : `${dispatch.eta || '—'} mins`}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Telemetry Status</span>
          <div className="mt-1.5 flex items-center gap-1.5">
            {trackingTelemetry?.isStale ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                Stale Location (&gt; 5m)
              </span>
            ) : trackingTelemetry?.status === 'WAITING_FOR_LOCATION' ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-sky-500/20 text-sky-300 border border-sky-500/30 animate-pulse">
                Waiting for Location
              </span>
            ) : dispatch.status === 'EN_ROUTE' ? (
              <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
                Live GPS Active
              </span>
            ) : (
              <span className="text-xs text-slate-400">Standby</span>
            )}
          </div>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Routing Provider</span>
          <span className="text-sm font-semibold text-emerald-400 mt-1.5 block truncate">
            {routeInfo?.routingProvider || 'OSRM Highway Engine'}
          </span>
        </div>
        <div>
          <span className="text-[10px] uppercase font-semibold text-slate-400 block">Target Blood Group</span>
          <div className="mt-1">
            <BloodTypeBadge bloodGroup={req?.blood_group || 'O-'} size="sm" />
          </div>
        </div>
      </div>

      {/* Interactive MapLibre GL Map */}
      <Card className="border-slate-800 bg-slate-900/90 p-0 overflow-hidden">
        {routeInfo && routeInfo.geometry ? (
          <RouteTrackingMap
            geometry={routeInfo.geometry}
            donorLocation={
              routeInfo.donorLocation || {
                latitude: dispatch.donor?.current_latitude || 12.965,
                longitude: dispatch.donor?.current_longitude || 77.585,
              }
            }
            hospitalLocation={
              routeInfo.hospitalLocation || {
                latitude: req?.hospital_latitude || 12.9716,
                longitude: req?.hospital_longitude || 77.5946,
              }
            }
            routingProvider={routeInfo.routingProvider}
            fallback={routeInfo.fallback}
          />
        ) : (
          <div className="h-[350px] flex items-center justify-center text-xs text-slate-500">
            Route geometry awaiting live GPS coordinates...
          </div>
        )}
      </Card>

      {/* Milestone State Progression Controls */}
      <Card className="border-slate-800 bg-slate-900/90">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="text-base text-white flex items-center gap-2">
              <Radio className="w-4 h-4 text-red-400 animate-pulse" />
              Milestone Progression Protocol
            </CardTitle>
            <CardDescription className="text-xs">
              Confirm your physical transit state to notify hospital surgical theater staff.
            </CardDescription>
          </div>
          {['ACCEPTED', 'EN_ROUTE'].includes(dispatch.status) && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWithdrawModal(true)}
              className="text-xs text-red-400 border-red-900 hover:bg-red-950/50 hover:text-red-300"
            >
              Withdraw from Dispatch
            </Button>
          )}
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3 pt-2">
          {dispatch.status === 'ACCEPTED' && (
            <Button
              variant="medical"
              size="lg"
              isLoading={actionLoading}
              onClick={handleStartTransit}
              className="gap-2"
            >
              <Navigation className="w-4 h-4" />
              1. Start Transit (En Route)
            </Button>
          )}

          {dispatch.status === 'EN_ROUTE' && (
            <>
              <Button
                variant="outline"
                size="lg"
                isLoading={actionLoading}
                onClick={handleTransmitLocation}
                className="gap-2"
              >
                <MapPin className="w-4 h-4 text-sky-400" />
                Transmit Current GPS
              </Button>
              <Button
                variant="default"
                size="lg"
                isLoading={actionLoading}
                onClick={handleArrive}
                className="gap-2 bg-emerald-600 hover:bg-emerald-500"
              >
                <Building2 className="w-4 h-4" />
                2. Confirm Arrived at Facility
              </Button>
            </>
          )}

          {dispatch.status === 'ARRIVED' && (
            <Button
              variant="default"
              size="lg"
              isLoading={actionLoading}
              onClick={handleComplete}
              className="gap-2 bg-emerald-600 hover:bg-emerald-500 shadow-lg shadow-emerald-950/60"
            >
              <CheckCircle2 className="w-5 h-5" />
              3. Confirm Blood Draw & Donation Completed
            </Button>
          )}

          {dispatch.status === 'COMPLETED' && (
            <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm p-3 rounded-lg bg-emerald-950/40 border border-emerald-800">
              <CheckCircle2 className="w-5 h-5" />
              Donation Procedure Completed & Fulfilled in Surgery Theatre. Thank you for saving a life!
            </div>
          )}
        </CardContent>
      </Card>

      {/* Withdrawal Confirmation Modal */}
      {showWithdrawModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="max-w-md w-full rounded-2xl bg-slate-900 border border-red-800/60 p-6 shadow-2xl space-y-4">
            <div className="flex items-center gap-3 text-amber-400">
              <AlertTriangle className="w-6 h-6" />
              <h3 className="text-lg font-bold text-white">Withdraw from Dispatch?</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed">
              Withdrawing releases this assignment immediately back to the hospital so another donor can be matched.
            </p>
            <div className="p-3 rounded-lg bg-emerald-950/40 border border-emerald-800/40 text-[11px] text-emerald-300">
              ✅ <strong>Eligibility Unharmed:</strong> Your eligibility status remains <strong>100% ELIGIBLE</strong>. You may participate in future dispatches anytime.
            </div>
            <div>
              <label className="text-[11px] uppercase font-semibold text-slate-400 block mb-1">
                Reason for Withdrawal (Optional)
              </label>
              <input
                type="text"
                value={withdrawReason}
                onChange={(e) => setWithdrawReason(e.target.value)}
                placeholder="e.g., Heavy traffic, personal emergency, GPS issue..."
                className="w-full px-3 py-2 text-xs bg-slate-950 border border-slate-700 rounded-lg text-white focus:outline-none focus:border-red-500"
              />
            </div>
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowWithdrawModal(false)}
                disabled={actionLoading}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleWithdraw}
                isLoading={actionLoading}
              >
                Confirm Withdrawal
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
