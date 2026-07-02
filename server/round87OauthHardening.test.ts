import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Express, Request, Response } from "express";

/**
 * Round 87 — Published-site OAuth hardening.
 *
 * The published site showed ERR_CONNECTION_CLOSED / raw 500 when a stale or
 * misrouted sign-in link (e.g. `/?code=...` with no valid base64 `state`) hit
 * the callback. These tests lock in the graceful-failure behaviour:
 *   1. `decodeState` never throws on garbage/missing state (static-source guard).
 *   2. The callback redirects to `/?authError=...` instead of a raw 4xx/5xx.
 *   3. The sign-in screen surfaces a friendly banner when ?authError / ?code present.
 */

const root = join(__dirname, "..");
const sdkSrc = readFileSync(join(root, "server/_core/sdk.ts"), "utf-8");
const oauthSrc = readFileSync(join(root, "server/_core/oauth.ts"), "utf-8");
const layoutSrc = readFileSync(
  join(root, "client/src/components/DashboardLayout.tsx"),
  "utf-8"
);

describe("Round 87 A — decodeState is defensive (static source)", () => {
  it("wraps base64 decoding in a try/catch so it never throws", () => {
    const fnStart = sdkSrc.indexOf("private decodeState(");
    const fnBody = sdkSrc.slice(fnStart, fnStart + 1400);
    expect(fnStart).toBeGreaterThan(-1);
    expect(fnBody).toContain("try {");
    expect(fnBody).toContain("catch");
  });

  it("accepts a fallback redirect URI parameter", () => {
    expect(sdkSrc).toContain("decodeState(state: string, fallbackRedirectUri");
  });

  it("only trusts a decoded value that looks like an absolute http(s) URL", () => {
    const fnStart = sdkSrc.indexOf("private decodeState(");
    const fnBody = sdkSrc.slice(fnStart, fnStart + 1400);
    // The guard tests the decoded string against an absolute http(s) URL pattern.
    expect(fnBody).toContain("https?:");
    expect(fnBody).toContain(".test(decoded)");
  });

  it("threads the fallback through getTokenByCode and exchangeCodeForToken", () => {
    expect(sdkSrc).toContain("getTokenByCode(code, state, fallbackRedirectUri)");
    expect(sdkSrc).toContain("fallbackRedirectUri = \"\"");
  });
});

describe("Round 87 B — callback redirects instead of erroring (static source)", () => {
  it("redirects with an authError flag rather than sending a raw status/JSON", () => {
    expect(oauthSrc).toContain("redirectWithAuthError");
    expect(oauthSrc).toContain("/?authError=");
  });

  it("handles missing code/state by redirecting, not 400", () => {
    expect(oauthSrc).toContain('redirectWithAuthError(res, "missing_code")');
  });

  it("handles a missing openId gracefully", () => {
    expect(oauthSrc).toContain('redirectWithAuthError(res, "missing_openid")');
  });

  it("catches exchange failures (expired/replayed code) and redirects", () => {
    expect(oauthSrc).toContain('redirectWithAuthError(res, "exchange_failed")');
  });

  it("derives a request-based fallback callback URL", () => {
    expect(oauthSrc).toContain('req.get("host")');
    expect(oauthSrc).toContain("/api/oauth/callback");
  });
});

describe("Round 87 C — sign-in screen surfaces a friendly banner (static source)", () => {
  it("reads ?authError and treats a stray ?code as a stale link", () => {
    expect(layoutSrc).toContain('params.get("authError")');
    expect(layoutSrc).toContain('params.get("code")');
    expect(layoutSrc).toContain("stale_link");
  });

  it("shows an expired-link message", () => {
    expect(layoutSrc).toMatch(/expired or was already used/i);
  });
});

describe("Round 87 D — callback runtime behaviour", () => {
  let handler: ((req: Request, res: Response) => Promise<void> | void) | null =
    null;

  beforeEach(async () => {
    vi.resetModules();
    // Stub the SDK so we exercise the callback wiring, not the network.
    vi.doMock("../server/_core/sdk", () => ({
      sdk: {
        exchangeCodeForToken: vi.fn(async () => {
          throw new Error("invalid_grant: code already used");
        }),
        getUserInfo: vi.fn(async () => ({ openId: "x" })),
        createSessionToken: vi.fn(async () => "tok"),
      },
    }));
    vi.doMock("../server/db", () => ({ upsertUser: vi.fn(async () => {}) }));

    const mod = await import("./_core/oauth");
    const app = {
      get: (_path: string, h: (req: Request, res: Response) => void) => {
        handler = h as typeof handler;
      },
    } as unknown as Express;
    mod.registerOAuthRoutes(app);
  });

  afterEach(() => {
    vi.doUnmock("../server/_core/sdk");
    vi.doUnmock("../server/db");
    handler = null;
  });

  function makeReqRes(query: Record<string, string>) {
    let redirectedTo = "";
    const req = {
      query,
      headers: {},
      protocol: "https",
      get: (k: string) => (k === "host" ? "example.manus.space" : undefined),
    } as unknown as Request;
    const res = {
      redirect: (_status: number, url: string) => {
        redirectedTo = url;
      },
      cookie: () => {},
    } as unknown as Response;
    return { req, res, getRedirect: () => redirectedTo };
  }

  it("redirects to /?authError=missing_code when code/state absent", async () => {
    expect(handler).toBeTruthy();
    const { req, res, getRedirect } = makeReqRes({});
    await handler!(req, res);
    expect(getRedirect()).toBe("/?authError=missing_code");
  });

  it("redirects to /?authError=exchange_failed when the code is expired/replayed", async () => {
    const { req, res, getRedirect } = makeReqRes({ code: "used", state: "aHR0cHM6Ly9leC9jYg==" });
    await handler!(req, res);
    expect(getRedirect()).toBe("/?authError=exchange_failed");
  });
});
