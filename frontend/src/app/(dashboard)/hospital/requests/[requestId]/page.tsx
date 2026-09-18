'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AlertOctagon,
  ArrowLeft,
  Database,
  Building2,
  Users,
  CheckCircle2,
  Clock,
  Sparkles,
  MapPin,
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Send,
  AlertTriangle,
} from 'lucide-react';
import { supabase } from '../../../../../lib/supabase/client';
import { api } from '../../../../../lib/api/client';
import { Button } from '../../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../../../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../../../../components/ui/alert';
import { StatusBadge } from '../../../../../components/shared/StatusBadge';
import { UrgencyBadge } from '../../../../../components/shared/UrgencyBadge';
import { BloodTypeBadge } from '../../../../../components/shared/BloodTypeBadge';
import { ResolutionPipelineStepper } from '../../../../../components/shared/ResolutionPipelineStepper';
import {
  EmergencyRequest,
  InventoryResolutionResult,
  PeerBanksResolutionResult,
} from '../../../../../types/requests';
import {
  RankingResult,
  DonorDispatch,
  EligibleDonor,
} from '../../../../../types/dispatch';

export default function EmergencyRequestResolutionPage() {
  const params = useParams();
  const router = useRouter();
  const requestId = params?.requestId as string;

  const [request, setRequest] = useState<EmergencyRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Resolution Pipeline States
  const [inventoryResult, setInventoryResult] = useState<InventoryResolutionResult | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(false);

  const [peerBanksResult, setPeerBanksResult] = useState<PeerBanksResolutionResult | null>(null);
  const [peerBanksLoading, setPeerBanksLoading] = useState(false);
  const [acceptingOfferId, setAcceptingOfferId] = useState<string | null>(null);

  const [eligibleDonors, setEligibleDonors] = useState<EligibleDonor[] | null>(null);
  const [eligibleLoading, setEligibleLoading] = useState(false);

  const [rankingResult, setRankingResult] = useState<RankingResult | null>(null);
  const [rankingLoading, setRankingLoading] = useState(false);

  const [dispatchLoading, setDispatchLoading] = useState(false);
  const [dispatches, setDispatches] = useState<DonorDispatch[]>([]);

  const loadRequest = useCallback(async () => {
    if (!requestId) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('emergency_requests')
        .select('*, hospital:hospitals(id, name)')
        .eq('id', requestId)
        .single();

      if (error) throw error;
      setRequest(data as unknown as EmergencyRequest);

      // Also load existing donor dispatches for this request
      const { data: dispatchData } = await supabase
        .from('donor_dispatches')
        .select('*, donor:donors(id, blood_group, users:user_id(email))')
        .eq('request_id', requestId)
        .order('batch_number', { ascending: true });

      if (dispatchData) {
        setDispatches(dispatchData as unknown as DonorDispatch[]);
      }
    } catch (err: unknown) {
      console.error('Failed to load request:', err);
      const message = err instanceof Error ? err.message : 'Error fetching request details';
      setErrorMessage(message);
    } finally {
      setLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    loadRequest();
  }, [loadRequest]);

  // Tier 1: Inventory Resolution
  const handleResolveInventory = async () => {
    if (!requestId) return;
    setInventoryLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await api.requests.resolveInventory(requestId);
      setInventoryResult(result);
      if (result.allocatedUnits > 0) {
        setSuccessMessage(`Successfully allocated ${result.allocatedUnits} units from inventory reserve.`);
      } else {
        setSuccessMessage('No compatible inventory units available in local reserve.');
      }
      await loadRequest();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Inventory resolution failed';
      setErrorMessage(message);
    } finally {
      setInventoryLoading(false);
    }
  };

  // Tier 2: Peer Banks Resolution
  const handleResolvePeerBanks = async () => {
    if (!requestId) return;
    setPeerBanksLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await api.requests.resolvePeerBanks(requestId);
      setPeerBanksResult(result);
      setSuccessMessage(`Discovered ${result.offers.length} peer blood bank transfer offers.`);
      await loadRequest();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Peer banks query failed';
      setErrorMessage(message);
    } finally {
      setPeerBanksLoading(false);
    }
  };

  const handleAcceptTransferOffer = async (offerId: string) => {
    setAcceptingOfferId(offerId);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const result = await api.transfers.accept(offerId);
      setSuccessMessage(`Transfer offer accepted! ${result.reservedUnits} units reserved from peer bank.`);
      await loadRequest();
      // Re-run peer banks to update remaining
      const updated = await api.requests.resolvePeerBanks(requestId);
      setPeerBanksResult(updated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Accept transfer failed';
      setErrorMessage(message);
    } finally {
      setAcceptingOfferId(null);
    }
  };

  // Tier 3: Scan Eligible Donors
  const handleScanEligibleDonors = async () => {
    if (!requestId) return;
    setEligibleLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.requests.getEligibleDonors(requestId);
      setEligibleDonors(result.donors);
      setSuccessMessage(`Identified ${result.candidateCount} eligible verified volunteer donors within range.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to scan eligible donors';
      setErrorMessage(message);
    } finally {
      setEligibleLoading(false);
    }
  };

  // Tier 3: Run ML Ranking
  const handleRunRanking = async () => {
    if (!requestId) return;
    setRankingLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.requests.getDonorRanking(requestId);
      setRankingResult(result);
      setSuccessMessage(`Model ${result.modelVersion} evaluated and ranked ${result.candidateCount} candidates.`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'ML ranking failed';
      setErrorMessage(message);
    } finally {
      setRankingLoading(false);
    }
  };

  // Tier 3: Dispatch Next Batch
  const handleDispatchNextBatch = async () => {
    if (!requestId) return;
    setDispatchLoading(true);
    setErrorMessage(null);
    try {
      const result = await api.requests.dispatchNextBatch(requestId, 5);
      setSuccessMessage(`Dispatched Batch #${result.batchNumber}: Notified ${result.notified} volunteer donors.`);
      await loadRequest();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Batch dispatch failed';
      setErrorMessage(message);
    } finally {
      setDispatchLoading(false);
    }
  };

  if (loading && !request) {
    return (
      <div className="p-12 text-center">
        <div className="h-8 w-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin mx-auto mb-3"></div>
        <p className="text-xs text-slate-400">Loading emergency resolution workspace...</p>
      </div>
    );
  }

  if (!request) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm font-semibold text-red-400">Emergency request record not found.</p>
        <Link href="/hospital/dashboard" className="mt-4 inline-block">
          <Button variant="outline" size="sm">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header & Status */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/hospital/dashboard">
            <Button variant="outline" size="sm">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back
            </Button>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              Resolution Workspace: <span className="font-mono text-slate-300">{request.id.slice(0, 8)}</span>
            </h1>
            <p className="text-xs text-slate-400">
              Trauma Center: {request.hospital?.name || 'Authorized Emergency Hospital'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={loadRequest} className="text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh Telemetry
          </Button>
          <StatusBadge status={request.status} />
        </div>
      </div>

      {/* Global Alerts */}
      {errorMessage && (
        <Alert variant="destructive">
          <AlertTriangle className="w-4 h-4" />
          <AlertTitle>Resolution Exception</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success">
          <CheckCircle2 className="w-4 h-4" />
          <AlertTitle>Action Confirmed</AlertTitle>
          <AlertDescription>{successMessage}</AlertDescription>
        </Alert>
      )}

      {/* Core Architectural Resolution Stepper */}
      <ResolutionPipelineStepper
        currentStatus={request.status}
        allocatedInventoryUnits={inventoryResult?.allocatedUnits || (request.status === 'INVENTORY_RESERVED' ? request.quantity : 0)}
        transferredUnits={peerBanksResult?.offers.reduce((acc, o) => acc + o.offeredUnits, 0) || 0}
        dispatchedDonorsCount={dispatches.length}
        totalQuantity={request.quantity}
      />

      {/* Request Specs Overview Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 p-4 rounded-xl bg-slate-900/90 border border-slate-800">
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Target Blood Group</span>
          <div className="mt-1">
            <BloodTypeBadge bloodGroup={request.blood_group} size="sm" />
          </div>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Component</span>
          <span className="text-xs font-bold text-white mt-1 block">
            {request.resource_type.replace(/_/g, ' ')}
          </span>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Requested Units</span>
          <span className="text-lg font-black text-white mt-0.5 block">{request.quantity} Units</span>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Triage Urgency</span>
          <div className="mt-1">
            <UrgencyBadge urgency={request.urgency} />
          </div>
        </div>
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Trauma Coords</span>
          <span className="text-xs font-mono text-slate-300 mt-1 block">
            {request.hospital_latitude.toFixed(4)}, {request.hospital_longitude.toFixed(4)}
          </span>
        </div>
      </div>

      {/* TIER 1: INVENTORY RESOLUTION */}
      <Card className="border-slate-800 bg-slate-900/90">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-sky-950/80 border border-sky-800/60 flex items-center justify-center text-sky-400">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base text-white">Tier 1: Hospital & Reserve Inventory Allocation</CardTitle>
              <CardDescription className="text-xs">
                Queries local blood inventory and atomically locks available units to satisfy request.
              </CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            variant="medical"
            onClick={handleResolveInventory}
            isLoading={inventoryLoading}
            className="text-xs font-semibold"
          >
            Run Inventory Allocation
          </Button>
        </CardHeader>

        {inventoryResult && (
          <CardContent className="pt-2 border-t border-slate-800/60">
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-4 rounded-lg bg-slate-950/60 mb-4 text-xs">
              <div>
                <span className="text-slate-400 block">Requested Units:</span>
                <span className="font-bold text-white text-sm">{inventoryResult.requestedUnits}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Allocated Units:</span>
                <span className="font-bold text-emerald-400 text-sm">{inventoryResult.allocatedUnits}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Remaining Shortfall:</span>
                <span className="font-bold text-amber-400 text-sm">{inventoryResult.remainingUnits}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Fully Sourced:</span>
                <span className={`font-bold text-sm ${inventoryResult.fullyReserved ? 'text-emerald-400' : 'text-slate-300'}`}>
                  {inventoryResult.fullyReserved ? 'YES (100% Satisfied)' : 'NO (Trigger Peer Banks)'}
                </span>
              </div>
            </div>

            {inventoryResult.allocations && inventoryResult.allocations.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase text-slate-400 bg-slate-950/80">
                    <tr>
                      <th className="p-2.5">Allocation ID</th>
                      <th className="p-2.5">Inventory Unit</th>
                      <th className="p-2.5">Units Allocated</th>
                      <th className="p-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {inventoryResult.allocations.map((alloc) => (
                      <tr key={alloc.id}>
                        <td className="p-2.5 font-mono text-slate-300">{alloc.id}</td>
                        <td className="p-2.5 font-mono text-slate-400">{alloc.inventoryId}</td>
                        <td className="p-2.5 font-bold text-emerald-400">{alloc.unitsAllocated} Unit(s)</td>
                        <td className="p-2.5 text-slate-300">{alloc.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* TIER 2: PEER BLOOD BANK TRANSFERS */}
      <Card className="border-slate-800 bg-slate-900/90">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base text-white">Tier 2: Peer Blood Bank Transfer Offers</CardTitle>
              <CardDescription className="text-xs">
                Scans affiliated regional facilities by geodesic distance and computes transfer allocations.
              </CardDescription>
            </div>
          </div>
          <Button
            size="sm"
            variant="secondary"
            onClick={handleResolvePeerBanks}
            isLoading={peerBanksLoading}
            className="text-xs font-semibold"
          >
            Search Peer Blood Banks
          </Button>
        </CardHeader>

        {peerBanksResult && (
          <CardContent className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs text-slate-400 mb-3">
              <span>Remaining units to source: <strong className="text-white">{peerBanksResult.remainingUnits}</strong></span>
              <span>Available offers: <strong className="text-white">{peerBanksResult.offers.length}</strong></span>
            </div>

            {peerBanksResult.offers.length === 0 ? (
              <p className="text-xs text-slate-400 p-4 text-center bg-slate-950/40 rounded-lg">
                No peer blood banks currently hold compatible reserve stock within range. Proceed to Tier 3.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[10px] uppercase text-slate-400 bg-slate-950/80">
                    <tr>
                      <th className="p-2.5">Blood Bank Name</th>
                      <th className="p-2.5">Distance</th>
                      <th className="p-2.5">Bank Stock</th>
                      <th className="p-2.5">Offered Units</th>
                      <th className="p-2.5 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/40">
                    {peerBanksResult.offers.map((offer) => (
                      <tr key={offer.id}>
                        <td className="p-2.5 font-semibold text-white">{offer.bloodBankName}</td>
                        <td className="p-2.5 text-slate-300">{offer.distanceKm.toFixed(1)} km</td>
                        <td className="p-2.5 text-slate-400">{offer.availableUnits} units</td>
                        <td className="p-2.5 font-bold text-amber-400">{offer.offeredUnits} Units</td>
                        <td className="p-2.5 text-right">
                          <Button
                            size="sm"
                            variant="success"
                            className="h-7 text-xs"
                            isLoading={acceptingOfferId === offer.id}
                            onClick={() => handleAcceptTransferOffer(offer.id)}
                          >
                            Accept Offer
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* TIER 3: PREDICTIVE ML VOLUNTEER DONOR DISPATCH */}
      <Card className="border-slate-800 bg-slate-900/90">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-red-950/80 border border-red-800/60 flex items-center justify-center text-red-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-base text-white">
                Tier 3: Volunteer Donor Dispatch (Logistic Regression V1 ML)
              </CardTitle>
              <CardDescription className="text-xs">
                Filters verified donors by 90-day cooldown and scores responsiveness via frozen ML model.
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={handleScanEligibleDonors}
              isLoading={eligibleLoading}
              className="text-xs"
            >
              1. Scan Donors
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleRunRanking}
              isLoading={rankingLoading}
              className="text-xs"
            >
              2. Run ML Ranking
            </Button>
            <Button
              size="sm"
              variant="default"
              onClick={handleDispatchNextBatch}
              isLoading={dispatchLoading}
              className="text-xs font-semibold gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              3. Dispatch Next Batch (5)
            </Button>
          </div>
        </CardHeader>

        {rankingResult && (
          <CardContent className="pt-2 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-xs mb-3">
              <span className="text-slate-400">
                Model: <strong className="text-sky-400">{rankingResult.modelVersion}</strong> (Logistic Regression Frozen V1)
              </span>
              <span className="text-slate-400">
                Candidates Evaluated: <strong className="text-white">{rankingResult.candidateCount}</strong>
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase text-slate-400 bg-slate-950/80">
                  <tr>
                    <th className="p-2.5">Rank</th>
                    <th className="p-2.5">Donor ID</th>
                    <th className="p-2.5">Blood Group</th>
                    <th className="p-2.5">Distance</th>
                    <th className="p-2.5">ML Priority Score</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {rankingResult.rankedDonors.slice(0, 5).map((donor, idx) => (
                    <tr key={donor.donorId} className={idx === 0 ? 'bg-red-950/20' : ''}>
                      <td className="p-2.5 font-bold text-white">#{idx + 1}</td>
                      <td className="p-2.5 font-mono text-slate-300">{donor.donorId.slice(0, 8)}...</td>
                      <td className="p-2.5">
                        <BloodTypeBadge bloodGroup={donor.bloodGroup} size="sm" />
                      </td>
                      <td className="p-2.5 text-slate-300">{donor.distanceKm.toFixed(2)} km</td>
                      <td className="p-2.5">
                        <span className="font-mono font-bold text-sky-400">
                          {(donor.priorityScore * 100).toFixed(1)}%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        )}
      </Card>

      {/* DISPATCHES & LIVE ROUTE TRACKING */}
      {dispatches.length > 0 && (
        <Card className="border-slate-800 bg-slate-900/90">
          <CardHeader>
            <CardTitle className="text-base text-white">Active Donor Dispatches ({dispatches.length})</CardTitle>
            <CardDescription className="text-xs">
              Live status and OSRM transit tracking for notified volunteer donors.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="text-[10px] uppercase text-slate-400 bg-slate-950/80 border-b border-slate-800">
                  <tr>
                    <th className="p-3">Batch</th>
                    <th className="p-3">Donor ID</th>
                    <th className="p-3">Priority Score</th>
                    <th className="p-3">Status</th>
                    <th className="p-3">ETA</th>
                    <th className="p-3 text-right">Route Tracking</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {dispatches.map((dispatch) => (
                    <tr key={dispatch.id} className="hover:bg-slate-800/40">
                      <td className="p-3 font-semibold text-slate-400">Batch #{dispatch.batch_number}</td>
                      <td className="p-3 font-mono text-slate-300">{dispatch.donor_id.slice(0, 8)}...</td>
                      <td className="p-3 font-mono font-bold text-sky-400">
                        {dispatch.priority_score ? (dispatch.priority_score * 100).toFixed(1) + '%' : '—'}
                      </td>
                      <td className="p-3">
                        <StatusBadge status={dispatch.status} />
                      </td>
                      <td className="p-3 text-slate-300">
                        {dispatch.eta ? `${dispatch.eta} mins` : 'Calculating...'}
                      </td>
                      <td className="p-3 text-right">
                        <Link href={`/donor/dispatches/${dispatch.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            Track Map
                            <ExternalLink className="w-3 h-3" />
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
