'use client';

import React from 'react';
import { useRouter } from 'next/navigation';
import { UserCheck, ArrowLeft, LogOut } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';
import { useAuth } from '../../lib/supabase/auth-context';

export default function UnprovisionedPage() {
  const router = useRouter();
  const { signOut, authError } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="lifelink-page min-h-screen flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-slate-200 bg-white text-center shadow-sm">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mb-2">
            <UserCheck className="w-6 h-6" />
          </div>
          <CardTitle className="justify-center text-slate-900 font-bold">Pending Provisioning</CardTitle>
          <CardDescription className="text-slate-500 text-xs">
            {authError || 'Your email has been authenticated, but your account has not been provisioned in the LIFE-LINK medical registry.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-500 leading-relaxed">
            LIFE-LINK requires an organizational link (Hospital Trauma Coordinator, Regional Blood Bank
            Officer, or Verified Volunteer Donor) before access to sensitive medical resources is granted.
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
