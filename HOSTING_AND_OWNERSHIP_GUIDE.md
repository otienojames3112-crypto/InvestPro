# KES 5M Investment Tracker — Own It, Host It, Keep Building It

**A complete, non-coder-friendly guide to taking full ownership of your application.**

This guide is written for you specifically: you come from FlutterFlow, you build with AI rather than by hand-writing code, and you want the backend and the full source in your own hands. It explains, in plain language, exactly what you are getting, how to run it on any server you choose, and how to keep evolving it with AI from here.

---

## Part 0 — The one thing to understand first

Your FlutterFlow apps are built in **Flutter (the Dart language)**. This application is **not** a Flutter app. It is a **web application** built with a different, equally mainstream technology stack:

| Layer | What it is | FlutterFlow equivalent |
| --- | --- | --- |
| Front end (what users see) | **React** + **Tailwind CSS** (TypeScript) | The widget canvas / UI |
| Back end (the logic & rules) | **Node.js** + **Express** + **tRPC** (TypeScript) | Firebase / Supabase functions |
| Database | **MySQL** (via the Drizzle ORM) | Firestore / Supabase tables |

Why this matters for your decision:

- **You cannot open this project inside FlutterFlow.** FlutterFlow only edits Flutter apps. This is a web app, so you would continue building it with **web-oriented AI builders** instead (covered in Part 6). The good news is that these tools are arguably *better* suited to "I have the full code and I want AI to keep changing it" than FlutterFlow is.
- **You get something FlutterFlow never fully gives you: the entire backend and database, as plain files you own.** There is no locked black box. Every rule, every calculation, every screen is a readable text file in the ZIP.
- **The whole app is one program.** Unlike a typical Flutter app (phone app + separate cloud backend), this is a single Node.js program that serves both the screens and the logic. That makes hosting dramatically simpler — one thing to deploy, not two.

So the honest summary: **you are fully portable and fully in control, but your "continue with AI" workflow will use web AI builders, not FlutterFlow.**

---

## Part 1 — What is inside the ZIP

The archive contains the **complete source code** — nothing is withheld. The only things excluded are files that are *automatically regenerated* and would just bloat the download:

- `node_modules/` — the third-party libraries, reinstalled in one command (`pnpm install`).
- `dist/` and build output — recreated by the build command.
- `.manus-logs/` and local caches — runtime noise.

Everything that defines *your app* is included: every screen, every business rule, the database design, the migration history, the test suite, and the configuration. Here is the map of where things live, so you (or an AI) always know where to look:

| What it is | Where it lives | Notes |
| --- | --- | --- |
| **The financial brain** (accrual, withholding tax, reconciliation, projections, AI-intake trust rules) | `shared/` | Pure TypeScript math. Runs anywhere, depends on no external service. This is the heart of the app. |
| **Database design & change history** | `drizzle/schema.ts`, `drizzle/migrations/` | The tables and their evolution. |
| **The API (server rules)** | `server/routers.ts` | Every action the app can perform. |
| **Database query helpers** | `server/db.ts` | How data is read and written. |
| **Platform plumbing** (login, AI calls, file storage, etc.) | `server/_core/` | The parts wired to the Manus platform — see Part 4. |
| **The screens** | `client/src/pages/` | Dashboard, Explore, AI Intake, AI Review, Source Conflicts, etc. |
| **Reusable interface pieces** | `client/src/components/` | Buttons, tables, layout, sidebar. |
| **Automated tests** | `server/*.test.ts` | ~1,000 checks proving the math and rules are correct. |
| **Setup notes** | `SETUP.md` | A shorter technical companion to this guide. |

---

## Part 2 — What you need before you start (one-time)

You need three free things. None require coding knowledge to obtain; each is a sign-up.

