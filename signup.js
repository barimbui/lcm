// signup.js — handles the Sign Up flow (with immediate sign-in before profile insert)
document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("signup-form");
  if (!form) return;

  const firstNameEl = document.getElementById("first-name");
  const middleNameEl = document.getElementById("middle-name");
  const lastNameEl = document.getElementById("last-name");
  const usernameEl = document.getElementById("username");
  const govIdEl = document.getElementById("gov-id");
  const emailEl = document.getElementById("email");
  const phoneEl = document.getElementById("phone");
  const passwordEl = document.getElementById("password");
  const statusEl = document.getElementById("signup-status");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!window.sb) {
      statusEl.textContent = "Supabase not initialized.";
      statusEl.className = "status error";
      return;
    }

    // Gather values
    const first_name = firstNameEl.value.trim();
    const middle_name = middleNameEl.value.trim();
    const last_name = lastNameEl.value.trim();
    const username = usernameEl.value.trim() || null;
    const gov_id_raw = govIdEl.value.trim();
    const email = emailEl.value.trim() || null;
    const phone = phoneEl.value.trim() || null;
    const password = passwordEl.value;

    // Basic validations
    if (!first_name || !last_name || !gov_id_raw || !password) {
      statusEl.textContent = "Please fill all required fields (First, Last, ID/BC, Password).";
      statusEl.className = "status error";
      return;
    }
    if (!email) {
      // MVP requires email for password reset
      statusEl.textContent = "Please enter an Email (required for this version).";
      statusEl.className = "status error";
      return;
    }

    statusEl.textContent = "Creating your account…";
    statusEl.className = "status";

    // 1) Create Auth user (email + password)
    const { data: signUpData, error: signUpError } = await window.sb.auth.signUp({
      email,
      password
    });

    if (signUpError) {
      statusEl.textContent = signUpError.message;
      statusEl.className = "status error";
      return;
    }

    // 2) Ensure we have an authenticated session BEFORE inserting profile
    //    (If your project requires email confirmation, signIn will fail until you confirm.)
    statusEl.textContent = "Signing you in…";
    let userId = signUpData.user?.id;

    // Try to sign in to create a session so RLS sees auth.uid()
    const { data: signInData, error: signInError } = await window.sb.auth.signInWithPassword({
      email,
      password
    });

    if (signInError) {
      // If email confirmation is required, guide the user
      statusEl.textContent = "Check your email to confirm your account, then try signing in.";
      statusEl.className = "status error";
      return;
    }

    // Refresh user id from the new session (safer)
    userId = signInData?.user?.id || userId;
    if (!userId) {
      statusEl.textContent = "Could not retrieve your user ID after sign-in.";
      statusEl.className = "status error";
      return;
    }

    // 3) Insert profile with salted hash of ID/BC (now we have a session)
    try {
      const gov_id_hash = await hashGovId(gov_id_raw);

      const { error: profileErr } = await window.sb.from("profiles").insert([{
        user_id: userId,
        first_name,
        middle_name: middle_name || null,
        last_name,
        username,
        gov_id_hash,
        email,
        phone: phone || null,
        created_at: new Date().toISOString()
      }]);

      if (profileErr) {
        statusEl.textContent = profileErr.message;
        statusEl.className = "status error";
        return;
      }
    } catch (e) {
      statusEl.textContent = e.message || "Unexpected error creating profile.";
      statusEl.className = "status error";
      return;
    }

    // 4) Done → go to dashboard
    statusEl.textContent = "Account created! Redirecting…";
    statusEl.className = "status ok";
    window.location.href = "dashboard.html";
  });
});
