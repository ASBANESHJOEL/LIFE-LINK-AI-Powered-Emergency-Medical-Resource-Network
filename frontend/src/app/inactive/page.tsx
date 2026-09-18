'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { UserX, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { useAuth } from '../../lib/supabase/auth-context';

export default function InactiveAccountPage() {
  const router = useRouter();
  const { signOut, authError } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="lifelink-page min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-amber-200 bg-white text-center shadow-sm">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 border border-amber-200 flex items-center justify-center text-amber-600 mb-2">
            <UserX className="w-6 h-6" />
          </div>
          <CardTitle className="justify-center text-slate-900 font-bold">Account Deactivated</CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            {authError || 'Your account credentials exist, but access is currently deactivated by network policy.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            For medical compliance and safety, accounts not audited within the active window are automatically
            placed on standby. Please contact regional emergency network compliance to reactivate access.
          </p>
          <Button variant="outline" onClick={handleSignOut} className="w-full text-slate-700 border-slate-200 hover:bg-slate-50">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Sign in with another account
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
