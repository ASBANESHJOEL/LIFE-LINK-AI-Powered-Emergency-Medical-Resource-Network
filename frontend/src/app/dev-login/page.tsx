'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Heart, Building2, Database, ArrowRight, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';

const demoRoles = [
  { role: 'DONOR' as const, label: 'Donor', icon: Heart, description: 'Emergency donor dispatch and availability' },
  { role: 'HOSPITAL' as const, label: 'Hospital', icon: Building2, description: 'Emergency request and resource orchestration' },
  { role: 'BLOOD_BANK' as const, label: 'Blood Bank', icon: Database, description: 'Inventory and peer-bank transfer operations' },
  { role: 'ADMIN' as const, label: 'Admin / Regulator', icon: ShieldCheck, description: 'Network oversight and audit console' },
];

export default function DevLoginPage() {
  const router = useRouter();
  const { signInWithDevRole } = useAuth();
  const [loadingRole, setLoadingRole] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleLogin = async (role: (typeof demoRoles)[number]['role']) => {
    setLoadingRole(role);
    setErrorMessage(null);

    const result = await signInWithDevRole(role);
    if (!result.success) {
      setErrorMessage(result.error || 'Development login failed.');
      setLoadingRole(null);
      return;
    }

    const destinations = {
      DONOR: '/donor/dashboard',
      HOSPITAL: '/hospital/dashboard',
      BLOOD_BANK: '/blood-bank/dashboard',
      ADMIN: '/regulator/dashboard',
    };

    router.push(destinations[role]);
  };

  return (
    <div className="lifelink-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9 w-full max-w-lg">
        <Link href="/" className="brand-mark">
          <span className="brand-mark-icon"><span className="text-base">+</span></span>
          <span className="brand-mark-word">LIFE LINK</span>
        </Link>

        <div className="mt-8">
          <div className="inline-flex items-center gap-2 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-amber-700">
            Local Demo Only
          </div>
          <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">
            Judge Demo Login
          </h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            Passwordless demo sessions for the four LIFE-LINK roles. These sessions are available only when development authentication is enabled on the local backend.
          </p>
        </div>

        {errorMessage && (
          <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <div className="mt-7 space-y-3">
          {demoRoles.map(({ role, label, icon: Icon, description }) => (
            <button
              key={role}
              type="button"
              onClick={() => handleLogin(role)}
              disabled={loadingRole !== null}
              className="group w-full rounded-xl border border-slate-200 bg-white p-4 text-left hover:border-blue-300 hover:bg-blue-50/40 disabled:opacity-60 transition-colors"
            >
              <div className="flex items-center gap-4">
                <div className="h-10 w-10 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center group-hover:bg-blue-100 group-hover:text-blue-700">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-slate-900">
                    {loadingRole === role ? 'Signing in...' : label}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500">{description}</div>
                </div>
                <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600" />
              </div>
            </button>
          ))}
        </div>

        <div className="mt-7 flex items-center gap-2 text-[10px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          Mock tokens are in-memory, expire after 2 hours, and are disabled in production.
        </div>

        <Link href="/login" className="mt-6 inline-flex text-[11px] text-slate-500 hover:text-slate-800">
          Back to normal OTP login
        </Link>
      </div>
    </div>
  );
}
