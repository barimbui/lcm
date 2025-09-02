// policing.js — report flow + verify queue + incident detail modal
// Uses 2-arg state RPC (avoids PGRST203). Strong submit wiring, visible error alerts, force-close on success.

(function () {
  const $ = (sel) => document.querySelector(sel);

  // ---------- Supabase client ----------
  function getSupabaseClient() {
    const candidates = [
      window.supabaseClient, window.sb, window.client, window.db,
      window.SUPABASE, window.supabase
    ].filter(Boolean);
    for (const c of candidates) if (typeof c?.from === 'function' && c?.auth) return c;
    return null;
  }

  // ---------- Elements ----------
  const communityEl      = $('#police-community-select');
  const userSelectEl     = $('#police-reported-user-select');
  const userFallbackWrap = $('#police-reported-user-fallback');
  const userFallbackInput= $('#police-reported-user');

  const taskSelectEl     = $('#police-task-select');
  const taskFallbackWrap = $('#police-task-fallback');
  const taskFallbackInput= $('#police-task-id');

  const reasonEl         = $('#police-reason');
  const evidenceEl       = $('#police-evidence');
  const submitBtn        = $('#police-submit');
  const toastEl          = $('#police-toast');

  const verifyListEl     = $('#verify-list');
  const verifyEmptyEl    = $('#verify-empty');

  const modalEl          = $('#incident-modal');
  const modalBodyEl      = $('#incident-body');
  const modalCloseEl     = $('#incident-close');

  const btnTrue          = $('#btn-true');
  const btnIgnore        = $('#btn-ignore');
  const btnFalse         = $('#btn-false');
  const falseForm        = $('#false-form');
  const falseReason      = $('#false-reason');
  const btnFalseCancel   = $('#btn-false-cancel');
  const btnFalseSubmit   = $('#btn-false-submit');

  const DEFAULT_COMMUNITIES = ['HOME', 'SCHOOL', 'CHURCH', 'WORK', 'TEAM'];

  let db = null;
  let currentUserId = null;

  // Local store (UX sugar)
  const STORAGE_KEY_IGNORED = 'police_ignored_incidents';
  const STORAGE_KEY_FALSE   = 'police_false_incidents';
  const ignoredSet = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_IGNORED) || '[]'));
  const falseSet   = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY_FALSE) || '[]'));

  // ---------- helpers ----------
  function showToast(message, isError = false) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.hidden = false;
    toastEl.style.borderColor = isError ? '#d33' : '#5a2ca0';
    toastEl.style.background  = isError ? 'rgba(211,51,51,0.15)' : 'rgba(90,44,160,0.15)';
    // pin above modal just in case
    toastEl.style.position = 'fixed';
    toastEl.style.right = '16px';
    toastEl.style.bottom = '16px';
    toastEl.style.zIndex = 20001;
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
    try { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString(); }
    catch { return ''; }
  }

  async function getCurrentUserId() {
    try {
      const { data, error } = await db.auth.getUser();
      if (error || !data?.user?.id) return null;
      return data.user.id;
    } catch { return null; }
  }

  // Deep-link reader (from notifications)
  function getIncidentFromURLIfNotif() {
    try {
      const url = new URL(window.location.href);
      const inc = url.searchParams.get('incident');
      const src = (url.searchParams.get('src') || '').toLowerCase();
      if (inc && src === 'notif') return /^\d+$/.test(String(inc)) ? Number(inc) : inc;
    } catch {}
    return null;
  }

  function exposeGlobals() {
    window.openIncidentById = (id) => openIncidentDetail(id);
    window.closeIncidentModal = () => closeModal();
    console.log('[policing] openIncidentById exposed:', typeof window.openIncidentById);
  }

  // ---------- RPC wrappers ----------
  async function rpcVerdict(incidentId, verdict, reason = null) {
    const { data, error, status } = await db.rpc('submit_incident_verdict', {
      p_incident_id: incidentId, p_verdict: verdict, p_reason: reason ?? null
    });
    if (error) { console.warn('[verdict RPC ERR]', status, error); throw decorate(error, status); }
    return { data };
  }

  function decorate(error, status) {
    const e = new Error(error?.message || 'RPC error');
    e.code = error?.code; e.details = error?.details; e.hint = error?.hint; e.status = status;
    return e;
  }

  async function rpcResolution(incidentId, action, textOrReason = null, isReason = false) {
    const payload = {
      p_incident_id: incidentId,
      p_action: action,
      p_text: isReason ? null : (textOrReason ?? null),
      p_reason: isReason ? (textOrReason ?? null) : null
    };
    const call = db.rpc('submit_incident_resolution', payload);
    // 12s client-side timeout so the button never spins forever
    const { data, error, status } = await Promise.race([
      call,
      new Promise((_, rej) => setTimeout(
        () => rej(Object.assign(new Error('Client timeout after 12s'), { code: 'TIMEOUT', status: 0 })), 12000))
    ]);
    if (error) { console.warn('[resolution RPC ERR]', status, error); throw decorate(error, status); }
    return { data };
  }

  // Use the 2-arg helper RPC to avoid PGRST203 ambiguity
  async function getResolutionState(incidentId) {
    const uid = window.__currentUserId || null;
    const args = { p_incident_id: incidentId, p_user_id: uid };
    const { data, error, status } = await db.rpc('get_incident_resolution_state', args);
    if (error) { console.warn('[state RPC ERR]', status, error); return null; }
    return data || null;
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
      if (error) { console.error('fetchUsersByCommunity error:', error); return { ok:false, users:[], err:error.message }; }
      const users = (data || []).map(r => ({ id: r.user_id, name: r.display_name || '' }));
      return { ok: true, users };
    } catch (e) { console.error(e); return { ok:false, users:[], err:String(e) }; }
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
        id: t.id, label: t.task_description ? `${t.task_description} (ID: ${t.id})` : `Task #${t.id}`
      }));
    } catch (e) { console.error(e); return []; }
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
      userFallbackWrap.hidden = false;            // <-- fixed typo here
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

      if (userSelectEl) userSelectEl.selectedIndex = 0, userSelectEl.disabled = true;
      if (userFallbackInput) userFallbackInput.value = '', userFallbackWrap.hidden = true;
      taskSelectEl.innerHTML = '<option value="">General incident (no specific task)</option>';
      taskSelectEl.disabled = true;
      taskFallbackInput.value = '';
      taskFallbackWrap.hidden = true;
      reasonEl.value = '';
      evidenceEl.value = '';

      await loadVerifyQueue();
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
    } catch (e) { console.error('get_verify_queue exception:', e); return []; }
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
    if (!currentUserId) {
      verifyListEl.innerHTML = '';
      verifyEmptyEl.hidden = false;
      verifyEmptyEl.textContent = 'Sign in to see your Verify Queue.';
      return;
    }
    const items = await fetchVerifyQueueForUser(currentUserId, 20);
    renderVerifyList(items);
  }

  // ---------- Modal ----------
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
    if (falseForm) { falseForm.hidden = true; }
    if (falseReason) { falseReason.value = ''; }
    if (btnTrue && btnIgnore && btnFalse) {
      btnTrue.disabled = btnIgnore.disabled = btnFalse.disabled = false;
      btnTrue.textContent = 'TRUE';
    }
    unlockBodyScroll();
  }

  function requiredConfirmsForCommunity(comm) {
    return (String(comm || '').toUpperCase() === 'HOME') ? 1 : 5;
  }

  function renderChip(text, color='#b7a9ff') {
    const chip = document.getElementById('resolution-chip');
    if (!chip) return;
    if (!text) { chip.style.display = 'none'; chip.textContent = ''; return; }
    chip.style.display = 'inline-block';
    chip.style.color = color;
    chip.textContent = text;
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

  // Composer (visible alerts on error; close modal on success + safety re-close)
  function makeComposer(incidentId) {
    const box = document.createElement('div');
    box.id = 'resolution-composer';
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
    ta.placeholder = 'E.g., I apologized to X on YYYY-MM-DD and removed the offending comment.';

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

    submit.onclick = async (e) => {
      e.preventDefault();
      const text = (ta.value || '').trim();
      if (text.length < 10) { showToast('Please add a bit more detail (≥ 10 chars).', true); return; }
      if (text.length > 600) { showToast('Resolution is too long (max 600).', true); return; }

      const prev = submit.textContent;
      submit.disabled = true;
      submit.textContent = 'Submitting…';

      try {
        await rpcResolution(incidentId, 'PROPOSE', text, false);
        showToast('Resolution submitted for community confirmation.');
        closeModal(); // close on success
        // safety: force-close again on next tick in case styles were stuck
        setTimeout(() => { try { closeModal(); } catch {} }, 0);
      } catch (e2) {
        console.error('[Submit Resolution] error:', e2);
        alert(`${e2.code ? e2.code + ' ' : ''}${e2.status ? '['+e2.status+'] ' : ''}${e2.message || 'Resolution failed.'}${e2.details ? '\n' + e2.details : ''}`);
        showToast(e2.message || 'Could not submit resolution.', true);
      } finally {
        submit.disabled = false;
        submit.textContent = prev;
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

  // Main injector (uses RPC state, hides verifier buttons for reported user)
  async function injectResolutionUI(incidentId, incidentData) {
    const wrap = document.getElementById('resolution-controls');
    if (!wrap) return;
    wrap.innerHTML = '';

    // Ensure we have incident data
    let d = incidentData;
    if (!d) {
      const { data } = await db.rpc('get_incident_detail', { p_incident_id: incidentId });
      d = Array.isArray(data) ? data[0] : data;
    }
    if (!d) return;

    const status = String(d.status || '');
    const isClosed = status.toUpperCase().startsWith('CLOSED') || status.toUpperCase() === 'RESOLVED';
    const isReportedUser = currentUserId && (currentUserId === d.reported_user_id);
    const req = (String(d.community||'').toUpperCase()==='HOME') ? 1 : 5;

    // Toggle verifier buttons
    if (isReportedUser) {
      if (btnTrue)   btnTrue.style.display = 'none';
      if (btnIgnore) btnIgnore.style.display = 'none';
      if (btnFalse)  btnFalse.style.display = 'none';
    } else {
      if (btnTrue)   btnTrue.style.display = '';
      if (btnIgnore) btnIgnore.style.display = '';
      if (btnFalse)  btnFalse.style.display = '';
    }

    // Current resolution state via RPC
    const state = await getResolutionState(incidentId);
    const hasPending = !!(state && state.resolution && state.resolution.status === 'pending');

    // CHIP
    if (hasPending) renderChip('Pending Resolution');
    else if (status.toUpperCase() === 'RESOLVED') renderChip('Resolved ✓', '#9ee49e');
    else renderChip('');

    // Reported user: show Resolve / Accept when no pending + not closed
    if (isReportedUser && !isClosed && !hasPending) {
      const banner = document.createElement('div');
      banner.style.margin = '8px 0';
      banner.style.color  = '#c8d3e1';
      banner.textContent  = 'You are the reported person for this incident. If it was verified, 2 normal credits may have been deducted. Submitting a resolution and getting it confirmed will restore 1 normal credit.';
      wrap.appendChild(banner);

      const bar = document.createElement('div');
      bar.style.display = 'flex';
      bar.style.gap = '8px';

      const btnResolve = document.createElement('button');
      btnResolve.className = 'btn btn-primary';
      btnResolve.textContent = 'Resolve';
      btnResolve.onclick = () => {
        if (!document.getElementById('resolution-composer')) {
          wrap.appendChild(makeComposer(incidentId));
        }
      };

      const btnAccept = makeSmallBtn('Accept (no resolution)');
      btnAccept.title = 'Acknowledge without proposing a resolution';
      btnAccept.onclick = () => {
        showToast('Acknowledged. You can resolve later if you change your mind.');
        closeModal();
      };

      bar.appendChild(btnResolve);
      bar.appendChild(btnAccept);
      wrap.appendChild(bar);
    }

    // If there is a pending/verified/rejected resolution → show it + tallies
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
      const c1 = makeCounter('CONFIRM', state.confirm_count || state.confirmCount || 0);
      const c2 = makeCounter('DECLINE', state.decline_count || state.declineCount || 0);
      const reqPill = makePill(`Need ${req} CONFIRM`);
      counters.appendChild(c1);
      counters.appendChild(c2);
      counters.appendChild(reqPill);
      top.appendChild(counters);

      box.appendChild(top);
      box.appendChild(desc);
      box.appendChild(meta);

      // Verifier controls (only if pending and user is not the reported)
      if (r.status === 'pending' && !isReportedUser) {
        const bar = document.createElement('div');
        bar.style.display = 'flex';
        bar.style.gap = '8px';
        bar.style.marginTop = '8px';

        const btnC = makeSmallBtn('CONFIRM');
        const btnD = makeSmallBtn('DECLINE');

        const myVote = state.user_vote || state.userVote || null;
        if (myVote === 'CONFIRM') {
          btnC.style.background = '#294a2f'; btnC.style.borderColor = '#3f7b49';
        } else if (myVote === 'DECLINE') {
          btnD.style.background = '#4a2b2b'; btnD.style.borderColor = '#7b3f3f';
        }

        btnC.onclick = async () => {
          try {
            btnC.disabled = true; btnD.disabled = true; btnC.textContent = 'Working…';
            await rpcResolution(incidentId, 'CONFIRM', 'confirmed', true);
            showToast('Resolution confirmed.');
          } catch (e) {
            console.error(e);
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
            console.error(e);
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

  function bindIncidentActions(incidentId, hideForReportedUser) {
    if (hideForReportedUser) return;

    // TRUE
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

    // IGNORE
    btnIgnore.onclick = async () => {
      try {
        const result = await rpcVerdict(incidentId, 'IGNORE');
        ignoredSet.add(incidentId);
        localStorage.setItem(STORAGE_KEY_IGNORED, JSON.stringify(Array.from(ignoredSet)));
        if (!reloadIfClosedFromRPC(result)) showToast('Ignored. It won’t show here again on this device.');
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not ignore.', true);
      }
    };

    // FALSE
    btnFalse.onclick = () => { falseForm.hidden = false; falseReason.focus(); };
    btnFalseCancel.onclick = () => { falseReason.value = ''; falseForm.hidden = true; };
    btnFalseSubmit.onclick = async () => {
      const reason = (falseReason.value || '').trim();
      if (reason.length < 5) { showToast('Add a brief reason for FALSE.', true); return; }
      try {
        const result = await rpcVerdict(incidentId, 'FALSE', reason);
        falseSet.add(incidentId);
        localStorage.setItem(STORAGE_KEY_FALSE, JSON.stringify(Array.from(falseSet)));
        if (!reloadIfClosedFromRPC(result)) showToast('Marked as FALSE. Thank you!');
        closeModal();
        await loadVerifyQueue();
      } catch (e) {
        console.error(e);
        showToast(e.message || 'Could not submit FALSE.', true);
      }
    };
  }

  // ---------- Open Incident Detail ----------
  async function openIncidentDetail(incidentId) {
    if (!modalEl) return;

    // show modal
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

    modalBodyEl.innerHTML = `<div style="color:#bbb;">Loading incident #${escapeHtml(incidentId)}…</div>`;

    const tryLoad = async (attempt = 0) => {
      if (!db) {
        if (attempt < 30) return setTimeout(() => tryLoad(attempt + 1), 200);
        modalBodyEl.innerHTML = `<div style="color:#d88;">Supabase not initialized. Try reloading the page.</div>`;
        return;
      }

      try {
        console.log('[policing] openIncidentDetail → p_incident_id =', incidentId, typeof incidentId);
        const { data, error } = await db.rpc('get_incident_detail', { p_incident_id: incidentId });
        if (error) {
          console.error('get_incident_detail error:', error);
          modalBodyEl.innerHTML = `<div style="color:#d88;">${escapeHtml(error.message || 'Failed to load incident')}</div>`;
          return;
        }
        const d = Array.isArray(data) ? data[0] : data;
        if (!d) { modalBodyEl.innerHTML = `<div style="color:#d88;">Incident not found.</div>`; return; }

        const header = `
          <div style="display:flex; flex-wrap:wrap; gap:8px; color:#eaeaea; font-weight:600;">
            Incident #${d.incident_id ?? d.id ?? incidentId} · ${escapeHtml(d.community || 'Unspecified')}
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

        // Resolution control mount
        const controls = document.createElement('div');
        controls.id = 'resolution-controls';
        controls.style.marginTop = '10px';
        modalBodyEl.appendChild(controls);

        const isReportedUser = currentUserId && (currentUserId === d.reported_user_id);

        // Inject resolution UI (RPC-backed)
        await injectResolutionUI(incidentId, d);

        // Bind verifier actions only if not reported user
        bindIncidentActions(incidentId, !!isReportedUser);
      } catch (e) {
        console.error(e);
        modalBodyEl.innerHTML = `<div style="color:#d88;">Failed to load incident.</div>`;
      }
    };

    tryLoad(0);
  }

  // ---------- Init ----------
  document.addEventListener('DOMContentLoaded', async () => {
    exposeGlobals();
    db = getSupabaseClient();

    if (db) {
      currentUserId = await getCurrentUserId();
      window.__currentUserId = currentUserId; // used by getResolutionState (2-arg RPC)
      await loadVerifyQueue();
    } else {
      setTimeout(async () => {
        db = getSupabaseClient();
        if (db) {
          currentUserId = await getCurrentUserId();
          window.__currentUserId = currentUserId;
          await loadVerifyQueue();
        }
      }, 200);
    }

    await loadCommunities();
    communityEl?.addEventListener('change', handleCommunityChange);
    userSelectEl?.addEventListener('change', handleUserChange);
    submitBtn?.addEventListener('click', handleSubmit);
    modalCloseEl?.addEventListener('click', closeModal);

    // Auto-open via notification deep-link
    const incFromNotif = getIncidentFromURLIfNotif();
    if (incFromNotif) setTimeout(() => { try { window.openIncidentById(incFromNotif); } catch {} }, 50);
  });
})();
