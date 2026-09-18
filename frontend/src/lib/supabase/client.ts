import { createClient } from '@supabase/supabase-js';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (typeof window !== 'undefined' ? (window as unknown as { __ENV?: Record<string, string> }).__ENV?.NEXT_PUBLIC_SUPABASE_URL : '') ||
  '';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

if (!supabaseUrl || !supabaseKey) {
  if (typeof window !== 'undefined') {
    console.warn(
      '[LIFE-LINK] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in environment.'
    );
  }
}

/**
 * Browser-safe Supabase client using public anon/publishable key.
 * Strictly adheres to zero secret leakage.
 */
export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
