import React from 'react';
import Link from 'next/link';
import { UserCheck, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';

export default function UnprovisionedPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-slate-800 bg-slate-900/90 text-center">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 mb-2">
            <UserCheck className="w-6 h-6" />
          </div>
          <CardTitle className="justify-center text-white">Pending Provisioning</CardTitle>
          <CardDescription>
            Your email has been authenticated, but no medical organization has provisioned your role yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400">
            LIFE-LINK requires an organizational link (Hospital Trauma Coordinator, Regional Blood Bank
            Officer, or Verified Volunteer Donor) before access to sensitive medical data is granted.
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
