'use client';

import React, { useState, useEffect } from 'react';
import { Database, RefreshCw, AlertTriangle, ShieldCheck, Filter } from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { BloodInventoryItem } from '../../../../types/inventory';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { Select } from '../../../../components/ui/select';

export default function BloodBankInventoryManagementPage() {
  const { organization } = useAuth();
  const [inventory, setInventory] = useState<BloodInventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [bloodGroupFilter, setBloodGroupFilter] = useState('ALL');

  const fetchInventory = async () => {
    try {
      setLoading(true);
      let query = supabase.from('blood_inventory').select('*').order('expiry_date', { ascending: true });
      if (organization?.bloodBankId) {
        query = query.eq('blood_bank_id', organization.bloodBankId);
      }
      if (bloodGroupFilter !== 'ALL') {
        query = query.eq('blood_group', bloodGroupFilter);
      }
      const { data, error } = await query;
      if (error) throw error;
      setInventory((data as unknown as BloodInventoryItem[]) || []);
    } catch (err) {
      console.error('Failed to fetch inventory:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInventory();
  }, [organization?.bloodBankId, bloodGroupFilter]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-sky-400" />
            Facility Stock & Cold Storage Batches
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Track available and emergency-reserved blood components by expiration date
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select
            value={bloodGroupFilter}
            onChange={(e) => setBloodGroupFilter(e.target.value)}
            className="h-9 text-xs w-44"
          >
            <option value="ALL">All Blood Groups</option>
            <option value="O-">O-</option>
            <option value="O+">O+</option>
            <option value="A-">A-</option>
            <option value="A+">A+</option>
            <option value="B-">B-</option>
            <option value="B+">B+</option>
            <option value="AB-">AB-</option>
            <option value="AB+">AB+</option>
          </Select>

          <Button variant="outline" size="sm" onClick={fetchInventory} className="h-9 text-xs gap-1.5">
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader>
          <CardTitle className="text-base text-white">Stock Lots Directory</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading stock data...</div>
          ) : inventory.length === 0 ? (
            <div className="p-12 text-center text-xs text-slate-400">
              No inventory lots found matching criteria.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400 border-y border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Lot ID</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Component Type</th>
                    <th className="py-3 px-4">Available Units</th>
                    <th className="py-3 px-4">Reserved Units</th>
                    <th className="py-3 px-4">Expiry Date</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {inventory.map((item) => {
                    const isExpired = new Date(item.expiry_date) < new Date();

                    return (
                      <tr key={item.id} className="hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono text-slate-400">{item.id.slice(0, 8)}...</td>
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
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {new Date(item.expiry_date).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4 text-right">
                          {isExpired ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-950/80 text-red-300 border border-red-800">
                              EXPIRED
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                              SAFE FOR TRANSFUSION
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
