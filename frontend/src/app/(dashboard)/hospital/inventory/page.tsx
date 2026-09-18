'use client';

import React, { useState, useEffect } from 'react';
import { Database, AlertTriangle, ShieldCheck, RefreshCw } from 'lucide-react';
import { supabase } from '../../../../lib/supabase/client';
import { BloodInventoryItem } from '../../../../types/inventory';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { MetricCard } from '../../../../components/shared/MetricCard';

export default function HospitalInventoryPage() {
  const [inventory, setInventory] = useState<BloodInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInventory = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('blood_inventory')
        .select('*, blood_banks:blood_bank_id(id, name)')
        .order('expiry_date', { ascending: true });

      if (error) throw error;
      setInventory((data as unknown as BloodInventoryItem[]) || []);
    } catch (err) {
      console.error('Failed to load inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, []);

  const totalAvailable = inventory.reduce((sum, item) => sum + (item.available_units || 0), 0);
  const totalReserved = inventory.reduce((sum, item) => sum + (item.reserved_units || 0), 0);

  const isExpiringSoon = (expiryDateStr: string) => {
    const expiry = new Date(expiryDateStr);
    const now = new Date();
    const diffDays = (expiry.getTime() - now.getTime()) / (1000 * 3600 * 24);
    return diffDays <= 7 && diffDays >= 0;
  };

  const isExpired = (expiryDateStr: string) => {
    return new Date(expiryDateStr) < new Date();
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-sky-400" />
            Hospital Blood Inventory Reserve
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Real-time stock of local hospital reserves and cold-storage units
          </p>
        </div>

        <Button variant="outline" size="sm" onClick={fetchInventory} className="text-xs gap-1.5">
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh Stock
        </Button>
      </div>

      {/* KPI Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <MetricCard
          label="Available Units"
          value={`${totalAvailable} Units`}
          subtext="Ready for immediate transfusion"
          icon={<ShieldCheck className="w-5 h-5 text-emerald-400" />}
        />
        <MetricCard
          label="Reserved Units"
          value={`${totalReserved} Units`}
          urgency={totalReserved > 0 ? 'warning' : 'normal'}
          subtext="Allocated to active emergency requests"
          icon={<Database className="w-5 h-5 text-sky-400" />}
        />
        <MetricCard
          label="Total Managed Lots"
          value={inventory.length}
          subtext="Separate cold storage batches"
          icon={<Database className="w-5 h-5 text-slate-400" />}
        />
      </div>

      {/* Inventory Table */}
      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">Stock Directory</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading stock data...</div>
          ) : inventory.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No inventory units logged in the local facility.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Component</th>
                    <th className="py-3 px-4">Available</th>
                    <th className="py-3 px-4">Reserved</th>
                    <th className="py-3 px-4">Facility / Bank</th>
                    <th className="py-3 px-4">Expiry Date</th>
                    <th className="py-3 px-4 text-right">Batch Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {inventory.map((item) => {
                    const expired = isExpired(item.expiry_date);
                    const expiring = isExpiringSoon(item.expiry_date);

                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <BloodTypeBadge bloodGroup={item.blood_group} size="sm" />
                        </td>
                        <td className="py-3 px-4 font-medium text-slate-200">
                          {item.component_type.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 px-4 font-bold text-emerald-400 text-sm">
                          {item.available_units} Units
                        </td>
                        <td className="py-3 px-4 font-bold text-amber-400">
                          {item.reserved_units} Units
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {item.blood_banks?.name || 'Central Reserve'}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {new Date(item.expiry_date).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {expired ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/80 text-red-300 border border-red-800">
                              EXPIRED
                            </span>
                          ) : expiring ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950/80 text-amber-300 border border-amber-800 animate-pulse">
                              EXPIRING SOON
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                              VALID
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
