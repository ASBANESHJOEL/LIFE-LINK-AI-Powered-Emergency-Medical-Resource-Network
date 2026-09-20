'use client';

import Link from 'next/link';
import { ArrowRight, Heart, Building2, Database, ShieldCheck, Menu, HelpCircle, Mail } from 'lucide-react';
import { useAuth } from '../lib/supabase/auth-context';
import { BrandLogo } from '../components/shared/BrandLogo';

export default function LandingPage() {
  const { user, isAuthenticated } = useAuth();

  const dashboard = user?.role === 'HOSPITAL'
    ? '/hospital/dashboard'
    : user?.role === 'BLOOD_BANK'
      ? '/blood-bank/dashboard'
      : user?.role === 'DONOR'
        ? '/donor/dashboard'
        : user?.role === 'ADMIN' || user?.role === 'REGULATOR'
          ? '/regulator/dashboard'
          : '/login';

  return (
    <div className="lifelink-page">
      <header className="public-header">
        <div className="lifelink-container h-16 flex items-center justify-between">
          <BrandLogo href="/" />
          <nav className="hidden sm:flex items-center gap-7">
            <Link className="public-nav-link active" href="/">Home</Link>
            <Link className="public-nav-link" href="/about">About</Link>
            <Link className="public-nav-link" href="/faq">FAQ</Link>
            <Link className="public-nav-link" href="/contact">Contact</Link>
          </nav>
          <div className="flex items-center gap-2">
            <Link href={isAuthenticated ? dashboard : '/login'} className="hidden sm:inline-flex h-9 px-4 rounded-lg bg-blue-600 text-white text-xs font-semibold items-center justify-center hover:bg-blue-700">
              {isAuthenticated ? 'Dashboard' : 'Log in'}
            </Link>
            <Link href="/choose-role" className="inline-flex h-9 px-4 rounded-lg border border-slate-200 bg-white text-slate-700 text-xs font-semibold items-center justify-center hover:bg-slate-50">
              Get started
            </Link>
          </div>
        </div>
      </header>

      <main>
        <section className="lifelink-container grid lg:grid-cols-2 gap-12 items-center py-16 sm:py-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 border border-blue-100 px-3 py-1.5 text-[11px] font-semibold text-blue-700">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />
              Emergency medical resource network
            </div>
            <h1 className="mt-5 text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.08] text-slate-900">
              Connect. Donate.<br />
              <span className="text-blue-600">Save Lives.</span>
            </h1>
            <p className="mt-5 max-w-xl text-sm sm:text-base leading-7 text-slate-500">
              LIFE-LINK brings hospitals, blood banks, and verified volunteer donors together so emergency blood requests can be coordinated through one trusted network.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/choose-role" className="inline-flex h-11 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold items-center gap-2 shadow-sm">
                Get Started <ArrowRight className="w-4 h-4" />
              </Link>
              <Link href="/about" className="inline-flex h-11 px-5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-sm font-semibold items-center">
                Learn more
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-5 text-xs text-slate-500">
              <span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-green-600" />Verified access</span>
              <span className="flex items-center gap-2"><Heart className="w-4 h-4 text-red-500" />Donor coordination</span>
              <span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-blue-600" />Hospital network</span>
            </div>
          </div>

          <div className="relative">
            <div className="mx-auto max-w-[460px] rounded-[28px] bg-gradient-to-b from-blue-50 to-white border border-blue-100 p-8 shadow-[0_25px_70px_rgba(37,99,235,.10)]">
              <div className="grid grid-cols-2 gap-4">
                <div className="public-card p-5">
                  <Heart className="w-6 h-6 text-red-500" />
                  <h3 className="mt-3 text-sm font-bold text-slate-900">Donors</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Verified volunteers available for compatible emergency requests.</p>
                </div>
                <div className="public-card p-5">
                  <Database className="w-6 h-6 text-blue-600" />
                  <h3 className="mt-3 text-sm font-bold text-slate-900">Blood banks</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-500">Inventory and transfer coordination across the network.</p>
                </div>
                <div className="col-span-2 public-card p-5 flex items-center gap-4 bg-white">
                  <div className="h-12 w-12 rounded-full bg-red-50 flex items-center justify-center"><Heart className="w-6 h-6 text-red-500 fill-current" /></div>
                  <div>
                    <div className="text-sm font-bold text-slate-900">Emergency request</div>
                    <div className="text-xs text-slate-500 mt-1">Hospital → LIFE-LINK → compatible resources</div>
                  </div>
                  <ArrowRight className="ml-auto w-5 h-5 text-blue-600" />
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-200 bg-white">
          <div className="lifelink-container py-14">
            <div className="text-center max-w-2xl mx-auto">
              <p className="text-[11px] uppercase tracking-widest font-bold text-blue-600">One connected workflow</p>
              <h2 className="mt-2 public-section-title">Resources coordinated when they matter</h2>
              <p className="mt-3 public-section-copy">The platform supports the emergency journey from hospital request through inventory, peer-bank sourcing, and donor dispatch.</p>
            </div>
            <div className="mt-9 grid md:grid-cols-3 gap-5">
              {[
                { icon: Building2, title: 'Hospitals', text: 'Raise and track emergency blood requests.' },
                { icon: Database, title: 'Blood banks', text: 'Share inventory and coordinate peer transfers.' },
                { icon: Heart, title: 'Donors', text: 'Receive compatible emergency alerts and respond.' },
              ].map(({icon: Icon, title, text}) => (
                <div key={title} className="public-card p-6">
                  <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center"><Icon className="w-5 h-5" /></div>
                  <h3 className="mt-4 text-base font-bold text-slate-900">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="lifelink-container py-12 flex flex-col sm:flex-row items-center justify-between gap-5">
          <div>
            <h2 className="text-xl font-extrabold text-slate-900">Ready to join LIFE-LINK?</h2>
            <p className="mt-1 text-sm text-slate-500">Choose your role and continue to the secure passwordless flow.</p>
          </div>
          <Link href="/choose-role" className="inline-flex h-10 px-5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold items-center gap-2">
            Choose your role <ArrowRight className="w-4 h-4" />
          </Link>
        </section>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="lifelink-container py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-xs text-slate-500">© {new Date().getFullYear()} LIFE-LINK. Connect. Donate. Save Lives.</div>
          <div className="flex items-center gap-5 text-xs text-slate-500">
            <Link href="/terms" className="hover:text-blue-600">Terms</Link>
            <Link href="/privacy" className="hover:text-blue-600">Privacy</Link>
            <Link href="/contact" className="flex items-center gap-1 hover:text-blue-600"><Mail className="w-3.5 h-3.5" />Contact</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
