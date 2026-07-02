# Round 87 — Published site "can't be reached" / OAuth diagnosis

## Symptom
User hits `https://kes5mtrack-z9kgo7pi.manus.space/?code=3MFqEZ7Z4gaxWKDkoB6WSR` → Chrome `ERR_CONNECTION_CLOSED` / "site can't be reached".

## Probe results (2026-07-02, published domain kes5mtrack-z9kgo7pi.manus.space)
- `GET /` → 302 → `https://manus.im/app-auth?appId=Z9kgo7pi4mVGhShDcikeZn&redirectUri=https%3A%2F%2Fkes5mtrack-z9kgo7pi.manus.space%2Fmanus-oauth%2Fcallback&...` (login redirect works)
- `GET /?code=...` → 302 to the SAME app-auth login (root does NOT consume ?code)
- `GET /api/oauth/callback?code=test` → 400 `{"error":"code and state are required"}` (route EXISTS; needs state)
- `GET /manus-oauth/callback?code=test` → 400
- `GET /manus-oauth/callback?code=<real>&state=<b64>` → **502**, body `OAuth user missing openId`  ← the actual failure
- `GET /robots.txt` → 302 (goes through auth gate)
- `GET /api/trpc/auth.me` → 200 `{"result":{"data":{"json":null}}}` (server healthy, just unauthenticated)

## Key facts
- The framework's real callback path is `/manus-oauth/callback` (that's the `redirectUri` in the login redirect), which is proxied to the app's `/api/oauth/callback` (server/_core/oauth.ts handler).
- Handler (server/_core/oauth.ts) exchanges code→token→userInfo; if `!userInfo.openId` returns 400 `openId missing from user info`. The proxied error we saw is `OAuth user missing openId` + 502.
- So: SERVER IS UP. The site is reachable. The failure is the OAuth exchange returning a user with no openId (or the code was already consumed / expired). The user's screenshot URL is `/?code=...` on ROOT with NO state — that is a stale/mismatched callback (root doesn't handle code), so the browser churns.

## Likely root cause
The `?code=` landed on `/` (root) instead of `/manus-oauth/callback`. Root just re-initiates login. The `ERR_CONNECTION_CLOSED` is a transient edge/cold-start hiccup (Autoscale min-instances=0 → cold start ~2-3s; curl times were 2.2-3.0s). A reload typically fixes it. The 502 "missing openId" happens only when a real (already-used/expired) code is replayed.

## Fix directions to consider
1. Confirm it's just cold-start/replay: re-run `GET /` and a fresh login end-to-end.
2. Harden oauth.ts: on failure redirect to `/` with a friendly `?authError=` rather than raw 500/JSON, so a replayed/expired code doesn't dead-end.
3. Nothing in app code makes the domain unreachable — server + trpc are 200.
