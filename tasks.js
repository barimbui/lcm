// tasks.js — inserts a task, links to selected verifier (or ALL), soft-deletes/restores tasks,
// autosuggests task labels, blocks same-day duplicates, and lists today's tasks (Supabase v2)
console.log("tasks.js loaded – build arch3");

document.addEventListener("DOMContentLoaded", () => {
  const statusEl = document.getElementById("task-status");
  const tbody = document.getElementById("tasks-tbody");
  const form = document.getElementById("task-form");
  const taskInput = document.getElementById("task-input");
  const communitySelect = document.getElementById("community-select");
  const verifierSelect = document.getElementById("verifier-select"); // single-select
  const suggestionsEl = document.getElementById("task-suggestions"); // <datalist>

  const ALL_VALUE = "__ALL__";

  // Guard: ensure Supabase client exists
  if (!window.sb) {
    setStatus("Supabase not initialized.", true);
    return;
  }

  // On load: ensure session, then render today's tasks and pre-load verifiers (if community chosen)
  (async function init() {
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      const { data: sub } = window.sb.auth.onAuthStateChange((evt, s) => {
        if (evt === "SIGNED_IN" && s) {
          sub.subscription.unsubscribe();
          renderToday();
          preloadVerifiers();
        } else if (evt === "SIGNED_OUT") {
          sub.subscription.unsubscribe();
          window.location.href = "index.html";
        }
      });
      setTimeout(async () => {
        const again = await window.sb.auth.getSession();
        if (again.data.session) {
          renderToday();
          preloadVerifiers();
        } else {
          window.location.href = "index.html";
        }
      }, 300);
    } else {
      renderToday();
      preloadVerifiers();
    }
  })();

  // Reload verifiers when community changes
  if (communitySelect && verifierSelect) {
    communitySelect.addEventListener("change", () =>
      loadVerifiersForCommunity(communitySelect.value)
    );
  }

  // ---- Autosuggest wiring (debounced) ----
  let suggestTimer = null;
  taskInput.addEventListener("input", () => {
    const q = (taskInput.value || "").trim();
    if (suggestTimer) clearTimeout(suggestTimer);
    suggestTimer = setTimeout(() => updateSuggestions(q), 150);
  });

  async function updateSuggestions(prefix) {
    if (!suggestionsEl) return;
    suggestionsEl.innerHTML = "";
    const q = (prefix || "").trim();
    if (!q || q.length < 2) return; // start suggesting from 2 chars

    const { data, error } = await window.sb
      .from("tasks")
      .select("label")
      .ilike("label", `${escapeLike(q)}%`)
      .order("label", { ascending: true })
      .limit(12);

    if (error) {
      return; // suggestions are optional
    }

    const seen = new Set();
    (data || []).forEach(r => {
      const label = (r.label || "").trim();
      const key = normalizeLabel(label);
      if (label && !seen.has(key)) {
        seen.add(key);
        const opt = document.createElement("option");
        opt.value = label;
        suggestionsEl.appendChild(opt);
      }
    });
  }

  // Submit handler (insert -> link verifications -> refresh list)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const labelRaw = (taskInput.value || "").trim();
    const community = communitySelect.value || "";
    const selectedVal = verifierSelect.value || "";

    if (!labelRaw) return setStatus("Please enter a task.", true);
    if (!community) return setStatus("Please choose a community.", true);
    if (!selectedVal) return setStatus("Please choose a verifier (or ALL).", true);

    const labelNorm = normalizeLabel(labelRaw);

    setStatus("Checking…");

    // Same-day duplicate guard
    const from = startOfTodayISO();
    const to = startOfTomorrowISO();
    theSameDay:
    {
      const { data: todayRows, error: todayErr } = await window.sb
        .from("tasks")
        .select("id,label,archived,created_at")
        .gte("created_at", from)
        .lt("created_at", to);

      if (todayErr) {
        setStatus(todayErr.message, true);
        break theSameDay;
      }

      const dup = (todayRows || []).find(r =>
        !r.archived && normalizeLabel(r.label) === labelNorm
      );
      if (dup) {
        setStatus("You’ve already logged that task today.", true);
        return;
      }
    }

    setStatus("Submitting task…");

    // Ensure session
    const { data: { session } } = await window.sb.auth.getSession();
    if (!session) {
      setStatus("Your session expired. Please sign in again.", true);
      window.location.href = "index.html";
      return;
    }

    // Determine verifier IDs to link
    let verifierIds = [];
    if (selectedVal === ALL_VALUE) {
      const { data: allVs, error: allErr } = await window.sb
        .from("verifiers")
        .select("id")
        .eq("category", community)
        .order("id", { ascending: true });
      if (allErr) return setStatus(`Failed to load verifiers: ${allErr.message}`, true);
      verifierIds = (allVs || []).map(v => v.id);
      if (verifierIds.length === 0) {
        return setStatus("No verifiers available in this community.", true);
      }
    } else {
      const vId = parseInt(selectedVal, 10);
      if (!Number.isInteger(vId)) return setStatus("Verifier selection invalid. Please try again.", true);
      verifierIds = [vId];
    }

    // 1) Insert the task (backend handles credits/diminishing)
    const { data: taskRow, error: taskErr } = await window.sb
      .from("tasks")
      .insert([{
        community,
        label: labelRaw,
        task_description: labelRaw
      }])
      .select("id")
      .single();

    if (taskErr) {
      setStatus(taskErr.message, true);
      return;
    }

    // 2) Link requested verifiers
    const payload = verifierIds.map(vId => ({ task_id: taskRow.id, verifier_id: vId }));
    const { error: linkErr } = await window.sb.from("task_verifications").insert(payload);

    if (linkErr) {
      setStatus(`Task added, but verification linking failed: ${linkErr.message}`, true);
    } else {
      setStatus(
        selectedVal === ALL_VALUE
          ? "Task added & verification requested from ALL!"
          : "Task added & verification requested!"
      );
    }

    // Clear inputs and refresh
    taskInput.value = "";
    communitySelect.value = "";
    if (verifierSelect) {
      verifierSelect.innerHTML = `<option value="">Choose…</option>`;
    }
    await renderToday();
  });

  // === Helpers ===
  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg || "";
    statusEl.className = "status " + (isError ? "error" : "ok");
    // make it obvious
    try { statusEl.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch {}
  }

  function startOfTodayISO() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0));
    return d.toISOString();
  }
  function startOfTomorrowISO() {
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0));
    return d.toISOString();
  }

  // Render today's tasks with progress + action buttons
  async function renderToday() {
    const from = startOfTodayISO();
    const to = startOfTomorrowISO();

    // include archived so you can restore
    const { data: tasks, error: taskErr } = await window.sb
      .from("tasks")
      .select("id,label,community,created_at,archived")
      .gte("created_at", from)
      .lt("created_at", to)
      .order("created_at", { ascending: true });

    if (taskErr) {
      setStatus(taskErr.message, true);
      return;
    }

    // Debug: see what we're about to render
    console.table((tasks || []).map(t => ({ id: t.id, label: t.label, archived: !!t.archived })));

    tbody.innerHTML = "";
    if (!tasks || tasks.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="5" style="text-align:center; color: var(--muted);">
            No tasks logged today yet.
          </td>
        </tr>`;
      setStatus("");
      return;
    }

    // Count APPROVED verifications per task
    const taskIds = tasks.map(t => t.id);
    const approvedByTask = new Map();

    if (taskIds.length > 0) {
      const { data: approvals, error: apprErr } = await window.sb
        .from("task_verifications")
        .select("task_id")
        .in("task_id", taskIds)
        .eq("status", "APPROVED");

      if (!apprErr && approvals) {
        approvals.forEach(row => {
          approvedByTask.set(row.task_id, (approvedByTask.get(row.task_id) || 0) + 1);
        });
      }
    }

    // Build rows
    tasks.forEach((row, idx) => {
      const approved = approvedByTask.get(row.id) || 0;
      const needed = thresholdForCommunity(row.community);
      const ticks = Array.from({ length: needed }, (_, i) =>
        i < approved ? `<span class="tick ok"></span>` : `<span class="tick"></span>`
      ).join("");

      const isArchived = !!row.archived;
      const delIsDisabled = isArchived;     // delete disabled when archived
      const resIsDisabled = !isArchived;    // restore disabled unless archived

      const tr = document.createElement("tr");
      tr.dataset.taskId = row.id;

      // Apply archived style (class + inline fallback so it’s obvious)
      if (isArchived) {
        tr.classList.add("archived-row");
        tr.style.opacity = "0.55";
        tr.style.filter = "grayscale(0.35)";
      } else {
        tr.classList.remove("archived-row");
        tr.style.opacity = "";
        tr.style.filter = "";
      }

      tr.innerHTML = `
        <td>${idx + 1}</td>
        <td>${escapeHtml(row.label)}${isArchived ? ' <span style="color:var(--muted)">(archived)</span>' : ''}</td>
        <td>${escapeHtml(row.community)}</td>
        <td><div class="progress">${ticks}</div></td>
        <td class="credits-cell">
          <span class="credits">0</span>
          <span class="spacer"></span>
          <button type="button" class="icon-btn delete-btn${delIsDisabled ? ' is-disabled' : ''}" data-id="${row.id}" title="Delete task">🗑️</button>
          <button type="button" class="icon-btn restore-btn${resIsDisabled ? ' is-disabled' : ''}" data-id="${row.id}" title="Restore task">↩️</button>
        </td>
      `;
      tbody.appendChild(tr);
    });

    setStatus("");
  }

  // Thresholds per community (adjust as needed)
  function thresholdForCommunity(comm) {
    return comm === "HOME" ? 1 : 5;
  }

  // Event delegation for action buttons
  tbody.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;

    // Ignore clicks on visually disabled icons
    if (btn.classList.contains("is-disabled")) return;

    const taskId = btn.getAttribute("data-id");
    if (!taskId) return;

    if (btn.classList.contains("delete-btn")) {
      await archiveTask(taskId, btn);
    } else if (btn.classList.contains("restore-btn")) {
      await restoreTask(taskId, btn);
    }
  });

  // Soft delete (optimistic): archive task and stop verification (reject pending)
  async function archiveTask(taskId, buttonEl) {
    console.log("Archive clicked for", taskId);

    // Optimistic UI
    const tr = tbody.querySelector(`tr[data-task-id="${taskId}"]`);
    const restoreBtn = tr?.querySelector(".restore-btn");
    const deleteBtn  = tr?.querySelector(".delete-btn");
    if (tr) {
      tr.classList.add("archived-row");
      tr.style.opacity = "0.55";
      tr.style.filter = "grayscale(0.35)";
    }
    deleteBtn?.classList.add("is-disabled");
    restoreBtn?.classList.remove("is-disabled");

    setStatus("Archiving…");

    const { error: upErr, data: upData } = await window.sb
      .from("tasks")
      .update({ archived: true })
      .eq("id", taskId)
      .select("id,archived");

    console.log("Archive result", { upErr, upData });

    if (upErr) {
      // Revert optimistic UI
      tr?.classList.remove("archived-row");
      tr && (tr.style.opacity = "", tr.style.filter = "");
      deleteBtn?.classList.remove("is-disabled");
      restoreBtn?.classList.add("is-disabled");
      return setStatus(`Failed to archive: ${upErr.message}`, true);
    }

    // Best-effort: reject pending verifications
    const { error: rejErr } = await window.sb
      .from("task_verifications")
      .update({ status: "REJECTED" })
      .eq("task_id", taskId)
      .eq("status", "PENDING");

    if (rejErr) console.warn("Failed to reject pending verifications:", rejErr.message);

    setStatus("Task archived and pending verifications stopped.");
    // Re-fetch to stay in sync with DB
    await renderToday();
  }

  // Restore (optimistic): un-archive task and flash it briefly
  async function restoreTask(taskId, buttonEl) {
    console.log("Restore clicked for", taskId);

    // Optimistic UI
    const tr = tbody.querySelector(`tr[data-task-id="${taskId}"]`);
    const restoreBtn = tr?.querySelector(".restore-btn");
    const deleteBtn  = tr?.querySelector(".delete-btn");
    if (tr) {
      tr.classList.remove("archived-row");
      tr.style.opacity = "";
      tr.style.filter = "";
    }
    deleteBtn?.classList.remove("is-disabled");
    restoreBtn?.classList.add("is-disabled");

    setStatus("Restoring…");

    const { error: upErr, data: upData } = await window.sb
      .from("tasks")
      .update({ archived: false })
      .eq("id", taskId)
      .select("id,archived");

    console.log("Restore result", { upErr, upData });

    if (upErr) {
      // Revert optimistic UI
      tr?.classList.add("archived-row");
      tr && (tr.style.opacity = "0.55", tr.style.filter = "grayscale(0.35)");
      deleteBtn?.classList.add("is-disabled");
      restoreBtn?.classList.remove("is-disabled");
      return setStatus(`Failed to restore: ${upErr.message}`, true);
    }

    setStatus("Task restored.");

    // Re-render and briefly highlight the restored row
    await renderToday();
    const tr2 = tbody.querySelector(`tr[data-task-id="${taskId}"]`);
    if (tr2) {
      tr2.classList.add("row-flash");
      setTimeout(() => tr2.classList.remove("row-flash"), 900);
    }
  }

  // Load verifiers for selected community (single-select)
  async function loadVerifiersForCommunity(community) {
    if (!verifierSelect) return;
    verifierSelect.innerHTML = `<option value="">Loading…</option>`;
    if (!community) {
      verifierSelect.innerHTML = `<option value="">Choose…</option>`;
      return;
    }

    const { data, error } = await window.sb
      .from("verifiers")
      .select("id,name")
      .eq("category", community)
      .order("name", { ascending: true });

    if (error) {
      verifierSelect.innerHTML = `<option value="">Failed to load</option>`;
      console.warn("Failed to load verifiers:", error.message);
      return;
    }

    const opts = [new Option("ALL VERIFIERS", ALL_VALUE)];
    (data || []).forEach(v => opts.push(new Option(v.name, String(v.id))));

    verifierSelect.innerHTML = "";
    opts.forEach(o => verifierSelect.add(o));
  }

  // On first load, ensure the Verifier dropdown has data by default
  function preloadVerifiers() {
    if (!communitySelect || !verifierSelect) return;
    const firstRealOption = Array.from(communitySelect.options).find(opt => opt.value && opt.value !== '');
    const value = communitySelect.value || (firstRealOption ? firstRealOption.value : '');
    if (value) {
      if (!communitySelect.value) communitySelect.value = value;
      loadVerifiersForCommunity(value);
    } else {
      verifierSelect.innerHTML = `<option value="">Choose…</option>`;
    }
  }

  // --- small utilities ---
  function normalizeLabel(s) {
    return (s || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  // Escape % and _ for ILIKE queries
  function escapeLike(s) {
    return s.replace(/[%_]/g, ch => "\\" + ch);
  }

  function escapeHtml(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }
});
