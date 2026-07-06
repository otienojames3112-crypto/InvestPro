// Emails that are always granted admin/owner rights on login
const ADMIN_EMAILS = [
  "otienojames3112@gmail.com",
  "otienojames707@gmail.com",
];

export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Dedicated LLM endpoint (the app's own OpenAI account). When OPENAI_API_KEY is set,
  // invokeLLM uses it (and OPENAI_BASE_URL, defaulting to https://api.openai.com) for
  // the MODEL ONLY — storage/maps/voice/image still use the BUILT_IN_FORGE_* vars above.
  // When unset, invokeLLM falls back to the forge config, so today's behaviour is unchanged.
  openaiApiKey: process.env.OPENAI_API_KEY ?? "",
  openaiBaseUrl: process.env.OPENAI_BASE_URL ?? "",
  // Which model the app asks OpenAI to use. Stock OpenAI requires an explicit model on
  // every request (the Manus forge gateway picked one for us). Defaults to gpt-4o in
  // llm.ts when this is blank; set OPENAI_MODEL to override without a code change.
  openaiModel: process.env.OPENAI_MODEL ?? "",
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? "",
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
  adminEmails: ADMIN_EMAILS,
};
