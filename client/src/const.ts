export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";
// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  // Guard: if login isn't configured yet, don't crash the app building a URL
  // from an undefined base. Return a placeholder so the page still renders.
  if (!oauthPortalUrl) {
    console.warn("[auth] VITE_OAUTH_PORTAL_URL not set; login disabled for now.");
    return "/?authError=login_not_configured";
  }
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);
  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId ?? "");
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");
  return url.toString();
};
