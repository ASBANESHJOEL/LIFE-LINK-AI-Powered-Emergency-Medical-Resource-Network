'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, AlertCircle, ChevronLeft } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { normalizeEmail, savePendingEmail, saveAuthIntent } from '../../lib/supabase/pending-email';

export default function LoginPage() {
  const router = useRouter();
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    const result = await signInWithOtp(cleanEmail, { shouldCreateUser: false });
    setIsLoading(false);
    if (result.success) {
      savePendingEmail(cleanEmail);
      saveAuthIntent('login');
      router.push('/verify-otp?email=' + encodeURIComponent(cleanEmail));
    } else {
      setErrorMessage(result.error || 'Unable to send the verification code.');
    }
  };

  return (
    <div className="lifelink-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9">
        <Link href="/" className="brand-mark">
          <span className="brand-mark-icon"><span className="text-base">+</span></span>
          <span className="brand-mark-word">LIFE LINK</span>
        </Link>

        <div className="mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Log in</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">Access your account without a password.</p>
        </div>

        {errorMessage && (
          <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <div>
            <label htmlFor="email" className="block text-[11px] font-semibold text-slate-700">Enter valid email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={e => { setEmail(e.target.value); setErrorMessage(null); }}
              placeholder="name@example.com"
              autoComplete="email"
              autoFocus
              disabled={isLoading}
              className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            />
          </div>

          <button type="submit" disabled={isLoading} className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {isLoading ? 'Sending OTP...' : 'Send OTP'}
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <div className="mt-6 flex items-center gap-2 text-[10px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          Passwordless verification via secure email OTP
        </div>

        <div className="mt-7 text-center text-xs text-slate-500">
          New to LIFE LINK? <Link href="/choose-role" className="font-semibold text-blue-600 hover:text-blue-700">Create an account</Link>
        </div>

        <Link href="/" className="mt-7 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700">
          <ChevronLeft className="w-3.5 h-3.5" /> Back to home
        </Link>
      </div>
    </div>
  );
}
