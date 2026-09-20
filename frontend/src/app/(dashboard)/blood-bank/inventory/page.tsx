'use client';

import React, { useEffect, useState } from 'react';
import { Database, RefreshCw, Plus, Minus, PackagePlus, AlertTriangle } from 'lucide-react';
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
const displayGroup = (value: string) => groups.find(([apiValue]) => apiValue === value)?.[1] || value;

export default function BloodBankInventoryManagementPage() {
  const [inventory, setInventory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [message, setMessage] = useState('');
  const [form, setForm] = useState({ bloodGroup:'O_NEGATIVE', componentType:'RED_BLOOD_CELLS', units:'5', criticalLevel:'2', expiryDate:'' });

  const load = async () => {
    try {
      setLoading(true);
      const result = await api.bloodBank.getInventory();
      setInventory(result.inventory || []);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Unable to load inventory');
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const addLot = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true); setMessage('');
    try {
      await api.bloodBank.addInventoryLot({
        bloodGroup: form.bloodGroup,
        componentType: form.componentType,
        units: Number(form.units),
        criticalLevel: Number(form.criticalLevel),
        expiryDate: new Date(form.expiryDate).toISOString(),
      });
      setShowAdd(false);
      setMessage('Inventory lot added successfully.');
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed to add inventory lot'); }
    finally { setSaving(false); }
  };

  const adjust = async (id: string, delta: number) => {
    setSaving(true); setMessage('');
    try {
      await api.bloodBank.updateInventory(id, { deltaUnits: delta });
      await load();
    } catch (err) { setMessage(err instanceof Error ? err.message : 'Failed to update stock'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <Database className="w-6 h-6 text-sky-600" /> Blood Inventory Control
          </h1>
          <p className="text-xs text-slate-500 mt-1">Add stock lots, adjust available units and maintain critical thresholds.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} className="gap-1.5"><RefreshCw className="w-3.5 h-3.5" /> Refresh</Button>
          <Button size="sm" onClick={() => setShowAdd(true)} className="gap-1.5"><Plus className="w-4 h-4" /> Add Stock Lot</Button>
        </div>
      </div>

      {message && <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs text-sky-800">{message}</div>}

      {showAdd && (
        <Card className="border-sky-200 shadow-sm">
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><PackagePlus className="w-5 h-5 text-sky-600" /> Add Blood Stock Lot</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addLot} className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              <Select label="Blood Group" value={form.bloodGroup} onChange={e=>setForm({...form,bloodGroup:e.target.value})}>
                {groups.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </Select>
              <Select label="Component" value={form.componentType} onChange={e=>setForm({...form,componentType:e.target.value})}>
                {components.map(([v,l])=><option key={v} value={v}>{l}</option>)}
              </Select>
              <Input label="Units" type="number" min="1" value={form.units} onChange={e=>setForm({...form,units:e.target.value})}/>
              <Input label="Critical Level" type="number" min="0" value={form.criticalLevel} onChange={e=>setForm({...form,criticalLevel:e.target.value})}/>
              <Input label="Expiry Date" type="date" min={new Date().toISOString().slice(0,10)} value={form.expiryDate} onChange={e=>setForm({...form,expiryDate:e.target.value})} required/>
              <div className="lg:col-span-5 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={()=>setShowAdd(false)}>Cancel</Button>
                <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Lot'}</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Stock Lots</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? <div className="p-8 text-center text-sm text-slate-500">Loading inventory...</div> :
          inventory.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">No inventory lots yet. Add your first stock lot.</div> :
          <div className="overflow-x-auto"><table className="w-full text-left text-xs">
            <thead className="bg-slate-50 border-y text-[10px] uppercase tracking-wider text-slate-500">
              <tr><th className="p-3">Blood</th><th className="p-3">Component</th><th className="p-3">Available</th><th className="p-3">Reserved</th><th className="p-3">Critical</th><th className="p-3">Expiry</th><th className="p-3 text-right">Adjust</th></tr>
            </thead>
            <tbody className="divide-y">
              {inventory.map(item => {
                const expired = new Date(item.expiry_date) <= new Date();
                return <tr key={item.id} className="hover:bg-slate-50">
                  <td className="p-3"><BloodTypeBadge bloodGroup={displayGroup(item.blood_group)} size="sm"/></td>
                  <td className="p-3 font-medium">{String(item.component_type).replace(/_/g,' ')}</td>
                  <td className={`p-3 font-bold ${item.available_units <= item.critical_level ? 'text-red-600' : 'text-emerald-600'}`}>{item.available_units}</td>
                  <td className="p-3 font-semibold text-amber-600">{item.reserved_units}</td>
                  <td className="p-3">{item.critical_level}</td>
                  <td className="p-3">{new Date(item.expiry_date).toLocaleDateString()} {expired && <span className="text-red-600 ml-1">EXPIRED</span>}</td>
                  <td className="p-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="outline" disabled={saving || item.available_units <= item.reserved_units} onClick={()=>adjust(item.id,-1)} title="Remove one available unit"><Minus className="w-3 h-3"/></Button>
                      <Button size="sm" variant="outline" disabled={saving} onClick={()=>adjust(item.id,1)} title="Add one available unit"><Plus className="w-3 h-3"/></Button>
                    </div>
                  </td>
                </tr>
              })}
            </tbody>
          </table></div>}
        </CardContent>
      </Card>

      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
        <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0"/>
        Inventory changes affect what the emergency resolution engine can reserve. Reserved units cannot be reduced below their committed amount.
      </div>
    </div>
  );
}
