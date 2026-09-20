'use client';

import React, { useEffect, useState } from 'react';
import { ClipboardPlus, RefreshCw, Send, AlertTriangle } from 'lucide-react';
import { api } from '../../../../lib/api/client';
import { Card, CardHeader, CardTitle, CardContent } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { Input } from '../../../../components/ui/input';
import { Select } from '../../../../components/ui/select';
import { BloodTypeBadge } from '../../../../components/shared/BloodTypeBadge';

const groups = [
  ['A_POSITIVE','A+'],['A_NEGATIVE','A-'],['B_POSITIVE','B+'],['B_NEGATIVE','B-'],
  ['AB_POSITIVE','AB+'],['AB_NEGATIVE','AB-'],['O_POSITIVE','O+'],['O_NEGATIVE','O-']
];
const components = [
  ['WHOLE_BLOOD','Whole Blood'],['RED_BLOOD_CELLS','Red Blood Cells'],['PLASMA','Plasma'],['PLATELETS','Platelets']
];
const priorities = ['LOW','MEDIUM','HIGH','CRITICAL'];

export default function BloodBankRequestStockPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ bloodGroup:'O_NEGATIVE', componentType:'RED_BLOOD_CELLS', requiredUnits:'5', priority:'HIGH' });

  const load = async () => {
    try {
      setLoading(true);
      const result = await api.bloodBank.getRefillRequests();
      setRequests(result.requests || []);
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Unable to load requests'); }
    finally { setLoading(false); }
  };

  useEffect(()=>{ load(); },[]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true); setMessage('');
    try {
      await api.bloodBank.createRefillRequest({
        bloodGroup: form.bloodGroup,
        componentType: form.componentType,
        requiredUnits: Number(form.requiredUnits),
        priority: form.priority,
      });
      setMessage('Peer blood-bank refill request created successfully.');
      setForm({...form, requiredUnits:'5'});
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed to create request'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
          <ClipboardPlus className="w-6 h-6 text-amber-600"/> Request Blood Stock
        </h1>
        <p className="text-xs text-slate-500 mt-1">Create a peer-network refill request when your facility needs additional stock.</p>
      </div>

      {message && <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">{message}</div>}

      <Card className="border-amber-200">
        <CardHeader><CardTitle className="text-base">New Peer Refill Request</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Select label="Blood Group" value={form.bloodGroup} onChange={e=>setForm({...form,bloodGroup:e.target.value})}>
              {groups.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </Select>
            <Select label="Component" value={form.componentType} onChange={e=>setForm({...form,componentType:e.target.value})}>
              {components.map(([v,l])=><option key={v} value={v}>{l}</option>)}
            </Select>
            <Input label="Required Units" type="number" min="1" value={form.requiredUnits} onChange={e=>setForm({...form,requiredUnits:e.target.value})} required/>
            <Select label="Priority" value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}>
              {priorities.map(p=><option key={p} value={p}>{p}</option>)}
            </Select>
            <div className="lg:col-span-4 flex justify-end">
              <Button type="submit" disabled={saving} className="gap-2">{saving ? 'Submitting...' : 'Create Refill Request'} <Send className="w-4 h-4"/></Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">My Refill Requests</CardTitle>
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5"/> Refresh</Button>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading requests...</div> :
          requests.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No refill requests yet.</div> :
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-y text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">Blood</th><th className="p-3">Component</th><th className="p-3">Units</th><th className="p-3">Priority</th><th className="p-3">Status</th><th className="p-3">Created</th></tr>
            </thead>
            <tbody className="divide-y">
              {requests.map(r=><tr key={r.id} className="hover:bg-slate-50">
                <td className="p-3"><BloodTypeBadge bloodGroup={groups.find(([v])=>v===r.blood_group)?.[1] || r.blood_group} size="sm"/></td>
                <td className="p-3">{String(r.component_type).replace(/_/g,' ')}</td>
                <td className="p-3 font-bold">{r.required_units}</td>
                <td className="p-3 font-semibold">{r.priority}</td>
                <td className="p-3"><span className="rounded-full bg-slate-100 px-2 py-1 font-semibold">{r.status}</span></td>
                <td className="p-3 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
              </tr>)}
            </tbody>
          </table></div>}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 text-xs text-sky-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0"/> This request represents a stock refill need from the blood-bank network; emergency hospital requests continue through the hospital emergency workflow.
      </div>
    </div>
  );
}
