import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/supabase/auth-context';
import { AppShell } from '../components/layout/AppShell';

export const metadata: Metadata = {
  title: 'LIFE-LINK | AI-Powered Emergency Medical Resource Network',
  description:
    'Mission-critical emergency blood-resource orchestration platform connecting trauma hospitals, blood banks, and verified volunteer donors with intelligent logistic dispatch.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#090d16] text-slate-100 min-h-screen antialiased selection:bg-red-900 selection:text-white">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
