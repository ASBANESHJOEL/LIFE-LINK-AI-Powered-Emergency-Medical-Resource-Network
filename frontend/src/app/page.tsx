'use client';

import React from 'react';
import Link from 'next/link';
import {
  Activity,
  ShieldCheck,
  Truck,
  Database,
  Building2,
  ArrowRight,
  Sparkles,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { useAuth } from '../lib/supabase/auth-context';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';

export default function LandingPage() {
  const { user, isAuthenticated } = useAuth();

  const getDashboardLink = () => {
    if (!user) return '/login';
    switch (user.role) {
      case 'HOSPITAL_COORDINATOR':
        return '/hospital/dashboard';
      case 'BLOOD_BANK_OFFICER':
        return '/blood-bank/dashboard';
      case 'DONOR':
        return '/donor/dashboard';
      default:
        return '/hospital/dashboard';
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-[calc(100vh-4rem)] py-12 px-4">
      {/* Platform Banner */}
      <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-red-950/60 border border-red-800/60 text-red-300 text-xs font-semibold mb-6 animate-pulse">
        <span className="h-2 w-2 rounded-full bg-red-500"></span>
        CRITICAL EMERGENCY RESOURCE SYSTEM ACTIVE
      </div>

      {/* Main Hero Header */}
      <h1 className="text-4xl sm:text-6xl font-black text-center tracking-tight text-white max-w-4xl leading-tight">
        Zero-Latency Emergency <br />
        <span className="text-transparent bg-clip-text bg-gradient-to-r from-red-500 via-rose-400 to-sky-400">
          Blood Resource Orchestration
        </span>
      </h1>

      <p className="mt-6 text-base sm:text-lg text-slate-400 text-center max-w-2xl leading-relaxed">
        LIFE-LINK automates trauma blood sourcing through a strict three-tier resolution
        pipeline: immediate local inventory reservations, regional peer-bank transfers, and
        predictive ML-ranked donor dispatches.
      </p>

      {/* Action Buttons */}
      <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
        {isAuthenticated ? (
          <Link href={getDashboardLink()}>
            <Button size="lg" variant="default" className="gap-2 px-8 text-base">
              Enter Operations Console
              <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        ) : (
          <Link href="/login">
            <Button size="lg" variant="default" className="gap-2 px-8 text-base">
              <Lock className="w-4 h-4" />
              Sign In with Medical OTP
            </Button>
          </Link>
        )}
        <a
          href="#architecture"
          className="text-sm font-semibold text-slate-400 hover:text-white px-4 py-2 transition-colors"
        >
          Explore Resolution Pipeline ↓
        </a>
      </div>

      {/* 3-Tier Pipeline Section */}
      <div id="architecture" className="mt-20 w-full max-w-5xl">
        <div className="text-center mb-10">
          <p className="text-xs font-bold uppercase tracking-widest text-sky-400 mb-2">
            Architectural Hierarchy
          </p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">
            Automated Sourcing Pipeline
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Every emergency request progresses deterministically through 3 resolution layers
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Tier 1 */}
          <Card className="border-slate-800 bg-slate-900/60 hover:border-sky-500/50 transition-all">
            <CardContent className="p-6">
              <div className="h-10 w-10 rounded-lg bg-sky-950/80 border border-sky-800/60 flex items-center justify-center text-sky-400 mb-4">
                <Database className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-sky-400 bg-sky-950/60 px-2 py-0.5 rounded border border-sky-800/40">
                Tier 1 • Instant
              </span>
              <h3 className="text-lg font-bold text-white mt-3">Local Inventory Reservation</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Directly queries the hospital and affiliated facility inventory. Available units are
                immediately reserved and flagged to prevent double-allocation during surgery.
              </p>
            </CardContent>
          </Card>

          {/* Tier 2 */}
          <Card className="border-slate-800 bg-slate-900/60 hover:border-amber-500/50 transition-all">
            <CardContent className="p-6">
              <div className="h-10 w-10 rounded-lg bg-amber-950/80 border border-amber-800/60 flex items-center justify-center text-amber-400 mb-4">
                <Building2 className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800/40">
                Tier 2 • Network
              </span>
              <h3 className="text-lg font-bold text-white mt-3">Peer Blood Bank Transfer</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Surrounding regional blood banks are scanned based on geodesic proximity. Transfer
                offers are computed and accepted with 1-click coordinator verification.
              </p>
            </CardContent>
          </Card>

          {/* Tier 3 */}
          <Card className="border-slate-800 bg-slate-900/60 hover:border-red-500/50 transition-all">
            <CardContent className="p-6">
              <div className="h-10 w-10 rounded-lg bg-red-950/80 border border-red-800/60 flex items-center justify-center text-red-400 mb-4">
                <Sparkles className="w-5 h-5" />
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-red-400 bg-red-950/60 px-2 py-0.5 rounded border border-red-800/40">
                Tier 3 • Predictive ML
              </span>
              <h3 className="text-lg font-bold text-white mt-3">ML Donor Dispatch</h3>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                Eligible verified volunteer donors are evaluated by the frozen Logistic Regression V1
                model. Ranked batches are notified in real-time with OSRM transit tracking.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Trust & Compliance Strip */}
      <div className="mt-16 pt-8 border-t border-slate-800/80 flex flex-wrap justify-center items-center gap-8 text-xs text-slate-500">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Role-Enforced Row-Level Security</span>
        </div>
        <div className="flex items-center gap-2">
          <Lock className="w-4 h-4 text-sky-400" />
          <span>Supabase 8-Digit Cryptographic OTP</span>
        </div>
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-red-400" />
          <span>Logistic Regression V1 ML Scoring</span>
        </div>
        <div className="flex items-center gap-2">
          <Truck className="w-4 h-4 text-amber-400" />
          <span>OSRM Live Transit Routing</span>
        </div>
      </div>
    </div>
  );
}
