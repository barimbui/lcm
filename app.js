// app.js — handles login form logic
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("login-form");
  if (!form) return;

  const identifierEl = document.getElementById("login-identifier");
  const passwordEl = document.getElementById("login-password");
  const statusEl = document.getElementById("login-status");

  const forgotId = document.getElementById("forgot-identifier");
  const forgotPw = document.getElementById("forgot-password");

  forgotId.addEventListener("click", (e) => {
    e.preventDefault();
    alert("For now, please contact support to recover your username/ID. Self-service is coming soon.");
  });

  forgotPw.addEventListener("click", (e) => {
    e.preventDefault();
    alert("Password reset is via email in MVP. Use Sign Up if you don’t have an account.");
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!window.sb) {
      statusEl.textContent = "Supabase not initialized.";
      statusEl.className = "status error";
      return;
    }

    const identifier = identifierEl.value.trim();
    const password = passwordEl.value;

    // MVP supports email+password only for now
    const looksLikeEmail = identifier.includes("@");
    if (!looksLikeEmail) {
      statusEl.textContent = "Please use your email for login in this version.";
      statusEl.className = "status error";
      return;
    }

    statusEl.textContent = "Signing in…";
    statusEl.className = "status";

    const { error } = await window.sb.auth.signInWithPassword({
      email: identifier,
      password
    });

    if (error) {
      statusEl.textContent = error.message;
      statusEl.className = "status error";
      return;
    }

    statusEl.textContent = "Success! Redirecting…";
    statusEl.className = "status ok";
    window.location.href = "dashboard.html"; // placeholder for now
  });
});

/* ========== LCM PROFILE (Supabase v2) — with header view ========== */
(function () {
  // Run only on pages that actually have the Profile UI
  const $ = (id) => document.getElementById(id);
  if (!($('profile-display-name') && $('profile-save-btn'))) return;

  const setStatus = (msg) => { const el = $('profile-save-status'); if (el) el.textContent = msg || ''; };
  const disableInputs = (disabled) => {
    ['profile-display-name','profile-avatar-url','profile-bio','profile-save-btn']
      .forEach(id => { const el = $(id); if (el) el.disabled = !!disabled; });
  };
  const setAvatarPreview = (url) => {
    const img = $('profile-avatar-preview');
    if (!img) return;
    if (url && url.trim()) { img.style.display = 'inline-block'; img.src = url.trim(); }
    else { img.style.display = 'none'; img.removeAttribute('src'); }
  };
  const updateHeader = (name, bio) => {
    const nameEl = $('profile-view-name');
    const bioEl  = $('profile-view-bio');
    if (nameEl) nameEl.textContent = (name && name.trim()) ? name.trim() : 'Your name';
    if (bioEl)  bioEl.textContent  = (bio && bio.trim())  ? bio.trim()  : 'Your bio will show here';
  };

  async function getUser() {
    // Prefer the helper you defined in supabaseClient.js
    if (typeof window.getCurrentUser === 'function') return await window.getCurrentUser();
    const { data, error } = await window.sb.auth.getUser();
    if (error) return null;
    return data?.user || null;
  }

  async function loadProfile() {
    const user = await getUser();
    if (!user) { disableInputs(true); setStatus('Please sign in to edit your profile.'); return; }

    const { data, error } = await window.sb
      .from('user_profiles')
      .select('display_name, avatar_url, bio')
      .eq('user_id', user.id)
      .maybeSingle();

    if (error) { console.error('Load profile error:', error); setStatus('Could not load profile.'); return; }

    const row = data || null;
    const displayName = row?.display_name || '';
    const avatarUrl   = row?.avatar_url   || '';
    const bio         = row?.bio          || '';

    // Fill form fields
    $('profile-display-name').value = displayName;
    $('profile-avatar-url').value   = avatarUrl;
    $('profile-bio').value          = bio;

    // Update the read-only header + avatar preview
    updateHeader(displayName, bio);
    setAvatarPreview(avatarUrl);

    setStatus('');
    disableInputs(false);
  }

  async function saveProfile() {
    const user = await getUser();
    if (!user) { setStatus('Please sign in to save your profile.'); return; }

    const displayName = $('profile-display-name').value.trim() || null;
    const avatarUrl   = $('profile-avatar-url').value.trim()   || null;
    const bio         = $('profile-bio').value.trim()          || null;

    const payload = {
      user_id: user.id,
      display_name: displayName,
      avatar_url:   avatarUrl,
      bio:          bio,
      updated_at:   new Date().toISOString()
    };

    setStatus('Saving…');
    const { error } = await window.sb
      .from('user_profiles')
      .upsert(payload, { onConflict: 'user_id' });

    if (error) { console.error('Save profile error:', error); setStatus('Save failed. Check console.'); return; }

    // Immediately reflect changes in the header + avatar
    updateHeader(displayName || '', bio || '');
    setAvatarPreview(avatarUrl || '');

    setStatus('Profile saved ✅');
  }

  document.addEventListener('DOMContentLoaded', () => {
    const avatarInput = $('profile-avatar-url');
    if (avatarInput) avatarInput.addEventListener('input', () => setAvatarPreview(avatarInput.value));

    const saveBtn = $('profile-save-btn');
    if (saveBtn) saveBtn.addEventListener('click', (e) => { e.preventDefault(); saveProfile(); });

    loadProfile();
  });

  if (window.sb?.auth?.onAuthStateChange) {
    window.sb.auth.onAuthStateChange(() => { loadProfile(); });
  }
})();
