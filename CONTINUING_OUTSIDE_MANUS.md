# Continuing Your Investment Tracker Outside Manus — A Plain-English Guide

_Written for someone with no coding experience. No jargon without an explanation._

This guide explains, in everyday language, what your app actually **is**, what your options are for continuing to build it outside Manus, and the trade-offs of each path. Read the first two sections even if you skip the rest — they will save you from expensive mistakes.

---

## 1. First, understand what you actually own

Think of your app as a **restaurant**. It has three parts:

| Restaurant part | In your app | Plain meaning |
|---|---|---|
| The **recipes and kitchen** | The *source code* (the ZIP file I keep sending you) | The instructions that make everything work. You own a full copy. |
| The **pantry / walk-in fridge** | The *database* | Where your real numbers live — your portfolios, deposits, rates, approved instruments. |
| The **building and address** | The *hosting* + the web address `kes5mtrack-z9kgo7pi.manus.space` | The physical place customers walk into, and the sign on the door. |

The single most important thing to understand:

> **You own the recipes (the code). Manus is currently renting you the building (hosting) and holding your pantry (database).**

So "continuing outside Manus" really means: **taking the recipes to a new building, and moving the pantry with them.** Nothing about the code stops you from doing this — but the pantry (your live data) and the address need deliberate handling.

---

## 2. The honest recommendation first

Before the how-to, the honest advice:

- **If the app works and you mainly want to keep using and lightly tweaking it → stay on Manus.** Moving is real work and introduces risk for little gain. Manus already gives you hosting, the database, login, backups (checkpoints), and a "Publish" button.
- **You should consider moving out only if one of these is true:**
  1. You want a **different developer or a coding team** to take over and they prefer their own tools.
  2. You need something Manus's hosting can't do (for example, a program that must run **24/7 in the background**, or very heavy number-crunching).
  3. You want **full independence** — your own server bill, your own accounts, no dependency on Manus.
  4. You're worried about **long-term ownership** and want everything sitting in your own accounts.

If none of those apply, the best "continuing" strategy is simply: keep asking Manus (or any developer) to make changes, and click **Publish** when you're happy. You can always leave later — owning the code means you're never locked in.

---

## 3. What the app is built with (so any developer instantly understands it)

If you hand this to a developer, these are the words that tell them everything in five seconds. You don't need to memorise them — just know they exist.

- **Front end (what you see):** React + TypeScript + Tailwind CSS + Vite.
- **Back end (the engine behind the scenes):** Node.js + Express + tRPC.
- **Database:** MySQL-compatible (specifically TiDB, but any MySQL works).
- **Login:** currently "Sign in with Manus" (Manus OAuth). **This is the one piece that is tied to Manus** — see Section 6.
- **Tests:** ~1,500 automated checks (Vitest) that prove the money-math and workflows still work after any change.

Any competent web developer will recognise this as a standard, modern, mainstream setup. It is **not** exotic or locked to Manus, with the single exception of the login button.

---

## 4. Your three realistic options, ranked

### Option A — Stay on Manus, keep publishing (easiest, recommended for most people)
- **Effort:** none beyond what you already do.
- **You keep:** hosting, database, login, backups, the Publish button.
- **How you continue building:** keep giving instructions (to Manus or a hired developer working inside Manus). Click **Publish** to push changes live.
- **Best for:** you, right now, unless you have a specific reason to leave.

### Option B — Hand the code to a developer, host it somewhere else (the real "move out")
- **Effort:** a few days of a developer's time to set up; ongoing small monthly bills.
- **You get:** full independence.
- **What has to happen (your developer does this, not you):**
  1. Take the ZIP of the code.
  2. Rent a **server** to run the engine (e.g. Railway, Render, Fly.io, or a plain virtual machine). Rough cost: **US$5–20/month** to start.
  3. Rent a **database** (e.g. PlanetScale, or any managed MySQL). Rough cost: often a **free tier**, then **US$10–30/month** as data grows.
  4. **Move your existing data** out of the Manus database into the new one (see Section 5).
  5. **Replace the login** (see Section 6) — the one genuinely Manus-specific piece.
  6. Point your web address at the new server.
- **Best for:** you want a team to own it, or you've outgrown Manus hosting.

