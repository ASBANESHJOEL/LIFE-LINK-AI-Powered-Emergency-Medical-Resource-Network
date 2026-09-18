'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity,
  AlertOctagon,
  Building2,
  Database,
  Bell,
  LogOut,
  Menu,
  X,
  User,
  ShieldCheck,
  Truck,
  HeartHandshake,
  FileText,
  Navigation,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../../lib/supabase/auth-context';
import { api } from '../../lib/api/client';
import { AppNotification } from '../../types/notifications';

interface NavItem {
  label: string;
  href: string;
  icon: React.ReactNode;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, organization, signOut, isAuthenticated, isLoading } = useAuth();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [unreadNotificationsCount, setUnreadNotificationsCount] = useState(0);

  // Poll or fetch notifications count when user is authenticated
  useEffect(() => {
    if (!isAuthenticated) return;

    let mounted = true;
    async function loadUnread() {
      try {
        const res = await api.notifications.list({ unreadOnly: true, limit: 1 });
        if (mounted && res?.pagination) {
          setUnreadNotificationsCount(res.pagination.unreadCount || 0);
        }
      } catch (err) {
        // Silent catch for background notifications counter
      }
    }

    loadUnread();
    const interval = setInterval(loadUnread, 30000); // Check every 30s
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [isAuthenticated]);

  // Route protection redirect: if not loading and not authenticated, redirect to /login
  useEffect(() => {
    if (!isLoading && !isAuthenticated && pathname !== '/login' && pathname !== '/verify-otp' && pathname !== '/') {
      router.push('/login');
    }
  }, [isLoading, isAuthenticated, pathname, router]);

  // Generate navigation items based on verified role
  const getNavItems = (): NavItem[] => {
    if (!user) return [];

    switch (user.role) {
      case 'HOSPITAL_COORDINATOR':
        return [
          { label: 'Command Center', href: '/hospital/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Emergency Requests', href: '/hospital/requests', icon: <AlertOctagon className="w-4 h-4" /> },
          { label: 'New Request', href: '/hospital/requests/new', icon: <AlertOctagon className="w-4 h-4 text-red-400" /> },
          { label: 'Inventory Reserve', href: '/hospital/inventory', icon: <Database className="w-4 h-4" /> },
          { label: 'Peer Transfers', href: '/hospital/transfers', icon: <Building2 className="w-4 h-4" /> },
        ];
      case 'BLOOD_BANK_OFFICER':
        return [
          { label: 'Bank Dashboard', href: '/blood-bank/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Blood Inventory', href: '/blood-bank/inventory', icon: <Database className="w-4 h-4" /> },
          { label: 'Transfer Requests', href: '/blood-bank/transfers', icon: <HeartHandshake className="w-4 h-4" /> },
        ];
      case 'DONOR':
        return [
          { label: 'Donor Hub', href: '/donor/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Emergency Alerts', href: '/donor/alerts', icon: <AlertOctagon className="w-4 h-4 text-red-400" /> },
          { label: 'Live Dispatches', href: '/donor/dispatches', icon: <Navigation className="w-4 h-4" /> },
        ];
      case 'REGULATOR':
      case 'SUPER_ADMIN':
        return [
          { label: 'Audit Dashboard', href: '/regulator/dashboard', icon: <Activity className="w-4 h-4" /> },
          { label: 'Network Operations', href: '/hospital/requests', icon: <Building2 className="w-4 h-4" /> },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#090d16] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 border-4 border-red-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-semibold tracking-wider uppercase">
            Securing LIFE-LINK Operational Session...
          </p>
        </div>
      </div>
    );
  }

  // If on login or verify-otp pages, don't show full dashboard shell
  if (pathname === '/login' || pathname === '/verify-otp' || pathname === '/') {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-[#090d16] text-slate-100 flex flex-col">
      {/* Top Header */}
      <header className="sticky top-0 z-40 h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>

          <Link href="/" className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center text-white font-black text-lg shadow-md shadow-red-900/40">
              +
            </div>
            <div className="flex flex-col">
              <span className="font-extrabold text-base tracking-tight text-white flex items-center gap-1.5">
                LIFE-LINK
                <span className="text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-red-950 border border-red-800/60 text-red-300">
                  CRITICAL
                </span>
              </span>
              <span className="text-[10px] text-slate-400 leading-none">Emergency Medical Resource Network</span>
            </div>
          </Link>
        </div>

        {/* User Info & Organization Context */}
        <div className="flex items-center gap-3">
          {organization && (
            <div className="hidden lg:flex flex-col text-right pr-3 border-r border-slate-800">
              <span className="text-xs font-semibold text-white">
                {organization.hospital?.name || organization.bloodBank?.name || 'Authorized Member'}
              </span>
              <span className="text-[10px] text-slate-400 uppercase font-medium">
                {organization.hospital ? 'Trauma Center' : organization.bloodBank ? 'Regional Blood Bank' : 'Network Operations'}
              </span>
            </div>
          )}

          {/* User Role Badge */}
          {user && (
            <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800">
              <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
              <span className="text-[11px] font-semibold text-slate-300">
                {user.role.replace(/_/g, ' ')}
              </span>
            </div>
          )}

          {/* Notifications Bell */}
          <Link
            href="/notifications"
            className="relative p-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/80 transition-colors"
            title="System Notifications"
          >
            <Bell className="w-4 h-4" />
            {unreadNotificationsCount > 0 && (
              <span className="absolute top-1 right-1 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-red-600 text-[10px] font-black text-white ring-2 ring-slate-950 animate-pulse">
                {unreadNotificationsCount > 9 ? '9+' : unreadNotificationsCount}
              </span>
            )}
          </Link>

          {/* User Email & Sign Out */}
          <div className="flex items-center gap-2 pl-2">
            <Link
              href="/profile"
              className="hidden md:flex text-xs text-slate-400 hover:text-slate-200 transition-colors"
              title="User Profile"
            >
              {user?.email}
            </Link>
            <button
              onClick={handleSignOut}
              className="p-2 rounded-lg text-slate-400 hover:text-red-400 hover:bg-slate-800/80 transition-colors"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden md:flex flex-col w-64 border-r border-slate-800/80 bg-slate-950/40 p-4 shrink-0">
          <div className="text-[10px] uppercase font-bold text-slate-400 px-3 mb-2 tracking-wider">
            Operational Modules
          </div>
          <nav className="flex flex-col space-y-1">
            {navItems.map((item) => {
              const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-sky-600/15 text-sky-300 border border-sky-500/30'
                      : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/60'
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="mt-auto pt-4 border-t border-slate-800/60 flex flex-col gap-2">
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400">
              <div className="flex items-center gap-1.5 text-emerald-400 font-semibold mb-1">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
                Emergency Network Active
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Continuous latency monitoring active across hospital nodes.
              </p>
            </div>
          </div>
        </aside>

        {/* Mobile Slideout Navigation */}
        {mobileMenuOpen && (
          <div
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm md:hidden"
            onClick={() => setMobileMenuOpen(false)}
          >
            <div
              className="w-64 h-full bg-slate-950 border-r border-slate-800 p-4 flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between pb-4 border-b border-slate-800 mb-4">
                <span className="font-bold text-sm text-white">Navigation</span>
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="p-1 rounded text-slate-400 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <nav className="flex flex-col space-y-1">
                {navItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-slate-300 hover:text-white hover:bg-slate-900"
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>
        )}

        {/* Main Workspace Content */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 bg-[#090d16]">
          <div className="max-w-7xl mx-auto">{children}</div>
        </main>
      </div>
    </div>
  );
}
