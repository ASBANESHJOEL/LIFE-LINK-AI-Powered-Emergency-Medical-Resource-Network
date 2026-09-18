'use client';

import React from 'react';
import { User, ShieldCheck, Building2, Key, LogOut } from 'lucide-react';
import { useAuth } from '../../../lib/supabase/auth-context';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { StatusBadge } from '../../../components/shared/StatusBadge';

export default function ProfilePage() {
  const { user, organization, signOut } = useAuth();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-black text-white tracking-tight flex items-center gap-2">
          <User className="w-6 h-6 text-sky-400" />
          Operator Profile & Security Clearance
        </h1>
        <p className="text-xs text-slate-400 mt-1">
          Cryptographically verified identity, organizational affiliations, and institutional roles
        </p>
      </div>

      <Card className="border-slate-800 bg-slate-900/90 shadow-xl">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base text-white">{user?.email}</CardTitle>
              <CardDescription className="text-xs">
                User ID: <span className="font-mono text-slate-300">{user?.id}</span>
              </CardDescription>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-950/80 border border-emerald-800/80 text-emerald-300 text-xs font-semibold">
              <ShieldCheck className="w-3.5 h-3.5" />
              {user?.is_active ? 'ACTIVE ACCOUNT' : 'INACTIVE'}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6 text-xs pt-2">
          {/* Institutional Affiliation */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-3">
            <h4 className="font-semibold text-slate-300 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Building2 className="w-3.5 h-3.5 text-sky-400" />
              Organizational Clearance
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <span className="text-slate-400 block text-[11px]">Primary Role:</span>
                <span className="font-bold text-white text-sm">
                  {user?.role?.replace(/_/g, ' ') || 'Unassigned'}
                </span>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px]">Organization:</span>
                <span className="font-bold text-sky-400 text-sm">
                  {organization?.hospital?.name || organization?.bloodBank?.name || 'Network Volunteer Pool'}
                </span>
              </div>
              {organization?.membershipRole && (
                <div>
                  <span className="text-slate-400 block text-[11px]">Membership Role:</span>
                  <span className="text-slate-200 font-medium">{organization.membershipRole}</span>
                </div>
              )}
            </div>
          </div>

          {/* Security Features */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <h4 className="font-semibold text-slate-300 uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              Security Protocol
            </h4>
            <p className="text-slate-400 leading-relaxed">
              Authentication is governed by Supabase Auth with an 8-digit cryptographic email OTP policy. All backend calls are validated through signed JWT bearer tokens with Row-Level Security checks.
            </p>
          </div>
        </CardContent>

        <CardFooter className="flex justify-between items-center bg-slate-950/40 border-t border-slate-800/60 p-4">
          <span className="text-[11px] text-slate-500">
            Compliant with Medical Emergency Resource Governance
          </span>
          <Button variant="outline" size="sm" onClick={signOut} className="text-xs text-red-400 hover:text-red-300 gap-1.5">
            <LogOut className="w-3.5 h-3.5" />
            End Session
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