### Option C — Export to GitHub and let a team collaborate (usually combined with B)
- **What it is:** GitHub is like **Google Docs for code** — a shared, version-controlled home where multiple developers can work together and see every change.
- **How:** Manus has a built-in **GitHub export** (in the project's Settings → GitHub). One click puts your code in your own GitHub account.
- **Best for:** the moment you bring in more than one developer. It does **not** by itself move hosting or data — pair it with Option B.

---

## 5. Moving your real data (the pantry) — what to know

Your live numbers sit in the Manus database. To take them with you:

1. In the Manus project, open **Database** (and the connection details in the bottom-left settings). This gives your developer a secure way to connect and **export** everything.
2. The standard way is a **database dump** — think of it as photographing every shelf in the pantry so it can be rebuilt identically elsewhere. Your developer runs one command to produce a single backup file.
3. That backup is **loaded into the new database**. The app's structure (the "shape" of the shelves) is already described in the code, so it recreates cleanly.

**Two safety rules:**
- **Never let anyone run "delete everything" or "reset" commands on your live database** while testing. Practise on a copy.
- **Always take a fresh export right before you move.** It's your undo button.

---

## 6. The one genuinely Manus-specific part: the login button

Right now people sign in with **"Sign in with Manus."** That convenience is provided *by* Manus, so if you move out, that specific button won't work on its own.

This is **normal and expected**, and it's a small, well-understood job for a developer. Off the shelf replacements include:
- **Google / Microsoft "Sign in with…"** (most common),
- **Auth0**, **Clerk**, or **Firebase Authentication** (drop-in login services, often with a free tier).

The rest of your app is written so that login is a **self-contained corner** — swapping it does not require rewriting the investment engine, the dashboards, or your data. (As part of this very update, I also made the login **fail gracefully**: an expired or reused sign-in link now shows a friendly "please sign in again" message instead of an error page — see Section 8.)

---

## 7. A simple, low-risk sequence if you decide to move

You don't have to do this yourself — this is the checklist to hand a developer, in order:

1. **Export the code to GitHub** (Manus Settings → GitHub). Now it's in your own account.
2. **Export a fresh database backup** from Manus.
3. **Set up a test copy** on the new host (server + database) and load the backup there. **Do not touch the live site yet.**
4. **Swap the login** for Google/Auth0/Clerk on the test copy and confirm sign-in works.
5. **Test everything** on the copy (the ~1,500 automated checks that ship with the code make this fast and trustworthy).
6. Only when the copy works perfectly, **point your web address at the new server** and retire the Manus version.

Keeping the Manus version running until the new one is proven means **zero downtime and an easy fallback**.

---

## 8. What changed in this update (so you're current)

The connection error you hit (`This site can't be reached` / a stuck `?code=...` link) came from an **expired or reused sign-in link** hitting the server in a way it didn't handle politely — it errored out instead of just asking you to sign in again. I fixed that:

- Expired, reused, or malformed sign-in links now **redirect you to a friendly "your sign-in link expired — please sign in again" screen** instead of a raw error.
- The server **no longer crashes** on a garbled login link (the root cause of the failed connection).
- Added **13 automated tests** that lock this behaviour in so it can't quietly break again.

To get this live: open the project's checkpoint I just sent and click **Publish**. Then open a **fresh** `https://kes5mtrack-z9kgo7pi.manus.space/` (don't reuse the old bookmarked link with `?code=` in it).

---

## 9. Quick answers to likely questions

**"Am I locked in to Manus?"**
No. You own the code. The only Manus-specific piece is the login button, which is a standard, small swap.

**"Will I lose my data if I leave?"**
Not if you export a backup first (Section 5). Always export right before moving.

**"Do I need to learn to code to continue?"**
No. To keep building on Manus, you just keep giving instructions and clicking Publish. To move out, you hand this guide and the ZIP to a developer.

**"Roughly what will it cost to self-host?"**
Ballpark **US$15–50/month** total (small server + small database) for an app of this size, plus a one-off developer setup fee. Manus bundles these for you today.

**"What's the safest next step if I'm unsure?"**
Do **Option C step 1 only**: export the code to GitHub. It costs nothing, changes nothing about your live site, and means a full independent copy is sitting in your own account — ready if you ever want it.

---

_This guide is about software ownership and hosting logistics only. It is not financial advice, and nothing here changes how the investment calculations in the app work._
