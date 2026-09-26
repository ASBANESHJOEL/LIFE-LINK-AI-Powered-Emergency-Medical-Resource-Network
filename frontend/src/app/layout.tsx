import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '../lib/supabase/auth-context';
import { AppShell } from '../components/layout/AppShell';

export const metadata: Metadata = {
  title: 'LIFE-LINK | Emergency Medical Resource Network',
  description:
    'LIFE-LINK coordinates hospitals, blood banks, and verified donors during emergency medical resource requests.',
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
