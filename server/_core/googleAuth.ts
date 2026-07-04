import type { Express, Request, Response } from "express";
import { SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
import * as db from "../db";
import { users } from "../../drizzle/schema";
import { ENV } from "./env";
import { getSessionCookieOptions } from "./cookies";

const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

function redirectUri(req: Request): string {
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ||
    req.protocol ||
    "https";
  const host = req.get("host") ?? "";
  return `${proto}://${host}/api/oauth/callback`;
}

async function signSession(openId: string, name: string): Promise<string> {
  const secret = new TextEncoder().encode(ENV.cookieSecret);
  const exp = Math.floor((Date.now() + ONE_YEAR_MS) / 1000);
  return new SignJWT({ openId, appId: ENV.appId, name })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setExpirationTime(exp)
    .sign(secret);
}

export function registerGoogleAuthRoutes(app: Express) {
  // Start: send the user to Google's consent screen.
  app.get("/api/auth/google/start", (req: Request, res: Response) => {
    if (!ENV.googleClientId) {
      res.redirect(302, "/?authError=google_not_configured");
      return;
    }
    const url = new URL(GOOGLE_AUTH);
    url.searchParams.set("client_id", ENV.googleClientId);
    url.searchParams.set("redirect_uri", redirectUri(req));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", "openid email profile");
    url.searchParams.set("access_type", "online");
    url.searchParams.set("prompt", "select_account");
    res.redirect(302, url.toString());
  });

  // Callback: Google returns here with ?code=...
  app.get("/api/oauth/callback", async (req: Request, res: Response) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    if (!code) {
      res.redirect(302, "/?authError=missing_code");
      return;
    }
    try {
      // 1) Exchange the code for tokens.
      const body = new URLSearchParams({
        code,
        client_id: ENV.googleClientId,
        client_secret: ENV.googleClientSecret,
        redirect_uri: redirectUri(req),
        grant_type: "authorization_code",
      });
      const tokenRes = await fetch(GOOGLE_TOKEN, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      });
      if (!tokenRes.ok) {
        console.error("[GoogleAuth] token exchange failed", await tokenRes.text());
        res.redirect(302, "/?authError=exchange_failed");
        return;
      }
      const tokens = (await tokenRes.json()) as { access_token?: string };
      if (!tokens.access_token) {
        res.redirect(302, "/?authError=no_access_token");
        return;
      }

      // 2) Fetch the verified profile (email + name).
      const infoRes = await fetch(GOOGLE_USERINFO, {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      if (!infoRes.ok) {
        console.error("[GoogleAuth] userinfo failed", await infoRes.text());
        res.redirect(302, "/?authError=userinfo_failed");
        return;
      }
      const profile = (await infoRes.json()) as {
        email?: string;
        name?: string;
        email_verified?: boolean;
      };
      const email = (profile.email ?? "").toLowerCase().trim();
      if (!email) {
        res.redirect(302, "/?authError=no_email");
        return;
      }

      // 3) Match to an EXISTING account by email (so you land on your real data).
      const database = await db.getDb();
      let openId: string | null = null;
      let displayName = profile.name || email;
      if (database) {
        const rows = await database
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);
        if (rows[0]) {
          openId = rows[0].openId;
          displayName = rows[0].name || displayName;
        }
      }

      // 4) If no existing row, create a new user keyed by a google openId.
      if (!openId) {
        openId = `google_${email}`;
        await db.upsertUser({
          openId,
          name: profile.name || null,
          email,
          loginMethod: "google",
          lastSignedIn: new Date(),
        });
      } else {
        await db.upsertUser({ openId, lastSignedIn: new Date() });
      }

      // 5) Mint the same session cookie the app already understands.
      const token = await signSession(openId, displayName);
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, token, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[GoogleAuth] callback error", error);
      res.redirect(302, "/?authError=exchange_failed");
    }
  });
}
