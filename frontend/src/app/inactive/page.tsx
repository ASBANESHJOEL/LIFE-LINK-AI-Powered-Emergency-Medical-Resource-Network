import React from 'react';
import Link from 'next/link';
import { UserX, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';

export default function InactiveAccountPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-amber-900/60 bg-slate-900/90 text-center">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-amber-950/80 border border-amber-800 flex items-center justify-center text-amber-400 mb-2">
            <UserX className="w-6 h-6" />
          </div>
          <CardTitle className="justify-center text-amber-300">Account Deactivated</CardTitle>
          <CardDescription>
            Your account credentials exist, but access is currently marked inactive by network policy.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400">
            For medical safety, credentials not audited within the annual review window are automatically
            placed on standby. Contact regional emergency compliance to reactivate your credentials.
          </p>
          <Link href="/login">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Sign in with another account
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
