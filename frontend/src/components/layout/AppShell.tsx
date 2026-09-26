'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, AlertOctagon, Building2, Database, Bell, LogOut, Menu, X, ShieldCheck, Navigation, HeartHandshake, UserRound, ChevronRight } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { api } from '../../lib/api/client';
import { BrandLogo } from '../shared/BrandLogo';

interface NavItem { label: string; href: string; icon: React.ReactNode; description?: string; }

const publicPaths = new Set([
  '/', '/login', '/verify-otp', '/choose-role', '/signup',
  '/about', '/faq', '/contact', '/terms', '/privacy',
  '/inactive', '/unauthorized', '/unprovisioned'
]);

const roleLabels: Record<string, string> = {
  HOSPITAL: 'Hospital operations',
  BLOOD_BANK: 'Blood bank operations',
  DONOR: 'Donor network',
  ADMIN: 'Network administration',
  REGULATOR: 'Regulatory oversight',
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const currentPath = pathname ?? '/';
  const router = useRouter();
  const { user, organization, signOut, isAuthenticated, isLoading, profileStatus } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) return;
    let mounted = true;
    const loadUnread = async () => {
      try {
        const res = await api.notifications.list({ unreadOnly: true, limit: 1 });
        if (mounted) setUnreadNotificationsCount(res?.pagination?.unreadCount || 0);
      } catch { /* background count is non-blocking */ }
    };
    loadUnread();
    const interval = setInterval(loadUnread, 30000);
    return () => { mounted = false; clearInterval(interval); };
  }, [isAuthenticated]);

  useEffect(() => {
    if (isLoading || publicPaths.has(currentPath)) return;
    if (profileStatus === 'UNPROVISIONED') return void router.push('/unprovisioned');
    if (profileStatus === 'INACTIVE') return void router.push('/inactive');
    if (!isAuthenticated) router.push('/login');
  }, [isLoading, isAuthenticated, profileStatus, currentPath, router]);

  const getNavItems = (): NavItem[] => {
    if (!user) return [];
    const dashboard = { label: 'Overview', description: 'Network at a glance', href: user.role === 'HOSPITAL' ? '/hospital/dashboard' : user.role === 'BLOOD_BANK' ? '/blood-bank/dashboard' : user.role === 'DONOR' ? '/donor/dashboard' : '/regulator/dashboard', icon: <Activity aria-hidden="true" /> };
    switch (user.role) {
      case 'HOSPITAL': return [dashboard, { label: 'Emergency requests', href: '/hospital/requests', icon: <AlertOctagon aria-hidden="true" /> }, { label: 'New request', href: '/hospital/requests/new', icon: <AlertOctagon aria-hidden="true" /> }, { label: 'Inventory', href: '/hospital/inventory', icon: <Database aria-hidden="true" /> }, { label: 'Peer transfers', href: '/hospital/transfers', icon: <Building2 aria-hidden="true" /> }, { label: 'Live tracking', href: '/hospital/tracking', icon: <Navigation aria-hidden="true" /> }];
      case 'BLOOD_BANK': return [dashboard, { label: 'Blood inventory', href: '/blood-bank/inventory', icon: <Database aria-hidden="true" /> }, { label: 'Request stock', href: '/blood-bank/requests', icon: <AlertOctagon aria-hidden="true" /> }, { label: 'Transfer requests', href: '/blood-bank/transfers', icon: <HeartHandshake aria-hidden="true" /> }];
      case 'DONOR': return [dashboard, { label: 'Emergency alerts', href: '/donor/alerts', icon: <AlertOctagon aria-hidden="true" /> }, { label: 'Live dispatches', href: '/donor/dispatches', icon: <Navigation aria-hidden="true" /> }, { label: 'Tracking', href: '/donor/tracking', icon: <Navigation aria-hidden="true" /> }];
      case 'ADMIN':
      case 'REGULATOR': return [dashboard, { label: 'Network operations', href: '/hospital/requests', icon: <Building2 aria-hidden="true" /> }];
      default: return [];
    }
  };

  const navItems = getNavItems();
  const handleSignOut = async () => { await signOut(); router.push('/login'); };

  if (isLoading) return <div className="min-h-screen bg-[#f6f9fc] flex items-center justify-center"><div className="text-center"><div className="mx-auto size-9 border-2 border-[#0067B8] border-t-transparent rounded-full animate-spin" /><p className="mt-4 text-sm font-medium text-slate-500">Preparing your workspace…</p></div></div>;
  if (publicPaths.has(currentPath)) return <>{children}</>;

  const sectionLabel = navItems.find((item) => currentPath === item.href || currentPath.startsWith(`${item.href}/`))?.label ?? 'Workspace';
  const organizationName = organization?.hospital?.name || organization?.bloodBank?.name || 'Authorized network member';

  return (
    <div className="min-h-screen bg-[#f6f9fc] text-slate-900 flex flex-col">
      <header className="sticky top-0 z-40 h-[72px] border-b border-slate-200/80 bg-white/95 backdrop-blur px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <button type="button" onClick={() => setMobileMenuOpen(true)} className="md:hidden inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067B8]/30" aria-label="Open navigation"><Menu aria-hidden="true" /></button>
          <BrandLogo href="/" />
          <div className="hidden lg:flex items-center gap-2 text-sm text-slate-400"><ChevronRight aria-hidden="true" /><span>{sectionLabel}</span></div>
        </div>
        <div className="flex items-center gap-2 sm:gap-4">
          <div className="hidden xl:block text-right border-r border-slate-200 pr-4"><p className="text-sm font-semibold text-slate-800 truncate max-w-56">{organizationName}</p><p className="text-xs text-slate-500">{user ? roleLabels[user.role] : 'Secure workspace'}</p></div>
          {user && <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-[#0067B8]"><ShieldCheck aria-hidden="true" />{user.role.replace(/_/g, ' ')}</span>}
          <Link href="/notifications" className="relative inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067B8]/30" aria-label={`Notifications${unreadNotificationsCount ? `, ${unreadNotificationsCount} unread` : ''}`}><Bell aria-hidden="true" />{unreadNotificationsCount > 0 && <span className="absolute right-1.5 top-1.5 min-w-4 h-4 rounded-full bg-red-600 px-1 text-center text-[9px] font-bold leading-4 text-white">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>}</Link>
          <Link href="/profile" className="hidden md:flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-slate-600 hover:bg-slate-100"><span className="inline-flex size-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><UserRound aria-hidden="true" /></span><span className="max-w-44 truncate">{user?.email}</span></Link>
          <button type="button" onClick={handleSignOut} className="inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/30" aria-label="Sign out"><LogOut aria-hidden="true" /></button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-slate-200/80 bg-white px-3 py-5">
          <div className="px-3 pb-4"><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Operations center</p><p className="mt-1 text-xs text-slate-500">{roleLabels[user?.role ?? ''] ?? 'Secure workspace'}</p></div>
          <nav aria-label="Primary navigation" className="flex flex-col gap-1">
            {navItems.map((item) => { const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} aria-current={active ? 'page' : undefined} className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067B8]/30 ${active ? 'bg-[#e8f3fb] text-[#0067B8]' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>{item.icon}<span className="flex-1">{item.label}</span>{active && <span className="size-1.5 rounded-full bg-[#0067B8]" aria-hidden="true" />}</Link>; })}
          </nav>
          <div className="mt-auto border-t border-slate-100 pt-4"><div className="rounded-xl border border-emerald-100 bg-emerald-50/70 p-3"><div className="flex items-center gap-2 text-xs font-bold text-emerald-800"><span className="size-2 rounded-full bg-emerald-500" aria-hidden="true" />Network operational</div><p className="mt-1.5 text-[11px] leading-relaxed text-emerald-900/65">Coordination services are available.</p></div></div>
        </aside>

        {mobileMenuOpen && <div className="fixed inset-0 z-50 bg-slate-950/30 md:hidden" onClick={() => setMobileMenuOpen(false)}><aside role="dialog" aria-modal="true" aria-label="Navigation menu" className="flex h-full w-[min(86vw,20rem)] flex-col bg-white px-4 py-5 shadow-2xl" onClick={(event) => event.stopPropagation()}><div className="flex items-center justify-between border-b border-slate-100 pb-5"><BrandLogo href="/" compact /><button type="button" onClick={() => setMobileMenuOpen(false)} className="inline-flex size-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="Close navigation"><X aria-hidden="true" /></button></div><p className="px-2 pb-3 pt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Operations center</p><nav aria-label="Mobile navigation" className="flex flex-col gap-1">{navItems.map((item) => { const active = currentPath === item.href || currentPath.startsWith(`${item.href}/`); return <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)} aria-current={active ? 'page' : undefined} className={`flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-semibold ${active ? 'bg-[#e8f3fb] text-[#0067B8]' : 'text-slate-600 hover:bg-slate-50'}`}>{item.icon}{item.label}</Link>; })}</nav></aside></div>}

        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-7xl">{children}</div></main>
      </div>
    </div>
  );
}
