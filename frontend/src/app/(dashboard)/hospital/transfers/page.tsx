'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Building2, RefreshCw, ExternalLink, ShieldCheck } from 'lucide-react';
import { supabase } from '../../../../lib/supabase/client';
import { api } from '../../../../lib/api/client';
import { BloodBankTransferOffer } from '../../../../types/transfers';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { StatusBadge } from '../../../../components/shared/StatusBadge';

export default function HospitalTransfersPage() {
  const [offers, setOffers] = useState<BloodBankTransferOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);

  const fetchTransfers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('blood_bank_transfer_offers')
        .select('*, blood_banks:blood_bank_id(id, name), emergency_requests:request_id(id, urgency, hospital_id, hospitals:hospital_id(name))')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setOffers((data as unknown as BloodBankTransferOffer[]) || []);
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, []);

  const handleAccept = async (id: string) => {
    setAcceptingId(id);
    try {
      await api.transfers.accept(id);
      await fetchTransfers();
    } catch (err) {
      console.error('Failed to accept transfer offer:', err);
    } finally {
      setAcceptingId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Building2 className="w-6 h-6 text-amber-400" />
            Peer Blood Bank Transfer Logs
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Inter-facility blood transfers generated during Tier 2 resolution pipeline
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchTransfers} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Transfers
        </Button>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">Transfer Offers Directory</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading transfer data...</div>
          ) : offers.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No peer transfer offers currently recorded.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Offer ID</th>
                    <th className="py-3 px-4">Origin Blood Bank</th>
                    <th className="py-3 px-4">Target Request</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Offered Units</th>
                    <th className="py-3 px-4">Transit Distance</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {offers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {offer.id.slice(0, 8)}...
                      </td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {offer.blood_banks?.name || 'Regional Bank'}
                      </td>
                      <td className="py-3 px-4">
                        <Link
                          href={`/hospital/requests/${offer.request_id}`}
                          className="font-mono text-sky-400 hover:underline inline-flex items-center gap-1"
                        >
                          {offer.request_id.slice(0, 8)}...
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                      <td className="py-3 px-4">
                        <BloodTypeBadge bloodGroup={offer.blood_group} size="sm" />
                      </td>
                      <td className="py-3 px-4 font-bold text-amber-400">
                        {offer.offered_units} Units
                      </td>
                      <td className="py-3 px-4 text-slate-300">
                        {offer.distance_km ? `${offer.distance_km.toFixed(1)} km` : '—'}
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={offer.status} />
                      </td>
                      <td className="py-3 px-4 text-right">
                        {offer.status === 'PENDING' ? (
                          <Button
                            size="sm"
                            variant="success"
                            className="h-7 text-xs"
                            isLoading={acceptingId === offer.id}
                            onClick={() => handleAccept(offer.id)}
                          >
                            Accept Offer
                          </Button>
                        ) : (
                          <span className="text-slate-500 text-[11px]">Processed</span>
                        )}
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
