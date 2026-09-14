import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabasePublishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabasePublishableKey) {
  console.warn(
    '[LIFE-LINK] Missing VITE_SUPABASE_URL or VITE_SUPABASE_PUBLISHABLE_KEY in frontend environment.'
  );
}

/**
 * Browser-side Supabase client using public publishable key.
 * Strictly isolated from backend secret keys.
 */
export const supabase = createClient(supabaseUrl || '', supabasePublishableKey || '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});
