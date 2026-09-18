'use client';

import React, { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, KeyRound, ArrowRight, AlertCircle, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';

function VerifyOtpContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { verifyOtp, signInWithOtp, user, isAuthenticated } = useAuth();

  const emailParam = searchParams.get('email') || '';
  const [email, setEmail] = useState(emailParam);
  const [otpCode, setOtpCode] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // If user is already authenticated with a role, redirect to appropriate console
  useEffect(() => {
    if (isAuthenticated && user) {
      if (!user.is_active) {
        router.push('/inactive');
        return;
      }
      switch (user.role) {
        case 'HOSPITAL_COORDINATOR':
          router.push('/hospital/dashboard');
          break;
        case 'BLOOD_BANK_OFFICER':
          router.push('/blood-bank/dashboard');
          break;
        case 'DONOR':
          router.push('/donor/dashboard');
          break;
        case 'REGULATOR':
        case 'SUPER_ADMIN':
          router.push('/regulator/dashboard');
          break;
        default:
          router.push('/hospital/dashboard');
      }
    }
  }, [isAuthenticated, user, router]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otpCode || otpCode.trim().length < 6) {
      setErrorMessage('Please enter the complete verification code.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await verifyOtp(email, otpCode);
    setIsLoading(false);

    if (!result.success) {
      setErrorMessage(result.error || 'Verification code expired or invalid.');
    }
  };

  const handleResend = async () => {
    if (!email) return;
    setResendLoading(true);
    setErrorMessage(null);
    const result = await signInWithOtp(email);
    setResendLoading(false);
    if (result.success) {
      setResendSuccess(true);
      setTimeout(() => setResendSuccess(false), 5000);
    } else {
      setErrorMessage(result.error || 'Failed to resend code.');
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-[#090d16]">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl bg-gradient-to-br from-red-600 to-red-800 items-center justify-center text-white font-black text-2xl shadow-xl shadow-red-950/60 mb-3">
            +
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">Enter Verification Code</h2>
          <p className="text-xs text-slate-400 mt-1">
            Sent to <span className="text-white font-medium">{email || 'your registered email'}</span>
          </p>
        </div>

        <Card className="border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center justify-between">
              <span>Security Token Confirmation</span>
              <KeyRound className="w-4 h-4 text-sky-400" />
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Enter the 6-to-8 digit one-time passcode dispatched by the network.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertTitle>Verification Error</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            {resendSuccess && (
              <Alert variant="success">
                <ShieldCheck className="w-4 h-4" />
                <AlertTitle>Code Dispatched</AlertTitle>
                <AlertDescription>A new one-time passcode has been sent.</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleVerify} className="space-y-4">
              {!emailParam && (
                <Input
                  label="Confirm Email Address"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              )}

              <Input
                label="Passcode (OTP)"
                type="text"
                placeholder="12345678"
                maxLength={8}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                required
                autoFocus
                className="font-mono text-center text-xl tracking-widest font-bold h-12"
                disabled={isLoading}
              />

              <Button
                type="submit"
                variant="default"
                className="w-full h-11 text-sm font-semibold"
                isLoading={isLoading}
              >
                Authenticate & Enter Console
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>

            <div className="flex items-center justify-between pt-2">
              <Link
                href="/login"
                className="inline-flex items-center text-xs text-slate-400 hover:text-white transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5 mr-1" />
                Change email
              </Link>

              <button
                type="button"
                onClick={handleResend}
                disabled={resendLoading || !email}
                className="text-xs text-sky-400 hover:text-sky-300 font-medium disabled:opacity-50"
              >
                {resendLoading ? 'Sending...' : 'Resend code'}
              </button>
            </div>
          </CardContent>

          <CardFooter className="flex flex-col space-y-2 pt-2 text-center text-xs text-slate-500">
            <p className="text-[11px] text-slate-500">
              Codes expire automatically after 10 minutes for medical audit compliance.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function VerifyOtpPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#090d16] flex items-center justify-center">
          <div className="h-8 w-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      }
    >
      <VerifyOtpContent />
    </Suspense>
  );
}