1. **A computer with Node.js installed.** Node.js is the engine that runs the app. Install version 22 (or 20+) from [nodejs.org](https://nodejs.org). After installing, you also install the package manager this project uses by opening a terminal and running `npm install -g pnpm`.
2. **A MySQL database.** This is where all your data (instruments, deposits, audit trail) is stored. You do **not** have to run this yourself — managed providers give you one in minutes (see Part 5). For local testing you can install MySQL on your own machine.
3. **A place to host it.** Any service that can run a Node.js app. Recommended beginner-friendly options are in Part 5.

> **You do not need any paid Manus subscription to run the app you own.** The core tracker — deposits, daily interest accrual, withholding-tax math, reconciliation, projections, every screen and table — is self-contained TypeScript that runs with only a database. The Manus-connected extras (login, the AI document reader) are optional and replaceable; Part 4 explains each one.

---

## Part 3 — Running it, step by step

These are the exact commands. You type them into a **terminal** (on Windows: "Command Prompt" or "PowerShell"; on Mac: "Terminal"), inside the unzipped project folder.

### Step 1 — Unzip and enter the folder
Unzip the archive, then in your terminal move into it:
```bash
cd kes5m-tracker
```

### Step 2 — Install the libraries (one command, a few minutes)
```bash
pnpm install
```
This downloads the third-party building blocks into `node_modules/`. You only repeat this when libraries change.

### Step 3 — Create your settings file
In the project folder, create a file named exactly `.env` (the leading dot matters). Paste the block below and fill in your own values. Part 4 explains every line.
```bash
# ── Database (REQUIRED) ──────────────────────────────
DATABASE_URL="mysql://USER:PASSWORD@HOST:3306/kes5m_tracker"

# ── Sessions (REQUIRED) ──────────────────────────────
# Any long random string. It signs the login cookie.
JWT_SECRET="paste-a-long-random-string-here"

# ── Login provider (needed for sign-in) ──────────────
VITE_APP_ID="your-oauth-app-id"
OAUTH_SERVER_URL="https://api.manus.im"
VITE_OAUTH_PORTAL_URL="https://manus.im/login"
OWNER_OPEN_ID="your-owner-id"
OWNER_NAME="Your Name"

# ── AI document reader & file storage (OPTIONAL) ─────
# Leave blank to run without AI features. The tracker still works fully.
BUILT_IN_FORGE_API_URL=""
BUILT_IN_FORGE_API_KEY=""
VITE_FRONTEND_FORGE_API_KEY=""
VITE_FRONTEND_FORGE_API_URL=""

# ── Branding (OPTIONAL) ──────────────────────────────
VITE_APP_TITLE="KES 5M Investment Tracker"
VITE_APP_LOGO=""
```

### Step 4 — Build the database tables
This creates the tables your app expects inside the empty database you provisioned:
```bash
pnpm drizzle-kit push
```

### Step 5 — Run it
For trying it on your own machine:
```bash
pnpm dev
```
Then open **http://localhost:3000** in your browser.

For a real, live server:
```bash
pnpm build
pnpm start
```
The app listens on the port the host gives it (it reads `PORT` automatically), so it works on every platform without changes.

### Step 6 (optional but recommended) — Prove it still works
The project ships with about a thousand automated checks. Running them confirms nothing broke:
```bash
pnpm test
```

---

## Part 4 — The Manus-connected parts, and how to replace each

This is the most important section for true independence. The app was built on Manus, so a few features call Manus services. **None of them touch your core financial logic** — they are all in the `server/_core/` folder. Here is each one, what it does, what happens if you ignore it, and how to swap it.

| Feature | File | If you leave it as-is | To make it fully yours |
| --- | --- | --- | --- |
| **Login / accounts** | `server/_core/oauth.ts`, `sdk.ts` | Users sign in through Manus's login. Works, but depends on Manus being reachable. | Replace with any standard login provider (Auth0, Clerk, Google sign-in, or a simple email/password). This is the one piece most worth replacing for independence. |
| **AI document reader & "discover instruments"** | `server/_core/llm.ts` | Needs the two `FORGE` keys. Blank = AI buttons fail gracefully; everything else works. | Point it at your own AI account (e.g. an OpenAI key). The file already speaks the standard OpenAI format, so this is usually a URL + key change. |
| **File storage** (uploaded PDFs) | `server/storage.ts`, `server/_core/storageProxy.ts` | Uses Manus storage. | Repoint to your own S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze). The libraries for this are already installed. |
| **Owner notifications** | `server/_core/notification.ts` | Sends you operational alerts via Manus. | Optional. Swap for email later, or ignore. |

> **Plain-English takeaway:** if you do nothing, the app runs and every financial feature works; only the AI-reader and Manus login lean on Manus. When you are ready for total independence, the single highest-value swap is **login** — and an AI assistant can do that change for you in one focused session.

---

## Part 5 — Where to host it (concrete options)

