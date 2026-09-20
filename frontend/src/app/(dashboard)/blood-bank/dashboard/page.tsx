'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Database, Building2, HeartHandshake, ShieldCheck, ArrowUpRight, Plus, ClipboardPlus } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { MetricCard } from '../../../../components/shared/MetricCard';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { BloodInventoryItem } from '../../../../types/inventory';
import { BloodBankTransferOffer } from '../../../../types/transfers';

export default function BloodBankDashboardPage() {
  const { user, organization } = useAuth();
  const [inventory, setInventory] = useState<BloodInventoryItem[]>([]);
  const [transfers, setTransfers] = useState<BloodBankTransferOffer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        setLoading(true);
        let invQuery = supabase.from('blood_inventory').select('*').order('expiry_date', { ascending: true });
        if (organization?.bloodBankId) {
          invQuery = invQuery.eq('blood_bank_id', organization.bloodBankId);
        }
        const { data: invData } = await invQuery;
        if (invData) setInventory(invData as unknown as BloodInventoryItem[]);

        let trQuery = supabase.from('blood_bank_transfer_offers').select('*, emergency_requests(urgency, hospital_id)').order('created_at', { ascending: false }).limit(10);
        if (organization?.bloodBankId) {
          trQuery = trQuery.eq('blood_bank_id', organization.bloodBankId);
        }
        const { data: trData } = await trQuery;
        if (trData) setTransfers(trData as unknown as BloodBankTransferOffer[]);
      } catch (err) {
        console.error('Failed to load blood bank data:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [organization?.bloodBankId]);

  const totalAvailable = inventory.reduce((sum, item) => sum + (item.available_units || 0), 0);
  const totalReserved = inventory.reduce((sum, item) => sum + (item.reserved_units || 0), 0);
  const pendingTransfers = transfers.filter((t) => t.status === 'OFFERED').length;

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 p-6 rounded-2xl bg-gradient-to-r from-sky-950/40 via-slate-900 to-slate-900 border border-sky-900/40 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse"></span>
            <span className="text-xs font-bold uppercase tracking-wider text-sky-400">
              Blood Bank Facility Operations
            </span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">
            {organization?.bloodBank?.name || 'Regional Blood Center Operations'}
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Cold storage inventory control, peer transfer fulfillment & regional emergency response
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/blood-bank/inventory">
            <div className="flex items-center gap-2">
            <Link href="/blood-bank/requests">
              <Button size="md" variant="outline" className="gap-2"><ClipboardPlus className="w-4 h-4" /> Request Stock</Button>
            </Link>
            <Link href="/blood-bank/inventory">
              <Button size="md" variant="medical" className="gap-2 shadow-lg shadow-sky-950/60"><Database className="w-4 h-4" /> Manage Stock Lots</Button>
            </Link>
          </div>
          </Link>
        </div>
      </div>

      {/* KPI Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Available Units"
          value={`${totalAvailable} Units`}
          subtext="Unreserved inventory on site"
          icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          label="Emergency Reserved"
          value={`${totalReserved} Units`}
          urgency={totalReserved > 0 ? 'warning' : 'normal'}
          subtext="Committed to active trauma pipelines"
          icon={<Database className="w-5 h-5 text-sky-400" />}
        />
        <MetricCard
          label="Pending Transfer Offers"
          value={pendingTransfers}
          urgency={pendingTransfers > 0 ? 'warning' : 'normal'}
          subtext="Awaiting trauma center pickup"
          icon={<HeartHandshake className="w-5 h-5 text-amber-400" />}
        />
      </div>

      {/* Two-Column Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Inventory Batches */}
        <Card className="border-slate-800 bg-slate-900/80">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base text-white">Stock Lots Overview</CardTitle>
            <Link
              href="/blood-bank/inventory"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
            >
              All Lots
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="p-3">Blood Group</th>
                    <th className="p-3">Component</th>
                    <th className="p-3">Available</th>
                    <th className="p-3">Reserved</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {inventory.slice(0, 6).map((item) => (
                    <tr key={item.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <BloodTypeBadge bloodGroup={item.blood_group} size="sm" />
                      </td>
                      <td className="p-3 text-slate-300">{item.component_type.replace(/_/g, ' ')}</td>
                      <td className="p-3 font-bold text-emerald-400">{item.available_units}</td>
                      <td className="p-3 font-bold text-amber-400">{item.reserved_units}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Recent Peer Transfers */}
        <Card className="border-slate-800 bg-slate-900/80">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base text-white">Transfer Sourcing Log</CardTitle>
            <Link
              href="/blood-bank/transfers"
              className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1 font-semibold"
            >
              All Transfers
              <ArrowUpRight className="w-3 h-3" />
            </Link>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="p-3">Group</th>
                    <th className="p-3">Units</th>
                    <th className="p-3">Status</th>
                    <th className="p-3 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {transfers.slice(0, 6).map((tr) => (
                    <tr key={tr.id} className="hover:bg-slate-800/40">
                      <td className="p-3">
                        <BloodTypeBadge bloodGroup={tr.blood_group} size="sm" />
                      </td>
                      <td className="p-3 font-bold text-white">{tr.offered_units} Units</td>
                      <td className="p-3">
                        <StatusBadge status={tr.status} />
                      </td>
                      <td className="p-3 text-slate-400 text-right">
                        {new Date(tr.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
