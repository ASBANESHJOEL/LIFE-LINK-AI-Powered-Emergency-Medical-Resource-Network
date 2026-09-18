'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Activity, AlertOctagon, Building2, Database, Bell, LogOut, Menu, X, ShieldCheck, Navigation, HeartHandshake } from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { api } from '../../lib/api/client';

interface NavItem { label: string; href: string; icon: React.ReactNode; }

const publicPaths = new Set([
  '/', '/login', '/verify-otp', '/choose-role', '/signup',
  '/about', '/faq', '/contact', '/terms', '/privacy',
  '/inactive', '/unauthorized', '/unprovisioned'
]);

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, organization, signOut, isAuthenticated, isLoading } = useAuth();
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
    if (!isLoading && !isAuthenticated && !publicPaths.has(pathname)) {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  const getNavItems = (): NavItem[] => {
    if (!user) return [];
    switch (user.role) {
      case 'HOSPITAL':
        return [
          { label: 'Dashboard', href: '/hospital/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Emergency Requests', href: '/hospital/requests', icon: <AlertOctagon className="w-4 h-4" /> },
          { label: 'New Request', href: '/hospital/requests/new', icon: <AlertOctagon className="w-4 h-4" /> },
          { label: 'Inventory', href: '/hospital/inventory', icon: <Database className="w-4 h-4" /> },
          { label: 'Peer Transfers', href: '/hospital/transfers', icon: <Building2 className="w-4 h-4" /> },
        ];
      case 'BLOOD_BANK':
        return [
          { label: 'Dashboard', href: '/blood-bank/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Blood Inventory', href: '/blood-bank/inventory', icon: <Database className="w-4 h-4" /> },
          { label: 'Transfer Requests', href: '/blood-bank/transfers', icon: <HeartHandshake className="w-4 h-4" /> },
        ];
      case 'DONOR':
        return [
          { label: 'Dashboard', href: '/donor/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Emergency Alerts', href: '/donor/alerts', icon: <AlertOctagon className="w-4 h-4" /> },
          { label: 'Live Dispatches', href: '/donor/dispatches', icon: <Navigation className="w-4 h-4" /> },
        ];
      case 'ADMIN':
      case 'REGULATOR':
        return [
          { label: 'Audit Dashboard', href: '/regulator/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Network Operations', href: '/hospital/requests', icon: <Building2 className="w-4 h-4" /> },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const handleSignOut = async () => { await signOut(); router.push('/login'); };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="mx-auto h-8 w-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="mt-3 text-xs font-medium text-slate-500">Preparing LIFE-LINK...</p>
        </div>
      </div>
    );
  }

  if (publicPaths.has(pathname)) return <>{children}</>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 flex flex-col">
      <header className="sticky top-0 z-40 h-16 border-b border-slate-200 bg-white/95 backdrop-blur px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => setMobileMenuOpen(!mobileMenuOpen)} className="md:hidden p-2 rounded-lg text-slate-500 hover:bg-slate-50" aria-label="Toggle navigation">
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
          <Link href="/" className="brand-mark">
            <span className="brand-mark-icon"><span className="text-base">+</span></span>
            <span className="brand-mark-word">LIFE LINK</span>
          </Link>
          <span className="hidden lg:block text-xs text-slate-400 border-l border-slate-200 pl-3">Emergency Medical Resource Network</span>
        </div>

        <div className="flex items-center gap-2 sm:gap-4">
          {organization && (
            <div className="hidden lg:block text-right border-r border-slate-200 pr-4">
              <div className="text-xs font-semibold text-slate-800">{organization.hospital?.name || organization.bloodBank?.name || 'Authorized Member'}</div>
              <div className="text-[10px] text-slate-400">{organization.hospital ? 'Hospital' : organization.bloodBank ? 'Blood Bank' : 'Network Member'}</div>
            </div>
          )}
          {user && <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-700 text-[11px] font-semibold"><ShieldCheck className="w-3.5 h-3.5" />{user.role.replace(/_/g, ' ')}</div>}
          <Link href="/notifications" className="relative p-2 rounded-lg text-slate-500 hover:bg-slate-50 hover:text-slate-800" aria-label="Notifications">
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && <span className="absolute top-1 right-1 min-w-4 h-4 px-1 rounded-full bg-red-500 text-white text-[9px] font-bold flex items-center justify-center">{unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}</span>}
          </Link>
          <Link href="/profile" className="hidden md:block max-w-48 truncate text-xs text-slate-500 hover:text-blue-600">{user?.email}</Link>
          <button onClick={handleSignOut} className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50" title="Sign out"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      <div className="flex flex-1">
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white p-4">
          <p className="px-3 mb-2 text-[10px] uppercase tracking-wider font-bold text-slate-400">Workspace</p>
          <nav className="space-y-1">
            {navItems.map(item => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              return <Link key={item.href} href={item.href} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${active ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'}`}>{item.icon}{item.label}</Link>;
            })}
          </nav>
          <div className="mt-auto pt-4 border-t border-slate-100">
            <div className="rounded-xl bg-blue-50 border border-blue-100 p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-blue-700"><span className="h-2 w-2 rounded-full bg-green-500" />Network active</div>
              <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Emergency coordination services are available.</p>
            </div>
          </div>
        </aside>

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/20 md:hidden" onClick={() => setMobileMenuOpen(false)}>
            <div className="w-72 h-full bg-white border-r border-slate-200 p-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between pb-4 border-b border-slate-100 mb-4">
                <span className="font-bold text-sm text-slate-900">Workspace</span>
                <button onClick={() => setMobileMenuOpen(false)} className="p-1 text-slate-500"><X className="w-5 h-5" /></button>
              </div>
              <nav className="space-y-1">
                {navItems.map(item => <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-600 hover:bg-slate-50">{item.icon}{item.label}</Link>)}
              </nav>
            </div>
          </div>
        )}

        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
