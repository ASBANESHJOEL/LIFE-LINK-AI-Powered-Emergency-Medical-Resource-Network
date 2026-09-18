'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, Mail, ArrowRight, Lock, AlertCircle } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../components/ui/card';
import { Alert, AlertTitle, AlertDescription } from '../../components/ui/alert';

export default function LoginPage() {
  const router = useRouter();
  const { signInWithOtp } = useAuth();
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setErrorMessage('Please provide a valid registered medical or volunteer email address.');
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    const result = await signInWithOtp(email);
    setIsLoading(false);

    if (result.success) {
      router.push(`/verify-otp?email=${encodeURIComponent(email)}`);
    } else {
      setErrorMessage(
        result.error || 'Failed to dispatch verification code. Please confirm account provisioning.'
      );
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center p-4 bg-[#090d16]">
      <div className="w-full max-w-md">
        {/* Header Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex h-12 w-12 rounded-xl bg-gradient-to-br from-red-600 to-red-800 items-center justify-center text-white font-black text-2xl shadow-xl shadow-red-950/60 mb-3">
            +
          </div>
          <h2 className="text-2xl font-black text-white tracking-tight">LIFE-LINK Operations</h2>
          <p className="text-xs text-slate-400 mt-1">
            Authorized Medical Resource Network Access
          </p>
        </div>

        <Card className="border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-xl">
          <CardHeader>
            <CardTitle className="text-base text-white flex items-center justify-between">
              <span>Medical Personnel Sign In</span>
              <Lock className="w-4 h-4 text-sky-400" />
            </CardTitle>
            <CardDescription className="text-xs text-slate-400">
              Enter your provisioned email to receive a secure one-time verification code.
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-4 pt-2">
            {errorMessage && (
              <Alert variant="destructive">
                <AlertCircle className="w-4 h-4" />
                <AlertTitle>Authentication Failed</AlertTitle>
                <AlertDescription>{errorMessage}</AlertDescription>
              </Alert>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <Input
                label="Registered Institutional / Volunteer Email"
                type="email"
                placeholder="coordinator@hospital.org"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
                disabled={isLoading}
              />

              <Button
                type="submit"
                variant="default"
                className="w-full h-11 text-sm font-semibold"
                isLoading={isLoading}
              >
                Send One-Time Passcode
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          </CardContent>

          <CardFooter className="flex flex-col space-y-3 pt-2 text-center text-xs text-slate-500">
            <div className="flex items-center justify-center gap-1.5 text-slate-400">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Cryptographically signed 8-digit OTP via Supabase</span>
            </div>
            <p className="text-[11px] text-slate-500">
              Unprovisioned personnel should contact their facility emergency administrator.
            </p>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
