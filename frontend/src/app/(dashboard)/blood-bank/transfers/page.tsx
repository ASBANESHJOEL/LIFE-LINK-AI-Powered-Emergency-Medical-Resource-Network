'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { HeartHandshake, RefreshCw, ExternalLink } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { BloodBankTransferOffer } from '../../../../types/transfers';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { StatusBadge } from '../../../../components/shared/StatusBadge';

export default function BloodBankTransfersPage() {
  const { organization } = useAuth();
  const [transfers, setTransfers] = useState<BloodBankTransferOffer[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransfers = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('blood_bank_transfer_offers')
        .select('*, emergency_requests(id, urgency, hospital_id, hospitals:hospital_id(name))')
        .order('created_at', { ascending: false });

      if (organization?.bloodBankId) {
        query = query.eq('blood_bank_id', organization.bloodBankId);
      }

      const { data, error } = await query;
      if (error) throw error;
      setTransfers((data as unknown as BloodBankTransferOffer[]) || []);
    } catch (err) {
      console.error('Failed to load transfers:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransfers();
  }, [organization?.bloodBankId]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <HeartHandshake className="w-6 h-6 text-amber-400" />
            Inter-Facility Transfer Commitments
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Units reserved and dispatched to regional trauma centers
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchTransfers} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">Active Transfer Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading transfers...</div>
          ) : transfers.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No transfer offers active for this facility.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Offer ID</th>
                    <th className="py-3 px-4">Requesting Hospital</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Offered Units</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created At</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {transfers.map((offer) => (
                    <tr key={offer.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">{offer.id.slice(0, 8)}...</td>
                      <td className="py-3 px-4 font-semibold text-white">
                        {offer.emergency_requests?.hospitals?.name || 'Regional Trauma Center'}
                      </td>
                      <td className="py-3 px-4">
                        <BloodTypeBadge bloodGroup={offer.blood_group} size="sm" />
                      </td>
                      <td className="py-3 px-4 font-bold text-amber-400">{offer.offered_units} Units</td>
                      <td className="py-3 px-4">
                        <StatusBadge status={offer.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(offer.created_at).toLocaleString()}
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