Because the whole app is a single Node.js program, hosting is simple. Below are good fits, easiest first. All of them can take your code straight from a GitHub repository and run the same `pnpm build` / `pnpm start` you used locally.

| Platform | Why it suits you | Database included? |
| --- | --- | --- |
| **Railway** | Click-to-deploy from GitHub, adds a MySQL database in the same project, very beginner-friendly. | Yes (MySQL add-on) |
| **Render** | Similar simplicity; clear free/paid tiers; managed databases. | Yes (managed DB) |
| **Fly.io** | Runs your app close to users; good value as you grow. | Via add-on or external |
| **A plain VPS** (DigitalOcean, Hetzner, Linode) | Maximum control; you run the exact commands from Part 3 on a rented Linux machine. | You install or attach one |
| **PlanetScale / Neon / Aiven** | Not hosts for the app, but excellent **managed MySQL** to pair with any host above. | They *are* the database |

**The typical beginner path:** put the code on GitHub → connect Railway to that repo → add Railway's MySQL → paste your `.env` values into Railway's settings → deploy. That gives you a live, owned, controllable app with a backend you can inspect any time.

A short, ordered checklist for going live anywhere:

1. Create a managed MySQL database; copy its connection string into `DATABASE_URL`.
2. Put the project on GitHub (one of the AI tools in Part 6 can do this for you).
3. Connect your chosen host to that GitHub repository.
4. Enter the `.env` values from Part 3 into the host's "environment variables" screen.
5. Set the start command to `pnpm start` and the build command to `pnpm build`.
6. Run the database setup once (`pnpm drizzle-kit push`) against the live database.
7. Open your new URL.

---

## Part 6 — How to keep building it with AI (your FlutterFlow replacement)

This is the part that replaces your FlutterFlow workflow. Since this is a web app in plain files, you continue with **AI coding assistants that work on a whole codebase**. You describe what you want in normal English; the AI edits the files, runs the tests, and shows you the result. You never have to read the code yourself — but you *own* it, and you can hand it to any tool or developer at any time.

Recommended assistants for a non-coder, easiest first:

- **Manus** (what built this) — you can keep using it: open the project, describe a change, review the preview. The smoothest continuation since it already knows this codebase.
- **Cursor** or **Windsurf** — desktop apps where you open the project folder and chat with an AI that edits the code live. Strong for ongoing work.
- **GitHub Copilot Workspace / Lovable / v0** — browser-based, take a plain-English request and modify the app.
- **Claude / ChatGPT (with the files attached)** — for one-off questions or small edits when you don't want a full tool open.

**The golden rule that protects you as a non-coder:** the project has ~1,000 automated tests. After *any* AI change, the assistant should run `pnpm test`. If the tests stay green, the change did not break your financial logic. Always ask your AI assistant to "make the change and confirm all tests still pass." This is your safety net in place of manually checking code.

A healthy ongoing loop looks like this: describe the feature in plain English → let the AI edit and run the tests → view the live preview → if you like it, deploy (push to GitHub; your host updates automatically). It is the same describe-preview-publish rhythm you know from FlutterFlow, just with a web-savvy AI in the editor's seat.

---

## Part 7 — A short glossary (so the AI's words make sense)

| Term | Plain meaning |
| --- | --- |
| **Repository / repo** | The folder of your code, usually stored on GitHub. |
| **Environment variable / `.env`** | Your private settings (database address, keys) kept out of the code. |
| **Migration** | A recorded change to the database's shape. |
| **Build** | Turning the source into the optimized version that runs in production. |
| **Deploy / publish** | Putting the built app onto a live server. |
| **Endpoint / API** | A single action the back end can perform. |
| **ORM (Drizzle)** | The translator between your code and the MySQL database. |

---

## In one paragraph

You now own the entire application as readable files: every screen, every financial rule, the database design, and a thousand tests that guard it. It runs as a single Node.js program on any host — Railway, Render, Fly, or your own server — needing only a MySQL database to work fully. A handful of optional features lean on Manus (most importantly login and the AI document reader), and Part 4 shows how to swap each for your own provider when you want total independence. And because it is plain web code, you keep building it the way you already like to — by describing changes to an AI — using web-oriented assistants instead of FlutterFlow, with the test suite as your automatic safety check. Nothing here is locked; everything is yours.

---

*Prepared by Manus AI. This guide accompanies the full source archive of the KES 5M Investment Tracker.*
