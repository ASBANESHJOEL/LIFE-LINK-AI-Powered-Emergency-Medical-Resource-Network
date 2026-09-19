import { createClient } from '@supabase/supabase-js';

// NEXT_PUBLIC_* values are preferred for deployment configuration. The fallback values
// below are the LIFE-LINK Supabase project's public client configuration so the
// passwordless login cannot silently fall back to a placeholder client when a
// Vercel environment variable is missing. The publishable key is safe for browser use.
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  (typeof window !== 'undefined' ? (window as unknown as { __ENV?: Record<string, string> }).__ENV?.NEXT_PUBLIC_SUPABASE_URL : '') ||
  'https://dksyatfpkhknfrbefuep.supabase.co';

const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  'sb_publishable_Ku1vZVkC7zXbH3zRUYqaww_0pGeOlm_';

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
