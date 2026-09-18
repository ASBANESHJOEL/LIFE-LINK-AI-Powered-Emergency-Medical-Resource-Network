'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronLeft, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { normalizeEmail, savePendingEmail } from '../../lib/supabase/pending-email';

function SignupContent() {
  const router = useRouter();
  const params = useSearchParams();
  const role = params.get('role') || 'DONOR';
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const roleName = role === 'BLOOD_BANK' ? 'Blood Bank' : role === 'ADMIN' ? 'Admin' : role.charAt(0) + role.slice(1).toLowerCase();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) { setError('Please enter a valid email address.'); return; }
    setLoading(true); setError('');
    const result = await signInWithOtp(clean, { shouldCreateUser: true });
    setLoading(false);
    if (result.success) {
      savePendingEmail(clean);
      router.push('/verify-otp?email=' + encodeURIComponent(clean));
    } else {
      setError(result.error || 'Unable to send the verification code.');
    }
  };

  return <div className="lifelink-page min-h-screen flex items-center justify-center px-4 py-10">
    <div className="auth-surface p-6 sm:p-9">
      <Link href="/" className="brand-mark"><span className="brand-mark-icon">+</span><span className="brand-mark-word">LIFE LINK</span></Link>
      <div className="mt-10"><h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create your account</h1><p className="mt-2 text-xs text-slate-500">Sign up securely — no password required.</p></div>
      <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-2.5 flex items-center justify-between text-xs"><span className="text-slate-600">Selected role: <strong className="text-slate-900">{roleName}</strong></span><Link href="/choose-role" className="font-semibold text-blue-600">Change</Link></div>
      {error && <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex gap-2"><AlertCircle className="w-4 h-4 shrink-0"/>{error}</div>}
      <form onSubmit={submit} className="mt-6 space-y-5">
        <div><label htmlFor="signup-email" className="block text-[11px] font-semibold text-slate-700">Mobile number / email</label><input id="signup-email" type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="Enter your details" autoComplete="email" autoFocus className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"/></div>
        <button disabled={loading} className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">{loading?'Sending OTP...':'Send OTP'}{!loading&&<ArrowRight className="w-4 h-4"/>}</button>
      </form>
      <p className="mt-5 text-[10px] leading-4 text-slate-400 text-center">By continuing, you agree to the LIFE-LINK Terms & Privacy Policy.</p>
      <div className="mt-6 text-center text-xs text-slate-500">Already have an account? <Link href="/login" className="font-semibold text-blue-600">Log in</Link></div>
      <Link href="/choose-role" className="mt-6 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"><ChevronLeft className="w-3.5 h-3.5"/> Back to role selection</Link>
    </div>
  </div>;
}

export default function SignupPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"/></div>}><SignupContent/></Suspense>;
}
