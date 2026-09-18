'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  AlertOctagon,
  PlusCircle,
  Search,
  ExternalLink,
  ShieldCheck,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '../../../../lib/supabase/auth-context';
import { supabase } from '../../../../lib/supabase/client';
import { Button } from '../../../../components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { StatusBadge } from '../../../../components/shared/StatusBadge';
import { UrgencyBadge } from '../../../../components/shared/UrgencyBadge';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';
import { EmergencyRequest, RequestStatus } from '../../../../types/requests';

export default function HospitalRequestsListPage() {
  const { organization } = useAuth();
  const [requests, setRequests] = useState<EmergencyRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const fetchRequests = async () => {
    try {
      setLoading(true);
      let query = supabase
        .from('emergency_requests')
        .select('*, hospital:hospitals(id, name)')
        .order('created_at', { ascending: false });

      if (organization?.hospitalId) {
        query = query.eq('hospital_id', organization.hospitalId);
      }

      if (statusFilter !== 'ALL') {
        query = query.eq('status', statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRequests((data as unknown as EmergencyRequest[]) || []);
    } catch (err) {
      console.error('Failed to load requests:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, [organization?.hospitalId, statusFilter]);

  const filteredRequests = requests.filter((r) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    return (
      r.id.toLowerCase().includes(query) ||
      r.blood_group.toLowerCase().includes(query) ||
      r.resource_type.toLowerCase().includes(query)
    );
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
            <AlertOctagon className="w-6 h-6 text-red-500" />
            Emergency Requests Directory
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Complete audit trail of medical resource requests across all resolution states
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link href="/hospital/requests/new">
            <Button size="md" variant="default" className="gap-2">
              <PlusCircle className="w-4 h-4" />
              New Emergency Request
            </Button>
          </Link>
        </div>
      </div>

      <Card className="border-slate-800 bg-slate-900/80">
        <CardHeader className="p-4 border-b border-slate-800/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Input
                placeholder="Search by ID, blood group, or component..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="flex items-center gap-3">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="h-9 text-xs w-48"
              >
                <option value="ALL">All Pipeline States</option>
                <option value="OPEN">OPEN</option>
                <option value="SEARCHING">SEARCHING</option>
                <option value="INVENTORY_RESERVED">INVENTORY RESERVED</option>
                <option value="PEER_TRANSFER_PENDING">PEER TRANSFER PENDING</option>
                <option value="DONORS_NOTIFIED">DONORS NOTIFIED</option>
                <option value="EN_ROUTE">EN ROUTE</option>
                <option value="FULFILLED">FULFILLED</option>
                <option value="CANCELLED">CANCELLED</option>
              </Select>

              <Button
                variant="outline"
                size="sm"
                onClick={fetchRequests}
                className="h-9 text-xs gap-1"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Refresh
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400">Loading requests directory...</div>
          ) : filteredRequests.length === 0 ? (
            <div className="p-12 text-center">
              <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
              <p className="text-xs text-slate-400">No emergency requests match current filters.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950/60 text-[10px] uppercase tracking-wider text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Request ID</th>
                    <th className="py-3 px-4">Blood Group</th>
                    <th className="py-3 px-4">Component</th>
                    <th className="py-3 px-4">Units</th>
                    <th className="py-3 px-4">Urgency</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Created Date</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/40">
                  {filteredRequests.map((req) => (
                    <tr key={req.id} className="hover:bg-slate-800/40">
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {req.id.slice(0, 8)}...
                      </td>
                      <td className="py-3 px-4">
                        <BloodTypeBadge bloodGroup={req.blood_group} size="sm" />
                      </td>
                      <td className="py-3 px-4 text-slate-300 font-medium">
                        {req.resource_type.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 px-4 font-bold text-white">
                        {req.quantity}
                      </td>
                      <td className="py-3 px-4">
                        <UrgencyBadge urgency={req.urgency} />
                      </td>
                      <td className="py-3 px-4">
                        <StatusBadge status={req.status} />
                      </td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(req.created_at).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Link href={`/hospital/requests/${req.id}`}>
                          <Button size="sm" variant="outline" className="h-7 text-xs gap-1">
                            Resolution Console
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
