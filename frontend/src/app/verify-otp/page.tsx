'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, ShieldCheck, ChevronLeft, AlertCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { normalizeEmail, getPendingEmail, savePendingEmail } from '../../lib/supabase/pending-email';

function VerifyOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyOtp, signInWithOtp, user, isAuthenticated, profileStatus, isLoading: isAuthLoading } = useAuth();

  const urlEmail = searchParams.get('email') || '';
  const [email, setEmail] = useState<string>('');
  const [otpCode, setOtpCode] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resentMessage, setResentMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState<number>(0);

  // Recover email from URL or client session storage
  useEffect(() => {
    const cleanUrlEmail = normalizeEmail(urlEmail);
    const storedEmail = getPendingEmail();
    const effectiveEmail = cleanUrlEmail || storedEmail;

    if (effectiveEmail) {
      setEmail(effectiveEmail);
      savePendingEmail(effectiveEmail);
    }
  }, [urlEmail]);

  // Cooldown countdown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 1 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  // Route authenticated or unprovisioned users
  useEffect(() => {
    if (isAuthLoading) return;

    if (profileStatus === 'UNPROVISIONED') {
      router.push('/unprovisioned');
      return;
    }

    if (profileStatus === 'INACTIVE' || (user && !user.is_active)) {
      router.push('/inactive');
      return;
    }

    if (isAuthenticated && user && profileStatus === 'ACTIVE') {
      switch (user.role) {
        case 'HOSPITAL':
          router.push('/hospital/dashboard');
          break;
        case 'BLOOD_BANK':
          router.push('/blood-bank/dashboard');
          break;
        case 'DONOR':
          router.push('/donor/dashboard');
          break;
        case 'ADMIN':
        case 'REGULATOR':
          router.push('/regulator/dashboard');
          break;
        default:
          router.push('/');
      }
    }
  }, [isAuthenticated, user, profileStatus, isAuthLoading, router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isVerifying) return;

    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) {
      setErrorMessage(
        'No verification email found. Please return to login or registration to receive a verification code.'
      );
      return;
    }

    const cleanToken = otpCode.trim();
    if (!/^\d{6,8}$/.test(cleanToken)) {
      setErrorMessage('Please enter the complete 6 to 8-digit verification code.');
      return;
    }

    setIsVerifying(true);
    setErrorMessage(null);
    setResentMessage(null);

    const result = await verifyOtp(cleanEmail, cleanToken);
    setIsVerifying(false);

    if (!result.success) {
      setErrorMessage(result.error || 'The verification code is invalid or has expired.');
    } else if (result.profileStatus === 'UNPROVISIONED') {
      router.push('/unprovisioned');
    } else if (result.profileStatus === 'INACTIVE') {
      router.push('/inactive');
    }
  };

  const handleResend = async () => {
    if (resendLoading || cooldown > 0) return;

    const cleanEmail = normalizeEmail(email);
    if (!cleanEmail) {
      setErrorMessage('Please return to login to enter your email and request a code.');
      return;
    }

    setResendLoading(true);
    setErrorMessage(null);
    setResentMessage(null);

    const result = await signInWithOtp(cleanEmail);
    setResendLoading(false);

    if (result.success) {
      setOtpCode(''); // Clear stale code input so user does not re-submit invalidated OTP
      setCooldown(60); // 60 second cooldown
      setResentMessage(
        'A new verification code has been dispatched. Note: requesting a new code invalidates any previously sent codes.'
      );
    } else {
      setErrorMessage(result.error || 'Unable to resend verification code. Please try again later.');
    }
  };

  const hasNoEmail = !email;

  return (
    <div className="lifelink-page flex min-h-screen items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9">
        <Link href="/" className="brand-mark">
          <span className="brand-mark-icon">
            <span className="text-base">+</span>
          </span>
          <span className="brand-mark-word">LIFE LINK</span>
        </Link>

        <div className="mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Verify your email</h1>
          <p className="mt-2 text-xs leading-5 text-slate-500">
            {email ? (
              <>
                Enter the one-time passcode sent to <strong className="text-slate-800">{email}</strong>.
              </>
            ) : (
              'Enter the one-time passcode sent to your registered email address.'
            )}
          </p>
        </div>

        {hasNoEmail && (
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <div>
              <p className="font-semibold">Verification session not found</p>
              <p className="mt-1">
                We could not find a pending verification email. Please return to login or create an account to receive an OTP.
              </p>
              <Link
                href="/login"
                className="mt-2 inline-flex items-center gap-1 font-semibold text-blue-600 hover:text-blue-700"
              >
                Go to Login <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="mt-5 flex gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{errorMessage}</span>
          </div>
        )}

        {resentMessage && (
          <div className="mt-4 rounded-lg bg-green-50 border border-green-200 p-3 text-xs text-green-800 flex gap-2">
            <RefreshCw className="w-4 h-4 shrink-0 mt-0.5 text-green-600" />
            <span>{resentMessage}</span>
          </div>
        )}

        <form onSubmit={handleVerify} className="mt-7 space-y-5">
          <div>
            <label htmlFor="otp" className="block text-[11px] font-semibold text-slate-700">
              One-time passcode
            </label>
            <input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={otpCode}
              onChange={(e) => {
                setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 8));
                setErrorMessage(null);
              }}
              placeholder="12345678"
              autoFocus
              disabled={isVerifying || hasNoEmail}
              className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-3 text-center text-lg font-semibold tracking-[0.35em] text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50 disabled:text-slate-400"
            />
            <p className="mt-2 text-[10px] text-slate-400">
              Enter the 6 to 8-digit numerical passcode from your email.
            </p>
          </div>

          <button
            type="submit"
            disabled={isVerifying || hasNoEmail || otpCode.length < 6}
            className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isVerifying ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Verifying...
              </span>
            ) : (
              <>
                Verify & Continue <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>

        <div className="mt-6 flex items-center justify-between text-[11px]">
          <Link
            href="/login"
            className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Change email
          </Link>
          <button
            type="button"
            onClick={handleResend}
            disabled={resendLoading || cooldown > 0 || hasNoEmail}
            className="font-semibold text-blue-600 hover:text-blue-700 disabled:text-slate-400 disabled:cursor-not-allowed transition-colors"
          >
            {resendLoading
              ? 'Sending...'
              : cooldown > 0
              ? `Resend code (${cooldown}s)`
              : 'Resend code'}
          </button>
        </div>

        <div className="mt-7 flex items-center gap-2 text-[10px] text-slate-400">
          <ShieldCheck className="w-3.5 h-3.5 text-green-600" />
          Single-use cryptographic verification with automatic expiry.
        </div>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <VerifyOtpContent />
    </Suspense>
  );
}
