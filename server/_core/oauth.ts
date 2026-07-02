import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import type { Express, Request, Response } from "express";
import * as db from "../db";
import { getSessionCookieOptions } from "./cookies";
import { sdk } from "./sdk";

function getQueryParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Redirect the browser back to the SPA with a machine-readable auth error flag
 * instead of dead-ending on a raw 4xx/5xx JSON body. The client reads
 * `?authError=` and shows a friendly "sign-in link expired" prompt.
 */
function redirectWithAuthError(res: Response, reason: string) {
  const target = `/?authError=${encodeURIComponent(reason)}`;
  res.redirect(302, target);
}

export function registerOAuthRoutes(app: Express) {
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");

    if (!code || !state) {
      // A callback with no code/state is almost always a stale or misrouted
      // link. Send the user back into a clean login flow rather than showing
      // a raw 400 JSON error.
      redirectWithAuthError(res, "missing_code");
      return;
    }

    try {
      // Derive a safe fallback callback URL from the incoming request, used only
      // if `state` is missing/garbled so the token exchange never crashes on decode.
      const proto =
        (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
        req.protocol ||
        "https";
      const host = req.get("host") ?? "";
      const fallbackRedirectUri = host ? `${proto}://${host}/api/oauth/callback` : "";
      const tokenResponse = await sdk.exchangeCodeForToken(code, state, fallbackRedirectUri);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);

      if (!userInfo.openId) {
        redirectWithAuthError(res, "missing_openid");
        return;
      }

      await db.upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: new Date(),
      });

      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS,
      });

      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });

      res.redirect(302, "/");
    } catch (error) {
      // Most common cause here is a used/expired authorization code being
      // replayed (e.g. an old bookmark). Surface it as a graceful re-login
      // prompt instead of a raw 500 that looks like the site is broken.
      console.error("[OAuth] Callback failed", error);
      redirectWithAuthError(res, "exchange_failed");
    }
  });
}
