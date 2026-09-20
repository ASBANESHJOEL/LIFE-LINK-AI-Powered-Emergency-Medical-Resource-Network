'use client';

import React, { useState } from 'react';
import { BrandLogo } from '../../components/shared/BrandLogo';
import Link from 'next/link';
import { ChevronRight, ChevronLeft } from 'lucide-react';

const roles = [
  { id: 'DONOR', title: 'Donor', subtitle: 'Help when someone needs blood.' },
  { id: 'HOSPITAL', title: 'Hospital', subtitle: 'Coordinate emergency blood requests.' },
  { id: 'ADMIN', title: 'Admin', subtitle: 'Manage network operations.' },
  { id: 'BLOOD_BANK', title: 'Blood Bank', subtitle: 'Manage inventory and transfers.' },
];

export default function ChooseRolePage() {
  const [selected, setSelected] = useState('DONOR');

  return (
    <div className="lifelink-page min-h-screen flex items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9">
        <BrandLogo href="/" />
        <div className="mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Choose your role</h1>
          <p className="mt-2 text-xs text-slate-500">Select how you use Life Link</p>
        </div>

        <div className="mt-7 space-y-2.5">
          {roles.map(role => (
            <button key={role.id} type="button" onClick={() => setSelected(role.id)} className={`role-option text-left ${selected === role.id ? 'selected' : ''}`}>
              <span><span className="block font-semibold">{role.title}</span><span className="block mt-0.5 text-[10px] text-slate-400">{role.subtitle}</span></span>
              <ChevronRight className="w-4 h-4 shrink-0" />
            </button>
          ))}
        </div>

        <Link href={`/signup?role=${selected}`} className="mt-5 h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2">
          Continue <ChevronRight className="w-4 h-4" />
        </Link>

        <div className="mt-6 text-center text-xs text-slate-500">Already have an account? <Link href="/login" className="font-semibold text-blue-600">Log in</Link></div>
        <Link href="/" className="mt-6 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"><ChevronLeft className="w-3.5 h-3.5" /> Back</Link>
      </div>
    </div>
  );
}
