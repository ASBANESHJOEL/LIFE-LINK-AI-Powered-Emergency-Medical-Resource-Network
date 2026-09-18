import React from 'react';
import Link from 'next/link';
import { ShieldAlert, ArrowLeft } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../../components/ui/card';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center p-4">
      <Card className="max-w-md w-full border-red-900/60 bg-slate-900/90 text-center">
        <CardHeader>
          <div className="mx-auto h-12 w-12 rounded-full bg-red-950/80 border border-red-800 flex items-center justify-center text-red-400 mb-2">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <CardTitle className="justify-center text-red-300">Access Restricted</CardTitle>
          <CardDescription>
            You do not have the verified institutional role required to access this resource.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-slate-400">
            Resource authorization on LIFE-LINK is enforced through cryptographic row-level security.
            If you require elevated trauma privileges, request clearance through your hospital coordinator.
          </p>
          <Link href="/">
            <Button variant="outline" className="w-full">
              <ArrowLeft className="w-4 h-4 mr-2" />
              Return to Platform Overview
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
