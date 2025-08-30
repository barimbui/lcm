// policing.js — report flow + verify queue + incident detail modal
// Exposes window.openIncidentById ASAP and coerces incident ids to bigint where needed.

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  // ---- helpers
  const toNumMaybe = (v) => (v == null ? v : (/^\d+$/.test(String(v)) ? Number(v) : v));

  function getSupabaseClient() {
    const candidates = [window.supabaseClient, window.sb, window.client, window.db, window.SUPABASE, window.supabase].filter(Boolean);
    for (const c of candidates) if (typeof c?.from === 'function' && c?.auth) return c;
    return null;
  }

  // ---------- Elements (Report Misconduct)
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

  // ---------- Elements (Verify Queue + Modal)
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

  const STORAGE_KEY_IGNORED = 'police_ignored_incidents';
  const STORAGE_KEY_FALSE   = 'police_false_incidents';
  const ignoredSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_IGNORED) || '[]'));
  const falseSet   = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_FALSE) || '[]'));

  function showToast(message, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.borderColor = isError ? '#d33' : '#5a2ca0';
    toastEl.style.background = isError ? 'rgba(211,51,51,0.15)' : 'rgba(90,44,160,0.15)';
    setTimeout(() => { if (!isError) toastEl.hidden = true; }, isError ? 6000 : 3000);
  }

  function setLoading(state) {
    if (!submitBtn) return;
    submitBtn.disabled = state;
    submitBtn.textContent = state ? 'Submitting…' : 'Submit Report';
  }

  function escapeHtml(str) {
    return String(str || '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
  }

  function parseTaskIdOrNull(raw) {
    const t = (raw || '').trim();
    if (!t) return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }

  function fmtDate(iso) { try { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); } catch { return ''; } }

  async function getCurrentUserId() {
    try { const { data, error } = await db.auth.getUser(); return (error || !data?.user?.id) ? null : data.user.id; }
    catch { return null; }
  }

  function getIncidentFromURLIfNotif() {
    try {
      const url = new URL(window.location.href);
      const inc = url.searchParams.get('incident');
      const src = (url.searchParams.get('src') || '').toLowerCase();
      if (inc && src === 'notif') return toNumMaybe(inc);
    } catch {}
    return null;
  }

  function isUUID(v) { return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v); }

  function reloadIfClosedFromRPC(rpcResult) {
    try {
      const row = Array.isArray(rpcResult?.data) ? rpcResult.data[0] : null;
      if (row?.closed === true) {
        showToast(`Incident closed (${row.status}).`);
        closeModal();
        loadVerifyQueue();
        return true;
      }
    } catch {}
    return false;
  }

  async function rpcVerdict(incidentId, verdict, reason = null) {
    const pid = toNumMaybe(incidentId);
    const { data, error } = await db.rpc('submit_incident_verdict', {
      p_incident_id: pid,
      p_verdict: verdict,
      p_reason: reason ?? null
    });
    if (error) throw error;
    return { data };
  }

  async function rpcResolution(incidentId, action, textOrReason = null, isReason = false) {
    const pid = toNumMaybe(incidentId);
    const payload = {
      p_incident_id: pid,
      p_action: action,
      p_text: isReason ? null : (textOrReason ?? null),
      p_reason: isReason ? (textOrReason ?? null) : null
    };
    const { data, error } = await db.rpc('submit_incident_resolution', payload);
    if (error) throw error;
    return { data };
  }

  // ---------- Modal controls ----------
  let _prevBodyOverflow = '';

  function lockBodyScroll() { _prevBodyOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'; }
  function unlockBodyScroll() { document.body.style.overflow = _prevBodyOverflow || ''; }

  function closeModal() {
    if (modalEl) { modalEl.hidden = true; modalEl.style.display = 'none'; }
    if (falseForm) falseForm.hidden = true;
    if (falseReason) falseReason.value = '';
    if (btnTrue)   { btnTrue.disabled   = false; btnTrue.textContent = 'TRUE'; }
    if (btnIgnore) { btnIgnore.disabled = false; }
    if (btnFalse)  { btnFalse.disabled  = false; }
    unlockBodyScroll();
  }

  async function openIncidentDetail(incidentId) {
    if (!modalEl || !modalBodyEl) return;

    // Base modal style & show
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

    const pid = toNumMaybe(incidentId);
    modalBodyEl.innerHTML = `<div style="color:#bbb;">Loading incident #${escapeHtml(pid)}…</div>`;
    console.log('[policing] openIncidentDetail → p_incident_id =', pid, typeof pid);

    const tryLoad = async (attempt = 0) => {
      if (!db) {
        if (attempt < 30) { return setTimeout(() => tryLoad(attempt + 1), 200); }
        modalBodyEl.innerHTML = `<div style="color:#d88;">Supabase not initialized. Try reloading the page.</div>`;
        return;
      }

      try {
        const { data, error } = await db.rpc('get_incident_detail', { p_incident_id: pid });
        if (error) {
          console.error('[policing] get_incident_detail error:', error);
          modalBodyEl.innerHTML = `<div style="color:#d88;">${escapeHtml(error.message || 'Failed to load incident')}</div>`;
          return;
        }
        const d = Array.isArray(data) ? data[0] : data;
        if (!d) { modalBodyEl.innerHTML = `<div style="color:#d88;">Incident not found.</div>`; return; }

        const header = `
          <div style="display:flex; flex-wrap:wrap; gap:8px; color:#eaeaea; font-weight:600;">
            Incident #${d.incident_id} · ${escapeHtml(d.community || 'Unspecified')}
            <span id="resolution-chip" style="display:none; background:#2b2640; color:#b7a9ff; padding:2px 8px; border-radius:999px; font-size:12px;"></span>
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

        // Action area
        const controls = document.createElement('div');
        controls.id = 'resolution-controls';
        controls.style.marginTop = '10px';
        modalBodyEl.appendChild(controls);

        injectResolutionUI(d.incident_id, d);
        bindIncidentActions(d.incident_id);
      } catch (e) {
        console.error('[policing] get_incident_detail exception:', e);
        modalBodyEl.innerHTML = `<div style="color:#d88;">Failed to load incident.</div>`;
      }
    };

    tryLoad(0);
  }

  // Expose to window early
  function exposeGlobals() {
    window.openIncidentById   = (id) => openIncidentDetail(id);
    window.closeIncidentModal = () => closeModal();
    console.log('[policing] openIncidentById exposed:', typeof window.openIncidentById);
  }
  exposeGlobals();

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
      if (error) return { ok: false, users: [], err: error.message || String(error) };
      const users = (data || []).map(r => ({ id: r.user_id, name: r.display_name || '' }));
      return { ok: true, users };
    } catch (e) {
      return { ok: false, users: [], err: e.message || String(e) };
    }
  }

  function fillUserSelect(users) {
    if (!userSelectEl) return;
    const options = ['<option value="" selected disabled>Select a user…</option>'];
    for (const u of users) {
      const safeName = escapeHtml(u.name || '(unnamed)');
      const dataAttr = u.id ? ` data-userid="${u.id}"` : '';
      options.push(`<option value="${safeName}"${dataAttr}>${safeName}</option>`);
    }
    userSelectEl.innerHTML = options.join('');
    userSelectEl.disabled = users.length === 0;
    if (userFallbackWrap) userFallbackWrap.hidden = users.length !== 0;
  }

  async function fetchTasksForUser(userId) {
    try {
      const { data, error } = await db
        .from('tasks')
        .select('id, task_description, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) return [];
      return (data || []).map(t => ({ id: t.id, label: t.task_description ? `${t.task_description} (ID: ${t.id})` : `Task #${t.id}` }));
    } catch { return []; }
  }

  function fillTaskSelect(tasks) {
    if (!taskSelectEl) return;
    const options = ['<option value="">General incident (no specific task)</option>']
      .concat(tasks.map(t => `<option value="${t.id}">${escapeHtml(t.label)}</option>`));
    taskSelectEl.innerHTML = options.join('');
    taskSelectEl.disabled = false;
    if (taskFallbackWrap) taskFallbackWrap.hidden = tasks.length !== 0;
  }

  async function handleCommunityChange() {
    const comm = (communityEl?.value || '').trim();

    if (userSelectEl) { userSelectEl.innerHTML = '<option value="" selected disabled>Select a user…</option>'; userSelectEl.disabled = true; }
    if (userFallbackWrap) userFallbackWrap.hidden = true;
    if (userFallbackInput) userFallbackInput.value = '';

    if (taskSelectEl) { taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>'; taskSelectEl.disabled = true; }
    if (taskFallbackWrap) taskFallbackWrap.hidden = true;
    if (taskFallbackInput) taskFallbackInput.value = '';

    if (!comm) return;

    const { ok, users, err } = await fetchUsersByCommunity(comm);
    if (!ok) {
      fillUserSelect([]);
      if (userFallbackWrap) userFallbackWrap.hidden = false;
      showToast(`Could not load users for ${comm}. Paste user UUID instead.`, true);
      return;
    }

    fillUserSelect(users);
    if (users.length === 0) {
      if (userFallbackWrap) userFallbackWrap.hidden = false;
      showToast(`No users found for ${comm}. Paste user UUID.`, true);
    }
  }

  async function handleUserChange() {
    if (!userSelectEl) return;
    const opt = userSelectEl.options[userSelectEl.selectedIndex];
    const userIdFromOption = opt && opt.dataset ? opt.dataset.userid : null;

    if (taskSelectEl) { taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>'; taskSelectEl.disabled = true; }
    if (taskFallbackWrap) taskFallbackWrap.hidden = true;
    if (taskFallbackInput) taskFallbackInput.value = '';

    if (!userIdFromOption) { if (userFallbackWrap) userFallbackWrap.hidden = false; return; }

    if (userFallbackWrap) userFallbackWrap.hidden = true;
    const tasks = await fetchTasksForUser(userIdFromOption);
    fillTaskSelect(tasks);
  }

  function getSelectedReportedUserId() {
    if (!userSelectEl) return null;
    const opt = userSelectEl.options[userSelectEl.selectedIndex];
    if (opt && opt.dataset && opt.dataset.userid) { if (userFallbackWrap) userFallbackWrap.hidden = true; return opt.dataset.userid; }
    if (userFallbackWrap) userFallbackWrap.hidden = false;
    const pasted = (userFallbackInput?.value || '').trim();
    return pasted || null;
  }

  function getSelectedTaskIdOrNull() {
    const fromSelect = (taskSelectEl?.value || '').trim();
    if (fromSelect) return parseTaskIdOrNull(fromSelect);
    return parseTaskIdOrNull(taskFallbackInput?.value);
  }

  function validateUrlMaybe(url) { if (!url) return true; try { const u = new URL(url); return !!u.protocol && !!u.host; } catch { return false; } }

  async function handleSubmit(e) {
    e?.preventDefault?.();

    const reporterId = await getCurrentUserId();
    if (!reporterId) { showToast('Please sign in to submit a report.', true); return; }

    const community = (communityEl?.value || '').trim();
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
      if (error) { showToast(error.message || 'Could not submit report.', true); return; }

      const row = Array.isArray(data) ? data[0] : data;
      const incId = row?.incident_id ?? '(unknown)';
      const first = row?.is_first_report ? ' You are the first reporter.' : '';
      showToast(`Report submitted. Incident #${incId} created/updated.${first}`);

      if (userSelectEl) { userSelectEl.selectedIndex = 0; userSelectEl.disabled = true; }
      if (userFallbackInput) { userFallbackInput.value = ''; if (userFallbackWrap) userFallbackWrap.hidden = true; }
      if (taskSelectEl) { taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>'; taskSelectEl.disabled = true; }
      if (taskFallbackInput) taskFallbackInput.value = '';
      if (taskFallbackWrap) taskFallbackWrap.hidden = true;
      if (reasonEl) reasonEl.value = '';
      if (evidenceEl) evidenceEl.value = '';

      await loadVerifyQueue();
    } catch (err) {
      showToast('Something went wrong submitting the report.', true);
    } finally {
      setLoading(false);
    }
  }

  // ---------- Verify Queue ----------
  async function fetchVerifyQueueForUser(userId, limit = 20) {
    try {
      const { data, error } = await db.rpc('get_verify_queue', { p_user_id: userId, p_limit: limit });
      if (error) return [];
      return Array.isArray(data) ? data : [];
    } catch { return []; }
  }

  function renderVerifyList(items) {
    if (!verifyListEl || !verifyEmptyEl) return;

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
    if (!verifyListEl || !verifyEmptyEl) return;
    if (!currentUserId) {
      verifyListEl.innerHTML = '';
      verifyEmptyEl.hidden = false;
      verifyEmptyEl.textContent = 'Sign in to see your Verify Queue.';
      return;
    }
    const items = await fetchVerifyQueueForUser(currentUserId, 20);
    renderVerifyList(items);
  }

  // ---------- ACTION BUTTONS (added back) ----------
  // Binds TRUE / IGNORE / FALSE buttons for a specific incident
  function bindIncidentActions(incidentId) {
    if (!btnTrue || !btnIgnore || !btnFalse || !falseForm || !falseReason || !btnFalseCancel || !btnFalseSubmit) {
      console.warn('[policing] action buttons missing in DOM');
      return;
    }

    // TRUE → submit_incident_verdict('TRUE')
    btnTrue.onclick = async () => {
      btnTrue.disabled = true; btnTrue.textContent = 'Verifying…';
      try {
        const result = await rpcVerdict(incidentId, 'TRUE');
        if (reloadIfClosedFromRPC(result)) return;
        showToast('Verified. Thank you!');
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not verify.', true);
        btnTrue.disabled = false; btnTrue.textContent = 'TRUE';
      }
    };

    // IGNORE → record server-side and hide locally
    btnIgnore.onclick = async () => {
      btnIgnore.disabled = true;
      try {
        const result = await rpcVerdict(incidentId, 'IGNORE');
        ignoredSet.add(incidentId);
        localStorage.setItem(STORAGE_KEY_IGNORED, JSON.stringify(Array.from(ignoredSet)));
        if (!reloadIfClosedFromRPC(result)) {
          showToast('Ignored. It won’t show here again on this device.');
        }
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not ignore.', true);
      } finally {
        btnIgnore.disabled = false;
      }
    };

    // FALSE flow
    btnFalse.onclick = () => { falseForm.hidden = false; falseReason.focus(); };
    btnFalseCancel.onclick = () => { falseReason.value = ''; falseForm.hidden = true; };

    btnFalseSubmit.onclick = async () => {
      const reason = (falseReason.value || '').trim();
      if (reason.length < 5) { showToast('Add a brief reason for FALSE.', true); return; }
      btnFalseSubmit.disabled = true; btnFalseSubmit.textContent = 'Submitting…';
      try {
        const result = await rpcVerdict(incidentId, 'FALSE', reason);
        falseSet.add(incidentId);
        localStorage.setItem(STORAGE_KEY_FALSE, JSON.stringify(Array.from(falseSet)));
        if (!reloadIfClosedFromRPC(result)) {
          showToast('Marked as FALSE. Thank you!');
        }
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not submit FALSE.', true);
      } finally {
        btnFalseSubmit.disabled = false; btnFalseSubmit.textContent = 'Submit FALSE';
      }
    };
  }

  // ---------- Resolution UI ----------
  function requiredConfirmsForCommunity(comm) { return (String(comm || '').toUpperCase() === 'HOME') ? 1 : 5; }

  function renderChip(text, color = '#b7a9ff') {
    const chip = $('#resolution-chip');
    if (!chip) return;
    if (!text) { chip.style.display = 'none'; chip.textContent = ''; return; }
    chip.style.display = 'inline-block';
    chip.style.color = color;
    chip.textContent = text;
  }

  async function fetchResolutionState(incidentId) {
    if (!isUUID(String(incidentId))) return null;

    const { data: resRows, error: resErr } = await db
      .from('incident_resolutions')
      .select('id,status,resolution_text,created_at,verified_at,rejected_at')
      .eq('incident_id', incidentId)
      .order('created_at', { ascending: false })
      .limit(1);

    if (resErr) return null;

    const resolution = Array.isArray(resRows) ? resRows[0] : null;
    if (!resolution) return null;

    const { data: votes, error: vErr } = await db
      .from('incident_resolution_votes')
      .select('user_id,vote,created_at')
      .eq('resolution_id', resolution.id);

    if (vErr) return { resolution, confirmCount: 0, declineCount: 0, userVote: null };

    let confirmCount = 0, declineCount = 0, userVote = null;
    for (const v of votes || []) {
      if (v.vote === 'CONFIRM') confirmCount++;
      if (v.vote === 'DECLINE') declineCount++;
      if (!userVote && v.user_id === currentUserId) userVote = v.vote;
    }
    return { resolution, confirmCount, declineCount, userVote };
  }

  function makeSmallBtn(txt) {
    const b = document.createElement('button');
    b.className = 'btn btn-secondary';
    b.style.padding = '6px 10px';
    b.style.fontSize = '12px';
    b.textContent = txt;
    return b;
  }

  function makePill(text) {
    const s = document.createElement('span');
    s.style.display = 'inline-block';
    s.style.background = '#221c38';
    s.style.border = '1px solid #372c62';
    s.style.borderRadius = '999px';
    s.style.fontSize = '12px';
    s.style.color = '#d7cdfc';
    s.style.padding = '2px 8px';
    s.style.marginLeft = '6px';
    s.textContent = text;
    return s;
  }

  function makeCounter(label, value) {
    const x = document.createElement('span');
    x.style.display = 'inline-block';
    x.style.background = '#1f2a33';
    x.style.borderRadius = '6px';
    x.style.padding = '2px 6px';
    x.style.marginLeft = '6px';
    x.style.fontSize = '12px';
    x.style.color = '#cfe9ff';
    x.textContent = `${label}: ${value}`;
    return x;
  }

  function makeComposer(incidentId) {
    const box = document.createElement('div');
    box.style.border = '1px solid #2b2640';
    box.style.borderRadius = '10px';
    box.style.padding = '10px';
    box.style.marginTop = '8px';
    box.style.background = '#17132a';

    const label = document.createElement('div');
    label.style.color = '#eaeaea';
    label.style.fontWeight = '600';
    label.textContent = 'Describe how you resolved the issue:';

    const ta = document.createElement('textarea');
    ta.rows = 4;
    ta.style.width = '100%';
    ta.style.marginTop = '8px';
    ta.style.resize = 'vertical';
    ta.placeholder = 'E.g., I apologized to X in the group chat on YYYY-MM-DD and removed the offending comment.';
    const counter = document.createElement('div');
    counter.style.textAlign = 'right';
    counter.style.color = '#9aa3b2';
    counter.style.fontSize = '12px';
    counter.textContent = '0 / 600';

    ta.addEventListener('input', () => {
      const n = (ta.value || '').length;
      counter.textContent = `${n} / 600`;
      counter.style.color = n > 600 ? '#d88' : '#9aa3b2';
    });

    const bar = document.createElement('div');
    bar.style.display = 'flex';
    bar.style.gap = '8px';
    bar.style.marginTop = '8px';
    const submit = document.createElement('button');
    submit.className = 'btn btn-primary';
    submit.textContent = 'Submit Resolution';
    const cancel = makeSmallBtn('Cancel');

    submit.onclick = async () => {
      const text = (ta.value || '').trim();
      if (text.length < 10) { showToast('Please add a bit more detail about how you resolved it.', true); return; }
      if (text.length > 600) { showToast('Resolution is too long (max 600 chars).', true); return; }

      const pid = toNumMaybe(incidentId);
      if (!isUUID(String(pid))) { showToast('Resolution flow is not available for this incident id format.', true); return; }

      try {
        submit.disabled = true; submit.textContent = 'Submitting…';
        await rpcResolution(pid, 'PROPOSE', text, false);
        showToast('Resolution submitted for community confirmation.');
        injectResolutionUI(pid); // refresh
      } catch (e) {
        showToast(e.message || 'Could not submit resolution.', true);
      } finally {
        submit.disabled = false; submit.textContent = 'Submit Resolution';
      }
    };

    cancel.onclick = () => { box.remove(); };

    bar.appendChild(submit);
    bar.appendChild(cancel);
    box.appendChild(label);
    box.appendChild(ta);
    box.appendChild(counter);
    box.appendChild(bar);
    return box;
  }

  async function injectResolutionUI(incidentId, incidentData) {
    const wrap = document.getElementById('resolution-controls');
    if (!wrap) return;
    wrap.innerHTML = '';

    let d = incidentData;
    if (!d) {
      const pid = toNumMaybe(incidentId);
      const { data } = await db.rpc('get_incident_detail', { p_incident_id: pid });
      d = Array.isArray(data) ? data[0] : data;
    }
    if (!d) return;

    const status = String(d.status || '');
    const isClosed = status.startsWith('closed');
    const isReportedUser = currentUserId && (currentUserId === d.reported_user_id);
    const req = requiredConfirmsForCommunity(d.community);

    let state = null;
    if (isUUID(String(incidentId))) {
      state = await (async () => {
        try { return await fetchResolutionState(incidentId); } catch { return null; }
      })();
    }

    const hasPending = !!(state && state.resolution && state.resolution.status === 'pending');

    if (hasPending) renderChip('Pending Resolution');
    else if (status === 'closed_resolved') renderChip('Resolved ✓', '#9ee49e');
    else renderChip('');

    if (isReportedUser && !isClosed && !hasPending && isUUID(String(incidentId))) {
      const btnResolve = document.createElement('button');
      btnResolve.className = 'btn btn-primary';
      btnResolve.textContent = 'Resolve';
      btnResolve.onclick = () => {
        if (!document.getElementById('resolution-composer')) {
          const composer = makeComposer(incidentId);
          composer.id = 'resolution-composer';
          wrap.appendChild(composer);
        }
      };
      wrap.appendChild(btnResolve);
    }

    if (state && state.resolution) {
      const r = state.resolution;

      const box = document.createElement('div');
      box.style.border = '1px solid #2b2640';
      box.style.borderRadius = '10px';
      box.style.padding = '10px';
      box.style.marginTop = '8px';
      box.style.background = '#141026';

      const top = document.createElement('div');
      top.style.display = 'flex';
      top.style.flexWrap = 'wrap';
      top.style.gap = '8px';
      top.style.alignItems = 'center';

      const title = document.createElement('div');
      title.style.color = '#eaeaea';
      title.style.fontWeight = '600';
      title.textContent =
        (r.status === 'pending')  ? 'Resolution (pending review)' :
        (r.status === 'verified') ? 'Resolution (verified)' :
        (r.status === 'rejected') ? 'Resolution (rejected)' : 'Resolution';

      const desc = document.createElement('div');
      desc.style.whiteSpace = 'pre-wrap';
      desc.style.color = '#ddd';
      desc.style.marginTop = '6px';
      desc.textContent = r.resolution_text || '';

      const meta = document.createElement('div');
      meta.style.color = '#9aa3b2';
      meta.style.fontSize = '12px';
      meta.style.marginTop = '6px';
      meta.textContent = `Created: ${fmtDate(r.created_at)}${r.verified_at ? ' · Verified: '+fmtDate(r.verified_at) : ''}${r.rejected_at ? ' · Rejected: '+fmtDate(r.rejected_at) : ''}`;

      top.appendChild(title);

      const counters = document.createElement('div');
      counters.style.marginLeft = 'auto';
      counters.appendChild(makeCounter('CONFIRM', state.confirmCount));
      counters.appendChild(makeCounter('DECLINE', state.declineCount));
      counters.appendChild(makePill(`Need ${req} CONFIRM`));
      top.appendChild(counters);

      box.appendChild(top);
      box.appendChild(desc);
      box.appendChild(meta);

      if (r.status === 'pending') {
        const bar = document.createElement('div');
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.style.marginTop = '8px';

        const btnC = makeSmallBtn('CONFIRM');
        const btnD = makeSmallBtn('DECLINE');

        if (state.userVote === 'CONFIRM') { btnC.style.background = '#294a2f'; btnC.style.borderColor = '#3f7b49'; }
        else if (state.userVote === 'DECLINE') { btnD.style.background = '#4a2b2b'; btnD.style.borderColor = '#7b3f3f'; }

        btnC.onclick = async () => {
          try {
            btnC.disabled = true; btnD.disabled = true; btnC.textContent = 'Working…';
            const result = await rpcResolution(incidentId, 'CONFIRM', 'confirmed', true);
            if (reloadIfClosedFromRPC(result)) return;
            showToast('Resolution confirmed.');
          } catch (e) {
            showToast(e.message || 'Could not confirm.', true);
          } finally {
            btnC.disabled = false; btnD.disabled = false; btnC.textContent = 'CONFIRM';
            injectResolutionUI(incidentId);
          }
        };

        btnD.onclick = async () => {
          const why = prompt('Optional: why decline?') || '';
          try {
            btnC.disabled = true; btnD.disabled = true; btnD.textContent = 'Working…';
            await rpcResolution(incidentId, 'DECLINE', why.trim() || null, true);
            showToast('Resolution vote recorded.');
          } catch (e) {
            showToast(e.message || 'Could not decline.', true);
          } finally {
            btnC.disabled = false; btnD.disabled = false; btnD.textContent = 'DECLINE';
            injectResolutionUI(incidentId);
          }
        };

        bar.appendChild(btnC);
        bar.appendChild(btnD);
        box.appendChild(bar);
      }

      wrap.appendChild(box);
    }
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    db = getSupabaseClient();

    if (db) {
      currentUserId = await getCurrentUserId();
      await loadVerifyQueue();
    } else {
      setTimeout(async () => {
        db = getSupabaseClient();
        if (db) {
          currentUserId = await getCurrentUserId();
          await loadVerifyQueue();
        }
      }, 200);
    }

    await loadCommunities();
    communityEl?.addEventListener('change', handleCommunityChange);
    userSelectEl?.addEventListener('change', handleUserChange);
    submitBtn?.addEventListener('click', handleSubmit);
    modalCloseEl?.addEventListener('click', closeModal);

    const incFromNotif = getIncidentFromURLIfNotif();
    if (incFromNotif != null) {
      setTimeout(() => { try { window.openIncidentById(incFromNotif); } catch {} }, 50);
    }
  });
})();
