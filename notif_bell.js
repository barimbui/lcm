// notif_bell.js — works with supabaseClient.js that exposes window.sb (v2)
document.addEventListener('DOMContentLoaded', async () => {
  const sb = window.sb; // <-- client from supabaseClient.js
  if (!sb) {
    console.warn('[notif_bell] Supabase client not found. Ensure supabaseClient.js loads first.');
    return;
  }

  // Accepts #notif-badge OR .notif-badge OR [data-notif-badge]
  const badgeEl = document.querySelector('#notif-badge, .notif-badge, [data-notif-badge]');
  if (!badgeEl) {
    console.warn('[notif_bell] Badge element not found (#notif-badge/.notif-badge/[data-notif-badge]).');
    return;
  }

  const { data: userRes, error: authErr } = await sb.auth.getUser();
  const user = userRes?.user;
  if (!user || authErr) {
    badgeEl.hidden = true;
    return;
  }

  async function refreshBell() {
    try {
      const { data, error } = await sb.rpc('get_unread_notifications_count', {
        p_user: user.id,
        p_kind: 'BONUS' // change to null to count ALL kinds
      });
      const count = Number.isFinite(data) ? data : 0;
      badgeEl.textContent = String(count);
      badgeEl.hidden = count === 0;
    } catch (e) {
      console.warn('[notif_bell] refresh error:', e);
    }
  }

  // Initial load
  await refreshBell();

  // Light polling
  setInterval(refreshBell, 30000);

  // Realtime updates
  sb
    .channel('notif_bell')
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      table: 'notifications',
      filter: `user_id=eq.${user.id}`
    }, refreshBell)
    .subscribe();

  // Optional manual trigger
  window.refreshNotifBell = refreshBell;
});
