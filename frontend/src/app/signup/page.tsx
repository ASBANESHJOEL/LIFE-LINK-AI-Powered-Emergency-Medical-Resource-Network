'use client';

import React, { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, ChevronLeft, AlertCircle, LogIn, UserCheck } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { normalizeEmail, savePendingEmail, saveAuthIntent } from '../../lib/supabase/pending-email';
import { api } from '../../lib/api/client';

function SignupContent() {
  const router = useRouter();
  const params = useSearchParams();
  const role = params.get('role') || 'DONOR';
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Track existing account detection state
  const [existingAccount, setExistingAccount] = useState<{
    exists: boolean;
    email: string;
    existingRole?: string;
  } | null>(null);

  const formatRoleName = (r?: string) => {
    if (!r) return 'Network Member';
    if (r === 'BLOOD_BANK') return 'Blood Bank';
    if (r === 'ADMIN') return 'Administrator';
    if (r === 'REGULATOR') return 'Regulator';
    return r.charAt(0) + r.slice(1).toLowerCase();
  };

  const roleName = formatRoleName(role);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Please enter a valid email address.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // 1. Pre-check if account already exists in LIFE-LINK
      const check = await api.auth.checkSignup(clean);

      if (check.exists) {
        setLoading(false);
        setExistingAccount({
          exists: true,
          email: clean,
          existingRole: check.role,
        });
        return;
      }

      // 2. Account does not exist: proceed with genuine new user OTP flow
      const result = await signInWithOtp(clean, { shouldCreateUser: true });
      setLoading(false);

      if (result.success) {
        savePendingEmail(clean);
        saveAuthIntent('signup', role);
        router.push('/verify-otp?email=' + encodeURIComponent(clean));
      } else {
        setError(result.error || 'Unable to send the verification code.');
      }
    } catch (err) {
      setLoading(false);
      console.error('[SIGNUP] Error checking account:', err);
      setError('Unable to verify account status. Please try again.');
    }
  };

  // State: Existing user account detected
  if (existingAccount) {
    const isSameRole = existingAccount.existingRole === role;
    const existingRoleFormatted = formatRoleName(existingAccount.existingRole);

    return (
      <div className="lifelink-page min-h-screen flex items-center justify-center px-4 py-10">
        <div className="auth-surface p-6 sm:p-9">
          <Link href="/" className="brand-mark">
            <span className="brand-mark-icon">+</span>
            <span className="brand-mark-word">LIFE LINK</span>
          </Link>

          <div className="mt-8 text-center sm:text-left">
            <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600 mb-3">
              <UserCheck className="w-5 h-5" />
            </div>
            <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">
              An account already exists with this email.
            </h1>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {isSameRole
                ? `You're already registered as a ${existingRoleFormatted}. Please sign in instead.`
                : 'An account already exists with this email. Please sign in instead.'}
            </p>
          </div>

          <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-3.5 text-xs text-slate-700">
            <span className="text-slate-500">Registered account: </span>
            <strong className="text-slate-900">{existingAccount.email}</strong>
            <div className="mt-1 text-[11px] text-slate-500">
              Role: <span className="font-semibold text-slate-800">{existingRoleFormatted}</span>
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <Link
              href={`/login?email=${encodeURIComponent(existingAccount.email)}`}
              className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors"
            >
              <LogIn className="w-4 h-4" />
              Sign in to continue
            </Link>

            <button
              type="button"
              onClick={() => {
                setExistingAccount(null);
                setEmail('');
                setError('');
              }}
              className="h-10 w-full rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center transition-colors"
            >
              Use a different email
            </button>
          </div>

          <div className="mt-7 pt-4 border-t border-slate-100 flex items-center justify-between text-[11px]">
            <Link
              href="/choose-role"
              className="inline-flex items-center gap-1 text-slate-400 hover:text-slate-700"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Back to role selection
            </Link>
            <Link href="/" className="text-slate-400 hover:text-slate-700">
              Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // State: New User Signup Form
  return (
    <div className="lifelink-page min-h-screen flex items-center justify-center px-4 py-10">
      <div className="auth-surface p-6 sm:p-9">
        <Link href="/" className="brand-mark">
          <span className="brand-mark-icon">+</span>
          <span className="brand-mark-word">LIFE LINK</span>
        </Link>
        <div className="mt-10">
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900">Create your account</h1>
          <p className="mt-2 text-xs text-slate-500">Sign up securely — no password required.</p>
        </div>
        <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 px-3.5 py-2.5 flex items-center justify-between text-xs">
          <span className="text-slate-600">
            Selected role: <strong className="text-slate-900">{roleName}</strong>
          </span>
          <Link href="/choose-role" className="font-semibold text-blue-600">
            Change
          </Link>
        </div>
        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}
        <form onSubmit={submit} className="mt-6 space-y-5">
          <div>
            <label htmlFor="signup-email" className="block text-[11px] font-semibold text-slate-700">
              Email address
            </label>
            <input
              id="signup-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              placeholder="name@example.com"
              autoComplete="email"
              autoFocus
              disabled={loading}
              className="mt-2 h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 disabled:bg-slate-50"
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="h-11 w-full rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-60 transition-colors"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Checking...
              </span>
            ) : (
              <>
                Send OTP <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </form>
        <p className="mt-5 text-[10px] leading-4 text-slate-400 text-center">
          By continuing, you agree to the LIFE-LINK Terms & Privacy Policy.
        </p>
        <div className="mt-6 text-center text-xs text-slate-500">
          Already have an account?{' '}
          <Link href="/login" className="font-semibold text-blue-600 hover:text-blue-700">
            Log in
          </Link>
        </div>
        <Link
          href="/choose-role"
          className="mt-6 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-700"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to role selection
        </Link>
      </div>
    </div>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-slate-50 flex items-center justify-center">
          <div className="h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <SignupContent />
    </Suspense>
  );
}
