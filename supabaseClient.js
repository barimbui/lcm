// supabaseClient.js — v2 client
// Uses the v2 CDN global: window.supabase (from @supabase/supabase-js@2)

const SUPABASE_URL = 'https://zjxsymoobzgtxurwdxsl.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpqeHN5bW9vYnpndHh1cndkeHNsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQxNTYzMjksImV4cCI6MjA2OTczMjMyOX0.UCB7rUsv2tBsjz_PkmUy1G_WBS4mq_wLdWTAd-V7JHM';

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
