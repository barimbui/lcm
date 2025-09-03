// supabaseClient.js — v2 client
// Uses the v2 CDN global: window.supabase (from @supabase/supabase-js@2)

const SUPABASE_URL = window.SUPABASE_URL;
const SUPABASE_ANON_KEY = window.SUPABASE_ANON_KEY;

// Create the v2 client and expose it globally as `sb`
window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// (Optional) Handy helper to fetch the current user with v2
window.getCurrentUser = async () => {
  const { data, error } = await window.sb.auth.getUser();
  if (error) {
    console.warn('getUser error:', error.message);
    return null;
  }
  return data.user || null;
};
