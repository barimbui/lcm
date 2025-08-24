// policing.js — report flow + verify queue + incident detail modal
// Modal fix: force proper centering & overlay; lock body scroll while open; support deep-links (?incident= / #incident=)

(function () {
  const $ = (sel) => document.querySelector(sel);

  // Find a usable Supabase client
  function getSupabaseClient() {
    const candidates = [
      window.supabaseClient,
      window.sb,
      window.client,
      window.db,
      window.SUPABASE,
      window.supabase,
    ].filter(Boolean);
    for (const c of candidates) {
      if (typeof c?.from === 'function' && c?.auth) return c;
    }
    return null;
  }

  // Elements (Report Misconduct)
  const communityEl = $('#police-community-select');
  const userSelectEl = $('#police-reported-user-select');
  const userFallbackWrap = $('#police-reported-user-fallback');
  const userFallbackInput = $('#police-reported-user');

  const taskSelectEl = $('#police-task-select');
  const taskFallbackWrap = $('#police-task-fallback');
  const taskFallbackInput = $('#police-task-id');

  const reasonEl = $('#police-reason');
  const evidenceEl = $('#police-evidence');
  const submitBtn = $('#police-submit');
  const toastEl = $('#police-toast');

  // Elements (Verify Queue + Modal)
  const verifyListEl = $('#verify-list');
  const verifyEmptyEl = $('#verify-empty');

  const modalEl = $('#incident-modal');
  const modalBodyEl = $('#incident-body');
  const modalCloseEl = $('#incident-close');
  const btnTrue = $('#btn-true');
  const btnIgnore = $('#btn-ignore');
  const btnFalse = $('#btn-false');
  const falseForm = $('#false-form');
  const falseReason = $('#false-reason');
  const btnFalseCancel = $('#btn-false-cancel');
  const btnFalseSubmit = $('#btn-false-submit');

  const DEFAULT_COMMUNITIES = ['HOME', 'SCHOOL', 'CHURCH', 'WORK', 'TEAM'];

  let db = null;
  let currentUserId = null;

  // Local “handled” store so IGNORE/FALSE disappear immediately & survive reloads
  const STORAGE_KEY_IGNORED = 'police_ignored_incidents';
  const STORAGE_KEY_FALSE = 'police_false_incidents';
  const ignoredSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_IGNORED) || '[]'));
  const falseSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_FALSE) || '[]'));

  // ---------- helpers ----------
  function showToast(message, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.borderColor = isError ? '#d33' : '#5a2ca0';
    toastEl.style.background = isError
      ? 'rgba(211,51,51,0.15)'
      : 'rgba(90,44,160,0.15)';
    setTimeout(() => { if (!isError) toastEl.hidden = true; }, isError ? 6000 : 3000);
  }

  function setLoading(state) {
    if (!submitBtn) return;
    submitBtn.disabled = state;
    submitBtn.textContent = state ? 'Submitting…' : 'Submit Report';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, s => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    }[s]));
  }

  function parseTaskIdOrNull(raw) {
    const t = (raw || '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function fmtDate(iso) {
    try {
      const d = new Date(iso);
      if (isNaN(d)) return '';
      return d.toLocaleString();
    } catch { return ''; }
  }

  async function getCurrentUserId() {
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user?.id) return null;
      return data.user.id;
    } catch {
      return null;
    }
  }

  // ---------- Report flow ----------
  async function loadCommunities() {
    if (communityEl && communityEl.options && communityEl.options.length > 1) return;
    if (communityEl) {
      communityEl.innerHTML =
        '<option value="" selected disabled>Select a community…</option>' +
        DEFAULT_COMMUNITIES.map(c => `<option value="${c}">${c}</option>`).join('');
    }
  }

  async function fetchUsersByCommunity(comm) {
    try {
      const { data, error } = await db
        .from('v_policing_users_by_community')
        .select('display_name, user_id')
        .eq('community', comm)
        .order('display_name', { ascending: true })
        .limit(500);
      if (error) {
        console.error('fetchUsersByCommunity error:', error);
        return { ok: false, users: [], err: error.message || String(error) };
      }
      const users = (data || []).map(r => ({
        id: r.user_id,
        name: r.display_name || ''
      }));
      return { ok: true, users };
    } catch (e) {
      console.error(e);
      return { ok: false, users: [], err: e.message || String(e) };
    }
  }

  function fillUserSelect(users) {
    const options = ['<option value="" selected disabled>Select a user…</option>'];
    for (const u of users) {
      const safeName = escapeHtml(u.name || '(unnamed)');
      const dataAttr = u.id ? ` data-userid="${u.id}"` : '';
      options.push(`<option value="${safeName}"${dataAttr}>${safeName}</option>`);
    }
    userSelectEl.innerHTML = options.join('');
    userSelectEl.disabled = users.length === 0;
    userFallbackWrap.hidden = users.length !== 0;
  }

  async function fetchTasksForUser(userId) {
    try {
      const { data, error } = await db
        .from('tasks')
        .select('id, task_description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) { console.error('fetchTasksForUser error:', error); return []; }
      return (data || []).map(t => ({
        id: t.id,
        label: t.task_description ? `${t.task_description} (ID: ${t.id})` : `Task #${t.id}`
      }));
    } catch (e) {
      console.error(e);
      return [];
    }
  }

  function fillTaskSelect(tasks) {
    const options = ['<option value="">General incident (no specific task)</option>']
      .concat(tasks.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`));
    taskSelectEl.innerHTML = options.join('');
    taskSelectEl.disabled = false;
    taskFallbackWrap.hidden = tasks.length !== 0;
  }

  async function handleCommunityChange() {
    const comm = (communityEl.value || '').trim();

    userSelectEl.innerHTML = '<option value="" selected disabled>Select a user…</option>';
    userSelectEl.disabled = true;
    userFallbackWrap.hidden = true;
    userFallbackInput.value = '';

    taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>';
    taskSelectEl.disabled = true;
    taskFallbackWrap.hidden = true;
    taskFallbackInput.value = '';

    if (!comm) return;

    const { ok, users, err } = await fetchUsersByCommunity(comm);
    if (!ok) {
      console.warn('Could not load users:', err);
      fillUserSelect([]);
      userFallbackWrap.hidden = false;
      showToast(`Could not load users for ${comm}. Paste user UUID instead.`, true);
      return;
    }

    fillUserSelect(users);
    if (users.length === 0) {
      userFallbackWrap.hidden = false;
      showToast(`No users found for ${comm}. Paste user UUID.`, true);
    }
  }

  async function handleUserChange() {
    const opt = userSelectEl.options[userSelectEl.selectedIndex];
    const userIdFromOption = opt && opt.dataset ? opt.dataset.userid : null;

    taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>';
    taskSelectEl.disabled = true;
    taskFallbackWrap.hidden = true;
    taskFallbackInput.value = '';

    if (!userIdFromOption) {
      userFallbackWrap.hidden = false;
      return;
    }

    userFallbackWrap.hidden = true;
    const tasks = await fetchTasksForUser(userIdFromOption);
    fillTaskSelect(tasks);
  }

  function getSelectedReportedUserId() {
    const opt = userSelectEl.options[userSelectEl.selectedIndex];
    if (opt && opt.dataset && opt.dataset.userid) {
      userFallbackWrap.hidden = true;
      return opt.dataset.userid;
    }
    userFallbackWrap.hidden = false;
    const pasted = (userFallbackInput.value || '').trim();
    return pasted || null;
  }

  function getSelectedTaskIdOrNull() {
    const fromSelect = (taskSelectEl.value || '').trim();
    if (fromSelect) return parseTaskIdOrNull(fromSelect);
    return parseTaskIdOrNull(taskFallbackInput.value);
  }

  function validateUrlMaybe(url) {
    if (!url) return true;
    try { const u = new URL(url); return !!u.protocol && !!u.host; } catch { return false; }
  }

  async function handleSubmit(e) {
    e?.preventDefault?.();

    const reporterId = await getCurrentUserId();
    if (!reporterId) { showToast('Please sign in to submit a report.', true); return; }

    const community = (communityEl.value || '').trim();
    if (!community) { showToast('Pick a Community.', true); communityEl?.focus(); return; }

    const reportedUserId = getSelectedReportedUserId();
    if (!reportedUserId) { showToast('Select a user or paste a user UUID.', true); userSelectEl?.focus(); return; }

    const reason = (reasonEl?.value || '').trim();
    if (reason.length < 5) { showToast('Please describe what happened (a few words).', true); reasonEl?.focus(); return; }

    const evidenceUrl = (evidenceEl?.value || '').trim();
    if (evidenceUrl && !validateUrlMaybe(evidenceUrl)) { showToast('Evidence link looks invalid. Use https://… or leave empty.', true); evidenceEl?.focus(); return; }

    const taskIdOrNull = getSelectedTaskIdOrNull();
    const reasonWithCommunity = `[COMMUNITY:${community}] ` + reason;

    try {
      setLoading(true);
      const { data, error } = await db.rpc('report_misconduct', {
        p_reporter_user_id: reporterId,
        p_reported_user_id: reportedUserId,
        p_task_id: taskIdOrNull,
        p_reason: reasonWithCommunity,
        p_evidence_url: evidenceUrl || null
      });
      if (error) { console.error('report_misconduct error:', error); showToast(error.message || 'Could not submit report.', true); return; }

      const row = Array.isArray(data) ? data[0] : data;
      const incId = row?.incident_id ?? '(unknown)';
      const first = row?.is_first_report ? ' You are the first reporter.' : '';
      showToast(`Report submitted. Incident #${incId} created/updated.${first}`);

      // Reset (keep community)
      if (userSelectEl) userSelectEl.selectedIndex = 0, userSelectEl.disabled = true;
      if (userFallbackInput) userFallbackInput.value = '', userFallbackWrap.hidden = true;
      taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>';
      taskSelectEl.disabled = true;
      taskFallbackInput.value = '';
      taskFallbackWrap.hidden = true;
      reasonEl.value = '';
      evidenceEl.value = '';

      await loadVerifyQueue(); // harmless
    } catch (err) {
      console.error(err);
      showToast('Something went wrong submitting the report.', true);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Verify Queue ----------
  async function fetchVerifyQueueForUser(userId, limit = 20) {
    try {
      const { data, error } = await db.rpc('get_verify_queue', { p_user_id: userId, p_limit: limit });
      if (error) { console.error('get_verify_queue error:', error); return []; }
      return Array.isArray(data) ? data : [];
    } catch (e) {
      console.error('get_verify_queue exception:', e);
      return [];
    }
  }

  function renderVerifyList(items) {
    if (!verifyListEl || !verifyEmptyEl) return;

    // Filter out locally ignored/false
    const filtered = items.filter(it => !ignoredSet.has(it.incident_id) && !falseSet.has(it.incident_id));

    verifyListEl.innerHTML = '';
    verifyEmptyEl.hidden = filtered.length !== 0;

    for (const it of filtered) {
      const row = document.createElement('div');
      row.className = 'police-row';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'flex-start';
      row.style.borderTop = '1px solid #2b2640';
      row.style.paddingTop = '10px';
      row.style.marginTop = '10px';

      const left = document.createElement('div');
      left.style.flex = '1';
      left.style.cursor = 'pointer';
      left.innerHTML = `
        <div style="color:#eaeaea; font-weight:600;">
          Incident #${it.incident_id} · ${escapeHtml(it.community || 'Unspecified')}
        </div>
        <div style="color:#bbb; margin-top:4px;">
          ${escapeHtml(it.reason_preview || '(no reason provided)')}
        </div>
        <div style="color:#888; font-size:12px; margin-top:4px;">
          Verifiers: ${it.verifiers_count} · Created: ${fmtDate(it.created_at)}
        </div>
      `;
      left.onclick = () => openIncidentDetail(it.incident_id);

      const right = document.createElement('div');
      const btnDetail = document.createElement('button');
      btnDetail.className = 'btn btn-secondary';
      btnDetail.textContent = 'Details';
      btnDetail.onclick = () => openIncidentDetail(it.incident_id);

      right.appendChild(btnDetail);
      row.appendChild(left);
      row.appendChild(right);
      verifyListEl.appendChild(row);
    }
  }

  async function loadVerifyQueue() {
    if (!currentUserId) {
      verifyListEl.innerHTML = '';
      verifyEmptyEl.hidden = false;
      verifyEmptyEl.textContent = 'Sign in to see your Verify Queue.';
      return;
    }
    const items = await fetchVerifyQueueForUser(currentUserId, 20);
    renderVerifyList(items);
  }

  // ---------- Incident Detail Modal ----------
  let _prevBodyOverflow = '';

  function lockBodyScroll() {
    _prevBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  function unlockBodyScroll() {
    document.body.style.overflow = _prevBodyOverflow || '';
  }

  function closeModal() {
    if (modalEl) {
      modalEl.hidden = true;
      modalEl.style.display = 'none';
    }
    falseForm.hidden = true;
    falseReason.value = '';
    btnTrue.disabled = btnIgnore.disabled = btnFalse.disabled = false;
    btnTrue.textContent = 'TRUE';
    unlockBodyScroll();
  }

  async function openIncidentDetail(incidentId) {
    if (!modalEl) return;

    // Force overlay look + center here (even if external CSS changes)
    modalEl.style.position = 'fixed';
    modalEl.style.inset = '0';
    modalEl.style.zIndex = '10000';
    modalEl.style.display = 'flex';
    modalEl.style.alignItems = 'center';
    modalEl.style.justifyContent = 'center';
    modalEl.style.padding = '24px';
    modalEl.style.boxSizing = 'border-box';

    modalEl.hidden = false;
    lockBodyScroll();

    modalBodyEl.innerHTML = `<div style="color:#bbb;">Loading incident #${incidentId}…</div>`;

    try {
      const { data, error } = await db.rpc('get_incident_detail', { p_incident_id: incidentId });
      if (error) { console.error('get_incident_detail error:', error); modalBodyEl.innerHTML = `<div style="color:#d88;">${escapeHtml(error.message || 'Failed to load incident')}</div>`; return; }
      const d = Array.isArray(data) ? data[0] : data;
      if (!d) { modalBodyEl.innerHTML = `<div style="color:#d88;">Incident not found.</div>`; return; }

      const header = `
        <div style="display:flex; flex-wrap:wrap; gap:8px; color:#eaeaea; font-weight:600;">
          Incident #${d.incident_id} · ${escapeHtml(d.community || 'Unspecified')}
        </div>
        <div style="color:#888; font-size:12px; margin-top:4px;">
          Status: ${escapeHtml(d.status)} · Created: ${fmtDate(d.created_at)} · Verifiers: ${d.verifiers_count}
        </div>
        <div style="color:#bbb; margin-top:6px;">
          Reported User: <code>${escapeHtml(d.reported_user_id || '')}</code>
          ${d.task_id ? ` · Task: <code>${d.task_id}</code>` : ''}
        </div>
        <hr style="border:0; border-top:1px solid #2b2640; margin:10px 0;">
      `;

      const reports = Array.isArray(d.reports) ? d.reports : [];
      const list = reports.map((r, idx) => `
        <div style="margin-bottom:10px;">
          <div style="color:#eaeaea; font-weight:600;">Report ${idx+1}</div>
          <div style="color:#888; font-size:12px;">Reporter: <code>${escapeHtml(r.reporter_user_id || '')}</code> · ${fmtDate(r.created_at)}</div>
          <div style="color:#ddd; margin-top:4px; white-space:pre-wrap;">${escapeHtml(r.reason || '')}</div>
          ${r.evidence_url ? `<div style="margin-top:4px;"><a href="${escapeHtml(r.evidence_url)}" target="_blank" class="link">Evidence</a></div>` : ''}
        </div>
      `).join('');

      modalBodyEl.innerHTML = header + (list || '<div style="color:#bbb;">No reports found.</div>');

      // Bind action buttons to this incident
      bindIncidentActions(d.incident_id);
    } catch (e) {
      console.error(e);
      modalBodyEl.innerHTML = `<div style="color:#d88;">Failed to load incident.</div>`;
    }
  }

  function bindIncidentActions(incidentId) {
    // TRUE = verify_incident
    btnTrue.onclick = async () => {
      btnTrue.disabled = true; btnTrue.textContent = 'Verifying…';
      try {
        const { data, error } = await db.rpc('verify_incident', {
          p_incident_id: incidentId,
          p_verifier_user_id: currentUserId
        });
        if (error) { console.error('verify_incident error:', error); showToast(error.message || 'Could not verify.', true); btnTrue.disabled = false; btnTrue.textContent = 'TRUE'; return; }
        showToast('Verified. Thank you!');
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast('Error verifying incident.', true);
        btnTrue.disabled = false; btnTrue.textContent = 'TRUE';
      }
    };

    // IGNORE = local hide (server persistence coming next)
    btnIgnore.onclick = async () => {
      ignoredSet.add(incidentId);
      localStorage.setItem(STORAGE_KEY_IGNORED, JSON.stringify(Array.from(ignoredSet)));
      showToast('Ignored. It won’t show here again on this device.');
      closeModal();
      await loadVerifyQueue();
    };

    // FALSE = show reason form; submit locally for now
    btnFalse.onclick = () => { falseForm.hidden = false; falseReason.focus(); };
    btnFalseCancel.onclick = () => { falseReason.value = ''; falseForm.hidden = true; };
    btnFalseSubmit.onclick = async () => {
      const reason = (falseReason.value || '').trim();
      if (reason.length < 5) { showToast('Add a brief reason for FALSE.', true); return; }
      falseSet.add(incidentId);
      localStorage.setItem(STORAGE_KEY_FALSE, JSON.stringify(Array.from(falseSet)));
      showToast('Marked as FALSE (local). We’ll record this server-side next.');
      closeModal();
      await loadVerifyQueue();
    };
  }

  // ---------- Deep-link support: policing.html?incident=123 or #incident=123 ----------
  function getIncidentFromURL() {
    const url = new URL(window.location.href);
    const q = url.searchParams.get('incident');
    if (q) return q;
    // Also support hash: #incident=123
    if (url.hash && url.hash.startsWith('#incident=')) return url.hash.split('=').pop();
    return null;
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    db = getSupabaseClient();
    if (!db) { console.error('[Policing] No Supabase client found.'); showToast('Internal error: Supabase not initialized.', true); return; }

    await loadCommunities();
    communityEl?.addEventListener('change', handleCommunityChange);
    userSelectEl?.addEventListener('change', handleUserChange);
    submitBtn?.addEventListener('click', handleSubmit);
    modalCloseEl?.addEventListener('click', closeModal);

    // Load current user then the queue
    currentUserId = await getCurrentUserId();
    await loadVerifyQueue();

    // If we arrived via a notification deep-link, open it
    const incidentParam = getIncidentFromURL();
    if (incidentParam) {
      const idNum = Number(incidentParam);
      if (Number.isFinite(idNum)) openIncidentDetail(idNum);
    }
  });
})();
