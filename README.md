# LCM — Life Credits Manna

A simple, community‑verified credit system that turns everyday actions into trackable progress.

> **Live Demo:** Replace with your URL — e.g. `https://your-site.netlify.app` or `https://<your-username>.github.io/lcm`

---

## Table of Contents

* [About](#about)
* [Features](#features)
* [Tech Stack](#tech-stack)
* [Screenshots](#screenshots)
* [Project Structure](#project-structure)
* [Getting Started](#getting-started)

  * [Prerequisites](#prerequisites)
  * [Setup](#setup)
  * [Local Preview](#local-preview)
* [Deployment (Free)](#deployment-free)

  * [Option A — Netlify Drop (fastest)](#option-a--netlify-drop-fastest)
  * [Option B — GitHub Pages (durable)](#option-b--github-pages-durable)
  * [Post‑Deploy: Supabase URLs & CORS](#postdeploy-supabase-urls--cors)
* [Security](#security)
* [Troubleshooting](#troubleshooting)
* [Roadmap](#roadmap)
* [Contributing](#contributing)
* [License](#license)

---

## About

**LCM (Life Credits Manna)** lets people log everyday tasks, have them **verified by their communities**, and **earn credits**. It’s designed to be **child‑friendly** and **simple**, using a clean dashboard with purple accents and minimal numbers.

LCM is a **static front‑end** (HTML/CSS/JS) that talks directly to **Supabase** (Postgres + Auth + RLS). No servers to run, no paid hosting required.

---

## Features

* **Task Logging**: Describe your task, select a **category** (HOME, SCHOOL, CHURCH, WORK, TEAM), choose **verifiers**, submit.
* **Verification Flow**: Verifiers confirm/deny; threshold rules determine crediting.
* **Credits View**: See **Normal, Bonus, Super, Policing** credits separately; redeem bonus/policing to normal.
* **Notifications**: Status updates for task verification, bonus awards, incident resolution, etc.
* **Policing & Resolution**: Incident reporting (single‑incident grouping, fair penalties), resolution path and partial restoration.
* **Dashboard**: Profile + Communities row + “What are you up to today?” + tables for daily/monthly/yearly stats.

**Bonus logic (current design):**

* More than **10 verifiers** → **0.1 bonus** per extra verifier (max **1 bonus** per task).
* More than **10 verified tasks** in a day → **0.1 bonus** per extra task.
* Bonus stored separately; redeem at **1 bonus = 0.5 normal**. Daily caps apply.

---

## Tech Stack

* **Frontend:** HTML, CSS, Vanilla JavaScript (no build step)
* **Backend‑as‑a‑Service:** Supabase (Postgres, Auth, RLS, triggers)
* **Hosting:** Netlify Drop or GitHub Pages (free)

---

## Screenshots

> Create these files (optional) and update the paths below.

* Dashboard — `docs/screenshots/dashboard.png`
* Credits — `docs/screenshots/credits.png`

```md
![Dashboard](docs/screenshots/dashboard.png)
![Credits](docs/screenshots/credits.png)
```

---

## Project Structure

```
LCM/
├── index.html
├── tasks.html
├── credits.html
├── policing.html
├── notifications.html
├── styles.css
├── supabaseClient.js        # creates window.supabaseClient
├── assets/                  # images, icons
└── docs/
    └── screenshots/         # optional screenshots for README
```

---

## Getting Started

### Prerequisites

* A **Supabase** project (free). Grab:

  * **SUPABASE\_URL** like `https://YOUR-PROJECT.supabase.co`
  * **SUPABASE\_ANON\_KEY** (public, safe for frontend)
* Ensure **RLS (Row‑Level Security)** is **ON** for all user‑facing tables, with policies set appropriately.

### Setup

1. Include Supabase **v2** CDN **before** your app scripts:

```html
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script>
  const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
  const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
  window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
</script>
```

2. Or put the client in `supabaseClient.js` (loaded **after** the CDN):

```js
// supabaseClient.js
const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
```

3. Open `index.html` in your browser to preview.

### Local Preview

* Double‑click `index.html`, or
* Use VS Code **Live Server** extension (optional).

---

## Deployment (Free)

### Option A — Netlify Drop (fastest)

1. Zip your project folder (or keep it as a folder).
2. Open **Netlify Drop** in your browser and drag the folder/zip in.
3. Netlify returns a live link like `https://your-site.netlify.app`.

### Option B — GitHub Pages (durable)

1. Create a **public** repo and upload files with `index.html` at the **repo root**.
2. Go to **Settings → Pages → Build and deployment**:

   * Source: **Deploy from a branch**
   * Branch: `main` (root)
3. Wait \~1 minute for: `https://<your-username>.github.io/<repo>`.

### Post‑deploy: Supabase URLs & CORS

In **Supabase**:

* **Auth → URL Configuration**

  * **Site URL**: your live URL
  * **Additional Redirect URLs**: add same URL and any other public pages
* **Project Settings → API / CORS** (if shown): add your live domain(s)

Hard‑refresh your site after changes.

---

## Security

* Only the **anon key** is in the frontend. This is expected.
* **Never** expose your **service role** key to the browser.
* Enforce your rules with **RLS policies**, triggers, and constraints.

---

## Troubleshooting

* **`createClient is not defined`** → Load the Supabase v2 CDN **before** your scripts and call `window.supabase.createClient(...)`.
* **CORS errors** → Add your live domain in **Auth URL Configuration** and any **CORS allowlist**; hard‑refresh.
* **Blank page on GitHub Pages** → Ensure `index.html` is at repo root (not nested).
* **404 `favicon.ico`** → Optional; add a small icon or ignore.
* **Mixed content** → All URLs must use **HTTPS**.

---

## Roadmap

* ✅ Task logging & verification threshold rules
* ✅ Credits page (Normal, Bonus, Super, Policing) + redemption
* ✅ Notifications for task/bonus/incident updates
* ✅ Policing & Redemption flow (incident grouping, penalties, reset window, resolutions)
* ⏳ Verifier invites & community management UX
* ⏳ Admin dashboard (moderation/audits)
* ⏳ Mobile polish & accessibility pass
* ⏳ Multi‑language support

---

## Contributing

PRs welcome! Please include a clear description and (if UI) screenshots/GIFs.

---

## License

**MIT** — See [`LICENSE`](LICENSE) for details.
