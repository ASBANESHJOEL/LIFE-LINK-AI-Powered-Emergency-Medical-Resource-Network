'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, ChevronLeft, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';

function VerifyOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyOtp, signInWithOtp, user, isAuthenticated } = useAuth();
  const email = searchParams.get('email') || '';
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !user) return;
    if (!user.is_active) { router.push('/inactive'); return; }
    switch (user.role) {
      case 'HOSPITAL': router.push('/hospital/dashboard'); break;
      case 'BLOOD_BANK': router.push('/blood-bank/dashboard'); break;
      case 'DONOR': router.push('/donor/dashboard'); break;
      case 'ADMIN':
      case 'REGULATOR': router.push('/regulator/dashboard'); break;
      default: router.push('/'); 
    }
  }, [isAuthenticated, user, router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^\d{6,8}$/.test(otpCode.trim())) {
      setErrorMessage('Enter the complete verification code.');
      return;
    }
    setIsLoading(true);
    setErrorMessage(null);
    const result = await verifyOtp(email, otpCode);
    setIsLoading(false);
    if (!result.success) setErrorMessage(result.error || 'The verification code is invalid or expired.');
  };

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    setErrorMessage(null);
    const result = await signInWithOtp(email);
    setResendLoading(false);
    if (result.success) {
      setResent(true);
      setTimeout(() => setResent(false), 5000);
    } else setErrorMessage(result.error || 'Unable to resend the code.');
  };

  return (
    <div className="lifelink-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9">
        <Link href="/" className="brand-mark">
          <span className="brand-mark-icon"><span className="text-base">+</span></span>
          <span className="brand-mark-word">LIFE LINK</span>
        </Link>

        <div className="mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Verify your email</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">Enter the OTP sent to {email || 'your email'}.</p>
        </div>

        {errorMessage && (
          <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {resent && <p className="mt-4 rounded-lg bg-green-50 border border-green-100 p-3 text-xs text-green-700">A new code has been sent.</p>}

        <form onSubmit={handleVerify} className="mt-7 space-y-5">
          <div>
            <label htmlFor="otp" className="block text-[11px] font-semibold text-slate-700">One-time passcode</label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={otpCode}
              onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="12345678"
              autoFocus
              disabled={isLoading}
              className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-center text-lg font-semibold tracking-[0.35em] text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10"
            />
            <p className="mt-2 text-[10px] text-slate-400">Use the complete 6–8 digit code from your email.</p>
          </div>

          <button type="submit" disabled={isLoading} className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60">
            {isLoading ? 'Verifying...' : 'Verify & Continue'}
            {!isLoading && <ArrowRight className="w-4 h-4" />}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-[11px]">
          <Link href="/login" className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700"><ChevronLeft className="w-3.5 h-3.5" /> Change email</Link>
          <button type="button" onClick={handleResend} disabled={resendLoading || !email} className="font-semibold text-blue-600 hover:text-blue-700 disabled:opacity-50">
            {resendLoading ? 'Sending...' : 'Resend code'}
          </button>
        </div>

        <div className="mt-7 flex items-center gap-2 text-[10px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          Your session is protected by signed authentication tokens.
        </div>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return <Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center"><div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>}><VerifyOtpContent /></Suspense>;
}
