import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/supabase/auth-context';
import { AppShell } from '../components/layout/AppShell';

export const metadata: Metadata = {
  title: 'LIFE-LINK | Connect. Donate. Save Lives.',
  description:
    'LIFE-LINK connects emergency hospitals, blood banks, and verified donors through a coordinated medical resource network.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
