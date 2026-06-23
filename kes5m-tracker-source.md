# KES 5M Investment Tracker — Full Source Code

A React 19 + Tailwind 4 + Express + tRPC application that projects a 10-year journey to KES 5,000,000 across Money Market Funds and CBK government securities, and reconciles the projection against live recorded holdings.

> This document contains the application-level source only. Framework plumbing (`server/_core`, `client/src/_core`), generated shadcn/ui primitives (`client/src/components/ui`), test specs, migrations and lockfiles are omitted.

## Table of Contents

1. [Project Configuration](#project-configuration)
2. [Database — Drizzle Schema & Relations](#database--drizzle-schema--relations)
3. [Shared (client + server)](#shared-client--server)
4. [Server — Projection Engine, DB Helpers, tRPC Routers, Storage](#server--projection-engine-db-helpers-trpc-routers-storage)
5. [Client — Entry, App, Global Styles](#client--entry-app-global-styles)
6. [Client — Contexts](#client--contexts)
7. [Client — Hooks](#client--hooks)
8. [Client — Lib](#client--lib)
9. [Client — App Components](#client--app-components)
10. [Client — Pages](#client--pages)


## Project Configuration


### `package.json`

```json
{
  "name": "kes5m-tracker",
  "version": "1.0.0",
  "type": "module",
  "license": "MIT",
  "scripts": {
    "dev": "NODE_ENV=development tsx watch server/_core/index.ts",
    "build": "vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist",
    "start": "NODE_ENV=production node dist/index.js",
    "check": "tsc --noEmit",
    "format": "prettier --write .",
    "test": "vitest run",
    "db:push": "drizzle-kit generate && drizzle-kit migrate"
  },
  "dependencies": {
    "@aws-sdk/client-s3": "^3.693.0",
    "@aws-sdk/s3-request-presigner": "^3.693.0",
    "@hookform/resolvers": "^5.2.2",
    "@radix-ui/react-accordion": "^1.2.12",
    "@radix-ui/react-alert-dialog": "^1.1.15",
    "@radix-ui/react-aspect-ratio": "^1.1.7",
    "@radix-ui/react-avatar": "^1.1.10",
    "@radix-ui/react-checkbox": "^1.3.3",
    "@radix-ui/react-collapsible": "^1.1.12",
    "@radix-ui/react-context-menu": "^2.2.16",
    "@radix-ui/react-dialog": "^1.1.15",
    "@radix-ui/react-dropdown-menu": "^2.1.16",
    "@radix-ui/react-hover-card": "^1.1.15",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-menubar": "^1.1.16",
    "@radix-ui/react-navigation-menu": "^1.2.14",
    "@radix-ui/react-popover": "^1.1.15",
    "@radix-ui/react-progress": "^1.1.7",
    "@radix-ui/react-radio-group": "^1.3.8",
    "@radix-ui/react-scroll-area": "^1.2.10",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-separator": "^1.1.7",
    "@radix-ui/react-slider": "^1.3.6",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-switch": "^1.2.6",
    "@radix-ui/react-tabs": "^1.1.13",
    "@radix-ui/react-toggle": "^1.1.10",
    "@radix-ui/react-toggle-group": "^1.1.11",
    "@radix-ui/react-tooltip": "^1.2.8",
    "@tanstack/react-query": "^5.90.2",
    "@trpc/client": "^11.6.0",
    "@trpc/react-query": "^11.6.0",
    "@trpc/server": "^11.6.0",
    "axios": "^1.12.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "cookie": "^1.0.2",
    "date-fns": "^4.1.0",
    "dotenv": "^17.2.2",
    "drizzle-orm": "^0.44.5",
    "embla-carousel-react": "^8.6.0",
    "express": "^4.21.2",
    "framer-motion": "^12.23.22",
    "input-otp": "^1.4.2",
    "jose": "6.1.0",
    "lucide-react": "^0.453.0",
    "mysql2": "^3.15.0",
    "nanoid": "^5.1.5",
    "next-themes": "^0.4.6",
    "react": "^19.2.1",
    "react-day-picker": "^9.11.1",
    "react-dom": "^19.2.1",
    "react-hook-form": "^7.64.0",
    "react-resizable-panels": "^3.0.6",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "streamdown": "^1.4.0",
    "superjson": "^1.13.3",
    "tailwind-merge": "^3.3.1",
    "tailwindcss-animate": "^1.0.7",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "zod": "^4.1.12"
  },
  "devDependencies": {
    "@builder.io/vite-plugin-jsx-loc": "^0.1.1",
    "@tailwindcss/typography": "^0.5.15",
    "@tailwindcss/vite": "^4.1.3",
    "@types/express": "4.17.21",
    "@types/google.maps": "^3.58.1",
    "@types/node": "^24.7.0",
    "@types/react": "^19.2.1",
    "@types/react-dom": "^19.2.1",
    "@vitejs/plugin-react": "^5.0.4",
    "add": "^2.0.6",
    "autoprefixer": "^10.4.20",
    "drizzle-kit": "^0.31.4",
    "esbuild": "^0.25.0",
    "pnpm": "^10.15.1",
    "postcss": "^8.4.47",
    "prettier": "^3.6.2",
    "tailwindcss": "^4.1.14",
    "tsx": "^4.19.1",
    "tw-animate-css": "^1.4.0",
    "typescript": "5.9.3",
    "vite": "^7.1.7",
    "vite-plugin-manus-runtime": "^0.0.58",
    "vitest": "^2.1.4"
  },
  "packageManager": "pnpm@10.4.1+sha512.c753b6c3ad7afa13af388fa6d808035a008e30ea9993f58c6663e2bc5ff21679aa834db094987129aa4d488b86df57f7b634981b2f827cdcacc698cc0cfb88af",
  "pnpm": {
    "patchedDependencies": {
      "wouter@3.7.1": "patches/wouter@3.7.1.patch"
    },
    "overrides": {
      "tailwindcss>nanoid": "3.3.7"
    }
  }
}
```

### `tsconfig.json`

```json
{
  "include": ["client/src/**/*", "shared/**/*", "server/**/*"],
  "exclude": ["node_modules", "build", "dist", "**/*.test.ts"],
  "compilerOptions": {
    "incremental": true,
    "tsBuildInfoFile": "./node_modules/typescript/tsbuildinfo",
    "noEmit": true,
    "module": "ESNext",
    "strict": true,
    "lib": ["esnext", "dom", "dom.iterable"],
    "jsx": "preserve",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "bundler",
    "baseUrl": ".",
    "types": ["node", "vite/client"],
    "paths": {
      "@/*": ["./client/src/*"],
      "@shared/*": ["./shared/*"]
    }
  }
}
```

### `vite.config.ts`

```ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";

// =============================================================================
// Manus Debug Collector - Vite Plugin
// Writes browser logs directly to files, trimmed when exceeding size limit
// =============================================================================

const PROJECT_ROOT = import.meta.dirname;
const LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB per log file
const TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6); // Trim to 60% to avoid constant re-trimming

type LogSource = "browserConsole" | "networkRequests" | "sessionReplay";

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function trimLogFile(logPath: string, maxSize: number) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }

    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines: string[] = [];
    let keptBytes = 0;

    // Keep newest lines (from end) that fit within 60% of maxSize
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}\n`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }

    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
    /* ignore trim errors */
  }
}

function writeToLogFile(source: LogSource, entries: unknown[]) {
  if (entries.length === 0) return;

  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);

  // Format entries with timestamps
  const lines = entries.map((entry) => {
    const ts = new Date().toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });

  // Append to log file
  fs.appendFileSync(logPath, `${lines.join("\n")}\n`, "utf-8");

  // Trim if exceeds max size
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}

/**
 * Vite plugin to collect browser debug logs
 * - POST /__manus__/logs: Browser sends logs, written directly to files
 * - Files: browserConsole.log, networkRequests.log, sessionReplay.log
 * - Auto-trimmed when exceeding 1MB (keeps newest entries)
 */
function vitePluginManusDebugCollector(): Plugin {
  return {
    name: "manus-debug-collector",

    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true,
            },
            injectTo: "head",
          },
        ],
      };
    },

    configureServer(server: ViteDevServer) {
      // POST /__manus__/logs: Browser sends logs (written directly to files)
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }

        const handlePayload = (payload: any) => {
          // Write logs directly to files
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };

        const reqBody = (req as { body?: unknown }).body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }

        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });

        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    },
  };
}

const plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];

export default defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1",
    ],
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
```

### `vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@": path.resolve(templateRoot, "client", "src"),
      "@shared": path.resolve(templateRoot, "shared"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: ["server/**/*.test.ts", "server/**/*.spec.ts"],
  },
});
```

### `drizzle.config.ts`

```ts
import { defineConfig } from "drizzle-kit";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

export default defineConfig({
  schema: "./drizzle/schema.ts",
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: {
    url: connectionString,
  },
});
```

### `components.json`

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "css": "client/src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  }
}
```


## Database — Drizzle Schema & Relations


### `drizzle/schema.ts`

```ts
import { sql } from "drizzle-orm";
import {
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
  decimal,
  boolean,
  date,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/**
 * Portfolios — one user can own many portfolios.
 * Each portfolio is a self-contained investment plan with its own target,
 * horizon, contribution schedule, phase fractions, and rate sources.
 */
export const portfolios = mysqlTable("portfolios", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  /** Human-readable label, e.g. "James — 5M Plan" */
  name: varchar("name", { length: 200 }).notNull().default("My Portfolio"),
  /** Optional description / notes */
  description: text("description"),
  /** Target portfolio value to hold at end of horizon */
  targetAmount: decimal("targetAmount", { precision: 14, scale: 2 }).notNull().default("5000000.00"),
  /** Plan start date (YYYY-MM-DD) */
  startDate: date("startDate").notNull().default(sql`'2026-07-01'`),
  /** Total plan duration in months (12–240). Default 120 = 10 years. */
  horizonMonths: int("horizonMonths").notNull().default(120),
  /** Starting monthly contribution (KES) */
  startingContribution: decimal("startingContribution", { precision: 10, scale: 2 }).notNull().default("2500.00"),
  /** Step-up amount added every stepUpMonths */
  stepUpAmount: decimal("stepUpAmount", { precision: 10, scale: 2 }).notNull().default("3000.00"),
  /** How often to step up (months) */
  stepUpMonths: int("stepUpMonths").notNull().default(6),
  /** Minimum MMF balance before sweeping to DhowCSD */
  safetyFloor: decimal("safetyFloor", { precision: 10, scale: 2 }).notNull().default("50000.00"),
  /**
   * Phase fractions (must sum to 1.0). Expressed as decimal fractions of horizonMonths.
   * Defaults match the original PDF: Foundation 20%, Growth 50%, De-risking 15%, Final 15%.
   */
  foundationFrac: decimal("foundationFrac", { precision: 5, scale: 4 }).notNull().default("0.2000"),
  growthFrac: decimal("growthFrac", { precision: 5, scale: 4 }).notNull().default("0.5000"),
  deRiskingFrac: decimal("deRiskingFrac", { precision: 5, scale: 4 }).notNull().default("0.1500"),
  // finalLiquidityFrac is implied: 1 - foundationFrac - growthFrac - deRiskingFrac
  /** Editable source URL for CBK T-Bills rates page */
  cbkSourceUrl: varchar("cbkSourceUrl", { length: 500 }).notNull().default("https://www.centralbank.go.ke/bills-bonds/treasury-bills/"),
  /** Editable source URL for SanlamAllianz MMF page */
  sanlamSourceUrl: varchar("sanlamSourceUrl", { length: 500 }).notNull().default("https://www.sanlamallianz.co.ke/products/savings-and-investments/money-market-fund/"),
  /** Timestamp of last manual rate update (for staleness indicator) */
  ratesLastUpdatedAt: timestamp("ratesLastUpdatedAt"),
  /**
   * Selected MMF fund for this portfolio (nullable FK to mmf_funds).
   * If set, engine uses this fund's EAR as the MMF return (WHT still applied on top).
   * If null, engine falls back to rate_settings.mmfYield.
   */
  mmfFundId: int("mmfFundId"),
  /**
   * Test/live boundary. When true, this portfolio belongs to the user's
   * sandbox (Test mode) and must never mix with live portfolios.
   * All portfolio-scoped queries filter by the active mode.
   */
  isSandbox: boolean("isSandbox").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Portfolio = typeof portfolios.$inferSelect;
export type InsertPortfolio = typeof portfolios.$inferInsert;

/**
 * Investment rate settings — one row per portfolio.
 * The plan-level settings (target, horizon, contributions) live in portfolios.
 * This table holds only the market rate inputs.
 */
export const rateSettings = mysqlTable("rate_settings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull().default("8.7800"),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull().default("8.8206"),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull().default("8.7782"),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull().default("8.9746"),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull().default("12.5000"),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull().default("12.3500"),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull().default("15.0000"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type RateSettings = typeof rateSettings.$inferSelect;
export type InsertRateSettings = typeof rateSettings.$inferInsert;

/**
 * Month-by-month ledger entries — one row per month per portfolio.
 */
export const ledgerEntries = mysqlTable("ledger_entries", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  monthNumber: int("monthNumber").notNull(),
  entryDate: date("entryDate").notNull(),
  contribution: decimal("contribution", { precision: 10, scale: 2 }).notNull().default("0.00"),
  cbkCashIn: decimal("cbkCashIn", { precision: 10, scale: 2 }).notNull().default("0.00"),
  mmfToDhow: decimal("mmfToDhow", { precision: 10, scale: 2 }).notNull().default("0.00"),
  mainAction: text("mainAction"),
  mmfEndBalance: decimal("mmfEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  tbillEndBalance: decimal("tbillEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  ifbEndBalance: decimal("ifbEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  fxdEndBalance: decimal("fxdEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  totalEndBalance: decimal("totalEndBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  isActual: boolean("isActual").notNull().default(false),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type LedgerEntry = typeof ledgerEntries.$inferSelect;
export type InsertLedgerEntry = typeof ledgerEntries.$inferInsert;

/**
 * CBK securities register — individual T-bill and bond purchases per portfolio.
 */
export const securities = mysqlTable("securities", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  securityType: mysqlEnum("securityType", ["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]).notNull(),
  faceValue: decimal("faceValue", { precision: 14, scale: 2 }).notNull(),
  issueDate: date("issueDate").notNull(),
  maturityDate: date("maturityDate").notNull(),
  couponRate: decimal("couponRate", { precision: 8, scale: 4 }).notNull().default("0.0000"),
  isTaxExempt: boolean("isTaxExempt").notNull().default(false),
  isMatured: boolean("isMatured").notNull().default(false),
  /** When this lot was recycled via re-buy/split, points at the replacement security's id (audit trail). */
  rolledIntoId: int("rolledIntoId"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Security = typeof securities.$inferSelect;
export type InsertSecurity = typeof securities.$inferInsert;

/**
 * Contribution overrides — manual overrides or lump sums for specific months per portfolio.
 */
export const contributionOverrides = mysqlTable("contribution_overrides", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  monthNumber: int("monthNumber").notNull(),
  overrideAmount: decimal("overrideAmount", { precision: 10, scale: 2 }).notNull(),
  lumpSum: decimal("lumpSum", { precision: 10, scale: 2 }).notNull().default("0.00"),
  reason: text("reason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ContributionOverride = typeof contributionOverrides.$inferSelect;
export type InsertContributionOverride = typeof contributionOverrides.$inferInsert;

/**
 * Deposit entries — real money deposited into each investment bucket per portfolio.
 */
export const depositEntries = mysqlTable("deposit_entries", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /**
   * Legacy bucket. Kept for backward compatibility and for government
   * securities (T-bill/IFB/FXD). Derived from the destination where possible.
   */
  bucket: mysqlEnum("bucket", ["mmf", "tbill", "ifb", "fxd"]).notNull(),
  /**
   * Destination institution type. Names WHERE the money actually went:
   * - mmf_fund: an MMF account (mmfFundId set; primary or a secondary fund)
   * - bank_instrument: a live bank holding (bankHoldingId set)
   * - government_security: a CBK T-bill/IFB/FXD bucket (bucket set)
   */
  institutionType: mysqlEnum("institutionType", ["mmf_fund", "bank_instrument", "government_security"]).notNull().default("government_security"),
  /** FK to mmf_funds.id when institutionType = mmf_fund */
  mmfFundId: int("mmfFundId"),
  /** FK to bank_instrument_holdings.id when institutionType = bank_instrument */
  bankHoldingId: int("bankHoldingId"),
  /**
   * FK to securities.id when institutionType = government_security.
   * A government-security deposit auto-creates a register row; this links the
   * two so the register stays the single source of truth (no double-counting)
   * and deleting the deposit can remove its register entry.
   */
  securityId: int("securityId"),
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  depositDate: date("depositDate").notNull(),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type DepositEntry = typeof depositEntries.$inferSelect;
export type InsertDepositEntry = typeof depositEntries.$inferInsert;

/**
 * Rate history — per-portfolio rate snapshots for time-locked projection.
 */
export const rateHistory = mysqlTable("rate_history", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  effectiveDate: date("effectiveDate").notNull(),
  mmfYield: decimal("mmfYield", { precision: 8, scale: 4 }).notNull(),
  tbill91Rate: decimal("tbill91Rate", { precision: 8, scale: 4 }).notNull(),
  tbill182Rate: decimal("tbill182Rate", { precision: 8, scale: 4 }).notNull(),
  tbill364Rate: decimal("tbill364Rate", { precision: 8, scale: 4 }).notNull(),
  ifbCouponRate: decimal("ifbCouponRate", { precision: 8, scale: 4 }).notNull(),
  fxdCouponRate: decimal("fxdCouponRate", { precision: 8, scale: 4 }).notNull(),
  withholdingTax: decimal("withholdingTax", { precision: 8, scale: 4 }).notNull(),
  changeNote: text("changeNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type RateHistory = typeof rateHistory.$inferSelect;
export type InsertRateHistory = typeof rateHistory.$inferInsert;

/**
 * Account status — tracks whether the user has opened each investment account.
 * Keyed to portfolioId so each plan can track its own account setup progress.
 */
export const accountStatus = mysqlTable("account_status", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  accountType: mysqlEnum("accountType", ["mmf", "dhowcsd"]).notNull(),
  isOpened: boolean("isOpened").notNull().default(false),
  accountNumber: varchar("accountNumber", { length: 100 }),
  accountName: varchar("accountName", { length: 200 }),
  dateOpened: date("dateOpened"),
  phoneNumber: varchar("phoneNumber", { length: 20 }),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type AccountStatus = typeof accountStatus.$inferSelect;
export type InsertAccountStatus = typeof accountStatus.$inferInsert;

// pendingRateFetches and rateFetchLog tables removed — replaced by manual rate entry flow

/**
 * MMF Funds — CMA-regulated Kenyan money market funds.
 * Maintained manually; shared across all portfolios (not per-portfolio).
 */
export const mmfFunds = mysqlTable("mmf_funds", {
  id: int("id").autoincrement().primaryKey(),
  /** Fund name, e.g. "SanlamAllianz Money Market Fund" */
  fundName: varchar("fundName", { length: 200 }).notNull(),
  /** Fund manager / company, e.g. "SanlamAllianz Kenya" */
  company: varchar("company", { length: 200 }).notNull(),
  /** Quoted gross yield (% p.a.) before management fee */
  grossYield: decimal("grossYield", { precision: 8, scale: 4 }).notNull(),
  /** Effective Annual Rate net of management fee (% p.a.) — used by engine */
  ear: decimal("ear", { precision: 8, scale: 4 }).notNull(),
  /** Annual management fee (% p.a.) */
  managementFee: decimal("managementFee", { precision: 6, scale: 4 }).notNull().default("2.0000"),
  /** Minimum investment amount (KES) */
  minInvestment: decimal("minInvestment", { precision: 12, scale: 2 }).notNull().default("1000.00"),
  /** Assets under management (KES millions) — optional */
  aumMillions: decimal("aumMillions", { precision: 12, scale: 2 }),
  /** Date the data was sourced / last verified */
  asOfDate: date("asOfDate"),
  /** Source URL or description */
  source: varchar("source", { length: 500 }),
  /** Whether this fund is active / still available */
  isActive: boolean("isActive").notNull().default(true),
  /** Day-count basis for daily accrual: 365 (actual/365) or 360 */
  dayCountBasis: int("dayCountBasis").notNull().default(365),
  /** Crediting / compounding frequency: "daily" (net joins balance daily) or "monthly" (accrues daily, paid month-end) */
  creditingFrequency: mysqlEnum("creditingFrequency", ["daily", "monthly"]).notNull().default("daily"),
  /** Per-fund withholding tax rate on interest (% ) — default 15 */
  whtRate: decimal("whtRate", { precision: 6, scale: 4 }).notNull().default("15.0000"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MmfFund = typeof mmfFunds.$inferSelect;
export type InsertMmfFund = typeof mmfFunds.$inferInsert;

/**
 * Other holdings — real estate, equities, ETFs, and other assets tracked per portfolio.
 * This is a TRACKING layer only. No recommendations are made.
 */
export const otherHoldings = mysqlTable("other_holdings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Asset class */
  assetClass: mysqlEnum("assetClass", ["real_estate", "equity", "etf", "pension", "sacco", "business", "crypto", "insurance", "other"]).notNull(),
  /** User-supplied name, e.g. "Nairobi apartment", "Safaricom shares" */
  name: varchar("name", { length: 200 }).notNull(),
  /** Optional description / notes */
  description: text("description"),
  /** Purchase / cost basis (KES) */
  purchaseValue: decimal("purchaseValue", { precision: 14, scale: 2 }).notNull(),
  /** Current estimated value (KES) — updated manually */
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).notNull(),
  /** Date of purchase / acquisition */
  purchaseDate: date("purchaseDate"),
  /** User's own notes */
  notes: text("notes"),
  /**
   * Optional user-entered assumed annual return (%) for scenario modelling.
   * Conservative / base / optimistic — all three are user-entered assumptions,
   * never engine-generated forecasts.
   */
  assumedReturnConservative: decimal("assumedReturnConservative", { precision: 6, scale: 2 }),
  assumedReturnBase: decimal("assumedReturnBase", { precision: 6, scale: 2 }),
  assumedReturnOptimistic: decimal("assumedReturnOptimistic", { precision: 6, scale: 2 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type OtherHolding = typeof otherHoldings.$inferSelect;
export type InsertOtherHolding = typeof otherHoldings.$inferInsert;

/**
 * Holding income — dividends, rent, and other income per holding.
 */
export const holdingIncome = mysqlTable("holding_income", {
  id: int("id").autoincrement().primaryKey(),
  holdingId: int("holdingId").notNull(),
  /** Income amount (KES) */
  amount: decimal("amount", { precision: 14, scale: 2 }).notNull(),
  /** Date received */
  incomeDate: date("incomeDate").notNull(),
  /** Income type, e.g. "dividend", "rent", "interest" */
  incomeType: varchar("incomeType", { length: 50 }).notNull().default("other"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type HoldingIncome = typeof holdingIncome.$inferSelect;
export type InsertHoldingIncome = typeof holdingIncome.$inferInsert;

/**
 * Secondary MMF accounts — additional MMF funds a user is investing in alongside
 * their primary fund. Each row links a portfolio to an mmfFund and stores the
 * user's current balance in that fund.
 *
 * The primary fund is stored on the portfolio row (mmfFundId).
 * This table holds any additional funds the user wants to track.
 */
export const portfolioSecondaryMmfs = mysqlTable("portfolio_secondary_mmfs", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** References mmfFunds.id */
  mmfFundId: int("mmfFundId").notNull(),
  /** Optional user label, e.g. "Cytonn MMF (savings)" */
  label: varchar("label", { length: 200 }),
  /** Current balance in this fund (KES) — updated manually */
  currentBalance: decimal("currentBalance", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Monthly contribution amount allocated to this fund (KES) */
  monthlyContribution: decimal("monthlyContribution", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Notes */
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});
export type PortfolioSecondaryMmf = typeof portfolioSecondaryMmfs.$inferSelect;
export type InsertPortfolioSecondaryMmf = typeof portfolioSecondaryMmfs.$inferInsert;


/**
 * MMF composition — editable asset-allocation breakdown per fund.
 * Linked to mmfFunds.id. Buckets stored as percentages (0–100).
 * Seeded from published 2026 factsheets; fully user-editable.
 */
export const mmfComposition = mysqlTable("mmf_composition", {
  id: int("id").autoincrement().primaryKey(),
  /** References mmfFunds.id */
  mmfFundId: int("mmfFundId").notNull(),
  /** % in Government Securities (T-bills, T-bonds, IFBs) — total */
  govSecurities: decimal("govSecurities", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Treasury Bills */
  govTbills: decimal("govTbills", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Treasury Bonds (FXD) */
  govTbonds: decimal("govTbonds", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Sub-breakdown of govSecurities: % of the WHOLE fund in Infrastructure Bonds (IFB) */
  govIfb: decimal("govIfb", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Banking Sector Instruments (fixed / call / demand deposits) */
  bankInstruments: decimal("bankInstruments", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Corporate Short-Term Debt (commercial paper, corporate notes) */
  corporateDebt: decimal("corporateDebt", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Cash & Cash Equivalents */
  cashEquivalents: decimal("cashEquivalents", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Collective Investment Schemes / Regional / Offshore */
  offshoreRegional: decimal("offshoreRegional", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in Real Estate / Property (most pure MMFs hold 0; some affiliated funds have exposure) */
  realEstate: decimal("realEstate", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** % in any other asset class not covered above (structured notes, etc.) */
  otherAssets: decimal("otherAssets", { precision: 6, scale: 2 }).notNull().default("0.00"),
  /** Per-segment detail notes (which holdings + indicative rates) */
  bankNote: text("bankNote"),
  corporateNote: text("corporateNote"),
  cashNote: text("cashNote"),
  offshoreNote: text("offshoreNote"),
  realEstateNote: text("realEstateNote"),
  otherNote: text("otherNote"),
  /** Plain-language notes on strategy / how the fund earns its return */
  notes: text("notes"),
  /** "As of" date for this composition snapshot */
  asOfDate: date("asOfDate"),
  /** Source URL or description (factsheet) */
  source: varchar("source", { length: 500 }),
  /** Whether figures are exact (from factsheet) or estimated */
  isEstimate: boolean("isEstimate").notNull().default(false),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MmfComposition = typeof mmfComposition.$inferSelect;
export type InsertMmfComposition = typeof mmfComposition.$inferInsert;

/**
 * Bank Sector Instruments — editable reference table of Kenyan bank
 * call / fixed deposit products. Global (shared across portfolios).
 */
export const bankInstruments = mysqlTable("bank_instruments", {
  id: int("id").autoincrement().primaryKey(),
  /** Bank name, e.g. "Equity Bank" */
  bankName: varchar("bankName", { length: 200 }).notNull(),
  /** Instrument type */
  instrumentType: mysqlEnum("instrumentType", ["call_deposit", "fixed_deposit"]).notNull(),
  /** Minimum amount (KES) */
  minAmount: decimal("minAmount", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Typical tenor, e.g. "1–12 months" */
  typicalTenor: varchar("typicalTenor", { length: 100 }),
  /** Indicative rate (% p.a.) — negotiated rates vary */
  indicativeRate: decimal("indicativeRate", { precision: 6, scale: 2 }),
  /** Whether the rate is negotiable */
  isNegotiable: boolean("isNegotiable").notNull().default(true),
  /** Notes */
  notes: text("notes"),
  /** "As of" date */
  asOfDate: date("asOfDate"),
  /** Source URL */
  source: varchar("source", { length: 500 }),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BankInstrument = typeof bankInstruments.$inferSelect;
export type InsertBankInstrument = typeof bankInstruments.$inferInsert;

/**
 * Bank Instrument Holdings — LIVE actual money the user has placed in a
 * bank call/fixed deposit, per portfolio. This is the actuals counterpart
 * to the global `bankInstruments` reference catalog.
 *
 * These holdings are real recorded money: they appear in net worth and the
 * allocation breakdown, earn interest in the accrual ledger (rate, day-count,
 * 15% WHT where applicable), and their maturities show in the liquidity calendar.
 * Fixed deposits typically pay at maturity; call deposits accrue and are
 * withdrawable on call. Rates are manually editable with as-of dates.
 */
export const bankInstrumentHoldings = mysqlTable("bank_instrument_holdings", {
  id: int("id").autoincrement().primaryKey(),
  portfolioId: int("portfolioId").notNull(),
  /** Bank name, e.g. "Equity Bank" */
  bankName: varchar("bankName", { length: 200 }).notNull(),
  /** Optional user label, e.g. "Equity 3-month FD" */
  label: varchar("label", { length: 200 }),
  /** Instrument type */
  instrumentType: mysqlEnum("instrumentType", ["call_deposit", "fixed_deposit"]).notNull(),
  /** Principal placed (KES) */
  principal: decimal("principal", { precision: 14, scale: 2 }).notNull().default("0.00"),
  /** Annual interest rate (% p.a.) — manually editable */
  interestRate: decimal("interestRate", { precision: 6, scale: 4 }).notNull().default("0.0000"),
  /** As-of date for the interest rate */
  rateAsOfDate: date("rateAsOfDate"),
  /** Whether the rate is negotiable */
  isNegotiable: boolean("isNegotiable").notNull().default(true),
  /** Day-count basis for accrual: 365 or 360 */
  dayCountBasis: int("dayCountBasis").notNull().default(365),
  /** Withholding tax rate on interest (%) — default 15 */
  whtRate: decimal("whtRate", { precision: 6, scale: 4 }).notNull().default("15.0000"),
  /** Start / placement date */
  startDate: date("startDate"),
  /** Tenor in months (for fixed deposits); null/0 for open-ended call deposits */
  tenorMonths: int("tenorMonths"),
  /** Maturity date (fixed deposits); null for call deposits */
  maturityDate: date("maturityDate"),
  /** Payout frequency, e.g. "maturity", "monthly", "quarterly" */
  payoutFrequency: mysqlEnum("payoutFrequency", ["maturity", "monthly", "quarterly", "on_call"]).notNull().default("maturity"),
  /** Current accrued value (KES) — updated manually or computed */
  currentValue: decimal("currentValue", { precision: 14, scale: 2 }).notNull().default("0.00"),
  notes: text("notes"),
  isActive: boolean("isActive").notNull().default(true),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BankInstrumentHolding = typeof bankInstrumentHoldings.$inferSelect;
export type InsertBankInstrumentHolding = typeof bankInstrumentHoldings.$inferInsert;

/**
 * Benchmark inputs — editable macro benchmarks for comparison.
 * Global (one shared set) but each row carries source + as-of.
 * Used by the benchmark-comparison view (blended return vs market / inflation).
 */
export const benchmarkInputs = mysqlTable("benchmark_inputs", {
  id: int("id").autoincrement().primaryKey(),
  /** Stable key, e.g. "mmf_market_avg", "cbr", "inflation", "tbill_91" */
  metricKey: varchar("metricKey", { length: 64 }).notNull().unique(),
  /** Human label, e.g. "MMF Market Average Yield" */
  label: varchar("label", { length: 200 }).notNull(),
  /** Value (% p.a.) */
  value: decimal("value", { precision: 8, scale: 4 }).notNull(),
  /** "As of" date */
  asOfDate: date("asOfDate"),
  /** Source URL or description */
  source: varchar("source", { length: 500 }),
  notes: text("notes"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type BenchmarkInput = typeof benchmarkInputs.$inferSelect;
export type InsertBenchmarkInput = typeof benchmarkInputs.$inferInsert;

/**
 * Audit log — change trail for rate and deposit edits (defensibility).
 * Records who changed what, when, and the before/after values.
 */
export const auditLog = mysqlTable("audit_log", {
  id: int("id").autoincrement().primaryKey(),
  /** Portfolio this change relates to (nullable for global edits) */
  portfolioId: int("portfolioId"),
  /** Entity changed, e.g. "rate_settings", "deposit_entry", "mmf_fund" */
  entity: varchar("entity", { length: 64 }).notNull(),
  /** Optional entity row id */
  entityId: int("entityId"),
  /** Action: create | update | delete */
  action: mysqlEnum("action", ["create", "update", "delete"]).notNull(),
  /** Field name changed (for updates) */
  field: varchar("field", { length: 100 }),
  /** Previous value (stringified) */
  oldValue: text("oldValue"),
  /** New value (stringified) */
  newValue: text("newValue"),
  /** User open id who made the change */
  changedByOpenId: varchar("changedByOpenId", { length: 64 }),
  /** User display name who made the change */
  changedByName: varchar("changedByName", { length: 200 }),
  /** Free-text summary */
  summary: text("summary"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type AuditLog = typeof auditLog.$inferSelect;
export type InsertAuditLog = typeof auditLog.$inferInsert;
```

### `drizzle/relations.ts`

```ts
import {} from "./schema";
```


## Shared (client + server)


### `shared/accrual.ts`

```ts
/**
 * Shared, pure financial math for MMF daily accrual and Kenyan withholding tax.
 *
 * This is the single source of truth used by both the frontend pages
 * (MmfAccrual, TaxSummary) and the vitest suite. Keep it free of any
 * React / DOM / tRPC imports so it stays trivially testable.
 */

export interface DayRow {
  day: number;
  openingBalance: number;
  grossInterest: number;
  wht: number;
  netInterest: number;
  closingBalance: number;
}

export type CreditingFrequency = "daily" | "monthly";

/**
 * Simulate daily MMF interest accrual.
 *
 * - dailyRate = annualEar% / dayCount  (dayCount is 365 or 360)
 * - gross     = balance * dailyRate
 * - wht       = gross * whtRate%
 * - net       = gross - wht
 * - "daily"   crediting: net compounds into the balance every day
 * - "monthly" crediting: interest accrues on a fixed base and is credited
 *             (compounded) every 30 days
 */
export function simulateAccrual(
  principal: number,
  annualEar: number,
  dayCount: number,
  whtRate: number,
  crediting: CreditingFrequency,
  days: number
): DayRow[] {
  const rows: DayRow[] = [];
  const dailyRate = annualEar / 100 / dayCount;
  let balance = principal;
  let accruedNet = 0;
  let accrualBase = principal;

  for (let day = 1; day <= days; day++) {
    const opening = balance;
    if (crediting === "daily") {
      const gross = balance * dailyRate;
      const wht = gross * (whtRate / 100);
      const net = gross - wht;
      balance += net;
      rows.push({
        day,
        openingBalance: opening,
        grossInterest: gross,
        wht,
        netInterest: net,
        closingBalance: balance,
      });
    } else {
      const gross = accrualBase * dailyRate;
      const wht = gross * (whtRate / 100);
      const net = gross - wht;
      accruedNet += net;
      let closing = opening;
      if (day % 30 === 0) {
        balance += accruedNet;
        closing = balance;
        accruedNet = 0;
        accrualBase = balance;
      }
      rows.push({
        day,
        openingBalance: opening,
        grossInterest: gross,
        wht,
        netInterest: net,
        closingBalance: closing,
      });
    }
  }
  return rows;
}

/** One full day of interest on a principal (no compounding). */
export function oneDayInterest(
  principal: number,
  annualEar: number,
  dayCount: number,
  whtRate: number
): { gross: number; wht: number; net: number } {
  const gross = principal * (annualEar / 100 / dayCount);
  const wht = gross * (whtRate / 100);
  return { gross, wht, net: gross - wht };
}

// ─── Kenyan withholding-tax rules (2026) ────────────────────────────────────

/** Default KRA withholding-tax rates (%). All final tax for residents. */
export const WHT_RATES = {
  /** MMF / unit-trust interest distribution. */
  mmfInterest: 15,
  /** Bank deposit interest. */
  bankInterest: 15,
  /** T-bill & T-bond (FXD) discount/coupon — 15% for bonds ≥ certain tenor. */
  tbill: 15,
  /** Treasury bond coupon (FXD). */
  fxdCoupon: 15,
  /** Dividends (resident). */
  dividend: 5,
} as const;

/** Compute WHT on a gross interest amount at a given rate (%). */
export function whtOn(grossAmount: number, ratePct: number): number {
  return Math.max(0, grossAmount) * (ratePct / 100);
}

/**
 * Annual gross interest for a holding given its balance and net EAR.
 * The EAR funds quote is already NET of the manager fee but GROSS of WHT,
 * so to recover pre-tax interest we gross-up by the WHT rate.
 */
export function grossUpAnnualInterest(
  balance: number,
  netEarPct: number,
  whtRatePct: number
): { gross: number; wht: number; net: number } {
  // netEar already reflects what the investor earns AFTER wht when expressed
  // as a take-home yield; but fund EARs are typically quoted gross-of-tax.
  // We treat the quoted EAR as the gross annual rate here.
  const gross = balance * (netEarPct / 100);
  const wht = whtOn(gross, whtRatePct);
  return { gross, wht, net: gross - wht };
}
```

### `shared/actuals.ts`

```ts
import { WHT_RATES, whtOn } from "./accrual";

/**
 * Pure, framework-free aggregation of a portfolio's LIVE actuals (net worth)
 * across every destination the user owns: primary-MMF deposit rows, the
 * government-securities REGISTER (the single source of truth for T-bill/IFB/FXD),
 * secondary MMF account balances, and bank instrument principals.
 *
 * This is the single source of truth used by `getActualsSummary` (server/db.ts)
 * and is unit-tested directly so the "deposit reflects everywhere" guarantee is
 * locked in without needing a live database.
 *
 * Double-counting rule: a deposit attributed to a secondary MMF fund, a bank
 * instrument, OR a government security is represented by that destination's
 * own running balance (secondary balance, bank principal) or register row
 * (gov securities), so its deposit row must be EXCLUDED from the primary
 * contribution sum. Only primary-MMF deposits feed `depositsContributed`.
 */

export type DepositRow = {
  amount: number;
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  institutionType?: string | null;
  mmfFundId?: number | null;
};

export type SecurityActual = {
  /** "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd" */
  securityType: string;
  faceValue: number;
  couponRate: number; // annual %, gross
  isTaxExempt: boolean;
  isMatured?: boolean;
};

export type SecondaryMmfActual = {
  mmfFundId?: number | null;
  currentBalance: number;
  ear: number;
  whtRate?: number | null;
};

export type BankHoldingActual = {
  principal: number;
  interestRate: number;
  whtRate?: number | null;
  isActive?: boolean;
};

export type ActualsRates = {
  withholdingTax: number; // percent, e.g. 15
  mmfYield: number; // percent gross
  tbillRate: number; // percent gross
  fxdCouponRate: number; // percent gross
};

export function computeActualsTotals(
  deposits: DepositRow[],
  secondaries: SecondaryMmfActual[],
  bankHoldings: BankHoldingActual[],
  rates: ActualsRates,
  securities: SecurityActual[] = [],
) {
  const secondaryFundIds = new Set(
    secondaries.map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number"),
  );

  // ── Primary-MMF deposits only ──────────────────────────────────────────────
  // Government-security, bank-instrument, and secondary-MMF deposits are each
  // represented by their own destination state (register / principal / balance),
  // so they are excluded here to avoid double-counting.
  let depositsContributed = 0;
  for (const row of deposits) {
    if (row.institutionType === "bank_instrument") continue;
    if (row.institutionType === "government_security") continue;
    if (
      row.institutionType === "mmf_fund" &&
      row.mmfFundId != null &&
      secondaryFundIds.has(row.mmfFundId)
    ) {
      continue;
    }
    depositsContributed += row.amount;
  }

  // ── Government securities: valued from the REGISTER (source of truth) ────────
  // All withholding tax flows through the shared `whtOn` helper and the
  // `WHT_RATES` table in shared/accrual.ts, so there is one tax authority.
  const govWht = rates.withholdingTax || WHT_RATES.tbill;
  const byBucket = { mmf: depositsContributed, tbill: 0, ifb: 0, fxd: 0 };
  let securitiesValue = 0;
  let tbillTax = 0;
  let fxdTax = 0;
  for (const s of securities) {
    if (s.isMatured) continue;
    securitiesValue += s.faceValue;
    const isTbill = s.securityType.startsWith("tbill");
    const isIfb = s.securityType === "ifb";
    if (isTbill) {
      byBucket.tbill += s.faceValue;
      // T-bill return is the discount; approximate annual interest = face * rate.
      tbillTax += whtOn(s.faceValue * (rates.tbillRate / 100), govWht);
    } else if (isIfb) {
      byBucket.ifb += s.faceValue; // IFB coupons are tax-exempt in Kenya
    } else {
      // FXD bond
      byBucket.fxd += s.faceValue;
      const coupon = s.couponRate > 0 ? s.couponRate : rates.fxdCouponRate;
      fxdTax += whtOn(s.faceValue * (coupon / 100), govWht);
    }
  }

  // ── Secondary MMF accounts ───────────────────────────────────────────────────
  let secondaryMmfBalance = 0;
  let secondaryMmfTax = 0;
  for (const s of secondaries) {
    const sWht = s.whtRate ?? WHT_RATES.mmfInterest;
    secondaryMmfBalance += s.currentBalance;
    secondaryMmfTax += whtOn(s.currentBalance * (s.ear / 100), sWht);
  }

  // ── Bank instruments ─────────────────────────────────────────────────────────
  let bankBalance = 0;
  let bankTax = 0;
  for (const b of bankHoldings) {
    if (b.isActive === false) continue;
    const bWht = b.whtRate ?? WHT_RATES.bankInterest;
    bankBalance += b.principal;
    bankTax += whtOn(b.principal * (b.interestRate / 100), bWht);
  }

  const mmfTax = whtOn(depositsContributed * (rates.mmfYield / 100), rates.withholdingTax || WHT_RATES.mmfInterest);
  const ifbTax = 0; // IFB coupons are tax-exempt in Kenya

  const totalContributed =
    depositsContributed + securitiesValue + secondaryMmfBalance + bankBalance;
  const taxLiability = mmfTax + tbillTax + ifbTax + fxdTax + secondaryMmfTax + bankTax;

  return {
    totalContributed,
    depositsContributed,
    securitiesValue,
    secondaryMmfBalance,
    bankBalance,
    byBucket,
    taxBreakdown: {
      mmf: Math.round(mmfTax * 100) / 100,
      tbill: Math.round(tbillTax * 100) / 100,
      ifb: 0,
      fxd: Math.round(fxdTax * 100) / 100,
      secondaryMmf: Math.round(secondaryMmfTax * 100) / 100,
      bank: Math.round(bankTax * 100) / 100,
    },
    taxLiability,
  };
}
```

### `shared/const.ts`

```ts
export const COOKIE_NAME = "app_session_id";
export const ONE_YEAR_MS = 1000 * 60 * 60 * 24 * 365;
export const AXIOS_TIMEOUT_MS = 30_000;
export const UNAUTHED_ERR_MSG = 'Please login (10001)';
export const NOT_ADMIN_ERR_MSG = 'You do not have required permission (10002)';
```

### `shared/types.ts`

```ts
/**
 * Unified type exports
 * Import shared types from this single entry point.
 */

export type * from "../drizzle/schema";
export * from "./_core/errors";
```


## Server — Projection Engine, DB Helpers, tRPC Routers, Storage


### `server/engine.ts`

```ts
/**
 * KES Investment Compounding Engine — v3
 *
 * Tax treatment (Kenya, resident individuals — Income Tax Act Cap 470):
 *   - MMF interest:    15% WHT deducted at source (gross rate entered; engine applies WHT).
 *                      SanlamAllianz quotes a GROSS effective annual yield; WHT is applied here.
 *   - T-Bill discount: 15% WHT deducted at source; net discount flows to MMF at maturity.
 *   - IFB coupons:     Tax-exempt (all qualifying Infrastructure Bonds per Finance Act 2023;
 *                      the proposed 3-year tenor threshold was NOT enacted — all IFBs are exempt).
 *   - FXD coupons:     15% WHT deducted at source; gross rate stored, net applied here.
 *
 * Allocation rules by phase (proportional fractions of horizonMonths):
 *   Foundation    (~20%): MMF 50%, T-Bills 50%, IFB  0%, FXD  0%
 *   Growth        (~50%): MMF 20%, T-Bills 20%, IFB 45%, FXD 15%
 *   De-risking    (~15%): MMF 25%, T-Bills 35%, IFB 30%, FXD 10%
 *   Final liq.    (~15%): MMF 40%, T-Bills 45%, IFB 10%, FXD  5%
 *
 * Short-horizon strategy (horizonMonths < SHORT_HORIZON_THRESHOLD = 30):
 *   IFBs and long FXDs cannot mature in time. Strategy collapses to MMF + 91-day T-bills only.
 *   The plan becomes contribution-driven rather than return-driven.
 *
 * Key design decisions (v3, inherits v2):
 *   1. Fixed-income buckets (T-Bill, IFB, FXD) are held at FACE VALUE — they do NOT compound
 *      in place. Returns flow exclusively as cash (coupons / maturity proceeds) back into MMF.
 *      Only MMF compounds in place.
 *   2. Each security is tracked as an individual lot with its own issue month, tenor, and rate,
 *      so maturities and coupons fire on real per-lot dates.
 *   3. When actuals are provided, months before currentMonth are seeded from real deposit entries
 *      and logged securities; future months continue from the actual current balances.
 *   4. WHT is accumulated inside the engine and exposed per month.
 *   5. Sweep buys floor((mmf - safetyFloor) / 50000) lots per month, not just one.
 *   6. Horizon is variable (12–240 months). Phases are proportional fractions of the horizon.
 *   7. Backwards solver: given target, horizon, and rates, computes required startingContribution.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum horizon (months) for the full bond-ladder strategy.
 * Below this threshold, IFBs and long FXDs cannot mature in time, so the engine
 * collapses to MMF + 91-day T-bills only.
 */
export const SHORT_HORIZON_THRESHOLD = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RateSnapshot {
  effectiveDate: string; // YYYY-MM-DD
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  ifbCouponRate: number;
  fxdCouponRate: number;
  withholdingTax: number;
}

/**
 * Phase fractions — must sum to 1.0.
 * finalLiquidityFrac is implied: 1 - foundation - growth - deRisking.
 */
export interface PhaseFractions {
  foundationFrac: number; // default 0.20
  growthFrac: number;     // default 0.50
  deRiskingFrac: number;  // default 0.15
  // finalLiquidityFrac = 1 - foundationFrac - growthFrac - deRiskingFrac (default 0.15)
}

export interface EngineSettings {
  /** Gross annual MMF yield % (e.g. 8.78). WHT applied internally. */
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  /** Gross annual IFB coupon % (e.g. 12.5). Tax-exempt — no WHT. */
  ifbCouponRate: number;
  /** Gross annual FXD coupon % (e.g. 12.35). WHT applied internally → net ~10.5%. */
  fxdCouponRate: number;
  withholdingTax: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  targetAmount: number;
  startDate?: string;
  /** Total plan duration in months. Default 120. */
  horizonMonths?: number;
  /** Phase fractions. Defaults: foundation 0.20, growth 0.50, deRisking 0.15. */
  phaseFractions?: PhaseFractions;
}

/** An individual security lot held in the DhowCSD portfolio. */
export interface SecurityLot {
  id: string;
  bucket: "tbill" | "ifb" | "fxd";
  faceValue: number;
  /** Month number (1-based) when this lot was issued / purchased. */
  issueMonth: number;
  /** Tenor in months (3, 6, 12 for T-bills; 6, 12, 24, … for bonds). */
  tenorMonths: number;
  /** Annual coupon rate % (gross). 0 for T-bills (discount instruments). */
  couponRate: number;
  /** True for IFB — coupon is tax-exempt. */
  isTaxExempt: boolean;
}

export interface MonthlyContributionOverride {
  monthNumber: number;
  overrideAmount?: number;
  lumpSum?: number;
}

/**
 * A secondary MMF account held alongside the primary fund.
 * Each is projected forward independently using its own net yield, starting
 * balance, and monthly contribution, then folded into the portfolio total.
 */
export interface SecondaryMmfInput {
  /** Stable identifier (db row id), used only for traceability. */
  id?: number;
  /** Display label. */
  label?: string;
  /** Current balance (KES) at the start of the projection. */
  currentBalance: number;
  /** Monthly contribution assigned to this fund (KES). 0 if none. */
  monthlyContribution: number;
  /**
   * Gross effective annual yield % for this fund (e.g. 12.0). WHT is applied
   * inside the engine — matching how the primary MMF treats its fund EAR.
   */
  ear: number;
  /**
   * WHT % applied to this fund's interest. Defaults to the portfolio WHT when omitted.
   */
  whtRate?: number;
}

/** Actual deposit entry from the database (for actuals-seeded projection). */
export interface ActualDeposit {
  bucket: "mmf" | "tbill" | "ifb" | "fxd";
  amount: number;
  /** ISO date string YYYY-MM-DD */
  depositDate: string;
  /**
   * Destination of the deposit. Mirrors the destination-aware deposit fields
   * added in Round 17. When omitted, the deposit is attributed to the primary
   * plan via its `bucket` (legacy behaviour).
   *   - "mmf_fund"           → primary or secondary MMF fund (see mmfFundId)
   *   - "government_security"→ a T-bill/IFB/FXD lot held at face value
   *   - "bank_instrument"    → a bank call/fixed deposit (tracked separately)
   */
  institutionType?: "mmf_fund" | "government_security" | "bank_instrument" | null;
  /** Fund id when institutionType is "mmf_fund". Used to detect secondary-fund deposits. */
  mmfFundId?: number | null;
  /** Bank holding id when institutionType is "bank_instrument". */
  bankHoldingId?: number | null;
}

/**
 * A bank instrument holding (call / fixed deposit) tracked as a live actual.
 * During elapsed (actual) months it accrues simple interest on its principal
 * using its own rate, WHT, and day-count, on the same monthly footing as the
 * primary MMF, so identical money grows identically regardless of pocket.
 */
export interface ActualBankHolding {
  principal: number;
  /** Gross annual interest rate % (WHT applied internally). */
  interestRate: number;
  /** WHT % applied to this holding's interest. Defaults to portfolio WHT. */
  whtRate?: number | null;
  /** Day-count basis (365 or 360). Defaults to 365. */
  dayCountBasis?: number | null;
  /** ISO date the holding started accruing (YYYY-MM-DD). */
  startDate?: string | null;
  isActive?: boolean;
}

/** Actual security from the database (for actuals-seeded projection). */
export interface ActualSecurity {
  securityType: "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";
  faceValue: number;
  issueDate: string;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  isMatured: boolean;
}

export interface MonthResult {
  monthNumber: number;
  contribution: number;
  cbkCashIn: number;
  mmfToDhow: number;
  mainAction: string;
  mmfEnd: number;
  tbillEnd: number;
  ifbEnd: number;
  fxdEnd: number;
  totalEnd: number;
  /** Combined projected balance of all secondary MMF accounts this month. */
  secondaryMmfEnd: number;
  /** Combined projected balance of all bank instrument holdings this month. */
  bankEnd: number;
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity";
  sweepTarget: "tbill" | "ifb" | "fxd" | null;
  /** Total WHT withheld this month (MMF + T-Bill + FXD). */
  whtThisMonth: number;
  /** True if this month's data comes from actual deposits/securities. */
  isActual: boolean;
  /** True when the short-horizon strategy is active (MMF + T-bills only). */
  isShortHorizon: boolean;
}

export interface YearMilestone {
  year: number;
  month: number;
  projectedTotal: number;
  minHealthyCheckpoint: number;
  label: string;
}

export interface ScenarioResult {
  stepUp: number;
  finalMonthlySaving: number;
  totalContributed: number;
  projectedEndingValue: number;
  hitsTarget: boolean;
}

/**
 * Result of the backwards solver.
 */
export interface SolverResult {
  /** Whether a feasible solution was found within the contribution cap. */
  feasible: boolean;
  /** Required starting contribution (KES/month). */
  requiredStartingContribution: number;
  /** Step-up amount used (same as input, or 0 if no step-up). */
  stepUpAmount: number;
  /** Projected ending value at the required contribution. */
  projectedEndingValue: number;
  /** Total contributions over the horizon. */
  totalContributed: number;
  /** Shortfall if infeasible (how much more is needed at the cap). */
  shortfall: number;
  /** Whether the target is contribution-driven (short horizon). */
  isShortHorizon: boolean;
  /** Message explaining the result. */
  message: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const SCENARIO_STEPUPS = [0, 500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];

/** Maximum starting contribution the solver will try before declaring infeasible. */
const SOLVER_MAX_CONTRIBUTION = 1_000_000;

const DEFAULT_SETTINGS_FOR_MILESTONES: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  startDate: "2026-07-01",
  horizonMonths: 120,
};

/**
 * The fixed lot size used by the monthly CBK sweep. Every gov-security purchase
 * is a whole multiple of this; the MMF must keep at least one lot's worth of
 * liquidity plus a working buffer before sweeping.
 */
export const SWEEP_LOT_SIZE = 50000;

/**
 * Auto-derive a sensible MMF safety floor from the user's contribution level and
 * the sweep lot size — so the user does not have to set it by hand. The floor is
 * the larger of (a) one sweep lot (you must always be able to keep a lot's worth
 * liquid) and (b) ~2 months of the current monthly contribution (a short working
 * buffer), rounded UP to a whole sweep lot for clean sweeps. The user may still
 * override it explicitly; this only supplies the default.
 */
export function deriveSafetyFloor(
  monthlyContribution: number,
  lotSize: number = SWEEP_LOT_SIZE,
  bufferMonths = 2,
): number {
  const byContribution = Math.max(0, monthlyContribution) * bufferMonths;
  const raw = Math.max(lotSize, byContribution);
  // Round up to a whole lot so the sweep arithmetic stays clean.
  return Math.ceil(raw / lotSize) * lotSize;
}

// ─── Phase helpers ────────────────────────────────────────────────────────────

/**
 * Compute the absolute month boundaries for each phase given horizon and fractions.
 * Returns { foundationEnd, growthEnd, deRiskingEnd } — all inclusive upper bounds.
 * finalLiquidityEnd = horizonMonths.
 */
export function getPhaseBoundaries(
  horizonMonths: number,
  fractions?: PhaseFractions
): { foundationEnd: number; growthEnd: number; deRiskingEnd: number } {
  const f = fractions ?? { foundationFrac: 0.20, growthFrac: 0.50, deRiskingFrac: 0.15 };
  const foundationEnd = Math.round(horizonMonths * f.foundationFrac);
  const growthEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac));
  const deRiskingEnd = Math.round(horizonMonths * (f.foundationFrac + f.growthFrac + f.deRiskingFrac));
  return { foundationEnd, growthEnd, deRiskingEnd };
}

/**
 * Determine the phase for a given month number, using proportional boundaries.
 */
export function getPhase(
  month: number,
  horizonMonths = 120,
  fractions?: PhaseFractions
): "foundation" | "growth" | "de-risking" | "final-liquidity" {
  const { foundationEnd, growthEnd, deRiskingEnd } = getPhaseBoundaries(horizonMonths, fractions);
  if (month <= foundationEnd) return "foundation";
  if (month <= growthEnd) return "growth";
  if (month <= deRiskingEnd) return "de-risking";
  return "final-liquidity";
}

/** Net annual yield after WHT. Net = Gross × (1 − WHT/100). */
export function netYield(grossPct: number, whtPct: number): number {
  return grossPct * (1 - whtPct / 100);
}

/** Monthly compounding factor from a net annual yield percentage. */
export function monthlyRate(netAnnualPct: number): number {
  return Math.pow(1 + netAnnualPct / 100, 1 / 12) - 1;
}

export function getScheduledContribution(
  monthNumber: number,
  settings: Pick<EngineSettings, "startingContribution" | "stepUpAmount" | "stepUpMonths">
): number {
  const stepIndex = Math.floor((monthNumber - 1) / settings.stepUpMonths);
  return settings.startingContribution + stepIndex * settings.stepUpAmount;
}

export function getRatesForMonth(
  monthDate: Date,
  rateHistory: RateSnapshot[],
  currentSettings: EngineSettings
): Pick<EngineSettings, "mmfYield" | "tbill91Rate" | "tbill182Rate" | "tbill364Rate" | "ifbCouponRate" | "fxdCouponRate" | "withholdingTax"> {
  if (!rateHistory || rateHistory.length === 0) return currentSettings;
  const monthStr = monthDate.toISOString().split("T")[0];
  const sorted = [...rateHistory].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
  const snapshot = sorted.find(s => s.effectiveDate <= monthStr);
  return snapshot ?? currentSettings;
}

/**
 * Determine the sweep target for a given month, rotating through the phase allocation.
 * Returns the bucket name and the tenor (in months) to use for the new lot.
 * When isShortHorizon is true, always returns 91-day T-bills.
 */
export function getSweepTargetForMonth(
  month: number,
  sweepCountInPhase: number,
  horizonMonths = 120,
  fractions?: PhaseFractions,
  isShortHorizon = false
): { bucket: "tbill" | "ifb" | "fxd"; tenorMonths: number } | null {
  if (isShortHorizon) {
    return { bucket: "tbill", tenorMonths: 3 };
  }

  const phase = getPhase(month, horizonMonths, fractions);

  switch (phase) {
    case "foundation":
      return { bucket: "tbill", tenorMonths: 12 };

    case "growth": {
      const cycle = sweepCountInPhase % 16;
      if (cycle < 4) return { bucket: "tbill", tenorMonths: 12 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "de-risking": {
      const cycle = sweepCountInPhase % 15;
      if (cycle < 7) return { bucket: "tbill", tenorMonths: 6 };
      if (cycle < 13) return { bucket: "ifb", tenorMonths: 12 };
      return { bucket: "fxd", tenorMonths: 12 };
    }

    case "final-liquidity":
      return { bucket: "tbill", tenorMonths: 3 };

    default:
      return null;
  }
}

/**
 * 1-based month offset of a given ISO date relative to the plan start date.
 * Month 1 = the start month. Returns null when the date is missing/invalid.
 * A date before the start date clamps to 1; the caller decides further clamping.
 */
export function monthOffsetFromStart(
  isoDate: string | null | undefined,
  startDate: Date
): number | null {
  if (!isoDate) return null;
  const d = new Date(isoDate.split("T")[0] + "T12:00:00Z");
  if (isNaN(d.getTime())) return null;
  const offset =
    (d.getFullYear() - startDate.getFullYear()) * 12 +
    (d.getMonth() - startDate.getMonth());
  return offset + 1; // 1-based: the start month is month 1
}

// ─── Main projection engine ───────────────────────────────────────────────────

/**
 * Run the full projection simulation for horizonMonths months.
 *
 * @param settings         - Rate and plan settings (horizonMonths defaults to 120).
 * @param overrides        - Per-month contribution overrides.
 * @param rateHistory      - Historical rate snapshots for time-locked per-month rates.
 * @param actualDeposits   - Real deposit entries (for actuals-seeded mode).
 * @param actualSecurities - Real securities from the register (for actuals-seeded mode).
 * @param secondaryMmfs    - Secondary MMF accounts projected alongside the primary.
 * @param bankHoldings     - Bank call/fixed deposits tracked as live actuals.
 * @param primaryFundId    - Id of the portfolio's primary MMF fund. Deposits whose
 *                           mmfFundId differs (secondary funds) or whose destination
 *                           is a bank instrument are excluded from the primary MMF so
 *                           their balances are not double-counted.
 */
export function runProjection(
  settings: EngineSettings,
  overrides: MonthlyContributionOverride[] = [],
  rateHistory: RateSnapshot[] = [],
  actualDeposits: ActualDeposit[] = [],
  actualSecurities: ActualSecurity[] = [],
  secondaryMmfs: SecondaryMmfInput[] = [],
  bankHoldings: ActualBankHolding[] = [],
  primaryFundId: number | null = null
): MonthResult[] {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const fractions = settings.phaseFractions;

  const overrideMap = new Map<number, MonthlyContributionOverride>();
  for (const o of overrides) overrideMap.set(o.monthNumber, o);

  const startDate = new Date(
    (settings.startDate ?? new Date().toISOString().split("T")[0]) + "T12:00:00Z"
  );
  const today = new Date();
  const monthsSinceStart = Math.floor(
    (today.getFullYear() - startDate.getFullYear()) * 12 +
    (today.getMonth() - startDate.getMonth())
  );
  const currentMonth = Math.max(0, Math.min(monthsSinceStart, horizonMonths));
  const hasActuals = actualDeposits.length > 0 || actualSecurities.length > 0;

  const results: MonthResult[] = [];

  let mmf = 0;
  let lots: SecurityLot[] = [];
  let lotIdCounter = 0;
  let sweepCount = 0;
  let lastPhase = "";

  // Secondary MMF accounts: each projected forward independently from its own
  // current balance, using its own gross EAR (WHT applied here) and any monthly
  // contribution. Balances are folded into the portfolio total every month.
  const secondaryState = secondaryMmfs.map((s) => ({
    balance: s.currentBalance || 0,
    monthlyContribution: s.monthlyContribution || 0,
    ear: s.ear || 0,
    whtRate: s.whtRate,
  }));

  // ── Bank instrument holdings (live actuals) ──
  // Each accrues simple interest on its principal during elapsed months on the
  // same monthly footing as the primary MMF (own rate, WHT, day-count).
  const bankState = bankHoldings
    .filter((b) => b.isActive !== false)
    .map((b) => ({
      balance: b.principal || 0,
      principal: b.principal || 0,
      interestRate: b.interestRate || 0,
      whtRate: b.whtRate ?? null,
      // Month offset (1-based) at which the holding begins accruing.
      startMonth: monthOffsetFromStart(b.startDate, startDate) ?? 1,
    }));

  // ── Per-month placement of actual primary-MMF deposits ──
  // Deposits attributed to the PRIMARY plan (primary MMF fund, or legacy bucket
  // "mmf" with no destination) are placed in the month they actually occurred so
  // they compound through the elapsed period exactly like the forward path.
  // Secondary-fund and bank-instrument deposits are EXCLUDED here because their
  // balances are represented by `secondaryState` / `bankState` respectively
  // (mirrors the double-counting rule in shared/actuals.ts:computeActualsTotals).
  const actualMmfByMonth = new Map<number, number>();

  if (hasActuals && currentMonth > 0) {
    for (const d of actualDeposits) {
      const dest = d.institutionType ?? null;
      // Government-security deposits become lots (handled below).
      if (dest === "government_security") continue;
      // Bank-instrument deposits are represented by bankState; skip.
      if (dest === "bank_instrument") continue;
      // Secondary-fund deposits are represented by secondaryState; skip.
      if (dest === "mmf_fund" && d.mmfFundId != null && primaryFundId != null && d.mmfFundId !== primaryFundId) {
        continue;
      }
      // Remaining: primary-MMF fund deposits, or legacy bucket==="mmf" with no
      // destination metadata. Only bucket==="mmf" lands in the MMF balance;
      // a legacy non-mmf bucket with no destination falls through to lots below.
      if (d.bucket === "mmf") {
        const offset = monthOffsetFromStart(d.depositDate, startDate) ?? 1;
        const placeMonth = Math.max(1, Math.min(offset, currentMonth));
        actualMmfByMonth.set(placeMonth, (actualMmfByMonth.get(placeMonth) ?? 0) + d.amount);
      }
    }

    // Government securities are sourced EXCLUSIVELY from the securities register
    // (the single source of truth). A government-security deposit auto-creates a
    // register row (see deposits.add in routers.ts), so we deliberately do NOT
    // build a lot from the deposit itself — that would double-count the holding.
    // Build every gov-security lot from the register below.
    for (const sec of actualSecurities) {
      if (sec.isMatured) continue;
      const issueDate = new Date(sec.issueDate + "T12:00:00Z");
      const matDate = new Date(sec.maturityDate + "T12:00:00Z");
      const issueMonthOffset = Math.floor(
        (issueDate.getFullYear() - startDate.getFullYear()) * 12 +
        (issueDate.getMonth() - startDate.getMonth())
      );
      const issueMonth = issueMonthOffset + 1;
      const tenorMonths = Math.round(
        (matDate.getFullYear() - issueDate.getFullYear()) * 12 +
        (matDate.getMonth() - issueDate.getMonth())
      );
      const bucket: "tbill" | "ifb" | "fxd" =
        sec.securityType.startsWith("tbill") ? "tbill"
        : sec.securityType === "ifb" ? "ifb"
        : "fxd";
      lots.push({
        id: `actual-${lotIdCounter++}`,
        bucket,
        faceValue: sec.faceValue,
        issueMonth,
        tenorMonths,
        couponRate: sec.couponRate,
        isTaxExempt: sec.isTaxExempt,
      });
    }
  }

  // Determine the last month at which new long bonds are allowed.
  // In the final-liquidity phase, only T-bills are swept.
  const { deRiskingEnd } = getPhaseBoundaries(horizonMonths, fractions);

  for (let m = 1; m <= horizonMonths; m++) {
    const monthDate = new Date(startDate);
    monthDate.setMonth(monthDate.getMonth() + (m - 1));

    const rates = getRatesForMonth(monthDate, rateHistory, settings);
    const wht = rates.withholdingTax / 100;

    const mmfNetAnnual = netYield(rates.mmfYield, rates.withholdingTax);
    const mmfMonthly = monthlyRate(mmfNetAnnual);

    const phase = getPhase(m, horizonMonths, fractions);
    const override = overrideMap.get(m);

    if (phase !== lastPhase) {
      sweepCount = 0;
      lastPhase = phase;
    }

    const isActualMonth = hasActuals && m <= currentMonth;

    let contribution = 0;
    let whtThisMonth = 0;

    if (!isActualMonth) {
      // Forward (future) months: scheduled contribution + overrides flow to MMF.
      const scheduled = getScheduledContribution(m, settings);
      contribution = override?.overrideAmount !== undefined ? override.overrideAmount : scheduled;
      const lumpSum = override?.lumpSum ?? 0;
      contribution += lumpSum;
      mmf += contribution;
    } else {
      // Elapsed (actual) months: place this month's REAL primary-MMF deposits in
      // the month they actually occurred (Fix #4), so the actual-period curve is
      // correct, not just the endpoint. `contribution` reflects real money in.
      contribution = actualMmfByMonth.get(m) ?? 0;
      mmf += contribution;
    }

    // Primary MMF compounds EVERY month — actual and forward alike (Fix #3, #5).
    // During actual months the real deposits accrue interest through the elapsed
    // period exactly as the forward projection would, so the projected balance at
    // "today" matches the daily-accrual ledger for the same deposits.
    {
      const interestGross = mmf * monthlyRate(rates.mmfYield);
      const interestWHT = interestGross * wht;
      whtThisMonth += interestWHT;
      mmf = mmf * (1 + mmfMonthly);
    }

    // ── Secondary MMF accounts ──
    // Each is contribution-driven plus its own net compounding. We always
    // accrue/contribute (even in actuals-seeded months) because these balances
    // are tracked separately from the primary plan's deposit ledger.
    //
    // Unified accounting basis (Fix #5): `currentBalance` is the balance AS OF
    // TODAY. During elapsed (actual) months we hold each secondary balance flat
    // (no extra contribution, no layered interest) so the projected total at
    // "today" equals the dashboard's principal-only figure. From the forward
    // period onward, each fund contributes monthly and compounds on its net EAR,
    // exactly on the same monthly footing as the primary MMF.
    let secondaryMmfEnd = 0;
    for (const sec of secondaryState) {
      if (sec.balance === 0 && sec.monthlyContribution === 0) continue;
      if (!isActualMonth) {
        const secWhtPct = sec.whtRate ?? rates.withholdingTax;
        const secWht = secWhtPct / 100;
        // Add this fund's own monthly contribution.
        sec.balance += sec.monthlyContribution;
        // Compound on the fund's gross EAR, then withhold tax on the interest.
        const grossInterest = sec.balance * monthlyRate(sec.ear);
        const netInterest = grossInterest * (1 - secWht);
        whtThisMonth += grossInterest * secWht;
        sec.balance += netInterest;
      }
      secondaryMmfEnd += sec.balance;
    }

    // ── Bank instrument holdings ──
    // Same unified rule: principal is held flat through elapsed months (so the
    // "today" total equals the recorded principal), then accrues simple monthly
    // interest on its own rate/WHT/day-count going forward. Bank deposits do not
    // compound into the MMF; they grow in place as a separate pocket.
    let bankEnd = 0;
    for (const b of bankState) {
      if (b.balance === 0) continue;
      if (!isActualMonth && m >= b.startMonth) {
        const bWhtPct = b.whtRate ?? rates.withholdingTax;
        const bWht = bWhtPct / 100;
        // Monthly simple interest = principal × annualRate × (1/12), net of WHT.
        const grossInterest = b.balance * (b.interestRate / 100) / 12;
        const netInterest = grossInterest * (1 - bWht);
        whtThisMonth += grossInterest * bWht;
        b.balance += netInterest;
      }
      bankEnd += b.balance;
    }

    let cbkCashIn = 0;
    const cbkActions: string[] = [];
    const survivingLots: SecurityLot[] = [];

    for (const lot of lots) {
      const age = m - lot.issueMonth;

      if (age < 0) {
        survivingLots.push(lot);
        continue;
      }

      if (age === lot.tenorMonths) {
        cbkCashIn += lot.faceValue;
        cbkActions.push(`${lot.bucket.toUpperCase()} maturity KES ${Math.round(lot.faceValue).toLocaleString()}`);

        if (lot.bucket === "tbill") {
          const tenorYears = lot.tenorMonths / 12;
          const grossInterest = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
          const netInterest = grossInterest * (1 - wht);
          whtThisMonth += grossInterest * wht;
          cbkCashIn += netInterest;
          cbkActions.push(`T-bill net discount KES ${Math.round(netInterest).toLocaleString()}`);
        }
        continue;
      }

      if ((lot.bucket === "ifb" || lot.bucket === "fxd") && age > 0 && age % 6 === 0) {
        const grossCoupon = (lot.couponRate / 100 / 2) * lot.faceValue;
        if (lot.isTaxExempt) {
          cbkCashIn += grossCoupon;
          cbkActions.push(`IFB coupon KES ${Math.round(grossCoupon).toLocaleString()} (tax-exempt)`);
        } else {
          const netCoupon = grossCoupon * (1 - wht);
          whtThisMonth += grossCoupon * wht;
          cbkCashIn += netCoupon;
          cbkActions.push(`FXD coupon KES ${Math.round(netCoupon).toLocaleString()} (net of ${rates.withholdingTax}% WHT)`);
        }
      }

      survivingLots.push(lot);
    }

    lots = survivingLots;
    mmf += cbkCashIn;

    let mmfToDhow = 0;
    let sweepTarget: "tbill" | "ifb" | "fxd" | null = null;

    // No new long bonds in final-liquidity phase
    const noNewLongBonds = m > deRiskingEnd;

    if (!isActualMonth) {
      const maxLots = Math.floor((mmf - settings.safetyFloor) / SWEEP_LOT_SIZE);
      if (maxLots > 0) {
        const target = getSweepTargetForMonth(m, sweepCount, horizonMonths, fractions, isShortHorizon);
        if (target) {
          const effectiveBucket = noNewLongBonds && target.bucket !== "tbill"
            ? { bucket: "tbill" as const, tenorMonths: 3 }
            : target;

          sweepTarget = effectiveBucket.bucket;
          const lotsCount = maxLots;
          const totalSweep = lotsCount * SWEEP_LOT_SIZE;

          if (mmf - totalSweep >= settings.safetyFloor) {
            mmf -= totalSweep;
            mmfToDhow = totalSweep;

            for (let i = 0; i < lotsCount; i++) {
              lots.push({
                id: `sim-${m}-${lotIdCounter++}`,
                bucket: effectiveBucket.bucket,
                faceValue: 50000,
                issueMonth: m,
                tenorMonths: effectiveBucket.tenorMonths,
                couponRate: effectiveBucket.bucket === "ifb"
                  ? rates.ifbCouponRate
                  : effectiveBucket.bucket === "fxd"
                  ? rates.fxdCouponRate
                  : 0,
                isTaxExempt: effectiveBucket.bucket === "ifb",
              });
            }
            sweepCount++;
          }
        }
      }
    }

    let tbillEnd = 0;
    let ifbEnd = 0;
    let fxdEnd = 0;
    for (const lot of lots) {
      if (lot.bucket === "tbill") {
        const age = m - lot.issueMonth;
        const tenorYears = lot.tenorMonths / 12;
        const grossDiscount = lot.faceValue * (rates.tbill364Rate / 100) * tenorYears;
        const netDiscount = grossDiscount * (1 - wht);
        // During elapsed (actual) months hold the lot flat at face value so the
        // "today" snapshot reconciles with recorded principal; accrue the discount
        // only across the forward horizon (Fix #5 — unified basis).
        const accruedDiscount = !isActualMonth && age > 0 ? netDiscount * (age / lot.tenorMonths) : 0;
        tbillEnd += lot.faceValue + accruedDiscount;
      } else if (lot.bucket === "ifb") {
        ifbEnd += lot.faceValue;
      } else if (lot.bucket === "fxd") {
        fxdEnd += lot.faceValue;
      }
    }

    let mainAction = "";
    const sweepDesc = mmfToDhow > 0
      ? `sweep KES ${Math.round(mmfToDhow).toLocaleString()} → ${sweepTarget?.toUpperCase()} (${Math.round(mmfToDhow / 50000)} lot${mmfToDhow > 50000 ? "s" : ""})`
      : "";
    if (cbkActions.length > 0 && sweepDesc) {
      mainAction = `${cbkActions.join("; ")}; ${sweepDesc}`;
    } else if (cbkActions.length > 0) {
      mainAction = `${cbkActions.join("; ")}; deposit to MMF`;
    } else if (sweepDesc) {
      mainAction = `Deposit to MMF; ${sweepDesc}`;
    } else {
      mainAction = "Deposit to MMF; no DhowCSD sweep this month";
    }

    const total = mmf + tbillEnd + ifbEnd + fxdEnd + secondaryMmfEnd + bankEnd;

    results.push({
      monthNumber: m,
      contribution,
      cbkCashIn:    Math.round(cbkCashIn    * 100) / 100,
      mmfToDhow:    Math.round(mmfToDhow    * 100) / 100,
      mainAction,
      mmfEnd:   Math.round(mmf     * 100) / 100,
      tbillEnd: Math.round(tbillEnd * 100) / 100,
      ifbEnd:   Math.round(ifbEnd   * 100) / 100,
      fxdEnd:   Math.round(fxdEnd   * 100) / 100,
      totalEnd: Math.round(total    * 100) / 100,
      secondaryMmfEnd: Math.round(secondaryMmfEnd * 100) / 100,
      bankEnd: Math.round(bankEnd * 100) / 100,
      phase,
      sweepTarget,
      whtThisMonth: Math.round(whtThisMonth * 100) / 100,
      isActual: isActualMonth,
      isShortHorizon,
    });
  }

  return results;
}

// ─── Scenarios ────────────────────────────────────────────────────────────────

export function runScenarios(
  baseSettings: EngineSettings,
  stepUps: number[] = SCENARIO_STEPUPS,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): ScenarioResult[] {
  const horizonMonths = baseSettings.horizonMonths ?? 120;
  return stepUps.map((stepUp) => {
    const settings = { ...baseSettings, stepUpAmount: stepUp };
    const results = runProjection(settings, [], rateHistory, [], [], secondaryMmfs);
    const last = results[results.length - 1];

    let totalContributed = 0;
    for (const r of results) totalContributed += r.contribution;

    return {
      stepUp,
      finalMonthlySaving:   getScheduledContribution(horizonMonths, settings),
      totalContributed:     Math.round(totalContributed),
      projectedEndingValue: last.totalEnd,
      hitsTarget:           last.totalEnd >= settings.targetAmount,
    };
  });
}

// ─── Milestones ───────────────────────────────────────────────────────────────

/**
 * Build a milestone narrative from the portfolio's PHASE at that month, so the
 * story matches any horizon (a 15-year plan no longer falls back to a generic
 * "Year N checkpoint" for years 11+). The phase is derived from the portfolio's
 * own phase fractions, not a hardcoded 10-year map.
 */
export function phaseMilestoneLabel(
  phase: "foundation" | "growth" | "de-risking" | "final-liquidity",
  isFinalYear: boolean,
): string {
  if (isFinalYear) {
    return "Goal stage. Most or all money should be liquid or near-liquid as you approach the target.";
  }
  switch (phase) {
    case "foundation":
      return "Foundation phase. Still building the base — do not worry if most money is still in the MMF and short T-bills.";
    case "growth":
      return "Growth phase. Coupons and reinvestment from IFBs and FXDs should start compounding noticeably.";
    case "de-risking":
      return "De-risking phase. Value should be shifting back toward T-bills and the MMF to lock in gains.";
    case "final-liquidity":
      return "Final-liquidity phase. Holdings should be mostly liquid or near-liquid, ready to draw down.";
  }
}

export function generateMilestones(
  settings?: EngineSettings,
  secondaryMmfs: SecondaryMmfInput[] = []
): YearMilestone[] {
  const s = settings ?? DEFAULT_SETTINGS_FOR_MILESTONES;
  const horizonMonths = s.horizonMonths ?? 120;
  const results = runProjection(s, [], [], [], [], secondaryMmfs);
  const milestones: YearMilestone[] = [];
  const totalYears = Math.floor(horizonMonths / 12);
  for (let year = 1; year <= totalYears; year++) {
    const month = year * 12;
    if (month > horizonMonths) break;
    const row = results.find(r => r.monthNumber === month);
    if (!row) continue;
    const projected = row.totalEnd;
    const phase = getPhase(month, horizonMonths, s.phaseFractions);
    // The healthy checkpoint is 90% in the early phases (more variance is fine
    // while building) and tightens to 95% once de-risking begins, since the
    // plan should be converging on target.
    const checkpointFrac = phase === "de-risking" || phase === "final-liquidity" ? 0.95 : 0.9;
    const isFinalYear = month === horizonMonths || (year === totalYears);
    milestones.push({
      year,
      month,
      projectedTotal: Math.round(projected),
      minHealthyCheckpoint: Math.round(projected * checkpointFrac),
      label: phaseMilestoneLabel(phase, isFinalYear),
    });
  }
  return milestones;
}

/** @deprecated Use generateMilestones(settings) directly. */
export function getYearMilestones(): YearMilestone[] {
  return generateMilestones();
}

/** @deprecated No-op — milestones are now generated per-portfolio on demand. */
export function invalidateMilestoneCache(): void {
  // no-op
}

/** @deprecated Backward compat — returns default 120-month milestones. */
export const YEAR_MILESTONES: YearMilestone[] = new Proxy([] as YearMilestone[], {
  get(_, prop) {
    const live = generateMilestones();
    if (prop === "length") return live.length;
    if (prop === Symbol.iterator) return live[Symbol.iterator].bind(live);
    if (typeof prop === "string" && !isNaN(Number(prop))) return live[Number(prop)];
    return (live as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export function checkMilestones(
  currentMonth: number,
  currentTotal: number,
  settings: EngineSettings,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): {
  milestone: YearMilestone | null;
  status: "on-track" | "behind" | "ahead";
  gap: number;
  recommendation: string;
} {
  const milestones = generateMilestones(settings, secondaryMmfs);
  const rawMilestone = milestones.find((m) => m.month === currentMonth);
  if (!rawMilestone) {
    return { milestone: null, status: "on-track", gap: 0, recommendation: "" };
  }

  const milestone = rawMilestone;
  const gap = currentTotal - milestone.minHealthyCheckpoint;

  if (currentTotal >= milestone.projectedTotal) {
    return { milestone, status: "ahead", gap, recommendation: "You are ahead of schedule. Keep up the discipline!" };
  } else if (currentTotal >= milestone.minHealthyCheckpoint) {
    return { milestone, status: "on-track", gap, recommendation: "You are on track. Continue your regular contributions." };
  } else {
    const shortfall = milestone.minHealthyCheckpoint - currentTotal;
    return {
      milestone,
      status: "behind",
      gap: -shortfall,
      recommendation: `You are KES ${shortfall.toLocaleString()} below the healthy checkpoint. Consider increasing your next step-up by KES 1,000–2,000, adding a one-off lump sum, or giving the plan more time.`,
    };
  }
}

// ─── Backwards Solver ─────────────────────────────────────────────────────────

/**
 * Solve backwards: given a target, horizon, and rates, compute the required
 * starting contribution (and optional step-up) to reach the goal.
 *
 * Strategy:
 *   - Hold the step-up amount fixed (caller supplies it, or 0 for flat contributions).
 *   - Binary-search on startingContribution until month-horizonMonths total ≥ target.
 *   - If even SOLVER_MAX_CONTRIBUTION doesn't reach the target, report infeasible
 *     with the shortfall and what would be needed.
 *
 * @param settings   - Base settings (target, horizon, rates, step-up). startingContribution is ignored.
 * @param stepUpAmount - Step-up amount to use (0 = flat contributions).
 * @param rateHistory  - Rate history for time-locked projection.
 */
export function solveForContribution(
  settings: EngineSettings,
  stepUpAmount = 0,
  rateHistory: RateSnapshot[] = [],
  secondaryMmfs: SecondaryMmfInput[] = []
): SolverResult {
  const horizonMonths = settings.horizonMonths ?? 120;
  const isShortHorizon = horizonMonths < SHORT_HORIZON_THRESHOLD;
  const target = settings.targetAmount;

  const project = (startingContribution: number): number => {
    const s: EngineSettings = { ...settings, startingContribution, stepUpAmount };
    const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
    return results[results.length - 1]?.totalEnd ?? 0;
  };

  // Quick feasibility check at the cap
  const atCap = project(SOLVER_MAX_CONTRIBUTION);
  if (atCap < target) {
    const shortfall = target - atCap;
    return {
      feasible: false,
      requiredStartingContribution: SOLVER_MAX_CONTRIBUTION,
      stepUpAmount,
      projectedEndingValue: atCap,
      totalContributed: 0,
      shortfall,
      isShortHorizon,
      message: `Target of KES ${target.toLocaleString()} is not achievable within ${horizonMonths} months even at KES ${SOLVER_MAX_CONTRIBUTION.toLocaleString()}/month. ` +
        `Shortfall: KES ${Math.round(shortfall).toLocaleString()}. ` +
        `Consider a longer horizon, a higher target tolerance, or a lower target.`,
    };
  }

  // Binary search: find minimum startingContribution that hits target
  let lo = 0;
  let hi = SOLVER_MAX_CONTRIBUTION;
  for (let iter = 0; iter < 60; iter++) {
    const mid = (lo + hi) / 2;
    if (project(mid) >= target) {
      hi = mid;
    } else {
      lo = mid;
    }
  }

  const requiredStartingContribution = Math.ceil(hi); // round up to nearest KES
  const projectedEndingValue = project(requiredStartingContribution);

  // Compute total contributed
  const s: EngineSettings = { ...settings, startingContribution: requiredStartingContribution, stepUpAmount };
  const results = runProjection(s, [], rateHistory, [], [], secondaryMmfs);
  let totalContributed = 0;
  for (const r of results) totalContributed += r.contribution;

  const shortHorizonNote = isShortHorizon
    ? ` Note: this is a short-horizon plan (${horizonMonths} months). The strategy uses MMF + 91-day T-bills only — returns are limited, so the result is primarily contribution-driven.`
    : "";

  const stepUpNote = stepUpAmount > 0
    ? ` with a KES ${stepUpAmount.toLocaleString()} step-up every ${settings.stepUpMonths ?? 6} months`
    : " (flat contributions, no step-up)";

  return {
    feasible: true,
    requiredStartingContribution,
    stepUpAmount,
    projectedEndingValue: Math.round(projectedEndingValue),
    totalContributed: Math.round(totalContributed),
    shortfall: 0,
    isShortHorizon,
    message: `To reach KES ${target.toLocaleString()} in ${horizonMonths} months, start at KES ${requiredStartingContribution.toLocaleString()}/month${stepUpNote}.${shortHorizonNote}`,
  };
}
```

### `server/db.ts`

```ts
import { and, eq, desc, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  InsertUser,
  users,
  portfolios,
  rateSettings,
  ledgerEntries,
  securities,
  contributionOverrides,
  depositEntries,
  rateHistory,
  accountStatus,
  type InsertPortfolio,
  type Portfolio,
  type InsertRateSettings,
  type InsertLedgerEntry,
  type InsertSecurity,
  type InsertContributionOverride,
  type InsertDepositEntry,
  type InsertRateHistory,
  type InsertAccountStatus,
  portfolioSecondaryMmfs,
  bankInstrumentHoldings,
  type InsertBankInstrumentHolding,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { computeActualsTotals } from "../shared/actuals";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};

  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) {
    const value = user[field];
    if (value === undefined) continue;
    const normalized = value ?? null;
    values[field] = normalized;
    updateSet[field] = normalized;
  }

  if (user.lastSignedIn !== undefined) {
    values.lastSignedIn = user.lastSignedIn;
    updateSet.lastSignedIn = user.lastSignedIn;
  }
  const isAdminEmail = user.email && ENV.adminEmails.includes(user.email);
  if (user.role !== undefined) {
    values.role = user.role;
    updateSet.role = user.role;
  } else if (isAdminEmail || user.openId === ENV.ownerOpenId) {
    values.role = "admin";
    updateSet.role = "admin";
  }

  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();

  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Portfolios ───────────────────────────────────────────────────────────────

export async function getPortfolios(userId: number, isSandbox?: boolean): Promise<Portfolio[]> {
  const db = await getDb();
  if (!db) return [];
  const where =
    isSandbox === undefined
      ? eq(portfolios.userId, userId)
      : and(eq(portfolios.userId, userId), eq(portfolios.isSandbox, isSandbox));
  return db.select().from(portfolios).where(where).orderBy(portfolios.createdAt);
}

export async function getPortfolio(portfolioId: number, userId: number): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(portfolios)
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function createPortfolio(data: InsertPortfolio): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  await db.insert(portfolios).values(data);
  const rows = await db
    .select()
    .from(portfolios)
    .where(eq(portfolios.userId, data.userId))
    .orderBy(desc(portfolios.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function updatePortfolio(
  portfolioId: number,
  userId: number,
  data: Partial<InsertPortfolio>
): Promise<Portfolio | null> {
  const db = await getDb();
  if (!db) return null;
  await db
    .update(portfolios)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
  return getPortfolio(portfolioId, userId);
}

export async function deletePortfolio(portfolioId: number, userId: number): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Cascade: delete all child records first
  await db.delete(rateSettings).where(eq(rateSettings.portfolioId, portfolioId));
  await db.delete(ledgerEntries).where(eq(ledgerEntries.portfolioId, portfolioId));
  await db.delete(securities).where(eq(securities.portfolioId, portfolioId));
  await db.delete(contributionOverrides).where(eq(contributionOverrides.portfolioId, portfolioId));
  await db.delete(depositEntries).where(eq(depositEntries.portfolioId, portfolioId));
  await db.delete(rateHistory).where(eq(rateHistory.portfolioId, portfolioId));
  await db.delete(accountStatus).where(eq(accountStatus.portfolioId, portfolioId));
  await db.delete(portfolioSecondaryMmfs).where(eq(portfolioSecondaryMmfs.portfolioId, portfolioId));
  await db.delete(bankInstrumentHoldings).where(eq(bankInstrumentHoldings.portfolioId, portfolioId));
  await db.delete(portfolios).where(and(eq(portfolios.id, portfolioId), eq(portfolios.userId, userId)));
}

/**
 * Ensure a portfolio has a rate_settings row. Creates one with defaults if missing.
 * Returns the existing or newly created rate_settings row.
 */
export async function ensureRateSettings(portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getRateSettings(portfolioId);
  if (existing) return existing;
  await db.insert(rateSettings).values({ portfolioId });
  return getRateSettings(portfolioId);
}

// ─── Rate Settings ─────────────────────────────────────────────────────────────

export async function getRateSettings(portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const result = await db
    .select()
    .from(rateSettings)
    .where(eq(rateSettings.portfolioId, portfolioId))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function upsertRateSettings(data: InsertRateSettings) {
  const db = await getDb();
  if (!db) return;
  const existing = await getRateSettings(data.portfolioId);
  if (existing) {
    await db
      .update(rateSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(rateSettings.portfolioId, data.portfolioId));
  } else {
    await db.insert(rateSettings).values(data);
  }
  return getRateSettings(data.portfolioId);
}

// ─── Ledger Entries ─────────────────────────────────────────────────────────────

export async function getLedgerEntries(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(ledgerEntries)
    .where(eq(ledgerEntries.portfolioId, portfolioId))
    .orderBy(ledgerEntries.monthNumber);
}

export async function upsertLedgerEntry(data: InsertLedgerEntry) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(ledgerEntries)
    .where(and(eq(ledgerEntries.portfolioId, data.portfolioId), eq(ledgerEntries.monthNumber, data.monthNumber)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(ledgerEntries)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(ledgerEntries.portfolioId, data.portfolioId), eq(ledgerEntries.monthNumber, data.monthNumber)));
  } else {
    await db.insert(ledgerEntries).values(data);
  }
}

export async function bulkUpsertLedgerEntries(entries: InsertLedgerEntry[]) {
  const db = await getDb();
  if (!db || entries.length === 0) return;
  const portfolioId = entries[0].portfolioId;
  await db.delete(ledgerEntries).where(eq(ledgerEntries.portfolioId, portfolioId));
  await db.insert(ledgerEntries).values(entries);
}

// ─── Securities ─────────────────────────────────────────────────────────────────

export async function getSecurities(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(securities)
    .where(eq(securities.portfolioId, portfolioId))
    .orderBy(securities.issueDate);
}

export async function getSecurityById(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(securities).where(eq(securities.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getDepositBySecurityId(securityId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.securityId, securityId))
    .limit(1);
  return rows[0] ?? null;
}

export async function addSecurity(data: InsertSecurity) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(securities).values(data);
  const rows = await db
    .select()
    .from(securities)
    .where(eq(securities.portfolioId, data.portfolioId))
    .orderBy(desc(securities.id))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateSecurity(id: number, data: Partial<InsertSecurity>) {
  const db = await getDb();
  if (!db) return;
  await db.update(securities).set({ ...data, updatedAt: new Date() }).where(eq(securities.id, id));
}

export async function deleteSecurity(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(securities).where(eq(securities.id, id));
}

// ─── Contribution Overrides ─────────────────────────────────────────────────────

export async function getContributionOverrides(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(contributionOverrides)
    .where(eq(contributionOverrides.portfolioId, portfolioId))
    .orderBy(contributionOverrides.monthNumber);
}

export async function upsertContributionOverride(data: InsertContributionOverride) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(contributionOverrides)
    .where(
      and(
        eq(contributionOverrides.portfolioId, data.portfolioId),
        eq(contributionOverrides.monthNumber, data.monthNumber)
      )
    )
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(contributionOverrides)
      .set(data)
      .where(
        and(
          eq(contributionOverrides.portfolioId, data.portfolioId),
          eq(contributionOverrides.monthNumber, data.monthNumber)
        )
      );
  } else {
    await db.insert(contributionOverrides).values(data);
  }
}

export async function deleteContributionOverride(portfolioId: number, monthNumber: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(contributionOverrides)
    .where(
      and(
        eq(contributionOverrides.portfolioId, portfolioId),
        eq(contributionOverrides.monthNumber, monthNumber)
      )
    );
}

// ─── Rate History ──────────────────────────────────────────────────────────────

export async function addRateHistorySnapshot(data: InsertRateHistory) {
  const db = await getDb();
  if (!db) return;
  await db.insert(rateHistory).values(data);
}

export async function getRateHistory(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(rateHistory)
    .where(eq(rateHistory.portfolioId, portfolioId))
    .orderBy(rateHistory.effectiveDate);
}

export async function getRateForDate(portfolioId: number, targetDate: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(rateHistory)
    .where(and(eq(rateHistory.portfolioId, portfolioId), sql`${rateHistory.effectiveDate} <= ${targetDate}`))
    .orderBy(desc(rateHistory.effectiveDate))
    .limit(1);
  return rows[0] ?? null;
}

// ─── Deposit Entries ────────────────────────────────────────────────────────────

export async function getDepositEntries(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, portfolioId))
    .orderBy(desc(depositEntries.depositDate));
}

export async function addDepositEntry(data: InsertDepositEntry) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(depositEntries).values(data);
  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, data.portfolioId))
    .orderBy(desc(depositEntries.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateDepositEntry(
  id: number,
  portfolioId: number,
  data: Partial<InsertDepositEntry>,
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(depositEntries)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)));
}

export async function deleteDepositEntry(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  // Cascade: a government-security deposit owns a register row; remove it too so
  // the register stays the single source of truth (no orphaned holdings).
  const existing = await db
    .select()
    .from(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)))
    .limit(1);
  const linkedSecurityId = (existing[0] as { securityId?: number | null } | undefined)?.securityId;
  await db
    .delete(depositEntries)
    .where(and(eq(depositEntries.id, id), eq(depositEntries.portfolioId, portfolioId)));
  if (linkedSecurityId) {
    await db.delete(securities).where(eq(securities.id, linkedSecurityId));
  }
}

export async function getActualsSummary(
  portfolioId: number,
  targetAmount: number,
  withholdingTax: number,
  fxdCouponRate = 12.35,
  mmfYield = 8.78,
  tbillRate = 8.97
) {
  const db = await getDb();
  if (!db) return null;

  const rows = await db
    .select()
    .from(depositEntries)
    .where(eq(depositEntries.portfolioId, portfolioId));

  const secondaries = await getSecondaryMmfs(portfolioId);
  const bankHoldings = await getBankInstrumentHoldings(portfolioId);
  const securityRows = await getSecurities(portfolioId);

  // Delegate the (double-counting-safe) aggregation to the pure, unit-tested helper.
  const agg = computeActualsTotals(
    rows.map((row) => ({
      amount: parseFloat(row.amount) || 0,
      bucket: row.bucket as "mmf" | "tbill" | "ifb" | "fxd",
      institutionType: (row as { institutionType?: string | null }).institutionType ?? null,
      mmfFundId: (row as { mmfFundId?: number | null }).mmfFundId ?? null,
    })),
    secondaries.map((s) => ({
      mmfFundId: s.mmfFundId ?? null,
      currentBalance: parseFloat(String(s.currentBalance ?? "0")) || 0,
      ear: parseFloat(String(s.ear ?? "0")) || 0,
      whtRate: parseFloat(String(s.whtRate ?? "15")) || 15,
    })),
    bankHoldings.map((b) => ({
      principal: parseFloat(String(b.principal ?? "0")) || 0,
      interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
      whtRate: parseFloat(String(b.whtRate ?? "15")) || 15,
      isActive: !!b.isActive,
    })),
    { withholdingTax, mmfYield, tbillRate, fxdCouponRate },
    securityRows.map((s) => ({
      securityType: String(s.securityType),
      faceValue: parseFloat(String(s.faceValue ?? "0")) || 0,
      couponRate: parseFloat(String(s.couponRate ?? "0")) || 0,
      isTaxExempt: !!s.isTaxExempt,
      isMatured: !!s.isMatured,
    })),
  );

  const annualFxdCouponIncome = agg.byBucket.fxd * (fxdCouponRate / 100);
  const remainingToTarget = Math.max(0, targetAmount - agg.totalContributed);

  return {
    totalContributed: agg.totalContributed,
    depositsContributed: agg.depositsContributed,
    securitiesValue: agg.securitiesValue,
    secondaryMmfBalance: agg.secondaryMmfBalance,
    bankBalance: agg.bankBalance,
    remainingToTarget,
    taxLiability: agg.taxLiability,
    taxBreakdown: agg.taxBreakdown,
    annualFxdCouponIncome,
    byBucket: agg.byBucket,
    secondaryCount: secondaries.length,
    bankHoldingCount: bankHoldings.filter((b) => b.isActive).length,
    entryCount: rows.length,
  };
}

// ─── Account Status ───────────────────────────────────────────────────────────

export async function getAccountStatuses(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(accountStatus).where(eq(accountStatus.portfolioId, portfolioId));
}

export async function upsertAccountStatus(data: InsertAccountStatus) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(accountStatus)
    .where(and(eq(accountStatus.portfolioId, data.portfolioId), eq(accountStatus.accountType, data.accountType)))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(accountStatus)
      .set({
        isOpened: data.isOpened,
        accountNumber: data.accountNumber ?? null,
        accountName: data.accountName ?? null,
        dateOpened: data.dateOpened ?? null,
        phoneNumber: data.phoneNumber ?? null,
        notes: data.notes ?? null,
      })
      .where(and(eq(accountStatus.portfolioId, data.portfolioId), eq(accountStatus.accountType, data.accountType)));
  } else {
    await db.insert(accountStatus).values(data);
  }
}

// ─── MMF Funds ────────────────────────────────────────────────────────────────

import {
  mmfFunds,
  otherHoldings,
  holdingIncome,
  type InsertMmfFund,
  type InsertOtherHolding,
  type InsertHoldingIncome,
} from "../drizzle/schema";

/** List all active MMF funds, ordered by EAR descending. */
export async function getMmfFunds() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(mmfFunds).where(eq(mmfFunds.isActive, true)).orderBy(desc(mmfFunds.ear));
}

/** Get a single MMF fund by ID. */
export async function getMmfFund(id: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(mmfFunds).where(eq(mmfFunds.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Insert a new MMF fund (admin/owner use). */
export async function addMmfFund(data: InsertMmfFund) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(mmfFunds).values(data);
  return result;
}

/** Update an existing MMF fund. */
export async function updateMmfFund(id: number, data: Partial<InsertMmfFund>) {
  const db = await getDb();
  if (!db) return;
  await db.update(mmfFunds).set(data).where(eq(mmfFunds.id, id));
}

/** Soft-delete (deactivate) an MMF fund. */
export async function deactivateMmfFund(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(mmfFunds).set({ isActive: false }).where(eq(mmfFunds.id, id));
}

/** Set the selected MMF fund for a portfolio (null = use manual rate). */
export async function setPortfolioMmfFund(portfolioId: number, mmfFundId: number | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(portfolios).set({ mmfFundId }).where(eq(portfolios.id, portfolioId));
}

// ─── Other Holdings ───────────────────────────────────────────────────────────

/** List all holdings for a portfolio, ordered by asset class then name. */
export async function getOtherHoldings(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(otherHoldings)
    .where(eq(otherHoldings.portfolioId, portfolioId))
    .orderBy(otherHoldings.assetClass, otherHoldings.name);
}

/** Get a single holding by ID. */
export async function getOtherHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(otherHoldings)
    .where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Add a new holding. */
export async function addOtherHolding(data: InsertOtherHolding) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(otherHoldings).values(data);
  return result;
}

/** Update a holding. */
export async function updateOtherHolding(id: number, portfolioId: number, data: Partial<InsertOtherHolding>) {
  const db = await getDb();
  if (!db) return;
  await db.update(otherHoldings).set(data).where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)));
}

/** Delete a holding and its income records. */
export async function deleteOtherHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(holdingIncome).where(eq(holdingIncome.holdingId, id));
  await db.delete(otherHoldings).where(and(eq(otherHoldings.id, id), eq(otherHoldings.portfolioId, portfolioId)));
}

/** List income records for a holding. */
export async function getHoldingIncome(holdingId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(holdingIncome)
    .where(eq(holdingIncome.holdingId, holdingId))
    .orderBy(desc(holdingIncome.incomeDate));
}

/** Add an income record for a holding. */
export async function addHoldingIncome(data: InsertHoldingIncome) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(holdingIncome).values(data);
  return result;
}

/** Delete an income record. */
export async function deleteHoldingIncome(id: number, holdingId: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(holdingIncome).where(and(eq(holdingIncome.id, id), eq(holdingIncome.holdingId, holdingId)));
}

// ─── Secondary MMF Accounts ───────────────────────────────────────────────────
import {
  type InsertPortfolioSecondaryMmf,
} from "../drizzle/schema";

/** List all secondary MMF accounts for a portfolio, joined with fund info. */
export async function getSecondaryMmfs(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db
    .select({
      id: portfolioSecondaryMmfs.id,
      portfolioId: portfolioSecondaryMmfs.portfolioId,
      mmfFundId: portfolioSecondaryMmfs.mmfFundId,
      label: portfolioSecondaryMmfs.label,
      currentBalance: portfolioSecondaryMmfs.currentBalance,
      monthlyContribution: portfolioSecondaryMmfs.monthlyContribution,
      notes: portfolioSecondaryMmfs.notes,
      createdAt: portfolioSecondaryMmfs.createdAt,
      updatedAt: portfolioSecondaryMmfs.updatedAt,
      fundName: mmfFunds.fundName,
      company: mmfFunds.company,
      ear: mmfFunds.ear,
      whtRate: mmfFunds.whtRate,
    })
    .from(portfolioSecondaryMmfs)
    .innerJoin(mmfFunds, eq(portfolioSecondaryMmfs.mmfFundId, mmfFunds.id))
    .where(eq(portfolioSecondaryMmfs.portfolioId, portfolioId))
    .orderBy(portfolioSecondaryMmfs.createdAt);
  return rows;
}

/** Add a secondary MMF account. */
export async function addSecondaryMmf(data: InsertPortfolioSecondaryMmf) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.insert(portfolioSecondaryMmfs).values(data);
  return result;
}

/** Update a secondary MMF account. */
export async function updateSecondaryMmf(
  id: number,
  portfolioId: number,
  data: Partial<InsertPortfolioSecondaryMmf>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(portfolioSecondaryMmfs)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(portfolioSecondaryMmfs.id, id),
        eq(portfolioSecondaryMmfs.portfolioId, portfolioId)
      )
    );
}

/** Delete a secondary MMF account. */
export async function deleteSecondaryMmf(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(portfolioSecondaryMmfs)
    .where(
      and(
        eq(portfolioSecondaryMmfs.id, id),
        eq(portfolioSecondaryMmfs.portfolioId, portfolioId)
      )
    );
}


// ============================================================================
// Round 12 — Knowledge & Accuracy Layer helpers
// ============================================================================
import {
  mmfComposition,
  bankInstruments,
  benchmarkInputs,
  auditLog,
  type InsertMmfComposition,
  type InsertBankInstrument,
  type InsertBenchmarkInput,
  type InsertAuditLog,
} from "../drizzle/schema";

/** ---------------- MMF Composition (global reference) ---------------- */

/** List all MMF compositions joined with fund name/company/ear. */
export async function getMmfCompositions() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select({
      id: mmfComposition.id,
      mmfFundId: mmfComposition.mmfFundId,
      govSecurities: mmfComposition.govSecurities,
      govTbills: mmfComposition.govTbills,
      govTbonds: mmfComposition.govTbonds,
      govIfb: mmfComposition.govIfb,
      bankInstruments: mmfComposition.bankInstruments,
      corporateDebt: mmfComposition.corporateDebt,
      cashEquivalents: mmfComposition.cashEquivalents,
      offshoreRegional: mmfComposition.offshoreRegional,
      realEstate: mmfComposition.realEstate,
      otherAssets: mmfComposition.otherAssets,
      bankNote: mmfComposition.bankNote,
      corporateNote: mmfComposition.corporateNote,
      cashNote: mmfComposition.cashNote,
      offshoreNote: mmfComposition.offshoreNote,
      realEstateNote: mmfComposition.realEstateNote,
      otherNote: mmfComposition.otherNote,
      notes: mmfComposition.notes,
      asOfDate: mmfComposition.asOfDate,
      source: mmfComposition.source,
      isEstimate: mmfComposition.isEstimate,
      updatedAt: mmfComposition.updatedAt,
      fundName: mmfFunds.fundName,
      company: mmfFunds.company,
      ear: mmfFunds.ear,
      grossYield: mmfFunds.grossYield,
      managementFee: mmfFunds.managementFee,
    })
    .from(mmfComposition)
    .innerJoin(mmfFunds, eq(mmfComposition.mmfFundId, mmfFunds.id))
    .orderBy(desc(mmfFunds.ear));
}

export async function getMmfCompositionByFund(mmfFundId: number) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select()
    .from(mmfComposition)
    .where(eq(mmfComposition.mmfFundId, mmfFundId))
    .limit(1);
  return rows[0] ?? null;
}

export async function upsertMmfComposition(data: InsertMmfComposition) {
  const db = await getDb();
  if (!db) return null;
  const existing = await getMmfCompositionByFund(data.mmfFundId);
  if (existing) {
    await db
      .update(mmfComposition)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(mmfComposition.id, existing.id));
    return existing.id;
  }
  await db.insert(mmfComposition).values(data);
  return null;
}

export async function deleteMmfComposition(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(mmfComposition).where(eq(mmfComposition.id, id));
}

/** ---------------- Bank Instruments (global reference) ---------------- */

export async function getBankInstruments() {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bankInstruments)
    .orderBy(bankInstruments.bankName);
}

export async function addBankInstrument(data: InsertBankInstrument) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(bankInstruments).values(data);
  return true;
}

export async function updateBankInstrument(
  id: number,
  data: Partial<InsertBankInstrument>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(bankInstruments)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(bankInstruments.id, id));
}

export async function deleteBankInstrument(id: number) {
  const db = await getDb();
  if (!db) return;
  await db.delete(bankInstruments).where(eq(bankInstruments.id, id));
}

/** ---------------- Bank Instrument Holdings (per-portfolio LIVE actuals) ---------------- */

export async function getBankInstrumentHoldings(portfolioId: number) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(bankInstrumentHoldings)
    .where(eq(bankInstrumentHoldings.portfolioId, portfolioId))
    .orderBy(bankInstrumentHoldings.createdAt);
}

export async function addBankInstrumentHolding(data: InsertBankInstrumentHolding) {
  const db = await getDb();
  if (!db) return null;
  await db.insert(bankInstrumentHoldings).values(data);
  const rows = await db
    .select()
    .from(bankInstrumentHoldings)
    .where(eq(bankInstrumentHoldings.portfolioId, data.portfolioId))
    .orderBy(desc(bankInstrumentHoldings.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function updateBankInstrumentHolding(
  id: number,
  portfolioId: number,
  data: Partial<InsertBankInstrumentHolding>
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(bankInstrumentHoldings)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(bankInstrumentHoldings.id, id), eq(bankInstrumentHoldings.portfolioId, portfolioId)));
}

export async function deleteBankInstrumentHolding(id: number, portfolioId: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .delete(bankInstrumentHoldings)
    .where(and(eq(bankInstrumentHoldings.id, id), eq(bankInstrumentHoldings.portfolioId, portfolioId)));
}

/** ---------------- Benchmark Inputs (global reference) ---------------- */

export async function getBenchmarkInputs() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(benchmarkInputs).orderBy(benchmarkInputs.id);
}

export async function upsertBenchmarkInput(data: InsertBenchmarkInput) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(benchmarkInputs)
    .where(eq(benchmarkInputs.metricKey, data.metricKey))
    .limit(1);
  if (existing[0]) {
    await db
      .update(benchmarkInputs)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(benchmarkInputs.id, existing[0].id));
  } else {
    await db.insert(benchmarkInputs).values(data);
  }
}

/** ---------------- Audit Log ---------------- */

export async function addAuditLog(data: InsertAuditLog) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditLog).values(data);
}

export async function getAuditLog(portfolioId: number, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.portfolioId, portfolioId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}

/** ---------------- MMF fund accrual settings ---------------- */

export async function updateMmfFundAccrualSettings(
  id: number,
  data: { dayCountBasis?: number; creditingFrequency?: "daily" | "monthly"; whtRate?: string }
) {
  const db = await getDb();
  if (!db) return;
  await db
    .update(mmfFunds)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(mmfFunds.id, id));
}
```

### `server/routers.ts`

```ts
import { TRPCError } from "@trpc/server";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import {
  getPortfolios,
  getPortfolio,
  createPortfolio,
  updatePortfolio,
  deletePortfolio,
  ensureRateSettings,
  getRateSettings,
  upsertRateSettings,
  getLedgerEntries,
  bulkUpsertLedgerEntries,
  getSecurities,
  getSecurityById,
  getDepositBySecurityId,
  addSecurity,
  updateSecurity,
  deleteSecurity,
  getContributionOverrides,
  upsertContributionOverride,
  deleteContributionOverride,
  getDepositEntries,
  addDepositEntry,
  updateDepositEntry,
  deleteDepositEntry,
  addRateHistorySnapshot,
  getRateHistory,
  getAccountStatuses,
  upsertAccountStatus,
  getMmfFunds,
  getMmfFund,
  addMmfFund,
  updateMmfFund,
  deactivateMmfFund,
  setPortfolioMmfFund,
  getOtherHoldings,
  addOtherHolding,
  updateOtherHolding,
  deleteOtherHolding,
  getHoldingIncome,
  addHoldingIncome,
  deleteHoldingIncome,
  getSecondaryMmfs,
  addSecondaryMmf,
  updateSecondaryMmf,
  deleteSecondaryMmf,
  getMmfCompositions,
  upsertMmfComposition,
  deleteMmfComposition,
  getBankInstruments,
  addBankInstrument,
  updateBankInstrument,
  deleteBankInstrument,
  getBankInstrumentHoldings,
  addBankInstrumentHolding,
  updateBankInstrumentHolding,
  deleteBankInstrumentHolding,
  getActualsSummary,
  getBenchmarkInputs,
  upsertBenchmarkInput,
  addAuditLog,
  getAuditLog,
  updateMmfFundAccrualSettings,
} from "./db";
import {
  runProjection,
  runScenarios,
  checkMilestones,
  getScheduledContribution,
  generateMilestones,
  solveForContribution,
  deriveSafetyFloor,
  SWEEP_LOT_SIZE,
  SCENARIO_STEPUPS,
  type EngineSettings,
  type ActualDeposit,
  type ActualSecurity,
  type ActualBankHolding,
  type SecondaryMmfInput,
} from "./engine";
import { COOKIE_NAME } from "../shared/const";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS: EngineSettings = {
  mmfYield: 8.78,
  tbill91Rate: 8.8206,
  tbill182Rate: 8.7782,
  tbill364Rate: 8.9746,
  ifbCouponRate: 12.5,
  fxdCouponRate: 12.35,
  withholdingTax: 15,
  startingContribution: 2500,
  stepUpAmount: 3000,
  stepUpMonths: 6,
  safetyFloor: 50000,
  targetAmount: 5000000,
  horizonMonths: 120,
};

/**
 * Convert a DB rate_settings row + portfolio row into an EngineSettings object.
 * Plan-level fields (contribution schedule, target, horizon) come from the portfolio;
 * rate fields come from rate_settings.
 */
function dbToEngine(
  rates: Awaited<ReturnType<typeof getRateSettings>>,
  portfolio: Awaited<ReturnType<typeof getPortfolio>>,
  selectedFundEar?: number | null
): EngineSettings {
  const r = rates;
  const p = portfolio;
  // If a fund is selected, use its EAR as the MMF gross yield (WHT applied in engine).
  // Otherwise fall back to the manually-entered mmfYield from rate_settings.
  const mmfYield = selectedFundEar != null
    ? selectedFundEar
    : (r ? parseFloat(String(r.mmfYield)) : DEFAULT_SETTINGS.mmfYield);
  return {
    mmfYield,
    tbill91Rate: r ? parseFloat(String(r.tbill91Rate)) : DEFAULT_SETTINGS.tbill91Rate,
    tbill182Rate: r ? parseFloat(String(r.tbill182Rate)) : DEFAULT_SETTINGS.tbill182Rate,
    tbill364Rate: r ? parseFloat(String(r.tbill364Rate)) : DEFAULT_SETTINGS.tbill364Rate,
    ifbCouponRate: r ? parseFloat(String(r.ifbCouponRate)) : DEFAULT_SETTINGS.ifbCouponRate,
    fxdCouponRate: r ? parseFloat(String(r.fxdCouponRate)) : DEFAULT_SETTINGS.fxdCouponRate,
    withholdingTax: r ? parseFloat(String(r.withholdingTax)) : DEFAULT_SETTINGS.withholdingTax,
    startingContribution: p ? parseFloat(String(p.startingContribution)) : DEFAULT_SETTINGS.startingContribution,
    stepUpAmount: p ? parseFloat(String(p.stepUpAmount)) : DEFAULT_SETTINGS.stepUpAmount,
    stepUpMonths: p ? p.stepUpMonths : DEFAULT_SETTINGS.stepUpMonths,
    safetyFloor: p ? parseFloat(String(p.safetyFloor)) : DEFAULT_SETTINGS.safetyFloor,
    targetAmount: p ? parseFloat(String(p.targetAmount)) : DEFAULT_SETTINGS.targetAmount,
    horizonMonths: p ? p.horizonMonths : DEFAULT_SETTINGS.horizonMonths,
    startDate: p ? normaliseDate(p.startDate) : "2026-07-01",
    phaseFractions: p ? {
      foundationFrac: parseFloat(String(p.foundationFrac)),
      growthFrac: parseFloat(String(p.growthFrac)),
      deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
    } : undefined,
  };
}

function normaliseDate(d: Date | string | null | undefined): string {
  if (!d) return "2026-07-01";
  if (d instanceof Date) return d.toISOString().split("T")[0];
  return String(d).split("T")[0];
}

/** Fetch the EAR of the portfolio's selected MMF fund, or null if none is set. */
async function getSelectedFundEar(portfolio: Awaited<ReturnType<typeof getPortfolio>>): Promise<number | null> {
  if (!portfolio?.mmfFundId) return null;
  const fund = await getMmfFund(portfolio.mmfFundId);
  return fund ? parseFloat(String(fund.ear)) : null;
}

function mapRateHistory(rows: Awaited<ReturnType<typeof getRateHistory>>) {
  return rows.map((r) => ({
    effectiveDate: normaliseDate(r.effectiveDate),
    mmfYield: parseFloat(String(r.mmfYield)),
    tbill91Rate: parseFloat(String(r.tbill91Rate)),
    tbill182Rate: parseFloat(String(r.tbill182Rate)),
    tbill364Rate: parseFloat(String(r.tbill364Rate)),
    ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
    fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
    withholdingTax: parseFloat(String(r.withholdingTax)),
  }));
}

function mapActualDeposits(rows: Awaited<ReturnType<typeof getDepositEntries>>): ActualDeposit[] {
  return rows.map((d) => ({
    bucket: d.bucket as "mmf" | "tbill" | "ifb" | "fxd",
    amount: parseFloat(String(d.amount)),
    depositDate: normaliseDate(d.depositDate),
    institutionType:
      (d as { institutionType?: string | null }).institutionType as ActualDeposit["institutionType"] ?? null,
    mmfFundId: (d as { mmfFundId?: number | null }).mmfFundId ?? null,
    bankHoldingId: (d as { bankHoldingId?: number | null }).bankHoldingId ?? null,
  }));
}

/** Map DB bank instrument holdings into engine actuals inputs. */
function mapActualBankHoldings(
  rows: Awaited<ReturnType<typeof getBankInstrumentHoldings>>
): ActualBankHolding[] {
  return rows.map((b) => ({
    principal: parseFloat(String(b.principal ?? "0")) || 0,
    interestRate: parseFloat(String(b.interestRate ?? "0")) || 0,
    whtRate: b.whtRate != null ? parseFloat(String(b.whtRate)) : null,
    dayCountBasis: (b as { dayCountBasis?: number | null }).dayCountBasis ?? 365,
    startDate: normaliseDate((b as { startDate?: Date | string | null }).startDate),
    isActive: !!b.isActive,
  }));
}

function mapActualSecurities(rows: Awaited<ReturnType<typeof getSecurities>>): ActualSecurity[] {
  return rows.map((s) => ({
    securityType: s.securityType as ActualSecurity["securityType"],
    faceValue: parseFloat(String(s.faceValue)),
    issueDate: normaliseDate(s.issueDate),
    maturityDate: normaliseDate(s.maturityDate),
    couponRate: parseFloat(String(s.couponRate)),
    isTaxExempt: s.isTaxExempt,
    isMatured: s.isMatured,
  }));
}

/** Map DB secondary MMF rows into engine inputs (fund EAR treated as gross, WHT applied in engine). */
function mapSecondaryMmfs(rows: Awaited<ReturnType<typeof getSecondaryMmfs>>): SecondaryMmfInput[] {
  return rows.map((s) => ({
    id: s.id,
    label: s.label ?? undefined,
    currentBalance: parseFloat(String(s.currentBalance)) || 0,
    monthlyContribution: parseFloat(String(s.monthlyContribution)) || 0,
    ear: parseFloat(String(s.ear)) || 0,
    whtRate: s.whtRate != null ? parseFloat(String(s.whtRate)) : undefined,
  }));
}

/** Verify the portfolio belongs to the requesting user. Throws FORBIDDEN if not. */
async function requirePortfolio(portfolioId: number, userId: number) {
  const p = await getPortfolio(portfolioId, userId);
  if (!p) throw new TRPCError({ code: "FORBIDDEN", message: "Portfolio not found or access denied." });
  return p;
}

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const portfolioIdInput = z.object({ portfolioId: z.number().int().positive() });

const portfolioCreateInput = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  targetAmount: z.number().min(1),
  startDate: z.string(),
  horizonMonths: z.number().int().min(12).max(240),
  startingContribution: z.number().min(0),
  stepUpAmount: z.number().min(0),
  stepUpMonths: z.number().int().min(1).max(24),
  // Optional: when omitted, the safety floor is auto-derived from the contribution.
  safetyFloor: z.number().min(0).optional(),
  foundationFrac: z.number().min(0.05).max(0.5).optional(),
  growthFrac: z.number().min(0.1).max(0.7).optional(),
  deRiskingFrac: z.number().min(0.05).max(0.4).optional(),
});

const rateOnlyInput = z.object({
  portfolioId: z.number().int().positive(),
  mmfYield: z.number().min(0).max(100),
  tbill91Rate: z.number().min(0).max(100),
  tbill182Rate: z.number().min(0).max(100),
  tbill364Rate: z.number().min(0).max(100),
  ifbCouponRate: z.number().min(0).max(100),
  fxdCouponRate: z.number().min(0).max(100),
  withholdingTax: z.number().min(0).max(100),
  cbkSourceUrl: z.string().url().max(500).optional(),
  sanlamSourceUrl: z.string().url().max(500).optional(),
  changeNote: z.string().max(500).optional(),
});

// ─── Router ───────────────────────────────────────────────────────────────────

export const appRouter = router({
  system: systemRouter,

  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  // ─── Portfolios ─────────────────────────────────────────────────────────────
  portfolios: router({
    /** List portfolios owned by the current user, optionally scoped by mode (live vs sandbox). */
    list: protectedProcedure
      .input(z.object({ isSandbox: z.boolean().optional() }).optional())
      .query(async ({ ctx, input }) => {
        const rows = await getPortfolios(ctx.user.id, input?.isSandbox);
        return rows.map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          targetAmount: parseFloat(String(p.targetAmount)),
          startDate: normaliseDate(p.startDate),
          horizonMonths: p.horizonMonths,
          startingContribution: parseFloat(String(p.startingContribution)),
          stepUpAmount: parseFloat(String(p.stepUpAmount)),
          stepUpMonths: p.stepUpMonths,
          safetyFloor: parseFloat(String(p.safetyFloor)),
          foundationFrac: parseFloat(String(p.foundationFrac)),
          growthFrac: parseFloat(String(p.growthFrac)),
          deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
          cbkSourceUrl: p.cbkSourceUrl,
          sanlamSourceUrl: p.sanlamSourceUrl,
          ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
          mmfFundId: p.mmfFundId ?? null,
          isSandbox: p.isSandbox,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        }));
      }),

    /** Get a single portfolio by ID (must belong to current user). */
    get: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      return {
        id: p.id,
        name: p.name,
        description: p.description,
        targetAmount: parseFloat(String(p.targetAmount)),
        startDate: normaliseDate(p.startDate),
        horizonMonths: p.horizonMonths,
        startingContribution: parseFloat(String(p.startingContribution)),
        stepUpAmount: parseFloat(String(p.stepUpAmount)),
        stepUpMonths: p.stepUpMonths,
        safetyFloor: parseFloat(String(p.safetyFloor)),
        foundationFrac: parseFloat(String(p.foundationFrac)),
        growthFrac: parseFloat(String(p.growthFrac)),
        deRiskingFrac: parseFloat(String(p.deRiskingFrac)),
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
        mmfFundId: p.mmfFundId ?? null,
        isSandbox: p.isSandbox,
        createdAt: p.createdAt,
      };
    }),

    /** Create a new portfolio. Also creates a default rate_settings row for it. */
    create: protectedProcedure
      .input(portfolioCreateInput.extend({ isSandbox: z.boolean().optional() }))
      .mutation(async ({ ctx, input }) => {
      const p = await createPortfolio({
        userId: ctx.user.id,
        isSandbox: input.isSandbox ?? false,
        name: input.name,
        description: input.description,
        targetAmount: String(input.targetAmount),
        startDate: new Date(`${input.startDate}T12:00:00.000Z`),
        horizonMonths: input.horizonMonths,
        startingContribution: String(input.startingContribution),
        stepUpAmount: String(input.stepUpAmount),
        stepUpMonths: input.stepUpMonths,
        safetyFloor: String(input.safetyFloor ?? deriveSafetyFloor(input.startingContribution)),
        foundationFrac: String(input.foundationFrac ?? 0.20),
        growthFrac: String(input.growthFrac ?? 0.50),
        deRiskingFrac: String(input.deRiskingFrac ?? 0.15),
      });
      if (!p) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to create portfolio." });
      // Ensure a rate_settings row exists
      await ensureRateSettings(p.id);
      return { success: true, portfolioId: p.id };
    }),

    /** Update plan-level settings for a portfolio. */
    update: protectedProcedure
      .input(portfolioCreateInput.extend({ portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          name: input.name,
          description: input.description,
          targetAmount: String(input.targetAmount),
          startDate: new Date(`${input.startDate}T12:00:00.000Z`),
          horizonMonths: input.horizonMonths,
          startingContribution: String(input.startingContribution),
          stepUpAmount: String(input.stepUpAmount),
          stepUpMonths: input.stepUpMonths,
          safetyFloor: String(input.safetyFloor ?? deriveSafetyFloor(input.startingContribution)),
          foundationFrac: String(input.foundationFrac ?? 0.20),
          growthFrac: String(input.growthFrac ?? 0.50),
          deRiskingFrac: String(input.deRiskingFrac ?? 0.15),
        });
        return { success: true };
      }),

    /** Delete a portfolio and all its child data. */
    delete: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      await deletePortfolio(input.portfolioId, ctx.user.id);
      return { success: true };
    }),
  }),

  // ─── Rate Settings (per-portfolio) ──────────────────────────────────────────
  settings: router({
    /** Get rate settings for a portfolio. */
    get: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const r = await getRateSettings(input.portfolioId);
      // Resolve the selected MMF fund name and EAR
      const selectedFund = p.mmfFundId ? await getMmfFund(p.mmfFundId) : null;
      const selectedFundEar = selectedFund ? parseFloat(String(selectedFund.ear)) : null;
      return {
        // Rate fields
        mmfYield: r ? parseFloat(String(r.mmfYield)) : DEFAULT_SETTINGS.mmfYield,
        tbill91Rate: r ? parseFloat(String(r.tbill91Rate)) : DEFAULT_SETTINGS.tbill91Rate,
        tbill182Rate: r ? parseFloat(String(r.tbill182Rate)) : DEFAULT_SETTINGS.tbill182Rate,
        tbill364Rate: r ? parseFloat(String(r.tbill364Rate)) : DEFAULT_SETTINGS.tbill364Rate,
        ifbCouponRate: r ? parseFloat(String(r.ifbCouponRate)) : DEFAULT_SETTINGS.ifbCouponRate,
        fxdCouponRate: r ? parseFloat(String(r.fxdCouponRate)) : DEFAULT_SETTINGS.fxdCouponRate,
        withholdingTax: r ? parseFloat(String(r.withholdingTax)) : DEFAULT_SETTINGS.withholdingTax,
        // Source URLs (from portfolio)
        cbkSourceUrl: p.cbkSourceUrl,
        sanlamSourceUrl: p.sanlamSourceUrl,
        ratesLastUpdatedAt: p.ratesLastUpdatedAt ?? null,
        // Selected MMF fund info
        selectedFundId: p.mmfFundId ?? null,
        selectedFundName: selectedFund?.fundName ?? null,
        selectedFundCompany: selectedFund?.company ?? null,
        selectedFundEar: selectedFundEar,
      };
    }),

    /**
     * Auto-derived MMF safety floor for this portfolio, computed from its current
     * monthly contribution and the sweep lot size. Returns the derived value, the
     * value currently stored on the portfolio, and whether the stored value is an
     * explicit override (i.e. differs from the derived default).
     */
    derivedSafetyFloor: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), startingContribution: z.number().min(0).optional() }))
      .query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const monthlyContribution = input.startingContribution ?? (parseFloat(String(p.startingContribution)) || 0);
      const derived = deriveSafetyFloor(monthlyContribution);
      const stored = parseFloat(String(p.safetyFloor)) || 0;
      return {
        derived,
        stored,
        lotSize: SWEEP_LOT_SIZE,
        bufferMonths: 2,
        monthlyContribution,
        isOverridden: Math.abs(stored - derived) > 0.5,
      };
    }),

    /** Get rate history for a portfolio. */
    getRateHistory: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getRateHistory(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: normaliseDate(r.effectiveDate),
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
        changeNote: r.changeNote,
        createdAt: r.createdAt,
      }));
    }),
  }),

  // ─── Projection Engine ────────────────────────────────────────────────────────
  projection: router({
    run: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const depositRows = await getDepositEntries(input.portfolioId);
      const actualDeposits = mapActualDeposits(depositRows);
      const securityRows = await getSecurities(input.portfolioId);
      const actualSecurities = mapActualSecurities(securityRows);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      const bankHoldings = mapActualBankHoldings(await getBankInstrumentHoldings(input.portfolioId));
      return runProjection(
        settings,
        mappedOverrides,
        rh,
        actualDeposits,
        actualSecurities,
        secondaryMmfs,
        bankHoldings,
        p.mmfFundId ?? null
      );
    }),

    scenarios: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      return runScenarios(settings, SCENARIO_STEPUPS, rh, secondaryMmfs);
    }),

    milestones: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
      return generateMilestones(settings, secondaryMmfs);
    }),

    contributionSchedule: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const horizonMonths = settings.horizonMonths ?? 120;
      const schedule = [];
      for (let m = 1; m <= horizonMonths; m += settings.stepUpMonths) {
        const end = Math.min(m + settings.stepUpMonths - 1, horizonMonths);
        const amount = getScheduledContribution(m, settings);
        const periodTotal = amount * (end - m + 1);
        schedule.push({
          startMonth: m,
          endMonth: end,
          monthlyAmount: amount,
          sixMonthTotal: periodTotal,
        });
      }
      return schedule;
    }),

    /**
     * Backwards solver: compute the required starting contribution to reach the portfolio target.
     * @param stepUpAmount - Step-up amount to use (0 = flat contributions). Defaults to portfolio setting.
     */
    solve: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        stepUpAmount: z.number().min(0).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const settings = dbToEngine(rates, p, fundEar);
        const rateHistoryRows = await getRateHistory(input.portfolioId);
        const rh = mapRateHistory(rateHistoryRows);
        const stepUp = input.stepUpAmount ?? settings.stepUpAmount;
        const secondaryMmfs = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
        return solveForContribution(settings, stepUp, rh, secondaryMmfs);
      }),

    /**
     * What-if overlay: re-run the projection with one or more secondary-MMF
     * monthly contributions replaced, and return both the baseline and the
     * what-if month series + final values so the UI can compare them.
     * Engine math is untouched — we only swap the secondary contribution input.
     */
    whatIf: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        overrides: z.array(z.object({
          secondaryMmfId: z.number().int().positive(),
          monthlyContribution: z.number().min(0),
        })).max(50),
        /** Optional override of the primary starting monthly contribution (KES). */
        primaryContribution: z.number().min(0).max(10000000).optional(),
        /** Optional override of the primary step-up amount (KES). */
        primaryStepUpAmount: z.number().min(0).max(10000000).optional(),
      }))
      .query(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
        const settings = dbToEngine(rates, p, fundEar);
        const rateHistoryRows = await getRateHistory(input.portfolioId);
        const rh = mapRateHistory(rateHistoryRows);
        const contribOverrides = (await getContributionOverrides(input.portfolioId)).map((o) => ({
          monthNumber: o.monthNumber,
          overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
          lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
        }));
        const baselineSecondary = mapSecondaryMmfs(await getSecondaryMmfs(input.portfolioId));
        const overrideMap = new Map(input.overrides.map((o) => [o.secondaryMmfId, o.monthlyContribution]));
        const whatIfSecondary = baselineSecondary.map((s) =>
          s.id != null && overrideMap.has(s.id)
            ? { ...s, monthlyContribution: overrideMap.get(s.id)! }
            : s,
        );

        // What-if settings: optionally override the PRIMARY contribution and/or step-up.
        const whatIfSettings = {
          ...settings,
          ...(input.primaryContribution !== undefined && { startingContribution: input.primaryContribution }),
          ...(input.primaryStepUpAmount !== undefined && { stepUpAmount: input.primaryStepUpAmount }),
        };

        const baselineSeries = runProjection(settings, contribOverrides, rh, [], [], baselineSecondary);
        const whatIfSeries = runProjection(whatIfSettings, contribOverrides, rh, [], [], whatIfSecondary);
        const last = (arr: typeof baselineSeries) => arr[arr.length - 1];
        const baselineFinal = last(baselineSeries)?.totalEnd ?? 0;
        const whatIfFinal = last(whatIfSeries)?.totalEnd ?? 0;

        return {
          target: settings.targetAmount,
          horizonMonths: settings.horizonMonths ?? baselineSeries.length,
          primaryBaseline: {
            startingContribution: settings.startingContribution,
            stepUpAmount: settings.stepUpAmount,
          },
          baseline: {
            finalValue: baselineFinal,
            series: baselineSeries.map((m) => ({ month: m.monthNumber, total: m.totalEnd })),
          },
          whatIf: {
            finalValue: whatIfFinal,
            series: whatIfSeries.map((m) => ({ month: m.monthNumber, total: m.totalEnd })),
          },
          delta: whatIfFinal - baselineFinal,
        };
      }),

    /**
     * Apply a what-if: persist the explored secondary-MMF monthly contributions
     * (and optionally the primary contribution / step-up) back to the live
     * accounts/portfolio. This turns an exploration into a saved plan change.
     */
    applyWhatIf: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        overrides: z.array(z.object({
          secondaryMmfId: z.number().int().positive(),
          monthlyContribution: z.number().min(0),
        })).max(50),
        primaryContribution: z.number().min(0).max(10000000).optional(),
        primaryStepUpAmount: z.number().min(0).max(10000000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        // Persist secondary MMF contribution changes.
        const secs = await getSecondaryMmfs(input.portfolioId);
        const secIds = new Set(secs.map((s) => s.id));
        let applied = 0;
        for (const o of input.overrides) {
          if (!secIds.has(o.secondaryMmfId)) continue;
          await updateSecondaryMmf(o.secondaryMmfId, input.portfolioId, {
            monthlyContribution: String(o.monthlyContribution),
          });
          applied++;
        }
        // Persist primary contribution / step-up changes.
        const portfolioPatch: { startingContribution?: string; stepUpAmount?: string } = {};
        if (input.primaryContribution !== undefined) portfolioPatch.startingContribution = String(input.primaryContribution);
        if (input.primaryStepUpAmount !== undefined) portfolioPatch.stepUpAmount = String(input.primaryStepUpAmount);
        if (Object.keys(portfolioPatch).length > 0) {
          await updatePortfolio(input.portfolioId, ctx.user.id, portfolioPatch);
        }
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "portfolio",
          entityId: input.portfolioId,
          action: "update",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? undefined,
          summary: `Applied what-if: ${applied} secondary MMF contribution(s)` +
            (input.primaryContribution !== undefined ? `, primary contribution → ${input.primaryContribution}` : "") +
            (input.primaryStepUpAmount !== undefined ? `, step-up → ${input.primaryStepUpAmount}` : ""),
        });
        return { success: true, appliedSecondaries: applied, portfolioUpdated: Object.keys(portfolioPatch).length > 0 };
      }),
  }),

  // ─── Ledger ─────────────────────────────────────────────────────
  ledger: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getLedgerEntries(input.portfolioId);
    }),

    sync: protectedProcedure.input(portfolioIdInput).mutation(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const results = runProjection(settings, mappedOverrides, rh);

      const startDate = new Date(`${settings.startDate}T12:00:00.000Z`);
      const entries = results.map((r) => {
        const entryDate = new Date(startDate);
        entryDate.setMonth(entryDate.getMonth() + r.monthNumber - 1);
        return {
          portfolioId: input.portfolioId,
          monthNumber: r.monthNumber,
          entryDate,
          contribution: String(r.contribution),
          cbkCashIn: String(r.cbkCashIn),
          mmfToDhow: String(r.mmfToDhow),
          mainAction: r.mainAction,
          mmfEndBalance: String(r.mmfEnd),
          tbillEndBalance: String(r.tbillEnd),
          ifbEndBalance: String(r.ifbEnd),
          fxdEndBalance: String(r.fxdEnd),
          totalEndBalance: String(r.totalEnd),
          isActual: false,
        };
      });

      await bulkUpsertLedgerEntries(entries);
      return { success: true, count: entries.length };
    }),
  }),

  // ─── Securities ───────────────────────────────────────────────────────────────
  securities: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getSecurities(input.portfolioId);
    }),

    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]),
        faceValue: z.number().min(50000),
        issueDate: z.string(),
        maturityDate: z.string(),
        couponRate: z.number().min(0).max(50),
        isTaxExempt: z.boolean(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addSecurity({
          portfolioId: input.portfolioId,
          securityType: input.securityType,
          faceValue: String(input.faceValue),
          issueDate: new Date(input.issueDate),
          maturityDate: new Date(input.maturityDate),
          couponRate: String(input.couponRate),
          isTaxExempt: input.isTaxExempt,
          notes: input.notes,
        });
        return { success: true };
      }),

    update: protectedProcedure
      .input(z.object({
        id: z.number(),
        // Status / annotation (Round 18+)
        isMatured: z.boolean().optional(),
        notes: z.string().optional(),
        // Full edit (Round 22) — any of these may be supplied.
        securityType: z.enum(["tbill_91", "tbill_182", "tbill_364", "ifb", "fxd"]).optional(),
        faceValue: z.number().min(50000).optional(),
        issueDate: z.string().optional(),
        maturityDate: z.string().optional(),
        couponRate: z.number().min(0).max(50).optional(),
        isTaxExempt: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Verify ownership: the security must belong to a portfolio owned by the
        // requesting user. (The register row is the single source of truth, so
        // we guard it directly rather than trusting a client-supplied portfolioId.)
        const existing = await getSecurityById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Security not found." });
        }
        await requirePortfolio(existing.portfolioId, ctx.user.id);

        // Build the partial update for the register row.
        const secUpdate: Record<string, unknown> = {};
        if (input.isMatured !== undefined) secUpdate.isMatured = input.isMatured;
        if (input.notes !== undefined) secUpdate.notes = input.notes;
        if (input.securityType !== undefined) secUpdate.securityType = input.securityType;
        if (input.faceValue !== undefined) secUpdate.faceValue = String(input.faceValue);
        if (input.issueDate !== undefined) secUpdate.issueDate = new Date(input.issueDate + "T12:00:00Z");
        if (input.maturityDate !== undefined) secUpdate.maturityDate = new Date(input.maturityDate + "T12:00:00Z");
        if (input.couponRate !== undefined) secUpdate.couponRate = String(input.couponRate);
        if (input.isTaxExempt !== undefined) secUpdate.isTaxExempt = input.isTaxExempt;
        await updateSecurity(input.id, secUpdate as Partial<typeof existing>);

        // Keep the linked deposit row in sync so the live actuals + accrual
        // ledger never drift from the (now-edited) register entry.
        const linkedDeposit = await getDepositBySecurityId(input.id);
        if (linkedDeposit) {
          const depUpdate: Record<string, unknown> = {};
          if (input.faceValue !== undefined) depUpdate.amount = String(input.faceValue);
          if (input.issueDate !== undefined) depUpdate.depositDate = new Date(input.issueDate + "T12:00:00Z");
          // The deposit bucket follows the register security type so the engine
          // places the lot in the right pocket.
          if (input.securityType !== undefined) {
            depUpdate.bucket =
              input.securityType === "ifb" ? "ifb"
              : input.securityType === "fxd" ? "fxd"
              : "tbill";
          }
          if (Object.keys(depUpdate).length > 0) {
            await updateDepositEntry(linkedDeposit.id, existing.portfolioId, depUpdate as never);
          }
        }
        return { success: true, linkedDepositSynced: !!linkedDeposit };
      }),

    delete: protectedProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await deleteSecurity(input.id);
        return { success: true };
      }),

    /**
     * Recycle a matured security. Marks the original register row matured (so it
     * leaves net worth), then redeploys the proceeds in one click:
     *  - mode "mmf": records a primary-MMF deposit for the face value.
     *  - mode "rebuy": records a fresh government-security deposit, which
     *    auto-creates a new linked register row (same single-source-of-truth
     *    flow as deposits.add), letting the user roll the T-bill/bond over.
     */
    recycle: protectedProcedure
      .input(z.object({
        id: z.number(),
        // "split" rolls part of the proceeds into the MMF and re-buys the rest in one action.
        mode: z.enum(["mmf", "rebuy", "split"]),
        // For mmf/rebuy: defaults to the matured security's face value; editable for partial rollovers.
        amount: z.number().positive().optional(),
        // For split: explicit portions. Each must be >= 0 and at least one positive.
        mmfAmount: z.number().min(0).optional(),
        rebuyAmount: z.number().min(0).optional(),
        // Defaults to today; the date the proceeds were redeployed.
        depositDate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        const existing = await getSecurityById(input.id);
        if (!existing) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Security not found." });
        }
        const portfolio = await requirePortfolio(existing.portfolioId, ctx.user.id);
        const portfolioId = existing.portfolioId;
        const depositDateStr = input.depositDate ?? new Date().toISOString().split("T")[0];
        const depositDate = new Date(depositDateStr + "T12:00:00Z");

        // Resolve the MMF and re-buy portions for whichever mode was chosen.
        const face = parseFloat(String(existing.faceValue)) || 0;
        let mmfPortion = 0;
        let rebuyPortion = 0;
        if (input.mode === "mmf") {
          mmfPortion = input.amount ?? face;
        } else if (input.mode === "rebuy") {
          rebuyPortion = input.amount ?? face;
        } else {
          // split — both portions explicit; default to a 50/50 face split if omitted.
          mmfPortion = input.mmfAmount ?? face / 2;
          rebuyPortion = input.rebuyAmount ?? face / 2;
        }
        mmfPortion = Math.round(mmfPortion * 100) / 100;
        rebuyPortion = Math.round(rebuyPortion * 100) / 100;
        const total = mmfPortion + rebuyPortion;
        if (total <= 0) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Recycle amount must be positive." });
        }
        if (input.mode === "split" && (mmfPortion <= 0 || rebuyPortion <= 0)) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "A split rollover needs a positive amount on both the MMF and re-buy sides.",
          });
        }

        // 1) Retire the matured security so it no longer counts toward net worth.
        //    (When there is a re-buy leg, we also stamp rolledIntoId below once the
        //    replacement security exists, so the register can show a "rolled into #N" trail.)
        if (!existing.isMatured) {
          await updateSecurity(input.id, { isMatured: true } as Partial<typeof existing>);
        }

        // 2a) Roll the MMF portion into the primary MMF account.
        if (mmfPortion > 0) {
          await addDepositEntry({
            portfolioId,
            bucket: "mmf",
            institutionType: "mmf_fund",
            mmfFundId: portfolio.mmfFundId ?? null,
            bankHoldingId: null,
            amount: String(mmfPortion),
            depositDate,
            notes: `Recycled from matured ${existing.securityType} (face KES ${Number(existing.faceValue).toLocaleString()})`,
          });
        }

        // 2b) Re-buy: same type/coupon/tax flag, new tenor from the redeploy date.
        if (rebuyPortion > 0) {
          const bucket: "tbill" | "ifb" | "fxd" =
            existing.securityType === "ifb" ? "ifb"
            : existing.securityType === "fxd" ? "fxd"
            : "tbill";
          const entry = await addDepositEntry({
            portfolioId,
            bucket,
            institutionType: "government_security",
            mmfFundId: null,
            bankHoldingId: null,
            amount: String(rebuyPortion),
            depositDate,
            notes: `Re-bought on rollover of matured ${existing.securityType}`,
          });
          // Preserve the original tenor length so the rollover matches the
          // instrument being replaced (e.g. a 364-day bill rolls to 364 days).
          const origIssue = new Date(existing.issueDate);
          const origMaturity = new Date(existing.maturityDate);
          const tenorMs = Math.max(origMaturity.getTime() - origIssue.getTime(), 0);
          const tenorMonths = tenorMs > 0 ? Math.round(tenorMs / (1000 * 60 * 60 * 24 * 30.4375)) : (bucket === "tbill" ? 12 : 24);
          const maturity = new Date(depositDate);
          maturity.setMonth(maturity.getMonth() + Math.max(tenorMonths, 1));
          const sec = await addSecurity({
            portfolioId,
            securityType: existing.securityType,
            faceValue: String(rebuyPortion),
            issueDate: depositDate,
            maturityDate: maturity,
            couponRate: String(parseFloat(String(existing.couponRate)) || 0),
            isTaxExempt: existing.isTaxExempt,
            notes: `Rolled over from security #${existing.id} on ${depositDateStr}`,
          });
          if (sec?.id && entry?.id) {
            await updateDepositEntry(entry.id, portfolioId, { securityId: sec.id } as never);
          }
          // Audit trail: link the matured lot to its replacement so the register
          // can render "rolled into #N" (rebuy + split modes).
          if (sec?.id) {
            await updateSecurity(input.id, { rolledIntoId: sec.id } as Partial<typeof existing>);
          }
        }

        const summary =
          input.mode === "mmf"
            ? `Rolled matured ${existing.securityType} (KES ${mmfPortion.toLocaleString()}) into the primary MMF on ${depositDateStr}`
            : input.mode === "rebuy"
              ? `Re-bought ${existing.securityType} (KES ${rebuyPortion.toLocaleString()}) on rollover on ${depositDateStr}`
              : `Split rollover of matured ${existing.securityType} on ${depositDateStr}: KES ${mmfPortion.toLocaleString()} to MMF + KES ${rebuyPortion.toLocaleString()} re-bought`;

        await addAuditLog({
          portfolioId,
          entity: "security",
          action: "update",
          field: `recycle_${input.mode}`,
          newValue: String(total),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary,
        });

        return { success: true, mode: input.mode, amount: total, mmfPortion, rebuyPortion };
      }),
  }),

  // ─── Deposit Entries (Live Actuals) ──────────────────────────────────────────
  deposits: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getDepositEntries(input.portfolioId);
    }),

    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        // Destination-aware: where the money actually went.
        institutionType: z.enum(["mmf_fund", "bank_instrument", "government_security"]).optional(),
        mmfFundId: z.number().int().positive().optional(),
        bankHoldingId: z.number().int().positive().optional(),
        // bucket is required for government securities; for MMF/bank it is derived.
        bucket: z.enum(["mmf", "tbill", "ifb", "fxd"]).optional(),
        amount: z.number().positive(),
        depositDate: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        // Resolve destination + legacy bucket.
        const institutionType =
          input.institutionType ??
          (input.mmfFundId ? "mmf_fund" : input.bankHoldingId ? "bank_instrument" : "government_security");
        let bucket: "mmf" | "tbill" | "ifb" | "fxd";
        if (institutionType === "mmf_fund" || institutionType === "bank_instrument") {
          bucket = "mmf"; // bank/MMF cash classified under the liquid (mmf-like) bucket for back-compat
        } else {
          if (!input.bucket) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "A government-security bucket is required." });
          }
          bucket = input.bucket;
        }
        const entry = await addDepositEntry({
          portfolioId: input.portfolioId,
          bucket,
          institutionType,
          mmfFundId: input.mmfFundId ?? null,
          bankHoldingId: input.bankHoldingId ?? null,
          amount: String(input.amount),
          depositDate: new Date(input.depositDate),
          notes: input.notes,
        });
        // If the deposit targets a GOVERNMENT SECURITY, auto-create a register
        // row (the single source of truth) and link it to the deposit so the
        // engine + dashboard value it ONCE, from the register.
        if (institutionType === "government_security" && entry) {
          const [rates, fundEar] = await Promise.all([
            getRateSettings(input.portfolioId),
            getSelectedFundEar(await requirePortfolio(input.portfolioId, ctx.user.id)),
          ]);
          void fundEar;
          // Map the legacy bucket to a register securityType + default tenor.
          const securityType: "tbill_364" | "ifb" | "fxd" =
            bucket === "tbill" ? "tbill_364" : bucket === "ifb" ? "ifb" : "fxd";
          const tenorMonths = bucket === "tbill" ? 12 : 24;
          const issue = new Date(input.depositDate + "T12:00:00Z");
          const maturity = new Date(issue);
          maturity.setMonth(maturity.getMonth() + tenorMonths);
          const couponRate =
            bucket === "ifb"
              ? parseFloat(String(rates?.ifbCouponRate ?? "0")) || 0
              : bucket === "fxd"
                ? parseFloat(String(rates?.fxdCouponRate ?? "0")) || 0
                : 0;
          const sec = await addSecurity({
            portfolioId: input.portfolioId,
            securityType,
            faceValue: String(input.amount),
            issueDate: issue,
            maturityDate: maturity,
            couponRate: String(couponRate),
            isTaxExempt: bucket === "ifb",
            notes: `Auto-created from deposit on ${input.depositDate}`,
          });
          if (sec?.id) {
            await updateDepositEntry(entry.id, input.portfolioId, { securityId: sec.id });
          }
        }
        // If the deposit targets a bank holding, increase its principal to keep actuals in sync.
        if (institutionType === "bank_instrument" && input.bankHoldingId) {
          const holdings = await getBankInstrumentHoldings(input.portfolioId);
          const h = holdings.find((x) => x.id === input.bankHoldingId);
          if (h) {
            const newPrincipal = (parseFloat(String(h.principal)) || 0) + input.amount;
            await updateBankInstrumentHolding(input.bankHoldingId, input.portfolioId, {
              principal: String(newPrincipal),
            });
          }
        }
        // If the deposit targets a secondary MMF account, increase its balance.
        if (institutionType === "mmf_fund" && input.mmfFundId) {
          const p = await getPortfolio(input.portfolioId, ctx.user.id);
          // Only adjust secondary accounts; the primary fund balance is the deposit ledger itself.
          if (p && p.mmfFundId !== input.mmfFundId) {
            const secs = await getSecondaryMmfs(input.portfolioId);
            const sec = secs.find((s) => s.mmfFundId === input.mmfFundId);
            if (sec) {
              const newBal = (parseFloat(String(sec.currentBalance)) || 0) + input.amount;
              await updateSecondaryMmf(sec.id, input.portfolioId, { currentBalance: String(newBal) });
            }
          }
        }
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "deposit",
          action: "create",
          field: institutionType,
          newValue: String(input.amount),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Recorded ${institutionType.replace("_", " ")} deposit of KES ${input.amount.toLocaleString()} on ${input.depositDate}`,
        });
        return { success: true, entry };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), id: z.number() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteDepositEntry(input.id, input.portfolioId);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "deposit",
          entityId: input.id,
          action: "delete",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Deleted deposit entry #${input.id}`,
        });
        return { success: true };
      }),

    summary: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      const p = await requirePortfolio(input.portfolioId, ctx.user.id);
      const [rates, fundEar] = await Promise.all([getRateSettings(input.portfolioId), getSelectedFundEar(p)]);
      const settings = dbToEngine(rates, p, fundEar);
      const rateHistoryRows = await getRateHistory(input.portfolioId);
      const rh = mapRateHistory(rateHistoryRows);
      const depositRows = await getDepositEntries(input.portfolioId);
      const actualDeposits = mapActualDeposits(depositRows);
      const securityRows = await getSecurities(input.portfolioId);
      const actualSecurities = mapActualSecurities(securityRows);
      const overrides = await getContributionOverrides(input.portfolioId);
      const mappedOverrides = overrides.map((o) => ({
        monthNumber: o.monthNumber,
        overrideAmount: o.overrideAmount ? parseFloat(String(o.overrideAmount)) : undefined,
        lumpSum: o.lumpSum ? parseFloat(String(o.lumpSum)) : undefined,
      }));
      void mappedOverrides; void actualDeposits; void actualSecurities;

      // Destination-aware live actuals: deposits + secondary MMFs + bank holdings.
      const summary = await getActualsSummary(
        input.portfolioId,
        settings.targetAmount,
        settings.withholdingTax,
        settings.fxdCouponRate,
        settings.mmfYield,
        settings.tbill364Rate,
      );
      const round2 = (n: number) => Math.round(n * 100) / 100;
      if (!summary) {
        return {
          totalContributed: 0,
          depositsContributed: 0,
          secondaryMmfBalance: 0,
          bankBalance: 0,
          remainingToTarget: settings.targetAmount,
          taxLiability: 0,
          taxBreakdown: { mmf: 0, tbill: 0, ifb: 0, fxd: 0, secondaryMmf: 0, bank: 0 },
          annualFxdCouponIncome: 0,
          byBucket: { mmf: 0, tbill: 0, ifb: 0, fxd: 0 },
          secondaryCount: 0,
          bankHoldingCount: 0,
          entryCount: 0,
        };
      }
      return {
        totalContributed: round2(summary.totalContributed),
        depositsContributed: round2(summary.depositsContributed),
        secondaryMmfBalance: round2(summary.secondaryMmfBalance),
        bankBalance: round2(summary.bankBalance),
        remainingToTarget: round2(summary.remainingToTarget),
        taxLiability: round2(summary.taxLiability),
        taxBreakdown: summary.taxBreakdown,
        annualFxdCouponIncome: round2(summary.annualFxdCouponIncome),
        byBucket: summary.byBucket,
        secondaryCount: summary.secondaryCount,
        bankHoldingCount: summary.bankHoldingCount,
        entryCount: summary.entryCount,
      };
    }),
  }),

  // ─── Contribution Overrides ───────────────────────────────────────────────────
  contributions: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      return getContributionOverrides(input.portfolioId);
    }),

    upsert: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        monthNumber: z.number().int().min(1).max(240),
        overrideAmount: z.number().min(0).optional(),
        lumpSum: z.number().min(0).optional(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertContributionOverride({
          portfolioId: input.portfolioId,
          monthNumber: input.monthNumber,
          overrideAmount: input.overrideAmount !== undefined ? String(input.overrideAmount) : "0",
          lumpSum: input.lumpSum !== undefined ? String(input.lumpSum) : "0",
          reason: input.reason,
        });
        return { success: true };
      }),

    delete: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), monthNumber: z.number().int().min(1).max(240) }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteContributionOverride(input.portfolioId, input.monthNumber);
        return { success: true };
      }),
  }),

  // ─── Rate History ──────────────────────────────────────────────────────────────
  rateHistory: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getRateHistory(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        effectiveDate: normaliseDate(r.effectiveDate),
        mmfYield: parseFloat(String(r.mmfYield)),
        tbill91Rate: parseFloat(String(r.tbill91Rate)),
        tbill364Rate: parseFloat(String(r.tbill364Rate)),
        ifbCouponRate: parseFloat(String(r.ifbCouponRate)),
        fxdCouponRate: parseFloat(String(r.fxdCouponRate)),
        withholdingTax: parseFloat(String(r.withholdingTax)),
        changeNote: r.changeNote,
        createdAt: r.createdAt,
      }));
    }),
  }),

  // ─── Account Status (Getting Started) ─────────────────────────────────────────
  accountStatus: router({
    list: protectedProcedure.input(portfolioIdInput).query(async ({ ctx, input }) => {
      await requirePortfolio(input.portfolioId, ctx.user.id);
      const rows = await getAccountStatuses(input.portfolioId);
      return rows.map((r) => ({
        id: r.id,
        accountType: r.accountType,
        isOpened: r.isOpened,
        accountNumber: r.accountNumber,
        accountName: r.accountName,
        dateOpened: r.dateOpened instanceof Date
          ? r.dateOpened.toISOString().split("T")[0]
          : r.dateOpened ? String(r.dateOpened).split("T")[0] : null,
        phoneNumber: r.phoneNumber,
        notes: r.notes,
        updatedAt: r.updatedAt,
      }));
    }),

    upsert: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        accountType: z.enum(["mmf", "dhowcsd"]),
        isOpened: z.boolean(),
        accountNumber: z.string().optional(),
        accountName: z.string().optional(),
        dateOpened: z.string().optional(),
        phoneNumber: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await upsertAccountStatus({
          portfolioId: input.portfolioId,
          accountType: input.accountType,
          isOpened: input.isOpened,
          accountNumber: input.accountNumber ?? null,
          accountName: input.accountName ?? null,
          dateOpened: input.dateOpened ? new Date(`${input.dateOpened}T12:00:00.000Z`) : null,
          phoneNumber: input.phoneNumber ?? null,
          notes: input.notes ?? null,
        });
        return { success: true };
      }),
  }),

  // ─── Manual Rate Update ("Update Rates" panel) ──────────────────────────────
  rateUpdate: router({
    save: protectedProcedure
      .input(rateOnlyInput)
      .mutation(async ({ ctx, input }) => {
        const p = await requirePortfolio(input.portfolioId, ctx.user.id);
        const now = new Date();

        await upsertRateSettings({
          portfolioId: input.portfolioId,
          mmfYield: String(input.mmfYield),
          tbill91Rate: String(input.tbill91Rate),
          tbill182Rate: String(input.tbill182Rate),
          tbill364Rate: String(input.tbill364Rate),
          ifbCouponRate: String(input.ifbCouponRate),
          fxdCouponRate: String(input.fxdCouponRate),
          withholdingTax: String(input.withholdingTax),
        });

        // Update source URLs and ratesLastUpdatedAt on the portfolio
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          cbkSourceUrl: input.cbkSourceUrl ?? p.cbkSourceUrl,
          sanlamSourceUrl: input.sanlamSourceUrl ?? p.sanlamSourceUrl,
          ratesLastUpdatedAt: now,
        });

        const today = now.toISOString().split("T")[0];
        await addRateHistorySnapshot({
          portfolioId: input.portfolioId,
          effectiveDate: new Date(`${today}T12:00:00.000Z`),
          mmfYield: String(input.mmfYield),
          tbill91Rate: String(input.tbill91Rate),
          tbill182Rate: String(input.tbill182Rate),
          tbill364Rate: String(input.tbill364Rate),
          ifbCouponRate: String(input.ifbCouponRate),
          fxdCouponRate: String(input.fxdCouponRate),
          withholdingTax: String(input.withholdingTax),
          changeNote: input.changeNote ?? "Manual rate update",
        });

        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "rate_settings",
          action: "update",
          field: "mmfYield",
          newValue: String(input.mmfYield),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary:
            input.changeNote ??
            `Rates updated — MMF ${input.mmfYield}%, 364d T-bill ${input.tbill364Rate}%, IFB ${input.ifbCouponRate}%, WHT ${input.withholdingTax}%`,
        });

        return { success: true, updatedAt: now };
      }),

    saveSourceUrls: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        cbkSourceUrl: z.string().url().max(500),
        sanlamSourceUrl: z.string().url().max(500),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await updatePortfolio(input.portfolioId, ctx.user.id, {
          cbkSourceUrl: input.cbkSourceUrl,
          sanlamSourceUrl: input.sanlamSourceUrl,
        });
        return { success: true };
      }),
  }),

  // ─── MMF Funds ──────────────────────────────────────────────────────────────
  mmfFunds: router({
    /** List all active MMF funds ordered by EAR descending. */
    list: protectedProcedure.query(async () => {
      const rows = await getMmfFunds();
      return rows.map((f) => ({
        id: f.id,
        fundName: f.fundName,
        company: f.company,
        grossYield: parseFloat(String(f.grossYield)),
        ear: parseFloat(String(f.ear)),
        managementFee: parseFloat(String(f.managementFee)),
        minInvestment: parseFloat(String(f.minInvestment)),
        aumMillions: f.aumMillions ? parseFloat(String(f.aumMillions)) : null,
                asOfDate: f.asOfDate ? normaliseDate(f.asOfDate) : null,
        source: f.source ?? null,
        isActive: f.isActive,
        dayCountBasis: f.dayCountBasis ?? 365,
        creditingFrequency: f.creditingFrequency ?? "daily",
        whtRate: parseFloat(String(f.whtRate ?? "15")),
        createdAt: f.createdAt,
        updatedAt: f.updatedAt,
      }));
    }),
    /** Add a new MMF fund. */
    add: protectedProcedure
      .input(z.object({
        fundName: z.string().min(1).max(200),
        company: z.string().min(1).max(200),
        grossYield: z.number().min(0).max(100),
        ear: z.number().min(0).max(100),
        managementFee: z.number().min(0).max(10).optional(),
        minInvestment: z.number().min(0).optional(),
        aumMillions: z.number().min(0).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        await addMmfFund({
          fundName: input.fundName,
          company: input.company,
          grossYield: String(input.grossYield),
          ear: String(input.ear),
          managementFee: input.managementFee != null ? String(input.managementFee) : undefined,
          minInvestment: input.minInvestment != null ? String(input.minInvestment) : undefined,
          aumMillions: input.aumMillions != null ? String(input.aumMillions) : undefined,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          isActive: true,
        });
        return { success: true };
      }),

    /** Update an MMF fund's yield / fee data. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        fundName: z.string().min(1).max(200).optional(),
        company: z.string().min(1).max(200).optional(),
        grossYield: z.number().min(0).max(100).optional(),
        ear: z.number().min(0).max(100).optional(),
        managementFee: z.number().min(0).max(10).optional(),
        minInvestment: z.number().min(0).optional(),
        aumMillions: z.number().min(0).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateMmfFund(id, {
          ...(rest.fundName !== undefined && { fundName: rest.fundName }),
          ...(rest.company !== undefined && { company: rest.company }),
          ...(rest.grossYield !== undefined && { grossYield: String(rest.grossYield) }),
          ...(rest.ear !== undefined && { ear: String(rest.ear) }),
          ...(rest.managementFee !== undefined && { managementFee: String(rest.managementFee) }),
          ...(rest.minInvestment !== undefined && { minInvestment: String(rest.minInvestment) }),
          ...(rest.aumMillions !== undefined && { aumMillions: String(rest.aumMillions) }),
          ...(rest.asOfDate !== undefined && { asOfDate: new Date(rest.asOfDate) }),
          ...(rest.source !== undefined && { source: rest.source }),
        });
        return { success: true };
      }),

    /** Deactivate (soft-delete) an MMF fund. */
    deactivate: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deactivateMmfFund(input.id);
        return { success: true };
      }),

    /** Set the selected MMF fund for a portfolio (null = use manual rate). */
    selectFund: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive().nullable(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await setPortfolioMmfFund(input.portfolioId, input.mmfFundId);
        return { success: true };
      }),
  }),

  // ─── Other Holdings ─────────────────────────────────────────────────────────
  otherHoldings: router({
    /** List all holdings for a portfolio. */
    list: protectedProcedure
      .input(portfolioIdInput)
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getOtherHoldings(input.portfolioId);
        return rows.map((h) => ({
          id: h.id,
          portfolioId: h.portfolioId,
          assetClass: h.assetClass,
          name: h.name,
          description: h.description ?? null,
          purchaseValue: parseFloat(String(h.purchaseValue)),
          currentValue: parseFloat(String(h.currentValue)),
          purchaseDate: h.purchaseDate ? normaliseDate(h.purchaseDate) : null,
          notes: h.notes ?? null,
          assumedReturnConservative: h.assumedReturnConservative ? parseFloat(String(h.assumedReturnConservative)) : null,
          assumedReturnBase: h.assumedReturnBase ? parseFloat(String(h.assumedReturnBase)) : null,
          assumedReturnOptimistic: h.assumedReturnOptimistic ? parseFloat(String(h.assumedReturnOptimistic)) : null,
          createdAt: h.createdAt,
          updatedAt: h.updatedAt,
        }));
      }),

    /** Add a new holding. */
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        assetClass: z.enum(["real_estate", "equity", "etf", "pension", "sacco", "business", "crypto", "insurance", "other"]),
        name: z.string().min(1).max(200),
        description: z.string().max(1000).optional(),
        purchaseValue: z.number().min(0).optional(),
        currentValue: z.number().min(0),
        purchaseDate: z.string().optional(),
        notes: z.string().max(2000).optional(),
        assumedReturnConservative: z.number().min(0).max(100).optional(),
        assumedReturnBase: z.number().min(0).max(100).optional(),
        assumedReturnOptimistic: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addOtherHolding({
          portfolioId: input.portfolioId,
          assetClass: input.assetClass,
          name: input.name,
          description: input.description,
          purchaseValue: String(input.purchaseValue),
          currentValue: String(input.currentValue),
          purchaseDate: input.purchaseDate ? new Date(input.purchaseDate) : undefined,
          notes: input.notes,
          assumedReturnConservative: input.assumedReturnConservative != null ? String(input.assumedReturnConservative) : undefined,
          assumedReturnBase: input.assumedReturnBase != null ? String(input.assumedReturnBase) : undefined,
          assumedReturnOptimistic: input.assumedReturnOptimistic != null ? String(input.assumedReturnOptimistic) : undefined,
        });
        return { success: true };
      }),

    /** Update a holding's current value and other fields. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        name: z.string().min(1).max(200).optional(),
        description: z.string().max(1000).optional(),
        currentValue: z.number().min(0).optional(),
        notes: z.string().max(2000).optional(),
        assumedReturnConservative: z.number().min(0).max(100).nullable().optional(),
        assumedReturnBase: z.number().min(0).max(100).nullable().optional(),
        assumedReturnOptimistic: z.number().min(0).max(100).nullable().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateOtherHolding(id, portfolioId, {
          ...(rest.name !== undefined && { name: rest.name }),
          ...(rest.description !== undefined && { description: rest.description }),
          ...(rest.currentValue !== undefined && { currentValue: String(rest.currentValue) }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.assumedReturnConservative !== undefined && { assumedReturnConservative: rest.assumedReturnConservative != null ? String(rest.assumedReturnConservative) : null }),
          ...(rest.assumedReturnBase !== undefined && { assumedReturnBase: rest.assumedReturnBase != null ? String(rest.assumedReturnBase) : null }),
          ...(rest.assumedReturnOptimistic !== undefined && { assumedReturnOptimistic: rest.assumedReturnOptimistic != null ? String(rest.assumedReturnOptimistic) : null }),
        });
        return { success: true };
      }),

    /** Delete a holding and all its income records. */
    delete: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteOtherHolding(input.id, input.portfolioId);
        return { success: true };
      }),

    /** List income records for a holding. */
    listIncome: protectedProcedure
      .input(z.object({ holdingId: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getHoldingIncome(input.holdingId);
        return rows.map((r) => ({
          id: r.id,
          holdingId: r.holdingId,
          amount: parseFloat(String(r.amount)),
          incomeDate: normaliseDate(r.incomeDate),
          incomeType: r.incomeType,
          notes: r.notes ?? null,
          createdAt: r.createdAt,
        }));
      }),

    /** Add an income record. */
    addIncome: protectedProcedure
      .input(z.object({
        holdingId: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        amount: z.number().min(0),
        incomeDate: z.string(),
        incomeType: z.string().max(50).optional(),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addHoldingIncome({
          holdingId: input.holdingId,
          amount: String(input.amount),
          incomeDate: new Date(input.incomeDate),
          incomeType: input.incomeType ?? "other",
          notes: input.notes,
        });
        return { success: true };
      }),

    /** Delete an income record. */
    deleteIncome: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), holdingId: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteHoldingIncome(input.id, input.holdingId);
        return { success: true };
      }),
  }),
  /** Secondary MMF accounts — additional MMF funds tracked per portfolio */
  secondaryMmfs: router({
    /** List all secondary MMF accounts for a portfolio. */
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getSecondaryMmfs(input.portfolioId);
        return rows.map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          mmfFundId: r.mmfFundId,
          label: r.label ?? null,
          currentBalance: Number(r.currentBalance),
          monthlyContribution: Number(r.monthlyContribution),
          notes: r.notes ?? null,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          fundName: r.fundName,
          company: r.company,
          ear: Number(r.ear),
        }));
      }),
    /** Add a secondary MMF account. */
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive(),
        label: z.string().max(200).optional(),
        currentBalance: z.number().min(0).default(0),
        monthlyContribution: z.number().min(0).default(0),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addSecondaryMmf({
          portfolioId: input.portfolioId,
          mmfFundId: input.mmfFundId,
          label: input.label,
          currentBalance: String(input.currentBalance),
          monthlyContribution: String(input.monthlyContribution),
          notes: input.notes,
        });
        return { success: true };
      }),
    /** Update a secondary MMF account. */
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        mmfFundId: z.number().int().positive().optional(),
        label: z.string().max(200).optional(),
        currentBalance: z.number().min(0).optional(),
        monthlyContribution: z.number().min(0).optional(),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateSecondaryMmf(id, portfolioId, {
          ...(rest.mmfFundId !== undefined && { mmfFundId: rest.mmfFundId }),
          ...(rest.label !== undefined && { label: rest.label }),
          ...(rest.currentBalance !== undefined && { currentBalance: String(rest.currentBalance) }),
          ...(rest.monthlyContribution !== undefined && { monthlyContribution: String(rest.monthlyContribution) }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
        });
        return { success: true };
      }),
    /** Remove a secondary MMF account. */
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteSecondaryMmf(input.id, input.portfolioId);
        return { success: true };
      }),
  }),

  /** Bank instrument holdings — per-portfolio LIVE call/fixed deposits */
  bankHoldings: router({
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive() }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getBankInstrumentHoldings(input.portfolioId);
        return rows.map((r) => ({
          id: r.id,
          portfolioId: r.portfolioId,
          bankName: r.bankName,
          label: r.label ?? null,
          instrumentType: r.instrumentType,
          principal: Number(r.principal),
          interestRate: Number(r.interestRate),
          rateAsOfDate: r.rateAsOfDate ? normaliseDate(r.rateAsOfDate) : null,
          isNegotiable: r.isNegotiable,
          dayCountBasis: r.dayCountBasis,
          whtRate: Number(r.whtRate),
          startDate: r.startDate ? normaliseDate(r.startDate) : null,
          tenorMonths: r.tenorMonths ?? null,
          maturityDate: r.maturityDate ? normaliseDate(r.maturityDate) : null,
          payoutFrequency: r.payoutFrequency,
          currentValue: Number(r.currentValue),
          notes: r.notes ?? null,
          isActive: r.isActive,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      }),
    add: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]),
        principal: z.number().min(0).default(0),
        interestRate: z.number().min(0).max(100).default(0),
        rateAsOfDate: z.string().optional(),
        isNegotiable: z.boolean().default(true),
        dayCountBasis: z.number().int().default(365),
        whtRate: z.number().min(0).max(100).default(15),
        startDate: z.string().optional(),
        tenorMonths: z.number().int().min(0).optional(),
        maturityDate: z.string().optional(),
        payoutFrequency: z.enum(["maturity", "monthly", "quarterly", "on_call"]).default("maturity"),
        notes: z.string().max(1000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addBankInstrumentHolding({
          portfolioId: input.portfolioId,
          bankName: input.bankName,
          label: input.label,
          instrumentType: input.instrumentType,
          principal: String(input.principal),
          interestRate: String(input.interestRate),
          rateAsOfDate: input.rateAsOfDate ? new Date(`${input.rateAsOfDate}T12:00:00.000Z`) : null,
          isNegotiable: input.isNegotiable,
          dayCountBasis: input.dayCountBasis,
          whtRate: String(input.whtRate),
          startDate: input.startDate ? new Date(`${input.startDate}T12:00:00.000Z`) : null,
          tenorMonths: input.tenorMonths ?? null,
          maturityDate: input.maturityDate ? new Date(`${input.maturityDate}T12:00:00.000Z`) : null,
          payoutFrequency: input.payoutFrequency,
          currentValue: String(input.principal),
        });
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: "bank_holding",
          action: "create",
          field: input.bankName,
          newValue: String(input.principal),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Added ${input.instrumentType.replace("_", " ")} at ${input.bankName} (KES ${input.principal.toLocaleString()})`,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        portfolioId: z.number().int().positive(),
        bankName: z.string().min(1).max(200).optional(),
        label: z.string().max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]).optional(),
        principal: z.number().min(0).optional(),
        interestRate: z.number().min(0).max(100).optional(),
        rateAsOfDate: z.string().optional(),
        isNegotiable: z.boolean().optional(),
        dayCountBasis: z.number().int().optional(),
        whtRate: z.number().min(0).max(100).optional(),
        startDate: z.string().optional(),
        tenorMonths: z.number().int().min(0).optional(),
        maturityDate: z.string().optional(),
        payoutFrequency: z.enum(["maturity", "monthly", "quarterly", "on_call"]).optional(),
        notes: z.string().max(1000).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const { id, portfolioId, ...rest } = input;
        await updateBankInstrumentHolding(id, portfolioId, {
          ...(rest.bankName !== undefined && { bankName: rest.bankName }),
          ...(rest.label !== undefined && { label: rest.label }),
          ...(rest.instrumentType !== undefined && { instrumentType: rest.instrumentType }),
          ...(rest.principal !== undefined && { principal: String(rest.principal) }),
          ...(rest.interestRate !== undefined && { interestRate: String(rest.interestRate) }),
          ...(rest.rateAsOfDate !== undefined && { rateAsOfDate: new Date(`${rest.rateAsOfDate}T12:00:00.000Z`) }),
          ...(rest.isNegotiable !== undefined && { isNegotiable: rest.isNegotiable }),
          ...(rest.dayCountBasis !== undefined && { dayCountBasis: rest.dayCountBasis }),
          ...(rest.whtRate !== undefined && { whtRate: String(rest.whtRate) }),
          ...(rest.startDate !== undefined && { startDate: new Date(`${rest.startDate}T12:00:00.000Z`) }),
          ...(rest.tenorMonths !== undefined && { tenorMonths: rest.tenorMonths }),
          ...(rest.maturityDate !== undefined && { maturityDate: new Date(`${rest.maturityDate}T12:00:00.000Z`) }),
          ...(rest.payoutFrequency !== undefined && { payoutFrequency: rest.payoutFrequency }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.isActive !== undefined && { isActive: rest.isActive }),
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive(), portfolioId: z.number().int().positive() }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await deleteBankInstrumentHolding(input.id, input.portfolioId);
        return { success: true };
      }),
  }),

  // ─── Round 12: MMF Composition / Strategy reference (global) ──────────────
  mmfComposition: router({
    list: publicProcedure.query(async () => {
      const rows = await getMmfCompositions();
      return rows.map((r) => ({
        id: r.id,
        mmfFundId: r.mmfFundId,
        govSecurities: Number(r.govSecurities),
        govTbills: Number(r.govTbills),
        govTbonds: Number(r.govTbonds),
        govIfb: Number(r.govIfb),
        bankInstruments: Number(r.bankInstruments),
        corporateDebt: Number(r.corporateDebt),
        cashEquivalents: Number(r.cashEquivalents),
        offshoreRegional: Number(r.offshoreRegional),
        realEstate: Number(r.realEstate),
        otherAssets: Number(r.otherAssets),
        bankNote: r.bankNote ?? null,
        corporateNote: r.corporateNote ?? null,
        cashNote: r.cashNote ?? null,
        offshoreNote: r.offshoreNote ?? null,
        realEstateNote: r.realEstateNote ?? null,
        otherNote: r.otherNote ?? null,
        notes: r.notes ?? null,
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        isEstimate: Boolean(r.isEstimate),
        updatedAt: r.updatedAt,
        fundName: r.fundName,
        company: r.company,
        ear: Number(r.ear),
        grossYield: Number(r.grossYield),
        managementFee: Number(r.managementFee),
      }));
    }),
    upsert: protectedProcedure
      .input(z.object({
        mmfFundId: z.number().int().positive(),
        govSecurities: z.number().min(0).max(100),
        govTbills: z.number().min(0).max(100).default(0),
        govTbonds: z.number().min(0).max(100).default(0),
        govIfb: z.number().min(0).max(100).default(0),
        bankInstruments: z.number().min(0).max(100),
        corporateDebt: z.number().min(0).max(100),
        cashEquivalents: z.number().min(0).max(100),
        offshoreRegional: z.number().min(0).max(100),
        realEstate: z.number().min(0).max(100).default(0),
        otherAssets: z.number().min(0).max(100).default(0),
        bankNote: z.string().max(2000).optional(),
        corporateNote: z.string().max(2000).optional(),
        cashNote: z.string().max(2000).optional(),
        offshoreNote: z.string().max(2000).optional(),
        realEstateNote: z.string().max(2000).optional(),
        otherNote: z.string().max(2000).optional(),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
        isEstimate: z.boolean().default(false),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertMmfComposition({
          mmfFundId: input.mmfFundId,
          govSecurities: String(input.govSecurities),
          govTbills: String(input.govTbills),
          govTbonds: String(input.govTbonds),
          govIfb: String(input.govIfb),
          bankInstruments: String(input.bankInstruments),
          corporateDebt: String(input.corporateDebt),
          cashEquivalents: String(input.cashEquivalents),
          offshoreRegional: String(input.offshoreRegional),
          realEstate: String(input.realEstate),
          otherAssets: String(input.otherAssets),
          bankNote: input.bankNote,
          corporateNote: input.corporateNote,
          cashNote: input.cashNote,
          offshoreNote: input.offshoreNote,
          realEstateNote: input.realEstateNote,
          otherNote: input.otherNote,
          notes: input.notes,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          isEstimate: input.isEstimate,
        });
        await addAuditLog({
          entity: "mmf_composition",
          entityId: input.mmfFundId,
          action: "update",
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Updated composition for fund #${input.mmfFundId}`,
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteMmfComposition(input.id);
        return { success: true };
      }),
  }),

  // ─── Round 12: Bank Sector Instruments reference (global) ─────────────────
  bankInstruments: router({
    list: publicProcedure.query(async () => {
      const rows = await getBankInstruments();
      return rows.map((r) => ({
        id: r.id,
        bankName: r.bankName,
        instrumentType: r.instrumentType,
        minAmount: Number(r.minAmount),
        typicalTenor: r.typicalTenor ?? null,
        indicativeRate: r.indicativeRate === null ? null : Number(r.indicativeRate),
        isNegotiable: Boolean(r.isNegotiable),
        notes: r.notes ?? null,
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        isActive: Boolean(r.isActive),
      }));
    }),
    add: protectedProcedure
      .input(z.object({
        bankName: z.string().min(1).max(200),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]),
        minAmount: z.number().min(0).default(0),
        typicalTenor: z.string().max(100).optional(),
        indicativeRate: z.number().min(0).max(100).optional(),
        isNegotiable: z.boolean().default(true),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        await addBankInstrument({
          bankName: input.bankName,
          instrumentType: input.instrumentType,
          minAmount: String(input.minAmount),
          typicalTenor: input.typicalTenor,
          indicativeRate: input.indicativeRate === undefined ? null : String(input.indicativeRate),
          isNegotiable: input.isNegotiable,
          notes: input.notes,
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
        });
        return { success: true };
      }),
    update: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        bankName: z.string().min(1).max(200).optional(),
        instrumentType: z.enum(["call_deposit", "fixed_deposit"]).optional(),
        minAmount: z.number().min(0).optional(),
        typicalTenor: z.string().max(100).optional(),
        indicativeRate: z.number().min(0).max(100).nullable().optional(),
        isNegotiable: z.boolean().optional(),
        notes: z.string().max(2000).optional(),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
      }))
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateBankInstrument(id, {
          ...(rest.bankName !== undefined && { bankName: rest.bankName }),
          ...(rest.instrumentType !== undefined && { instrumentType: rest.instrumentType }),
          ...(rest.minAmount !== undefined && { minAmount: String(rest.minAmount) }),
          ...(rest.typicalTenor !== undefined && { typicalTenor: rest.typicalTenor }),
          ...(rest.indicativeRate !== undefined && { indicativeRate: rest.indicativeRate === null ? null : String(rest.indicativeRate) }),
          ...(rest.isNegotiable !== undefined && { isNegotiable: rest.isNegotiable }),
          ...(rest.notes !== undefined && { notes: rest.notes }),
          ...(rest.asOfDate !== undefined && { asOfDate: new Date(rest.asOfDate) }),
          ...(rest.source !== undefined && { source: rest.source }),
        });
        return { success: true };
      }),
    remove: protectedProcedure
      .input(z.object({ id: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        await deleteBankInstrument(input.id);
        return { success: true };
      }),
  }),

  // ─── Round 12: Benchmark inputs (global) ──────────────────────────────────
  benchmarks: router({
    list: publicProcedure.query(async () => {
      const rows = await getBenchmarkInputs();
      return rows.map((r) => ({
        id: r.id,
        metricKey: r.metricKey,
        label: r.label,
        value: Number(r.value),
        asOfDate: r.asOfDate,
        source: r.source ?? null,
        notes: r.notes ?? null,
        updatedAt: r.updatedAt,
      }));
    }),
    upsert: protectedProcedure
      .input(z.object({
        metricKey: z.string().min(1).max(64),
        label: z.string().min(1).max(200),
        value: z.number().min(0).max(100),
        asOfDate: z.string().optional(),
        source: z.string().max(500).optional(),
        notes: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await upsertBenchmarkInput({
          metricKey: input.metricKey,
          label: input.label,
          value: String(input.value),
          asOfDate: input.asOfDate ? new Date(input.asOfDate) : undefined,
          source: input.source,
          notes: input.notes,
        });
        await addAuditLog({
          entity: "benchmark_inputs",
          action: "update",
          field: input.metricKey,
          newValue: String(input.value),
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: `Updated benchmark ${input.label} to ${input.value}%`,
        });
        return { success: true };
      }),
  }),

  // ─── Round 12: Audit log (per-portfolio) ──────────────────────────────────
  audit: router({
    list: protectedProcedure
      .input(z.object({ portfolioId: z.number().int().positive(), limit: z.number().int().min(1).max(500).default(100) }))
      .query(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        const rows = await getAuditLog(input.portfolioId, input.limit);
        return rows.map((r) => ({
          id: r.id,
          entity: r.entity,
          entityId: r.entityId,
          action: r.action,
          field: r.field ?? null,
          oldValue: r.oldValue ?? null,
          newValue: r.newValue ?? null,
          changedByName: r.changedByName ?? null,
          summary: r.summary ?? null,
          createdAt: r.createdAt,
        }));
      }),
    record: protectedProcedure
      .input(z.object({
        portfolioId: z.number().int().positive(),
        entity: z.string().max(64),
        entityId: z.number().int().optional(),
        action: z.enum(["create", "update", "delete"]),
        field: z.string().max(100).optional(),
        oldValue: z.string().max(2000).optional(),
        newValue: z.string().max(2000).optional(),
        summary: z.string().max(2000).optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        await requirePortfolio(input.portfolioId, ctx.user.id);
        await addAuditLog({
          portfolioId: input.portfolioId,
          entity: input.entity,
          entityId: input.entityId,
          action: input.action,
          field: input.field,
          oldValue: input.oldValue,
          newValue: input.newValue,
          changedByOpenId: ctx.user.openId,
          changedByName: ctx.user.name ?? null,
          summary: input.summary,
        });
        return { success: true };
      }),
  }),

  // ─── Round 12: MMF fund accrual settings ──────────────────────────────────
  mmfAccrual: router({
    updateSettings: protectedProcedure
      .input(z.object({
        id: z.number().int().positive(),
        dayCountBasis: z.union([z.literal(360), z.literal(365)]).optional(),
        creditingFrequency: z.enum(["daily", "monthly"]).optional(),
        whtRate: z.number().min(0).max(100).optional(),
      }))
      .mutation(async ({ input }) => {
        await updateMmfFundAccrualSettings(input.id, {
          ...(input.dayCountBasis !== undefined && { dayCountBasis: input.dayCountBasis }),
          ...(input.creditingFrequency !== undefined && { creditingFrequency: input.creditingFrequency }),
          ...(input.whtRate !== undefined && { whtRate: String(input.whtRate) }),
        });
        return { success: true };
      }),
  }),

  // ─── Test / Sandbox mode ────────────────────────────────────────────
  testMode: router({
    /** Seed a realistic sample sandbox portfolio (isolated from live data). */
    seedSample: protectedProcedure.mutation(async ({ ctx }) => {
      const funds = await getMmfFunds();
      const pickFund = (needle: string) =>
        funds.find((f) => f.fundName.toLowerCase().includes(needle.toLowerCase()));
      const primary = pickFund("nabo") ?? funds[0];
      const secondaryA = pickFund("cytonn") ?? funds[1] ?? primary;
      const secondaryB = pickFund("etica") ?? funds[2] ?? primary;

      // Anchor the demo to a start date ~7 months in the PAST so the sample
      // portfolio actually exercises the elapsed-month (actuals) path. Using a
      // future date would make currentMonth=0 and hide every recorded deposit.
      const now = new Date();
      const startBase = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 7, 1, 12, 0, 0));
      const iso = (year: number, monthIndex: number, day: number) =>
        `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // Helper: ISO date `k` months after the start month (clamped day 5/15).
      const monthsAfterStart = (k: number, day: number) => {
        const d = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + k, day, 12, 0, 0));
        return iso(d.getUTCFullYear(), d.getUTCMonth(), day);
      };

      const p = await createPortfolio({
        userId: ctx.user.id,
        isSandbox: true,
        name: "Sample Portfolio (Demo)",
        description: "Auto-generated demo data — safe to explore, edit, or reset.",
        targetAmount: "5000000",
        startDate: startBase,
        horizonMonths: 120,
        startingContribution: "30000",
        stepUpAmount: "3000",
        stepUpMonths: 6,
        safetyFloor: "50000",
        foundationFrac: "0.20",
        growthFrac: "0.50",
        deRiskingFrac: "0.15",
        mmfFundId: primary?.id ?? null,
      });
      if (!p) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to seed sample." });
      await ensureRateSettings(p.id);

      // A few primary-fund (MMF) and government-security deposits.
      const seedDeposit = (
        bucket: "mmf" | "tbill" | "ifb" | "fxd",
        institutionType: "mmf_fund" | "government_security",
        amount: number,
        date: string,
        mmfFundId?: number,
      ) =>
        addDepositEntry({
          portfolioId: p.id,
          bucket,
          institutionType,
          mmfFundId: mmfFundId ?? null,
          bankHoldingId: null,
          amount: String(amount),
          depositDate: new Date(`${date}T12:00:00.000Z`),
          notes: "Sample data",
        });
      // Primary-fund MMF deposits dated across the elapsed months (months 1, 2, 4).
      await seedDeposit("mmf", "mmf_fund", 90000, monthsAfterStart(0, 5), primary?.id);
      await seedDeposit("mmf", "mmf_fund", 30000, monthsAfterStart(1, 5), primary?.id);
      await seedDeposit("mmf", "mmf_fund", 30000, monthsAfterStart(3, 5), primary?.id);
      // Government-security deposits (T-bill + FXD) in elapsed months 2 and 3.
      await seedDeposit("tbill", "government_security", 50000, monthsAfterStart(1, 15));
      await seedDeposit("fxd", "government_security", 100000, monthsAfterStart(2, 1));

      // Two secondary MMF accounts.
      if (secondaryA && secondaryA.id !== primary?.id) {
        await addSecondaryMmf({
          portfolioId: p.id,
          mmfFundId: secondaryA.id,
          label: "Emergency pot",
          currentBalance: "120000",
          monthlyContribution: "5000",
          notes: "Sample data",
        });
      }
      if (secondaryB && secondaryB.id !== primary?.id && secondaryB.id !== secondaryA?.id) {
        await addSecondaryMmf({
          portfolioId: p.id,
          mmfFundId: secondaryB.id,
          label: "Short-term savings",
          currentBalance: "60000",
          monthlyContribution: "0",
          notes: "Sample data",
        });
      }

      // A bank fixed deposit (live actual) opened in elapsed month 3, 6-month tenor.
      const bankStart = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 2, 19, 12, 0, 0));
      const bankMaturity = new Date(Date.UTC(startBase.getUTCFullYear(), startBase.getUTCMonth() + 8, 19, 12, 0, 0));
      await addBankInstrumentHolding({
        portfolioId: p.id,
        bankName: "Equity Bank",
        label: "6-month fixed deposit",
        instrumentType: "fixed_deposit",
        principal: "200000",
        interestRate: "10.5000",
        rateAsOfDate: bankStart,
        isNegotiable: true,
        dayCountBasis: 365,
        whtRate: "15.0000",
        startDate: bankStart,
        tenorMonths: 6,
        maturityDate: bankMaturity,
        payoutFrequency: "maturity",
        currentValue: "200000",
      });

      return { success: true, portfolioId: p.id };
    }),

    /** Delete ALL sandbox portfolios (and their child data) for the current user. */
    reset: protectedProcedure.mutation(async ({ ctx }) => {
      const sandboxes = await getPortfolios(ctx.user.id, true);
      for (const s of sandboxes) {
        await deletePortfolio(s.id, ctx.user.id);
      }
      return { success: true, deleted: sandboxes.length };
    }),
  }),
});
export type AppRouter = typeof appRouter;
```

### `server/storage.ts`

```ts
// Preconfigured storage helpers for Manus WebDev templates
// Uploads via Forge Server presigned URL to S3 (PUT direct).
// Downloads return /manus-storage/{key} paths served via 307 redirect.

import { ENV } from "./_core/env";

function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;

  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY",
    );
  }

  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}

function normalizeKey(relKey: string): string {
  return relKey.replace(/^\/+/, "");
}

function appendHashSuffix(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}

export async function storagePut(
  relKey: string,
  data: Buffer | Uint8Array | string,
  contentType = "application/octet-stream",
): Promise<{ key: string; url: string }> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));

  // 1. Get presigned PUT URL from Forge
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);

  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }

  const { url: s3Url } = (await presignResp.json()) as { url: string };
  if (!s3Url) throw new Error("Forge returned empty presign URL");

  // 2. PUT file directly to S3
  const blob =
    typeof data === "string"
      ? new Blob([data], { type: contentType })
      : new Blob([data as any], { type: contentType });

  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob,
  });

  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }

  return { key, url: `/manus-storage/${key}` };
}

export async function storageGet(relKey: string): Promise<{ key: string; url: string }> {
  const key = normalizeKey(relKey);
  return { key, url: `/manus-storage/${key}` };
}

export async function storageGetSignedUrl(relKey: string): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = normalizeKey(relKey);

  const getUrl = new URL("v1/storage/presign/get", forgeUrl + "/");
  getUrl.searchParams.set("path", key);

  const resp = await fetch(getUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` },
  });

  if (!resp.ok) {
    const msg = await resp.text().catch(() => resp.statusText);
    throw new Error(`Storage signed URL failed (${resp.status}): ${msg}`);
  }

  const { url } = (await resp.json()) as { url: string };
  return url;
}
```


## Client — Entry, App, Global Styles


### `client/index.html`

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1" />
    <title>Investment Tracker</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;1,14..32,400&family=Playfair+Display:wght@600;700&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
    <script
      defer
      src="%VITE_ANALYTICS_ENDPOINT%/umami"
      data-website-id="%VITE_ANALYTICS_WEBSITE_ID%"></script>
  </body>
</html>
```

### `client/src/main.tsx`

```tsx
import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch(input, init) {
        return globalThis.fetch(input, {
          ...(init ?? {}),
          credentials: "include",
        });
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
```

### `client/src/App.tsx`

```tsx
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { DepositDrawerProvider } from "./contexts/DepositDrawerContext";
import { PortfolioProvider } from "./contexts/PortfolioContext";
import Dashboard from "./pages/Dashboard";
import Ledger from "./pages/Ledger";
import Contributions from "./pages/Contributions";
import Settings from "./pages/Settings";
import Securities from "./pages/Securities";
import Scenarios from "./pages/Scenarios";
import GettingStarted from "./pages/GettingStarted";
import Deposits from "./pages/Deposits";
import MmfFunds from "./pages/MmfFunds";
import OtherAssets from "./pages/OtherAssets";
import MmfAccrual from "./pages/MmfAccrual";
import TaxSummary from "./pages/TaxSummary";
import MmfStrategy from "./pages/MmfStrategy";
import BankInstruments from "./pages/BankInstruments";
import PortfolioReview from "./pages/PortfolioReview";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/ledger" component={Ledger} />
      <Route path="/contributions" component={Contributions} />
      <Route path="/securities" component={Securities} />
      <Route path="/scenarios" component={Scenarios} />
      <Route path="/settings" component={Settings} />
      <Route path="/getting-started" component={GettingStarted} />
      <Route path="/deposits" component={Deposits} />
      <Route path="/mmf-funds" component={MmfFunds} />
      <Route path="/mmf-accrual" component={MmfAccrual} />
      <Route path="/mmf-strategy" component={MmfStrategy} />
      <Route path="/bank-instruments" component={BankInstruments} />
      <Route path="/tax-summary" component={TaxSummary} />
      <Route path="/portfolio-review" component={PortfolioReview} />
      <Route path="/other-assets" component={OtherAssets} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <PortfolioProvider>
            <DepositDrawerProvider>
              <Toaster />
              <Router />
            </DepositDrawerProvider>
          </PortfolioProvider>
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
```

### `client/src/index.css`

```css
@import "tailwindcss";
@import "tw-animate-css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}

:root {
  --radius: 0.625rem;

  /* Deep navy + gold elegant dark theme */
  --background: oklch(0.12 0.02 250);
  --foreground: oklch(0.95 0.01 250);

  --card: oklch(0.16 0.025 250);
  --card-foreground: oklch(0.95 0.01 250);

  --popover: oklch(0.16 0.025 250);
  --popover-foreground: oklch(0.95 0.01 250);

  /* Gold accent */
  --primary: oklch(0.78 0.14 85);
  --primary-foreground: oklch(0.12 0.02 250);

  --secondary: oklch(0.22 0.03 250);
  --secondary-foreground: oklch(0.85 0.01 250);

  --muted: oklch(0.20 0.025 250);
  --muted-foreground: oklch(0.60 0.02 250);

  --accent: oklch(0.24 0.04 250);
  --accent-foreground: oklch(0.95 0.01 250);

  --destructive: oklch(0.60 0.20 25);

  --border: oklch(0.25 0.03 250);
  --input: oklch(0.20 0.025 250);
  --ring: oklch(0.78 0.14 85);

  /* Chart colors */
  --chart-1: oklch(0.78 0.14 85);    /* Gold */
  --chart-2: oklch(0.65 0.15 200);   /* Teal */
  --chart-3: oklch(0.70 0.12 160);   /* Green */
  --chart-4: oklch(0.65 0.15 280);   /* Purple */
  --chart-5: oklch(0.60 0.18 25);    /* Coral */

  /* Sidebar */
  --sidebar: oklch(0.10 0.02 250);
  --sidebar-foreground: oklch(0.90 0.01 250);
  --sidebar-primary: oklch(0.78 0.14 85);
  --sidebar-primary-foreground: oklch(0.12 0.02 250);
  --sidebar-accent: oklch(0.18 0.03 250);
  --sidebar-accent-foreground: oklch(0.90 0.01 250);
  --sidebar-border: oklch(0.20 0.025 250);
  --sidebar-ring: oklch(0.78 0.14 85);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
    font-feature-settings: "rlig" 1, "calt" 1;
  }
}

@layer utilities {
  .container {
    @apply mx-auto px-4 sm:px-6 lg:px-8;
    max-width: 1400px;
  }
  .flex {
    min-width: 0;
    min-height: 0;
  }
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}
::-webkit-scrollbar-track {
  background: oklch(0.14 0.02 250);
}
::-webkit-scrollbar-thumb {
  background: oklch(0.30 0.03 250);
  border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
  background: oklch(0.40 0.04 250);
}

/* Gold glow utility */
.gold-glow {
  box-shadow: 0 0 20px oklch(0.78 0.14 85 / 0.15);
}

/* Card hover effect */
.card-hover {
  transition: transform 0.2s cubic-bezier(0.23, 1, 0.32, 1), box-shadow 0.2s cubic-bezier(0.23, 1, 0.32, 1);
}
.card-hover:hover {
  transform: translateY(-2px);
  box-shadow: 0 8px 32px oklch(0.78 0.14 85 / 0.10);
}

/* Number display */
.kes-amount {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* Phase badge colors */
.phase-foundation { background: oklch(0.65 0.15 200 / 0.15); color: oklch(0.65 0.15 200); border-color: oklch(0.65 0.15 200 / 0.3); }
.phase-growth { background: oklch(0.70 0.12 160 / 0.15); color: oklch(0.70 0.12 160); border-color: oklch(0.70 0.12 160 / 0.3); }
.phase-de-risking { background: oklch(0.78 0.14 85 / 0.15); color: oklch(0.78 0.14 85); border-color: oklch(0.78 0.14 85 / 0.3); }
.phase-final-liquidity { background: oklch(0.65 0.15 280 / 0.15); color: oklch(0.65 0.15 280); border-color: oklch(0.65 0.15 280 / 0.3); }

/* Status colors */
.status-on-track { color: oklch(0.70 0.12 160); }
.status-ahead { color: oklch(0.78 0.14 85); }
.status-behind { color: oklch(0.60 0.18 25); }

/* Gradient text */
.gradient-text {
  background: linear-gradient(135deg, oklch(0.78 0.14 85), oklch(0.85 0.10 75));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

/* Animated progress bar */
@keyframes progress-fill {
  from { width: 0%; }
  to { width: var(--progress-width); }
}
.progress-animated {
  animation: progress-fill 1.2s cubic-bezier(0.23, 1, 0.32, 1) forwards;
}
```

### `client/src/const.ts`

```ts
export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

// Generate login URL at runtime so redirect URI reflects the current origin.
export const getLoginUrl = () => {
  const oauthPortalUrl = import.meta.env.VITE_OAUTH_PORTAL_URL;
  const appId = import.meta.env.VITE_APP_ID;
  const redirectUri = `${window.location.origin}/api/oauth/callback`;
  const state = btoa(redirectUri);

  const url = new URL(`${oauthPortalUrl}/app-auth`);
  url.searchParams.set("appId", appId);
  url.searchParams.set("redirectUri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("type", "signIn");

  return url.toString();
};
```


## Client — Contexts


### `client/src/contexts/DepositDrawerContext.tsx`

```tsx
import { createContext, useContext, useState } from "react";
import { DepositDrawer } from "@/components/DepositDrawer";

interface DepositDrawerContextValue {
  openDrawer: () => void;
  closeDrawer: () => void;
}

const DepositDrawerContext = createContext<DepositDrawerContextValue>({
  openDrawer: () => {},
  closeDrawer: () => {},
});

export function DepositDrawerProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <DepositDrawerContext.Provider value={{ openDrawer: () => setOpen(true), closeDrawer: () => setOpen(false) }}>
      {children}
      <DepositDrawer open={open} onClose={() => setOpen(false)} />
    </DepositDrawerContext.Provider>
  );
}

export function useDepositDrawer() {
  return useContext(DepositDrawerContext);
}
```

### `client/src/contexts/PortfolioContext.tsx`

```tsx
import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";

interface Portfolio {
  id: number;
  name: string;
  description?: string | null;
  targetAmount: number;
  startDate: string;
  horizonMonths: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
  foundationFrac: number;
  growthFrac: number;
  deRiskingFrac: number;
  mmfFundId: number | null;
  cbkSourceUrl: string | null;
  sanlamSourceUrl: string | null;
  ratesLastUpdatedAt: Date | null;
  isSandbox: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type PortfolioMode = "live" | "sandbox";

interface PortfolioContextValue {
  mode: PortfolioMode;
  setMode: (mode: PortfolioMode) => void;
  portfolioId: number | null;
  portfolio: Portfolio | null;
  portfolios: Portfolio[];
  isLoading: boolean;
  setPortfolioId: (id: number) => void;
  refetch: () => void;
}

const PortfolioContext = createContext<PortfolioContextValue>({
  mode: "live",
  setMode: () => {},
  portfolioId: null,
  portfolio: null,
  portfolios: [],
  isLoading: true,
  setPortfolioId: () => {},
  refetch: () => {},
});

const STORAGE_KEY = "kes5m_active_portfolio_id";
const MODE_KEY = "kes5m_portfolio_mode";

export function PortfolioProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const [mode, setModeState] = useState<PortfolioMode>(() => {
    const stored = localStorage.getItem(MODE_KEY);
    return stored === "sandbox" ? "sandbox" : "live";
  });

  // Active portfolio id is tracked per mode so switching modes restores the
  // last-selected portfolio in that mode.
  const [portfolioId, setPortfolioIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(`${STORAGE_KEY}_${mode}`);
    return stored ? parseInt(stored, 10) : null;
  });

  const { data: portfolios = [], isLoading, refetch } = trpc.portfolios.list.useQuery(
    { isSandbox: mode === "sandbox" },
    { enabled: !!user }
  );

  const setMode = useCallback((next: PortfolioMode) => {
    setModeState(next);
    localStorage.setItem(MODE_KEY, next);
    const stored = localStorage.getItem(`${STORAGE_KEY}_${next}`);
    setPortfolioIdState(stored ? parseInt(stored, 10) : null);
  }, []);

  // Auto-select: if stored ID is gone or no selection yet, pick the first portfolio
  useEffect(() => {
    if (isLoading) return;
    if (!portfolios.length) {
      // Nothing in this mode yet — clear selection so empty/onboarding states show.
      if (portfolioId !== null) setPortfolioIdState(null);
      return;
    }
    const ids = portfolios.map((p) => p.id);
    if (!portfolioId || !ids.includes(portfolioId)) {
      const first = portfolios[0].id;
      setPortfolioIdState(first);
      localStorage.setItem(`${STORAGE_KEY}_${mode}`, String(first));
    }
  }, [portfolios, isLoading, portfolioId, mode]);

  const setPortfolioId = useCallback(
    (id: number) => {
      setPortfolioIdState(id);
      localStorage.setItem(`${STORAGE_KEY}_${mode}`, String(id));
    },
    [mode]
  );

  const portfolio = portfolios.find((p) => p.id === portfolioId) ?? null;

  return (
    <PortfolioContext.Provider
      value={{ mode, setMode, portfolioId, portfolio, portfolios, isLoading, setPortfolioId, refetch }}
    >
      {children}
    </PortfolioContext.Provider>
  );
}

export function usePortfolio() {
  return useContext(PortfolioContext);
}
```

### `client/src/contexts/ThemeContext.tsx`

```tsx
import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  toggleTheme?: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: Theme;
  switchable?: boolean;
}

export function ThemeProvider({
  children,
  defaultTheme = "light",
  switchable = false,
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (switchable) {
      const stored = localStorage.getItem("theme");
      return (stored as Theme) || defaultTheme;
    }
    return defaultTheme;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }

    if (switchable) {
      localStorage.setItem("theme", theme);
    }
  }, [theme, switchable]);

  const toggleTheme = switchable
    ? () => {
        setTheme(prev => (prev === "light" ? "dark" : "light"));
      }
    : undefined;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, switchable }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
```


## Client — Hooks


### `client/src/hooks/useComposition.ts`

```ts
import { useRef } from "react";
import { usePersistFn } from "./usePersistFn";

export interface UseCompositionReturn<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  onCompositionStart: React.CompositionEventHandler<T>;
  onCompositionEnd: React.CompositionEventHandler<T>;
  onKeyDown: React.KeyboardEventHandler<T>;
  isComposing: () => boolean;
}

export interface UseCompositionOptions<
  T extends HTMLInputElement | HTMLTextAreaElement,
> {
  onKeyDown?: React.KeyboardEventHandler<T>;
  onCompositionStart?: React.CompositionEventHandler<T>;
  onCompositionEnd?: React.CompositionEventHandler<T>;
}

type TimerResponse = ReturnType<typeof setTimeout>;

export function useComposition<
  T extends HTMLInputElement | HTMLTextAreaElement = HTMLInputElement,
>(options: UseCompositionOptions<T> = {}): UseCompositionReturn<T> {
  const {
    onKeyDown: originalOnKeyDown,
    onCompositionStart: originalOnCompositionStart,
    onCompositionEnd: originalOnCompositionEnd,
  } = options;

  const c = useRef(false);
  const timer = useRef<TimerResponse | null>(null);
  const timer2 = useRef<TimerResponse | null>(null);

  const onCompositionStart = usePersistFn((e: React.CompositionEvent<T>) => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (timer2.current) {
      clearTimeout(timer2.current);
      timer2.current = null;
    }
    c.current = true;
    originalOnCompositionStart?.(e);
  });

  const onCompositionEnd = usePersistFn((e: React.CompositionEvent<T>) => {
    // 使用两层 setTimeout 来处理 Safari 浏览器中 compositionEnd 先于 onKeyDown 触发的问题
    timer.current = setTimeout(() => {
      timer2.current = setTimeout(() => {
        c.current = false;
      });
    });
    originalOnCompositionEnd?.(e);
  });

  const onKeyDown = usePersistFn((e: React.KeyboardEvent<T>) => {
    // 在 composition 状态下，阻止 ESC 和 Enter（非 shift+Enter）事件的冒泡
    if (
      c.current &&
      (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))
    ) {
      e.stopPropagation();
      return;
    }
    originalOnKeyDown?.(e);
  });

  const isComposing = usePersistFn(() => {
    return c.current;
  });

  return {
    onCompositionStart,
    onCompositionEnd,
    onKeyDown,
    isComposing,
  };
}
```

### `client/src/hooks/useMaturingWindow.ts`

```ts
import { useEffect, useState } from "react";

/**
 * Shared "maturing soon" window (in days). Persisted to localStorage and kept in
 * sync across the app — the Securities page selector and the sidebar count badge
 * both read/write the same value so they never disagree.
 *
 * Allowed values: 30 / 60 / 90 days. Defaults to 30.
 */
export type MaturingWindow = 30 | 60 | 90;

const STORAGE_KEY = "kes5m.maturingWindowDays";
const ALLOWED: MaturingWindow[] = [30, 60, 90];
const EVENT = "kes5m:maturing-window-change";

function readStored(): MaturingWindow {
  if (typeof window === "undefined") return 30;
  const raw = Number(window.localStorage.getItem(STORAGE_KEY));
  return (ALLOWED as number[]).includes(raw) ? (raw as MaturingWindow) : 30;
}

export function useMaturingWindow(): [MaturingWindow, (next: MaturingWindow) => void] {
  const [windowDays, setWindowDays] = useState<MaturingWindow>(readStored);

  useEffect(() => {
    // Keep multiple hook instances (page + sidebar) in sync within the same tab
    // (storage events only fire across tabs, so we use a custom event too).
    const sync = () => setWindowDays(readStored());
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const update = (next: MaturingWindow) => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, String(next));
      window.dispatchEvent(new Event(EVENT));
    }
    setWindowDays(next);
  };

  return [windowDays, update];
}

/** Whole days from now until the given date (negative = already overdue). */
export function daysUntilDate(dateStr: string | Date): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
```

### `client/src/hooks/useMobile.tsx`

```tsx
import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
```

### `client/src/hooks/usePersistFn.ts`

```ts
import { useRef } from "react";

type noop = (...args: any[]) => any;

/**
 * usePersistFn instead of useCallback to reduce cognitive load
 */
export function usePersistFn<T extends noop>(fn: T) {
  const fnRef = useRef<T>(fn);
  fnRef.current = fn;

  const persistFn = useRef<T>(null);
  if (!persistFn.current) {
    persistFn.current = function (this: unknown, ...args) {
      return fnRef.current!.apply(this, args);
    } as T;
  }

  return persistFn.current!;
}
```

### `client/src/hooks/useReconciliationDrift.ts`

```ts
import { useMemo } from "react";
import { trpc } from "@/lib/trpc";

/**
 * Shared reconciliation-drift calculation. Compares the projection engine's
 * "today" value (the ending total of the last month the engine seeded from
 * real deposits, i.e. isActual) against the live actuals total from
 * deposits.summary. Both the Dashboard reconciliation card and the sidebar
 * drift badge consume this so the two stay perfectly in step.
 *
 * Returns null while data is loading or when there are no actuals yet (no
 * engine "today" value exists to reconcile against).
 */
export type ReconciliationDrift = {
  engineToday: number;
  actualsTotal: number;
  delta: number;
  deltaPct: number;
  absPct: number;
  /** Severity tier mirroring the Dashboard thresholds. */
  level: "match" | "minor" | "major";
};

export function useReconciliationDrift(
  portfolioId: number | null | undefined
): ReconciliationDrift | null {
  const { data: projection } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );
  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );

  return useMemo(() => {
    if (!portfolioId || !projection?.length || !summary) return null;
    let engineToday: number | null = null;
    for (const r of projection) {
      if (r.isActual) engineToday = r.totalEnd;
    }
    if (engineToday == null) return null;

    const actualsTotal = summary.totalContributed ?? 0;
    // No actuals recorded yet → nothing to reconcile.
    if (actualsTotal <= 0 && engineToday <= 0) return null;

    const delta = actualsTotal - engineToday;
    const denom = engineToday > 0 ? engineToday : actualsTotal || 1;
    const deltaPct = (delta / denom) * 100;
    const absPct = Math.abs(deltaPct);
    const level: ReconciliationDrift["level"] =
      absPct <= 1 ? "match" : absPct <= 5 ? "minor" : "major";

    return { engineToday, actualsTotal, delta, deltaPct, absPct, level };
  }, [portfolioId, projection, summary]);
}
```

### `client/src/hooks/useSelectedFund.ts`

```ts
/**
 * useSelectedFund
 *
 * Returns the currently-selected MMF fund details for the active portfolio.
 * Falls back to sensible defaults when no fund is selected.
 *
 * Usage:
 *   const { fundName, fundCompany, fundEar, hasFund } = useSelectedFund();
 */
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";

export interface SelectedFundInfo {
  /** Display name, e.g. "Nabo Africa Money Market Fund" */
  fundName: string;
  /** Short label for bucket headers, e.g. "Nabo MMF" */
  fundLabel: string;
  /** Company/manager name, e.g. "Nabo Capital" */
  fundCompany: string;
  /** Effective annual return (gross, before WHT) */
  fundEar: number;
  /** True when a fund has been explicitly selected */
  hasFund: boolean;
  /** Numeric DB id of the selected fund, or null */
  fundId: number | null;
}

const FALLBACK: SelectedFundInfo = {
  fundName: "Money Market Fund",
  fundLabel: "MMF",
  fundCompany: "—",
  fundEar: 8.78,
  hasFund: false,
  fundId: null,
};

export function useSelectedFund(): SelectedFundInfo {
  const { portfolioId } = usePortfolio();

  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  if (!settings?.selectedFundName) return FALLBACK;

  const rawName = settings.selectedFundName;
  // Build a short label: strip common suffixes for compact display
  const shortLabel = rawName
    .replace(/\s*Money Market Fund\s*/i, "")
    .replace(/\s*MMF\s*/i, "")
    .trim();
  const fundLabel = shortLabel ? `${shortLabel} MMF` : rawName;

  return {
    fundName: rawName,
    fundLabel,
    fundCompany: settings.selectedFundCompany ?? "—",
    fundEar: settings.selectedFundEar ?? settings.mmfYield,
    hasFund: true,
    fundId: settings.selectedFundId ?? null,
  };
}
```


## Client — Lib


### `client/src/lib/format.ts`

```ts
/**
 * Format a number as a KES currency string.
 */
export function formatKES(value: number, decimals = 0): string {
  if (!isFinite(value)) return "KES 0";
  return `KES ${value.toLocaleString("en-KE", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}`;
}

/**
 * Format a number as a compact KES string (e.g. KES 1.2M).
 */
export function formatKESCompact(value: number): string {
  if (value >= 1_000_000) return `KES ${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `KES ${(value / 1_000).toFixed(1)}K`;
  return `KES ${value.toFixed(0)}`;
}

/**
 * Format a percentage.
 */
export function formatPct(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Get the month name and year from a start date and month offset.
 */
export function getMonthLabel(startDate: string, monthNumber: number): string {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + monthNumber - 1);
  return d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
}

/**
 * Get the phase label for display.
 */
export function getPhaseName(phase: string): string {
  switch (phase) {
    case "foundation": return "Foundation";
    case "growth": return "Growth Engine";
    case "de-risking": return "De-risking";
    case "final-liquidity": return "Final Liquidity";
    default: return phase;
  }
}

/**
 * Get the phase color class.
 */
export function getPhaseColorClass(phase: string): string {
  switch (phase) {
    case "foundation": return "phase-foundation";
    case "growth": return "phase-growth";
    case "de-risking": return "phase-de-risking";
    case "final-liquidity": return "phase-final-liquidity";
    default: return "";
  }
}

/**
 * Build a "Mon YYYY – Mon YYYY" date range from a start date and horizon in months.
 * The end is the month in which the horizon completes (start + horizonMonths - 1).
 */
export function formatDateRange(startDate: string | null | undefined, horizonMonths: number | null | undefined): string {
  if (!startDate || !horizonMonths || horizonMonths < 1) return "";
  const start = new Date(startDate);
  if (isNaN(start.getTime())) return "";
  const end = new Date(start);
  end.setMonth(end.getMonth() + horizonMonths - 1);
  const fmt = (d: Date) => d.toLocaleDateString("en-KE", { month: "short", year: "numeric" });
  return `${fmt(start)} – ${fmt(end)}`;
}

/**
 * Get security type label.
 */
export function getSecurityLabel(type: string): string {
  switch (type) {
    case "tbill_91": return "91-Day T-Bill";
    case "tbill_182": return "182-Day T-Bill";
    case "tbill_364": return "364-Day T-Bill";
    case "ifb": return "Infrastructure Bond (IFB)";
    case "fxd": return "Fixed Coupon Bond (FXD)";
    default: return type;
  }
}
```

### `client/src/lib/rateStaleness.ts`

```ts
/**
 * Shared rate-staleness helper.
 *
 * Computes a human-readable freshness label for the portfolio's rate snapshot
 * and flags whether it is stale (>= 7 days) or very stale (>= 30 days / never).
 * Used by the Dashboard rate card and the sidebar staleness badge so both use
 * identical thresholds and copy.
 */
export interface RateStaleness {
  label: string;
  isStale: boolean;
  isVeryStale: boolean;
}

export function rateStaleness(updatedAt: Date | string | null | undefined): RateStaleness {
  if (!updatedAt) return { label: "never", isStale: true, isVeryStale: true };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000);
  let label: string;
  if (minutes < 2) label = "just now";
  else if (minutes < 60) label = `${minutes} minutes ago`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  else label = `${days} day${days !== 1 ? "s" : ""} ago`;
  return { label, isStale: days >= 7, isVeryStale: days >= 30 };
}
```

### `client/src/lib/trpc.ts`

```ts
import { createTRPCReact } from "@trpc/react-query";
import type { AppRouter } from "../../../server/routers";

export const trpc = createTRPCReact<AppRouter>();
```

### `client/src/lib/utils.ts`

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```


## Client — App Components


### `client/src/components/AppShell.tsx`

```tsx
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { formatDateRange, formatKESCompact } from "@/lib/format";
import { PortfolioSelector } from "./PortfolioSelector";
import { ModeSwitcher, SandboxBanner } from "./ModeSwitcher";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
  TrendingUp,
  ArrowDownCircle,
  MapPin,
  PiggyBank,
  Briefcase,
  CalendarClock,
  Receipt,
  PieChart,
  Building2,
  ClipboardCheck,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { trpc } from "@/lib/trpc";
import { rateStaleness } from "@/lib/rateStaleness";
import { useReconciliationDrift } from "@/hooks/useReconciliationDrift";
import { useMaturingWindow, daysUntilDate } from "@/hooks/useMaturingWindow";
import { Clock } from "lucide-react";
import { useMemo } from "react";

/**
 * Compact rate-staleness badge for the sidebar, visible on every page. Reads
 * the current portfolio's rate snapshot freshness and links to Rate Settings.
 * Mirrors the Dashboard rate-card thresholds (green / amber / red).
 */
function SidebarRateStaleness({
  portfolioId,
  onNavClick,
}: {
  portfolioId: number | null | undefined;
  onNavClick?: () => void;
}) {
  const { data } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );
  if (!portfolioId || !data) return null;
  const s = rateStaleness((data as { ratesLastUpdatedAt?: Date | string | null }).ratesLastUpdatedAt ?? null);
  const tone = s.isVeryStale
    ? "border-red-500/40 bg-red-500/10 text-red-400"
    : s.isStale
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  return (
    <Link href="/settings" onClick={onNavClick}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer hover:brightness-110",
          tone
        )}
        title={s.isStale ? "Your saved rates may be out of date — update them to keep projections accurate." : "Rates are up to date."}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          Rates updated {s.label}
        </span>
        {s.isStale && <span className="font-semibold shrink-0">Update</span>}
      </div>
    </Link>
  );
}

/**
 * Reconciliation-drift badge shown next to the Dashboard nav item. Surfaces a
 * small amber/red pill whenever live actuals diverge from the projection
 * engine's seeded "today" value by more than ~1%, so portfolio drift is
 * visible without opening the Dashboard reconciliation card. Hidden when the
 * numbers match (or there is nothing to reconcile yet).
 */
function SidebarDriftBadge({
  portfolioId,
  onNavClick,
}: {
  portfolioId: number | null | undefined;
  onNavClick?: () => void;
}) {
  const [, setLocation] = useLocation();
  const drift = useReconciliationDrift(portfolioId);
  if (!drift || drift.level === "match") return null;
  const tone =
    drift.level === "major"
      ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25";
  const sign = drift.delta >= 0 ? "+" : "−";
  return (
    <button
      type="button"
      onClick={(e) => {
        // The badge lives inside the Dashboard <Link>; intercept so we can add the
        // deep-link param that tells the Dashboard to scroll to the reconciliation card.
        e.preventDefault();
        e.stopPropagation();
        setLocation("/?reconcile=1");
        onNavClick?.();
      }}
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums transition-colors cursor-pointer",
        tone
      )}
      title={`Live actuals are ${sign}${drift.absPct.toFixed(1)}% vs the projection engine's value for today. Click to open the Dashboard reconciliation card.`}
    >
      {sign}{drift.absPct.toFixed(1)}%
    </button>
  );
}

/**
 * Count badge on the CBK Securities nav item. Shows how many active lots fall
 * inside the user's chosen maturing-soon window (shared with the Securities page),
 * so an upcoming rollover is visible without opening the page. Hidden when none.
 */
function SidebarSecuritiesBadge({ portfolioId }: { portfolioId: number | null | undefined }) {
  const [windowDays] = useMaturingWindow();
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: portfolioId != null }
  );
  const count = useMemo(() => {
    if (!securities) return 0;
    return securities.filter(
      (s) => !s.isMatured && daysUntilDate(s.maturityDate) <= windowDays
    ).length;
  }, [securities, windowDays]);
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-amber-400"
      title={`${count} lot${count === 1 ? "" : "s"} maturing within ${windowDays} days`}
    >
      {count}
    </span>
  );
}

const navGroups = [
  {
    title: "Tracking",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ledger", label: "Month Ledger", icon: BookOpen },
      { href: "/contributions", label: "Contributions", icon: TrendingUp },
      { href: "/securities", label: "CBK Securities", icon: Landmark },
      { href: "/mmf-funds", label: "MMF Funds", icon: PiggyBank },
      { href: "/other-assets", label: "Other Assets", icon: Briefcase },
    ],
  },
  {
    title: "Analysis",
    items: [
      { href: "/scenarios", label: "Scenarios", icon: BarChart3 },
      { href: "/portfolio-review", label: "Portfolio Review", icon: ClipboardCheck },
      { href: "/mmf-accrual", label: "Daily Accrual", icon: CalendarClock },
      { href: "/tax-summary", label: "Tax Summary", icon: Receipt },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { href: "/mmf-strategy", label: "MMF Strategy", icon: PieChart },
      { href: "/bank-instruments", label: "Bank Instruments", icon: Building2 },
      { href: "/getting-started", label: "Getting Started", icon: MapPin },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/settings", label: "Rate Settings", icon: Settings },
    ],
  },
];

function SidebarContent({
  location,
  openDrawer,
  user,
  logout,
  onNavClick,
  appTitle,
  appSubtitle,
  portfolioId,
}: {
  location: string;
  openDrawer: () => void;
  user: { name?: string | null; email?: string | null } | null;
  logout: () => void;
  onNavClick?: () => void;
  appTitle: string;
  appSubtitle: string;
  portfolioId: number | null | undefined;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <LineChart className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p
              className="text-sm font-bold text-sidebar-foreground leading-tight truncate"
              style={{ fontFamily: "'Playfair Display', serif" }}
              title={appTitle}
            >
              {appTitle}
            </p>
            <p className="text-xs text-muted-foreground truncate" title={appSubtitle}>{appSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Mode toggle + Portfolio Selector */}
      <div className="px-3 py-3 border-b border-sidebar-border space-y-3">
        <ModeSwitcher />
        <PortfolioSelector />
        <SidebarRateStaleness portfolioId={portfolioId} onNavClick={onNavClick} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
        {/* Record Deposits — opens drawer, not a page */}
        <button
          onClick={() => { openDrawer(); onNavClick?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group",
            "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <ArrowDownCircle className="w-4 h-4 shrink-0 transition-colors text-muted-foreground group-hover:text-sidebar-accent-foreground" />
          <span className="flex-1 text-left">Record Deposits</span>
          <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">Live</span>
        </button>

        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="px-3 mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {group.items.map(({ href, label, icon: Icon }) => {
                const isActive = location === href;
                return (
                  <li key={href}>
                    <Link href={href} onClick={onNavClick}>
                      <div
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group",
                          isActive
                            ? "bg-sidebar-accent text-primary"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon
                          className={cn(
                            "w-4 h-4 shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground"
                          )}
                        />
                        <span className="flex-1">{label}</span>
                        {href === "/" && <SidebarDriftBadge portfolioId={portfolioId} onNavClick={onNavClick} />}
                        {href === "/securities" && <SidebarSecuritiesBadge portfolioId={portfolioId} />}
                        {isActive && <ChevronRight className="w-3 h-3 text-primary" />}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      {/* User profile */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name ?? "Investor"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => logout()}
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const { openDrawer } = useDepositDrawer();
  const { portfolio, portfolioId } = usePortfolio();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Portfolio-driven app identity. Falls back to a neutral label before a
  // portfolio is loaded so we never show another portfolio's hardcoded name.
  const appTitle = portfolio?.name?.trim() || "Investment Tracker";
  const dateRange = portfolio
    ? formatDateRange(portfolio.startDate, portfolio.horizonMonths)
    : "";
  const targetLabel = portfolio
    ? `Target ${formatKESCompact(Number(portfolio.targetAmount) || 0)}`
    : "";
  // Prefer the portfolio's own description; otherwise derive a date-range + target subtitle.
  const appSubtitle =
    portfolio?.description?.trim() ||
    [dateRange, targetLabel].filter(Boolean).join(" · ") ||
    "Personal investment plan";

  // Current page label for the mobile top bar
  const currentPage =
    navGroups
      .flatMap((g) => g.items)
      .find((n) => n.href === location)?.label ?? appTitle;

  if (loading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="hidden md:flex w-64 border-r border-border p-6 flex-col gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-32" />
          <div className="mt-6 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="mb-6">
            <LineChart className="w-16 h-16 mx-auto text-primary mb-4" />
            <h1
              className="text-3xl font-bold mb-2 gradient-text"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Investment Tracker
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Plan and track your fixed-income investment journey across Money
              Market Funds and CBK securities — one or many portfolios, each with
              its own target, horizon, and strategy.
            </p>
          </div>
          <Button
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            onClick={() => (window.location.href = getLoginUrl())}
          >
            Sign in to get started
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Desktop sidebar (always visible ≥ md) ── */}
      <aside className="hidden md:flex w-64 shrink-0 border-r border-border bg-sidebar flex-col">
        <SidebarContent
          location={location}
          openDrawer={openDrawer}
          user={user}
          logout={logout}
          appTitle={appTitle}
          appSubtitle={appSubtitle}
          portfolioId={portfolioId}
        />
      </aside>

      {/* ── Mobile slide-over backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile slide-over sidebar ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent
          location={location}
          openDrawer={openDrawer}
          user={user}
          logout={logout}
          onNavClick={() => setMobileOpen(false)}
          appTitle={appTitle}
          appSubtitle={appSubtitle}
          portfolioId={portfolioId}
        />
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
              <LineChart className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground truncate">{currentPage}</span>
          </div>
          {/* Quick deposit button on mobile */}
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            onClick={openDrawer}
            aria-label="Record deposit"
          >
            <ArrowDownCircle className="w-5 h-5" />
          </button>
        </header>

        {/* Sandbox banner */}
        <SandboxBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
```

### `client/src/components/DepositDrawer.tsx`

```tsx
import { useMemo, useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import { formatKES } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  PlusCircle,
  Trash2,
  Wallet,
  TrendingUp,
  ShieldCheck,
  Landmark,
  Info,
  ArrowDownCircle,
  X,
  Building2,
  PiggyBank,
} from "lucide-react";

/**
 * A destination is a concrete place real money can go:
 *  - a primary MMF fund
 *  - a secondary MMF fund
 *  - a live bank instrument holding
 *  - a government-security bucket (T-bill / IFB / FXD)
 * Each carries the exact payload `deposits.add` needs.
 */
type Destination = {
  value: string; // unique key for the Select
  label: string;
  sublabel?: string;
  group: "MMF funds" | "Bank instruments" | "Government securities";
  icon: React.ReactNode;
  color: string;
  taxNote: string;
  payload: {
    institutionType: "mmf_fund" | "bank_instrument" | "government_security";
    mmfFundId?: number;
    bankHoldingId?: number;
    bucket?: "mmf" | "tbill" | "ifb" | "fxd";
  };
};

const GOV_META = {
  tbill: { label: "CBK T-Bills", icon: <TrendingUp className="w-4 h-4" />, color: "text-blue-400", taxNote: "15% WHT on discount (final tax)" },
  ifb: { label: "IFB Bonds", icon: <ShieldCheck className="w-4 h-4" />, color: "text-violet-400", taxNote: "Tax-exempt (IFB)" },
  fxd: { label: "FXD Bonds", icon: <Landmark className="w-4 h-4" />, color: "text-orange-400", taxNote: "15% WHT on coupons" },
} as const;

interface DepositDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function DepositDrawer({ open, onClose }: DepositDrawerProps) {
  const { portfolioId, portfolio } = usePortfolio();
  const { fundName, fundLabel, fundEar } = useSelectedFund();
  const utils = trpc.useUtils();

  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: summary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaries = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const liveTarget = portfolio?.targetAmount ?? 0;

  const addMutation = trpc.deposits.add.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      utils.secondaryMmfs.list.invalidate();
      utils.bankHoldings.list.invalidate();
      toast.success("Deposit recorded");
      setFormOpen(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  const deleteMutation = trpc.deposits.delete.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Deposit removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  // Build the full destination list from the portfolio's real accounts.
  const destinations = useMemo<Destination[]>(() => {
    const list: Destination[] = [];
    const primaryFundId = portfolio?.mmfFundId ?? undefined;

    // Primary MMF (only routable as a destination if a fund is selected)
    if (primaryFundId) {
      list.push({
        value: `mmf:${primaryFundId}`,
        label: fundName,
        sublabel: `Primary fund · ${fundEar.toFixed(2)}% p.a. gross`,
        group: "MMF funds",
        icon: <Wallet className="w-4 h-4" />,
        color: "text-emerald-400",
        taxNote: "15% WHT deducted at source (final tax)",
        payload: { institutionType: "mmf_fund", mmfFundId: primaryFundId },
      });
    }
    // Secondary MMFs
    for (const s of secondaries) {
      list.push({
        value: `smmf:${s.id}`,
        label: s.label || s.fundName,
        sublabel: `${s.company} · ${s.ear.toFixed(2)}% p.a.`,
        group: "MMF funds",
        icon: <PiggyBank className="w-4 h-4" />,
        color: "text-emerald-300",
        taxNote: "15% WHT deducted at source (final tax)",
        payload: { institutionType: "mmf_fund", mmfFundId: s.mmfFundId },
      });
    }
    // Bank instrument holdings
    for (const h of bankHoldings) {
      list.push({
        value: `bank:${h.id}`,
        label: h.label || `${h.bankName} ${h.instrumentType === "fixed_deposit" ? "Fixed Deposit" : "Call Deposit"}`,
        sublabel: `${h.bankName} · ${h.interestRate.toFixed(2)}% p.a.`,
        group: "Bank instruments",
        icon: <Building2 className="w-4 h-4" />,
        color: "text-sky-300",
        taxNote: "15% WHT on interest (final tax)",
        payload: { institutionType: "bank_instrument", bankHoldingId: h.id },
      });
    }
    // Government securities buckets
    (["tbill", "ifb", "fxd"] as const).forEach((b) => {
      const m = GOV_META[b];
      list.push({
        value: `gov:${b}`,
        label: m.label,
        sublabel: "CBK / DhowCSD",
        group: "Government securities",
        icon: m.icon,
        color: m.color,
        taxNote: m.taxNote,
        payload: { institutionType: "government_security", bucket: b },
      });
    });
    return list;
  }, [portfolio?.mmfFundId, fundName, fundEar, secondaries, bankHoldings]);

  const [formOpen, setFormOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({
    destination: "",
    amount: "",
    depositDate: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  const selectedDest = destinations.find((d) => d.value === form.destination);

  function resetForm() {
    setForm({ destination: "", amount: "", depositDate: new Date().toISOString().slice(0, 10), notes: "" });
  }

  function handleSubmit() {
    const amount = parseFloat(form.amount);
    if (!amount || amount <= 0) { toast.error("Please enter a valid amount"); return; }
    if (!portfolioId) return;
    if (!selectedDest) { toast.error("Please choose where the money went"); return; }
    addMutation.mutate({
      portfolioId,
      amount,
      depositDate: form.depositDate,
      notes: form.notes || undefined,
      ...selectedDest.payload,
    });
  }

  // Resolve a deposit row to a human destination label for the history list.
  function destLabelFor(d: { institutionType?: string | null; mmfFundId?: number | null; bankHoldingId?: number | null; bucket: string }): { label: string; icon: React.ReactNode; color: string; taxFree: boolean } {
    if (d.institutionType === "bank_instrument" && d.bankHoldingId) {
      const h = bankHoldings.find((x) => x.id === d.bankHoldingId);
      return { label: h ? (h.label || `${h.bankName} deposit`) : "Bank deposit", icon: <Building2 className="w-4 h-4" />, color: "text-sky-300", taxFree: false };
    }
    if (d.institutionType === "mmf_fund" && d.mmfFundId) {
      if (portfolio?.mmfFundId === d.mmfFundId) {
        return { label: fundName, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
      }
      const s = secondaries.find((x) => x.mmfFundId === d.mmfFundId);
      return { label: s ? (s.label || s.fundName) : "MMF fund", icon: <PiggyBank className="w-4 h-4" />, color: "text-emerald-300", taxFree: false };
    }
    if (d.bucket === "ifb") return { label: GOV_META.ifb.label, icon: GOV_META.ifb.icon, color: GOV_META.ifb.color, taxFree: true };
    if (d.bucket === "tbill") return { label: GOV_META.tbill.label, icon: GOV_META.tbill.icon, color: GOV_META.tbill.color, taxFree: false };
    if (d.bucket === "fxd") return { label: GOV_META.fxd.label, icon: GOV_META.fxd.icon, color: GOV_META.fxd.color, taxFree: false };
    // legacy mmf bucket with no destination metadata
    return { label: fundLabel, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? liveTarget;
  const progressPct = liveTarget > 0 ? Math.min(100, (totalContributed / liveTarget) * 100) : 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Drawer panel */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-full max-w-[480px] bg-[#0d1117] border-l border-white/10 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        aria-label="Record Deposits panel"
      >
        {/* Drawer header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center">
              <ArrowDownCircle className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Record Deposits
              </h2>
              <p className="text-xs text-muted-foreground">Log real money into a specific account</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 flex items-center justify-center transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Summary strip */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-primary/10 border border-primary/20 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Contributed</p>
              <p className="text-xl font-bold text-primary kes-amount">{formatKES(totalContributed)}</p>
              <div className="mt-2 w-full h-1 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${progressPct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground mt-1">{progressPct.toFixed(1)}% of goal</p>
            </div>
            <div className="rounded-xl bg-white/5 border border-white/10 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Remaining</p>
              <p className="text-xl font-bold text-foreground kes-amount">{formatKES(remainingToTarget)}</p>
              <p className="text-xs text-muted-foreground mt-2">to reach {formatKES(liveTarget)}</p>
            </div>
          </div>

          {/* Tax summary */}
          {(summary?.taxLiability ?? 0) > 0 && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-red-400" />
                <p className="text-xs font-semibold text-red-400 uppercase tracking-wider">Est. Annual Tax (WHT)</p>
              </div>
              <p className="text-lg font-bold text-red-300 kes-amount">{formatKES(summary?.taxLiability ?? 0)}</p>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                {taxBreakdown.mmf > 0 && <p>MMF / Bank: {formatKES(taxBreakdown.mmf)}</p>}
                {taxBreakdown.tbill > 0 && <p>T-Bill: {formatKES(taxBreakdown.tbill)}</p>}
                {taxBreakdown.fxd > 0 && <p>FXD: {formatKES(taxBreakdown.fxd)}</p>}
                <p className="text-emerald-400 mt-1">IFB: Tax-exempt</p>
              </div>
            </div>
          )}

          <Separator className="bg-white/10" />

          {/* Add deposit form toggle */}
          {!formOpen ? (
            <Button
              onClick={() => setFormOpen(true)}
              className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold gap-2"
            >
              <PlusCircle className="w-4 h-4" />
              Add New Deposit
            </Button>
          ) : (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">New Deposit</p>
                <button onClick={() => { setFormOpen(false); resetForm(); }} className="text-xs text-muted-foreground hover:text-foreground">
                  Cancel
                </button>
              </div>

              {/* Destination — pick the account first */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Where did the money go?</Label>
                <Select value={form.destination} onValueChange={(v) => setForm((f) => ({ ...f, destination: v }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm">
                    <SelectValue placeholder="Choose an account or instrument" />
                  </SelectTrigger>
                  <SelectContent className="bg-[#0d1117] border-white/10 max-h-72">
                    {(["MMF funds", "Bank instruments", "Government securities"] as const).map((group) => {
                      const items = destinations.filter((d) => d.group === group);
                      if (items.length === 0) return null;
                      return (
                        <SelectGroup key={group}>
                          <SelectLabel className="text-xs text-muted-foreground">{group}</SelectLabel>
                          {items.map((d) => (
                            <SelectItem key={d.value} value={d.value}>
                              <div className="flex items-center gap-2">
                                <span className={d.color}>{d.icon}</span>
                                <span>{d.label}</span>
                              </div>
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      );
                    })}
                  </SelectContent>
                </Select>
                {selectedDest ? (
                  <p className="text-xs text-muted-foreground">{selectedDest.sublabel} · {selectedDest.taxNote}</p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Don't see your bank deposit or extra MMF? Add it first on the relevant page, then it appears here.
                  </p>
                )}
                {selectedDest?.payload.bucket === "fxd" && (
                  <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-300">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>FXD coupon income is subject to 15% WHT — reflected in your tax estimate.</span>
                  </div>
                )}
                {selectedDest?.payload.bucket === "ifb" && (
                  <div className="flex items-start gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-300">
                    <ShieldCheck className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>IFB bond coupons are fully tax-exempt.</span>
                  </div>
                )}
              </div>

              {/* Amount */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Amount (KES)</Label>
                <Input
                  type="number"
                  min="1"
                  step="100"
                  placeholder="e.g. 50000"
                  value={form.amount}
                  onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                  className="bg-white/5 border-white/10 font-mono h-9 text-sm"
                />
              </div>

              {/* Date */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Deposit Date</Label>
                <Input
                  type="date"
                  value={form.depositDate}
                  onChange={(e) => setForm((f) => ({ ...f, depositDate: e.target.value }))}
                  className="bg-white/5 border-white/10 h-9 text-sm"
                />
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
                <Textarea
                  placeholder="e.g. July 2026 monthly contribution"
                  value={form.notes}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="bg-white/5 border-white/10 resize-none h-16 text-sm"
                />
              </div>

              <Button
                onClick={handleSubmit}
                disabled={addMutation.isPending}
                className="w-full bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {addMutation.isPending ? "Saving…" : "Record Deposit"}
              </Button>
            </div>
          )}

          {/* Deposit history */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              History ({deposits.length})
            </p>
            {isLoading ? (
              <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
            ) : deposits.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <ArrowDownCircle className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
                <p className="text-xs text-muted-foreground">No deposits yet. Add your first one above.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {deposits.map((d) => {
                  const dest = destLabelFor(d as never);
                  const amount = parseFloat(String(d.amount));
                  return (
                    <div key={d.id} className="flex items-center gap-3 rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
                      <span className={dest.color}>{dest.icon}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground kes-amount">{formatKES(amount)}</span>
                          <Badge className={`text-xs px-1.5 py-0 h-4 ${dest.taxFree ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "bg-red-500/20 text-red-400 border-red-500/30"}`}>
                            {dest.taxFree ? "Tax-Free" : "15% WHT"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {dest.label} · {new Date(d.depositDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          {d.notes ? ` · ${d.notes}` : ""}
                        </p>
                      </div>
                      <button
                        onClick={() => setDeleteId(d.id)}
                        className="w-6 h-6 rounded flex items-center justify-center text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deposit?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently remove the deposit record and update your actuals summary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ portfolioId, id: deleteId })}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
```

### `client/src/components/ModeSwitcher.tsx`

```tsx
import { useState } from "react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "./ui/alert-dialog";
import { FlaskConical, Sparkles, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * Live / Test (sandbox) mode toggle plus sandbox-only seed & reset controls.
 * Lives in the sidebar. Sandbox data is isolated per-user and never mixes with
 * live tracking data.
 */
export function ModeSwitcher() {
  const { mode, setMode, refetch, setPortfolioId } = usePortfolio();
  const utils = trpc.useUtils();
  const [confirmReset, setConfirmReset] = useState(false);

  const seed = trpc.testMode.seedSample.useMutation({
    onSuccess: async (res) => {
      await utils.portfolios.list.invalidate();
      await refetch();
      if (res?.portfolioId) setPortfolioId(res.portfolioId);
      toast.success("Sample portfolio created", {
        description: "Explore freely — it never touches your live data.",
      });
    },
    onError: (e) => toast.error("Could not create sample", { description: e.message }),
  });

  const reset = trpc.testMode.reset.useMutation({
    onSuccess: async (res) => {
      await utils.portfolios.list.invalidate();
      await refetch();
      toast.success(
        res?.deleted ? `Cleared ${res.deleted} sample portfolio${res.deleted === 1 ? "" : "s"}` : "Sandbox cleared"
      );
      setConfirmReset(false);
    },
    onError: (e) => toast.error("Could not reset sandbox", { description: e.message }),
  });

  return (
    <div className="space-y-2">
      {/* Segmented Live / Test toggle */}
      <div
        role="tablist"
        aria-label="Data mode"
        className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-muted/60 border border-border"
      >
        <button
          role="tab"
          aria-selected={mode === "live"}
          onClick={() => setMode("live")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-150",
            mode === "live"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Live
        </button>
        <button
          role="tab"
          aria-selected={mode === "sandbox"}
          onClick={() => setMode("sandbox")}
          className={cn(
            "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-semibold transition-all duration-150",
            mode === "sandbox"
              ? "bg-amber-500 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <FlaskConical className="w-3 h-3" />
          Test
        </button>
      </div>

      {/* Sandbox-only controls */}
      {mode === "sandbox" && (
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="outline"
            className="flex-1 h-8 text-xs bg-amber-500/10 border-amber-500/30 text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
            onClick={() => seed.mutate()}
            disabled={seed.isPending}
          >
            {seed.isPending ? (
              <Loader2 className="w-3 h-3 animate-spin" />
            ) : (
              <Sparkles className="w-3 h-3" />
            )}
            Sample
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setConfirmReset(true)}
            disabled={reset.isPending}
            aria-label="Reset sandbox"
          >
            {reset.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
          </Button>
        </div>
      )}

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset sandbox?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes <strong>all</strong> test portfolios and their data for your account.
              Your live data is not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => reset.mutate()}
            >
              Delete test data
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Slim persistent banner shown across the top of the app while in sandbox mode. */
export function SandboxBanner() {
  const { mode, setMode } = usePortfolio();
  if (mode !== "sandbox") return null;
  return (
    <div className="flex items-center justify-center gap-2 px-4 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-medium">
      <FlaskConical className="w-3.5 h-3.5 shrink-0" />
      <span>
        Test mode — this is sample/sandbox data, isolated from your live tracking.
      </span>
      <button
        onClick={() => setMode("live")}
        className="underline underline-offset-2 hover:no-underline font-semibold"
      >
        Switch to Live
      </button>
    </div>
  );
}
```

### `client/src/components/PortfolioSelector.tsx`

```tsx
import { useState } from "react";
import { ChevronDown, Plus, Briefcase, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";

/**
 * The create-portfolio dialog. Extracted so it can be opened either from the
 * sidebar dropdown or from an empty-state onboarding screen.
 */
export function CreatePortfolioDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { setPortfolioId, refetch, mode } = usePortfolio();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [horizonMonths, setHorizonMonths] = useState("");
  const [startingContribution, setStartingContribution] = useState("");
  const [stepUpAmount, setStepUpAmount] = useState("");

  const utils = trpc.useUtils();
  const createMutation = trpc.portfolios.create.useMutation({
    onSuccess: async (data) => {
      await refetch();
      setPortfolioId(data.portfolioId);
      utils.portfolios.list.invalidate();
      toast.success("Portfolio created");
      onOpenChange(false);
      resetForm();
    },
    onError: (err) => toast.error(err.message),
  });

  function resetForm() {
    setName("");
    setDescription("");
    setTargetAmount("");
    setStartDate(new Date().toISOString().split("T")[0]);
    setHorizonMonths("");
    setStartingContribution("");
    setStepUpAmount("");
  }

  function handleCreate() {
    if (!name.trim()) return toast.error("Portfolio name is required");
    const target = parseFloat(targetAmount);
    const horizon = parseInt(horizonMonths);
    const month1 = parseFloat(startingContribution);
    const stepUp = parseFloat(stepUpAmount);
    if (!target || target < 100000) return toast.error("Enter a target of at least KES 100,000");
    if (!horizon || horizon < 12 || horizon > 240) return toast.error("Enter a horizon between 12 and 240 months");
    if (Number.isNaN(month1) || month1 < 0) return toast.error("Enter a valid Month 1 contribution");
    createMutation.mutate({
      name: name.trim(),
      description: description.trim() || undefined,
      targetAmount: target,
      startDate,
      horizonMonths: horizon,
      startingContribution: month1,
      stepUpAmount: Number.isNaN(stepUp) ? 0 : stepUp,
      stepUpMonths: 6,
      safetyFloor: 50000,
      isSandbox: mode === "sandbox",
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create Portfolio</DialogTitle>
          <DialogDescription>
            Set up a savings goal with its own target, horizon, and contribution schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>Name *</Label>
            <Input placeholder="e.g. Retirement Fund, House Deposit" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              placeholder="Optional — what this portfolio is for (shown as the app subtitle)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Target (KES)</Label>
              <Input type="number" placeholder="e.g. 5000000" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Horizon (months)</Label>
              <Input type="number" min={12} max={240} placeholder="e.g. 120" value={horizonMonths} onChange={(e) => setHorizonMonths(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start date</Label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Month 1 contribution</Label>
              <Input type="number" placeholder="e.g. 2500" value={startingContribution} onChange={(e) => setStartingContribution(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Step-up amount (KES / period)</Label>
            <Input type="number" placeholder="Optional — increase every 6 months" value={stepUpAmount} onChange={(e) => setStepUpAmount(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={createMutation.isPending}>
            {createMutation.isPending ? "Creating…" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PortfolioSelector() {
  const { portfolio, portfolios, setPortfolioId } = usePortfolio();
  const [showCreate, setShowCreate] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/10 transition-colors text-left">
            <Briefcase className="h-4 w-4 shrink-0 opacity-70" />
            <span className="flex-1 truncate text-sm font-medium">
              {portfolio?.name ?? "Select portfolio"}
            </span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {portfolios.map((p) => (
            <DropdownMenuItem
              key={p.id}
              onClick={() => setPortfolioId(p.id)}
              className="flex items-center gap-2"
            >
              <Briefcase className="h-3.5 w-3.5 opacity-60" />
              <span className="flex-1 truncate">{p.name}</span>
              {p.id === portfolio?.id && <Check className="h-3.5 w-3.5 text-primary" />}
            </DropdownMenuItem>
          ))}
          {portfolios.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={() => setShowCreate(true)} className="flex items-center gap-2 text-primary">
            <Plus className="h-3.5 w-3.5" />
            <span>New portfolio</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreatePortfolioDialog open={showCreate} onOpenChange={setShowCreate} />
    </>
  );
}
```

### `client/src/components/SecondaryWhatIf.tsx`

```tsx
/**
 * SecondaryWhatIf
 *
 * Interactive "what-if" overlay for the Scenarios page. Lets the user adjust:
 *   - the monthly contribution of any tracked secondary MMF account, and
 *   - the PRIMARY starting monthly contribution + step-up amount,
 * and instantly see the projected impact on the portfolio's ending value
 * (baseline vs what-if) without changing any saved data.
 *
 * A one-click "Apply this what-if" button persists the explored values back to
 * the live accounts/portfolio via `projection.applyWhatIf`.
 *
 * The math is the projection engine (server `projection.whatIf`); this
 * component only sends overrides and renders the comparison.
 */
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { FlaskConical, ArrowRight, RotateCcw, TrendingUp, TrendingDown, Info, Save, Check } from "lucide-react";
import { toast } from "sonner";

interface Props {
  portfolioId: number;
  /** Current primary starting monthly contribution (KES). */
  primaryContribution: number;
  /** Current primary step-up amount (KES). */
  primaryStepUp: number;
  /** How often the step-up applies, in months (for copy only). */
  stepUpMonths: number;
  /** Called after a successful apply so the parent can refetch the plan. */
  onApplied?: () => void;
}

export function SecondaryWhatIf({
  portfolioId,
  primaryContribution,
  primaryStepUp,
  stepUpMonths,
  onApplied,
}: Props) {
  const utils = trpc.useUtils();
  const { data: secondaries, isLoading } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId },
    { enabled: !!portfolioId }
  );

  // Local edits keyed by secondary id -> contribution string.
  const [edits, setEdits] = useState<Record<number, string>>({});
  // Primary edits (undefined = untouched).
  const [primaryEdit, setPrimaryEdit] = useState<string | undefined>(undefined);
  const [stepUpEdit, setStepUpEdit] = useState<string | undefined>(undefined);

  // Applied overrides that drive the query.
  const [applied, setApplied] = useState<{
    overrides: Array<{ secondaryMmfId: number; monthlyContribution: number }>;
    primaryContribution?: number;
    primaryStepUpAmount?: number;
  } | null>(null);

  const hasAccounts = (secondaries?.length ?? 0) > 0;

  const whatIf = trpc.projection.whatIf.useQuery(
    {
      portfolioId,
      overrides: applied?.overrides ?? [],
      primaryContribution: applied?.primaryContribution,
      primaryStepUpAmount: applied?.primaryStepUpAmount,
    },
    { enabled: !!portfolioId && applied !== null }
  );

  const applyMutation = trpc.projection.applyWhatIf.useMutation({
    onSuccess: async (res) => {
      await Promise.all([
        utils.secondaryMmfs.list.invalidate({ portfolioId }),
        utils.projection.invalidate(),
      ]);
      onApplied?.();
      toast.success("What-if applied", {
        description:
          `Saved ${res.appliedSecondaries} secondary contribution${res.appliedSecondaries === 1 ? "" : "s"}` +
          (res.portfolioUpdated ? " and your primary plan." : "."),
      });
      // Clear edits — the new baseline now reflects what we just saved.
      setEdits({});
      setPrimaryEdit(undefined);
      setStepUpEdit(undefined);
      setApplied(null);
    },
    onError: (e) => toast.error("Could not apply what-if", { description: e.message }),
  });

  const baselineContribOf = (id: number) =>
    Number(secondaries?.find((s) => s.id === id)?.monthlyContribution ?? 0);

  // Build the set of overrides currently entered (differing from baseline).
  const buildOverrides = () => {
    if (!secondaries) return [];
    return secondaries
      .map((s) => {
        const raw = edits[s.id];
        if (raw === undefined || raw === "") return null;
        const v = Number(raw);
        if (Number.isNaN(v) || v < 0) return null;
        if (v === baselineContribOf(s.id)) return null;
        return { secondaryMmfId: s.id, monthlyContribution: v };
      })
      .filter((x): x is { secondaryMmfId: number; monthlyContribution: number } => x !== null);
  };

  const primaryOverride = useMemo(() => {
    if (primaryEdit === undefined || primaryEdit === "") return undefined;
    const v = Number(primaryEdit);
    if (Number.isNaN(v) || v < 0 || v === primaryContribution) return undefined;
    return v;
  }, [primaryEdit, primaryContribution]);

  const stepUpOverride = useMemo(() => {
    if (stepUpEdit === undefined || stepUpEdit === "") return undefined;
    const v = Number(stepUpEdit);
    if (Number.isNaN(v) || v < 0 || v === primaryStepUp) return undefined;
    return v;
  }, [stepUpEdit, primaryStepUp]);

  const dirty = useMemo(() => {
    const secDirty = buildOverrides().length > 0;
    return secDirty || primaryOverride !== undefined || stepUpOverride !== undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, secondaries, primaryOverride, stepUpOverride]);

  const handleApply = () => {
    setApplied({
      overrides: buildOverrides(),
      primaryContribution: primaryOverride,
      primaryStepUpAmount: stepUpOverride,
    });
  };

  const handleReset = () => {
    setEdits({});
    setPrimaryEdit(undefined);
    setStepUpEdit(undefined);
    setApplied(null);
  };

  const handleSave = () => {
    if (!applied) return;
    applyMutation.mutate({
      portfolioId,
      overrides: applied.overrides,
      primaryContribution: applied.primaryContribution,
      primaryStepUpAmount: applied.primaryStepUpAmount,
    });
  };

  const result = whatIf.data;
  const chartData = useMemo(() => {
    if (!result) return [];
    const map = new Map<number, { month: number; Baseline: number; "What-if": number }>();
    for (const p of result.baseline.series) {
      map.set(p.month, { month: p.month, Baseline: p.total, "What-if": p.total });
    }
    for (const p of result.whatIf.series) {
      const row = map.get(p.month);
      if (row) row["What-if"] = p.total;
      else map.set(p.month, { month: p.month, Baseline: p.total, "What-if": p.total });
    }
    return Array.from(map.values()).sort((a, b) => a.month - b.month);
  }, [result]);

  const primaryShown = primaryEdit === undefined ? String(primaryContribution) : primaryEdit;
  const stepUpShown = stepUpEdit === undefined ? String(primaryStepUp) : stepUpEdit;

  return (
    <Card className="border-primary/30 bg-primary/[0.03]">
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold flex items-center gap-2">
          <FlaskConical className="w-4 h-4 text-primary" />
          What-if: contributions
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Try different monthly contributions — for your primary plan and any tracked secondary MMF — and see the
          projected impact on your ending value. Nothing changes until you choose <strong>Apply this what-if</strong>.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Primary contribution + step-up */}
        <div className="rounded-lg border border-border/60 bg-background/60 p-3">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="default" className="text-[10px] px-1.5 py-0">Primary plan</Badge>
            <span className="text-xs text-muted-foreground">
              Currently {formatKES(primaryContribution)}/mo
              {primaryStepUp > 0 ? <>, +{formatKES(primaryStepUp)} every {stepUpMonths} mo</> : ", no step-up"}
            </span>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <div className="w-44">
              <Label className="text-[10px] text-muted-foreground">What-if starting monthly (KES)</Label>
              <Input
                type="number"
                min="0"
                step="1000"
                className="mt-1 h-8 text-sm"
                value={primaryShown}
                onChange={(e) => setPrimaryEdit(e.target.value)}
              />
            </div>
            <div className="w-44">
              <Label className="text-[10px] text-muted-foreground">What-if step-up (KES)</Label>
              <Input
                type="number"
                min="0"
                step="500"
                className="mt-1 h-8 text-sm"
                value={stepUpShown}
                onChange={(e) => setStepUpEdit(e.target.value)}
              />
            </div>
          </div>
        </div>

        {isLoading && <p className="text-xs text-muted-foreground">Loading accounts…</p>}

        {!isLoading && !hasAccounts && (
          <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
            <Info className="w-4 h-4 shrink-0" />
            No secondary MMF accounts yet — you can still explore primary-plan what-ifs above. Add a secondary fund on
            the <strong>MMF Funds</strong> page to model it here.
          </div>
        )}

        {hasAccounts && (
          <div className="space-y-2">
            {secondaries!.map((s) => {
              const current = baselineContribOf(s.id);
              const raw = edits[s.id];
              const shown = raw === undefined ? String(current) : raw;
              return (
                <div
                  key={s.id}
                  className="flex items-center gap-3 flex-wrap rounded-lg border border-border/60 bg-background/60 p-3"
                >
                  <div className="flex-1 min-w-[160px]">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{s.label || s.fundName}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {Number(s.ear).toFixed(2)}% EAR
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Current: {formatKES(current)}/mo
                    </p>
                  </div>
                  <div className="w-40">
                    <Label className="text-[10px] text-muted-foreground">What-if monthly (KES)</Label>
                    <Input
                      type="number"
                      min="0"
                      step="500"
                      className="mt-1 h-8 text-sm"
                      value={shown}
                      onChange={(e) => setEdits((p) => ({ ...p, [s.id]: e.target.value }))}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          <Button size="sm" onClick={handleApply} disabled={!dirty || whatIf.isFetching}>
            {whatIf.isFetching ? "Calculating…" : "Preview what-if"}
            {!whatIf.isFetching && <ArrowRight className="w-3.5 h-3.5 ml-1" />}
          </Button>
          {applied !== null && (
            <Button size="sm" variant="outline" onClick={handleReset}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset
            </Button>
          )}

          {/* Apply (persist) — only when there's a previewed result. */}
          {result && applied !== null && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  size="sm"
                  variant="default"
                  className="ml-auto bg-emerald-600 hover:bg-emerald-600/90 text-white"
                  disabled={applyMutation.isPending}
                >
                  {applyMutation.isPending ? (
                    <>Applying…</>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5 mr-1" /> Apply this what-if
                    </>
                  )}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Apply this what-if to your plan?</AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm">
                      <p>This saves the explored contributions to your live plan:</p>
                      <ul className="list-disc pl-5 space-y-1">
                        {applied.primaryContribution !== undefined && (
                          <li>
                            Primary monthly: {formatKES(primaryContribution)} → <strong>{formatKES(applied.primaryContribution)}</strong>
                          </li>
                        )}
                        {applied.primaryStepUpAmount !== undefined && (
                          <li>
                            Step-up: {formatKES(primaryStepUp)} → <strong>{formatKES(applied.primaryStepUpAmount)}</strong>
                          </li>
                        )}
                        {applied.overrides.map((o) => {
                          const s = secondaries?.find((x) => x.id === o.secondaryMmfId);
                          return (
                            <li key={o.secondaryMmfId}>
                              {s?.label || s?.fundName || `Fund #${o.secondaryMmfId}`}: {formatKES(baselineContribOf(o.secondaryMmfId))} →{" "}
                              <strong>{formatKES(o.monthlyContribution)}</strong>/mo
                            </li>
                          );
                        })}
                      </ul>
                      <p className="text-xs text-muted-foreground">
                        Your projection, scenarios, and milestones will update to match.
                      </p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-emerald-600 hover:bg-emerald-600/90 text-white"
                    onClick={handleSave}
                  >
                    <Check className="w-3.5 h-3.5 mr-1" /> Save to plan
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>

        {result && applied !== null && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Baseline ending value</p>
                <p className="text-lg font-bold text-foreground kes-amount mt-0.5">
                  {formatKES(result.baseline.finalValue)}
                </p>
              </div>
              <div className="rounded-lg bg-muted/50 p-3">
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground">What-if ending value</p>
                <p className="text-lg font-bold text-primary kes-amount mt-0.5">
                  {formatKES(result.whatIf.finalValue)}
                </p>
              </div>
              <div
                className={`rounded-lg p-3 ${
                  result.delta >= 0 ? "bg-emerald-500/10" : "bg-red-500/10"
                }`}
              >
                <p className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  {result.delta >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-red-400" />
                  )}
                  Difference
                </p>
                <p
                  className={`text-lg font-bold kes-amount mt-0.5 ${
                    result.delta >= 0 ? "text-emerald-400" : "text-red-400"
                  }`}
                >
                  {result.delta >= 0 ? "+" : "−"}
                  {formatKES(Math.abs(result.delta))}
                </p>
              </div>
            </div>

            <div className="h-56 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickFormatter={(m) => `M${m}`}
                    tick={{ fontSize: 10 }}
                    stroke="currentColor"
                    className="text-muted-foreground"
                  />
                  <YAxis
                    tickFormatter={(v) => formatKESCompact(Number(v))}
                    tick={{ fontSize: 10 }}
                    width={56}
                    stroke="currentColor"
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    formatter={(v: number, name: string) => [formatKES(Number(v)), name]}
                    labelFormatter={(m) => `Month ${m}`}
                    contentStyle={{ fontSize: 12 }}
                  />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Line
                    type="monotone"
                    dataKey="Baseline"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="What-if"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              Both lines use the same projection engine, target, horizon, and rates as the rest of the app. Only the
              contributions you changed differ. Use <strong>Apply this what-if</strong> to make it your saved plan.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
```

### `client/src/components/UpdateRatesPanel.tsx`

```tsx
/**
 * UpdateRatesPanel
 *
 * Manual rate-entry panel with editable source URLs.
 * Accepts portfolioId as a required prop.
 */

import { useState, useEffect } from "react";
import { trpc } from "@/lib/trpc";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ExternalLink,
  Clock,
  Save,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle2,
  Pencil,
} from "lucide-react";

function formatStaleness(updatedAt: Date | string | null | undefined): {
  label: string;
  isStale: boolean;
  isVeryStale: boolean;
} {
  if (!updatedAt) return { label: "Never updated", isStale: true, isVeryStale: true };
  const ms = Date.now() - new Date(updatedAt).getTime();
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor(ms / 60_000);

  let label: string;
  if (minutes < 2) label = "Just now";
  else if (minutes < 60) label = `${minutes} minutes ago`;
  else if (hours < 24) label = `${hours} hour${hours !== 1 ? "s" : ""} ago`;
  else label = `${days} day${days !== 1 ? "s" : ""} ago`;

  return {
    label,
    isStale: days >= 7,
    isVeryStale: days >= 30,
  };
}

interface Props {
  portfolioId: number;
}

export function UpdateRatesPanel({ portfolioId }: Props) {
  const utils = trpc.useUtils();
  const { fundName: selectedFundName, fundLabel: selectedFundLabel } = useSelectedFund();
  const { data: settings, isLoading } = trpc.settings.get.useQuery({ portfolioId });

  const [mmfYield, setMmfYield] = useState("");
  const [tbill91Rate, setTbill91Rate] = useState("");
  const [tbill182Rate, setTbill182Rate] = useState("");
  const [tbill364Rate, setTbill364Rate] = useState("");
  const [ifbCouponRate, setIfbCouponRate] = useState("");
  const [fxdCouponRate, setFxdCouponRate] = useState("");
  const [withholdingTax, setWithholdingTax] = useState("");
  const [cbkSourceUrl, setCbkSourceUrl] = useState("");
  const [sanlamSourceUrl, setSanlamSourceUrl] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [editingUrls, setEditingUrls] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setMmfYield(String(settings.mmfYield ?? "8.78"));
    setTbill91Rate(String(settings.tbill91Rate ?? "8.8206"));
    setTbill182Rate(String(settings.tbill182Rate ?? "8.7782"));
    setTbill364Rate(String(settings.tbill364Rate ?? "8.9746"));
    setIfbCouponRate(String(settings.ifbCouponRate ?? "12.5"));
    setFxdCouponRate(String(settings.fxdCouponRate ?? "12.35"));
    setWithholdingTax(String(settings.withholdingTax ?? "15"));
    setCbkSourceUrl(settings.cbkSourceUrl || "https://www.centralbank.go.ke/bills-bonds/treasury-bills/");
    setSanlamSourceUrl(settings.sanlamSourceUrl || "https://www.sanlamallianz.co.ke/products/savings-and-investments/money-market-fund/");
  }, [settings]);

  const saveRates = trpc.rateUpdate.save.useMutation({
    onSuccess: () => {
      toast.success("Rates saved and history snapshot recorded.");
      setChangeNote("");
      utils.settings.get.invalidate({ portfolioId });
      utils.settings.getRateHistory.invalidate({ portfolioId });
      utils.projection.run.invalidate({ portfolioId });
      utils.projection.milestones.invalidate({ portfolioId });
    },
    onError: (err) => toast.error(`Failed to save rates: ${err.message}`),
  });

  const saveUrls = trpc.rateUpdate.saveSourceUrls.useMutation({
    onSuccess: () => {
      toast.success("Source URLs updated.");
      setEditingUrls(false);
      utils.settings.get.invalidate({ portfolioId });
    },
    onError: (err) => toast.error(`Failed to save URLs: ${err.message}`),
  });

  const parseRate = (v: string) => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleSaveRates = () => {
    const rates = {
      mmfYield: parseRate(mmfYield),
      tbill91Rate: parseRate(tbill91Rate),
      tbill182Rate: parseRate(tbill182Rate),
      tbill364Rate: parseRate(tbill364Rate),
      ifbCouponRate: parseRate(ifbCouponRate),
      fxdCouponRate: parseRate(fxdCouponRate),
      withholdingTax: parseRate(withholdingTax),
    };
    for (const [key, val] of Object.entries(rates)) {
      if (val === null) { toast.error(`Invalid value for ${key}`); return; }
    }
    try { new URL(cbkSourceUrl); new URL(sanlamSourceUrl); }
    catch { toast.error("One or more source URLs are invalid."); return; }

    saveRates.mutate({
      portfolioId,
      mmfYield: rates.mmfYield!,
      tbill91Rate: rates.tbill91Rate!,
      tbill182Rate: rates.tbill182Rate!,
      tbill364Rate: rates.tbill364Rate!,
      ifbCouponRate: rates.ifbCouponRate!,
      fxdCouponRate: rates.fxdCouponRate!,
      withholdingTax: rates.withholdingTax!,
      cbkSourceUrl,
      sanlamSourceUrl,
      changeNote: changeNote.trim() || undefined,
    });
  };

  const handleSaveUrls = () => {
    try { new URL(cbkSourceUrl); new URL(sanlamSourceUrl); }
    catch { toast.error("One or more source URLs are invalid."); return; }
    saveUrls.mutate({ portfolioId, cbkSourceUrl, sanlamSourceUrl });
  };

  const staleness = formatStaleness(settings?.ratesLastUpdatedAt);

  if (isLoading) return null;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardHeader className="cursor-pointer select-none" onClick={() => setExpanded((v) => !v)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-4 w-4 text-amber-400" />
            <CardTitle className="text-base font-semibold text-amber-300">Update Rates</CardTitle>
            <Badge
              variant="outline"
              className={
                staleness.isVeryStale
                  ? "border-red-500/50 text-red-400"
                  : staleness.isStale
                    ? "border-amber-500/50 text-amber-400"
                    : "border-emerald-500/50 text-emerald-400"
              }
            >
              {staleness.isVeryStale ? <AlertTriangle className="mr-1 h-3 w-3" /> :
               staleness.isStale ? <Clock className="mr-1 h-3 w-3" /> :
               <CheckCircle2 className="mr-1 h-3 w-3" />}
              {staleness.label}
            </Badge>
          </div>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Open the official source, read the current rate, type it in, and click Save.
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-6 pt-0">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Official Sources</p>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setEditingUrls((v) => !v); }}>
                <Pencil className="mr-1 h-3 w-3" />{editingUrls ? "Cancel" : "Edit URLs"}
              </Button>
            </div>

            {[
              { title: "CBK Treasury Bills", desc: "91-day, 182-day, 364-day auction results", url: cbkSourceUrl, setUrl: setCbkSourceUrl, placeholder: "https://www.centralbank.go.ke/..." },
              { title: selectedFundLabel, desc: `${selectedFundName} — effective annual yield (gross, before WHT)`, url: sanlamSourceUrl, setUrl: setSanlamSourceUrl, placeholder: "https://www.sanlamallianz.co.ke/..." },
            ].map(({ title, desc, url, setUrl, placeholder }) => (
              <div key={title} className="rounded-lg border border-border/50 bg-background/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium">{title}</p>
                    <p className="text-xs text-muted-foreground">{desc}</p>
                  </div>
                  <a href={url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" className="h-8 gap-1 text-xs">Open <ExternalLink className="h-3 w-3" /></Button>
                  </a>
                </div>
                {editingUrls && (
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={placeholder} className="h-8 text-xs font-mono" onClick={(e) => e.stopPropagation()} />
                )}
              </div>
            ))}

            {editingUrls && (
              <Button size="sm" variant="outline" className="w-full" onClick={(e) => { e.stopPropagation(); handleSaveUrls(); }} disabled={saveUrls.isPending}>
                {saveUrls.isPending ? "Saving…" : "Save URLs Only"}
              </Button>
            )}
          </div>

          <Separator />

          <div className="space-y-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Enter New Rates (% p.a., gross before WHT)</p>
            <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Which rate is used where?</span> The projection engine and accrual ledger use the <span className="font-medium text-amber-300">MMF Yield</span> you set here (gross, before WHT). Your selected fund <span className="font-medium text-foreground">{selectedFundName}</span> publishes its own effective annual yield, which you can copy into the MMF Yield field to keep them aligned. T-Bill / IFB / FXD rates feed the corresponding buckets only.
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "MMF Yield", value: mmfYield, setter: setMmfYield },
                { label: "Withholding Tax", value: withholdingTax, setter: setWithholdingTax },
              ].map(({ label, value, setter }) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={value} onChange={(e) => setter(e.target.value)} className="h-8 text-sm pr-8" onClick={(e) => e.stopPropagation()} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: "T-Bill 91d", value: tbill91Rate, setter: setTbill91Rate },
                { label: "T-Bill 182d", value: tbill182Rate, setter: setTbill182Rate },
                { label: "T-Bill 364d", value: tbill364Rate, setter: setTbill364Rate },
              ].map(({ label, value, setter }) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={value} onChange={(e) => setter(e.target.value)} className="h-8 text-sm pr-8" onClick={(e) => e.stopPropagation()} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: "IFB Coupon Rate", value: ifbCouponRate, setter: setIfbCouponRate },
                { label: "FXD Coupon Rate", value: fxdCouponRate, setter: setFxdCouponRate },
              ].map(({ label, value, setter }) => (
                <div key={label} className="space-y-1">
                  <Label className="text-xs">{label}</Label>
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={value} onChange={(e) => setter(e.target.value)} className="h-8 text-sm pr-8" onClick={(e) => e.stopPropagation()} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Change note (optional)</Label>
              <Input value={changeNote} onChange={(e) => setChangeNote(e.target.value)} placeholder="e.g. CBK auction 19 Jun 2026" className="h-8 text-xs" maxLength={200} onClick={(e) => e.stopPropagation()} />
            </div>
          </div>

          <Button className="w-full" onClick={(e) => { e.stopPropagation(); handleSaveRates(); }} disabled={saveRates.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {saveRates.isPending ? "Saving…" : "Save Rates & Record History"}
          </Button>
          <p className="text-xs text-muted-foreground text-center">
            Saving writes a rate history snapshot. Past months already recorded will not be retroactively changed.
          </p>
        </CardContent>
      )}
    </Card>
  );
}
```


## Client — Pages


### `client/src/pages/BankInstruments.tsx`

```tsx
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { Landmark, Plus, Pencil, Trash2, Info, Percent } from "lucide-react";

interface BankRow {
  id: number;
  bankName: string;
  instrumentType: "call_deposit" | "fixed_deposit";
  minAmount: number;
  typicalTenor: string | null;
  indicativeRate: number | null;
  isNegotiable: boolean;
  notes: string | null;
  asOfDate: string | Date | null;
  source: string | null;
  isActive: boolean;
}

function kes(n: number): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const EMPTY = {
  id: 0,
  bankName: "",
  instrumentType: "fixed_deposit" as "call_deposit" | "fixed_deposit",
  minAmount: "0",
  typicalTenor: "",
  indicativeRate: "",
  isNegotiable: true,
  notes: "",
  source: "",
};

export default function BankInstruments() {
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.bankInstruments.list.useQuery();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const add = trpc.bankInstruments.add.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Instrument added");
    },
    onError: (e) => toast.error(e.message),
  });
  const update = trpc.bankInstruments.update.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setEditOpen(false);
      toast.success("Instrument updated");
    },
    onError: (e) => toast.error(e.message),
  });
  const remove = trpc.bankInstruments.remove.useMutation({
    onSuccess: () => {
      utils.bankInstruments.list.invalidate();
      setDeleteId(null);
      toast.success("Instrument removed");
    },
    onError: (e) => toast.error(e.message),
  });

  const callRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "call_deposit"),
    [rows]
  );
  const fixedRows = useMemo(
    () => (rows ?? []).filter((r) => r.instrumentType === "fixed_deposit"),
    [rows]
  );

  function openAdd() {
    setForm({ ...EMPTY });
    setEditOpen(true);
  }
  function openEdit(r: BankRow) {
    setForm({
      id: r.id,
      bankName: r.bankName,
      instrumentType: r.instrumentType,
      minAmount: String(r.minAmount),
      typicalTenor: r.typicalTenor ?? "",
      indicativeRate: r.indicativeRate === null ? "" : String(r.indicativeRate),
      isNegotiable: r.isNegotiable,
      notes: r.notes ?? "",
      source: r.source ?? "",
    });
    setEditOpen(true);
  }

  function save() {
    if (!form.bankName.trim()) {
      toast.error("Bank name is required");
      return;
    }
    const payload = {
      bankName: form.bankName.trim(),
      instrumentType: form.instrumentType,
      minAmount: Number(form.minAmount) || 0,
      typicalTenor: form.typicalTenor || undefined,
      indicativeRate: form.indicativeRate === "" ? undefined : Number(form.indicativeRate),
      isNegotiable: form.isNegotiable,
      notes: form.notes || undefined,
      source: form.source || undefined,
    };
    if (form.id) {
      update.mutate({ id: form.id, ...payload });
    } else {
      add.mutate(payload);
    }
  }

  function renderTable(data: BankRow[]) {
    if (data.length === 0) {
      return (
        <p className="text-sm text-muted-foreground py-6 text-center">
          None recorded yet.
        </p>
      );
    }
    return (
      <div className="rounded-md border overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Bank</TableHead>
              <TableHead className="text-right">Min Amount</TableHead>
              <TableHead>Tenor</TableHead>
              <TableHead className="text-right">Indic. Rate</TableHead>
              <TableHead>Negotiable</TableHead>
              <TableHead className="w-20"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="font-medium">{r.bankName}</div>
                  {r.notes && (
                    <div className="text-xs text-muted-foreground">{r.notes}</div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {kes(r.minAmount)}
                </TableCell>
                <TableCell>{r.typicalTenor ?? "—"}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {r.indicativeRate === null ? (
                    <span className="text-muted-foreground">n/a</span>
                  ) : (
                    `${r.indicativeRate.toFixed(2)}%`
                  )}
                </TableCell>
                <TableCell>
                  {r.isNegotiable ? (
                    <Badge variant="secondary" className="text-[10px]">
                      Negotiable
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      Fixed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => openEdit(r)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setDeleteId(r.id)}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Landmark className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Banking Sector Instruments
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              Call and fixed deposit products from major Kenyan banks — a
              reference for the cash/deposit alternatives to money market funds.
              Posted rates are indicative and almost always{" "}
              <strong>negotiable</strong> for larger balances; treat them as a
              starting point for your own rate conversation with the bank.
            </p>
          </div>
          <Button onClick={openAdd} className="shrink-0">
            <Plus className="w-4 h-4 mr-2" /> Add Instrument
          </Button>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Fixed Deposits
                </CardTitle>
                <CardDescription>
                  Locked for a set tenor; higher rate but early withdrawal
                  usually forfeits interest.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(fixedRows)}</CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Percent className="w-4 h-4 text-primary" /> Call Deposits
                </CardTitle>
                <CardDescription>
                  Instant-access interest-bearing accounts; lower rate but fully
                  liquid — the closest bank equivalent to an MMF.
                </CardDescription>
              </CardHeader>
              <CardContent>{renderTable(callRows)}</CardContent>
            </Card>
          </>
        )}

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Interest on bank deposits is subject to 15% withholding tax (final
          tax), same as MMF interest. Rates change frequently and are editable
          here — keep them current from each bank's published schedule or your
          relationship manager.
        </p>
      </div>

      {/* Edit/Add dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {form.id ? "Edit Instrument" : "Add Instrument"}
            </DialogTitle>
            <DialogDescription>
              Record a bank deposit product and its indicative rate.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Bank Name</Label>
                <Input
                  value={form.bankName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, bankName: e.target.value }))
                  }
                  placeholder="e.g. Equity Bank"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Type</Label>
                <Select
                  value={form.instrumentType}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      instrumentType: v as "call_deposit" | "fixed_deposit",
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_deposit">Fixed Deposit</SelectItem>
                    <SelectItem value="call_deposit">Call Deposit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Min Amount (KES)</Label>
                <Input
                  type="number"
                  value={form.minAmount}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, minAmount: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Indicative Rate (%)</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  value={form.indicativeRate}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, indicativeRate: e.target.value }))
                  }
                  placeholder="optional"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Typical Tenor</Label>
              <Input
                value={form.typicalTenor}
                onChange={(e) =>
                  setForm((f) => ({ ...f, typicalTenor: e.target.value }))
                }
                placeholder="e.g. 3, 6, 12 months"
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                id="negotiable"
                type="checkbox"
                checked={form.isNegotiable}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isNegotiable: e.target.checked }))
                }
                className="h-4 w-4 rounded border-input"
              />
              <Label htmlFor="negotiable" className="text-xs">
                Rate is negotiable for larger balances
              </Label>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source (URL or note)</Label>
              <Input
                value={form.source}
                onChange={(e) =>
                  setForm((f) => ({ ...f, source: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                rows={2}
                onChange={(e) =>
                  setForm((f) => ({ ...f, notes: e.target.value }))
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={add.isPending || update.isPending}>
              {add.isPending || update.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this instrument?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && remove.mutate({ id: deleteId })}
              className="bg-red-500 hover:bg-red-600"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
```

### `client/src/pages/Contributions.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { TrendingUp, Plus, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useForm } from "react-hook-form";

interface OverrideForm {
  monthNumber: number;
  overrideAmount: number;
  lumpSum: number;
  reason: string;
}

export default function Contributions() {
  const { portfolioId, portfolio } = usePortfolio();
  const utils = trpc.useUtils();
  const { data: schedule, isLoading: schedLoading } = trpc.projection.contributionSchedule.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: overrides, isLoading: overLoading } = trpc.contributions.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: settings } = trpc.settings.get.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });

  const upsertMutation = trpc.contributions.upsert.useMutation({
    onSuccess: () => {
      toast.success("Contribution override saved");
      utils.contributions.list.invalidate();
      utils.projection.run.invalidate();
      setOpen(false);
    },
    onError: () => toast.error("Failed to save override"),
  });

  const deleteMutation = trpc.contributions.delete.useMutation({
    onSuccess: () => {
      toast.success("Override removed");
      utils.contributions.list.invalidate();
      utils.projection.run.invalidate();
    },
    onError: () => toast.error("Failed to remove override"),
  });

  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, setValue } = useForm<OverrideForm>({
    defaultValues: { monthNumber: 1, overrideAmount: 0, lumpSum: 0, reason: "" },
  });

  const startDate = portfolio?.startDate ? String(portfolio.startDate).split("T")[0] : "2026-07-01";

  const overrideMap = new Map(overrides?.map((o) => [o.monthNumber, o]) ?? []);

  function onSubmit(data: OverrideForm) {
    if (!portfolioId) return;
    upsertMutation.mutate({
      portfolioId,
      monthNumber: data.monthNumber,
      overrideAmount: data.overrideAmount > 0 ? data.overrideAmount : undefined,
      lumpSum: data.lumpSum > 0 ? data.lumpSum : undefined,
      reason: data.reason || undefined,
    });
  }

  function openEdit(monthNumber: number, existing?: { overrideAmount?: string | number | null; lumpSum?: string | number | null; reason?: string | null }) {
    reset({
      monthNumber,
      overrideAmount: existing?.overrideAmount ? parseFloat(String(existing.overrideAmount)) : 0,
      lumpSum: existing?.lumpSum ? parseFloat(String(existing.lumpSum)) : 0,
      reason: existing?.reason ?? "",
    });
    setOpen(true);
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Contribution Schedule
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {portfolio
                ? `Starting at ${formatKES(Number(portfolio.startingContribution) || 0)}${
                    Number(portfolio.stepUpAmount) > 0
                      ? ` with automatic +${formatKES(Number(portfolio.stepUpAmount))} step-up every ${portfolio.stepUpMonths} months`
                      : " with flat contributions (no step-up)"
                  }`
                : "Your monthly contribution schedule"}
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" onClick={() => reset({ monthNumber: 1, overrideAmount: 0, lumpSum: 0, reason: "" })}>
                <Plus className="w-3.5 h-3.5" />
                Add Override
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Contribution Override</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Month Number (1–{portfolio?.horizonMonths ?? 120})</Label>
                  <Input type="number" min={1} max={portfolio?.horizonMonths ?? 120} {...register("monthNumber", { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Override Monthly Amount (KES)</Label>
                  <Input type="number" min={0} step={100} {...register("overrideAmount", { valueAsNumber: true })} />
                  <p className="text-xs text-muted-foreground">Leave 0 to keep the scheduled amount</p>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">One-off Lump Sum (KES)</Label>
                  <Input type="number" min={0} step={1000} {...register("lumpSum", { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Reason (optional)</Label>
                  <Input placeholder="e.g. Bonus received" {...register("reason")} />
                </div>
                <Button type="submit" className="w-full" disabled={upsertMutation.isPending}>
                  {upsertMutation.isPending ? "Saving..." : "Save Override"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Contribution Ladder */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" />
              Contribution Ladder{Number(portfolio?.stepUpAmount) > 0 ? " (Auto Step-Up)" : ""}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {schedLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Months</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Period</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Monthly Amount</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">6-Month Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {schedule?.map((s) => (
                      <tr key={s.startMonth} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 pr-4 font-medium text-foreground">
                          {s.startMonth}–{s.endMonth}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {getMonthLabel(startDate, s.startMonth)} – {getMonthLabel(startDate, s.endMonth)}
                        </td>
                        <td className="py-2.5 pr-4 text-right font-bold text-primary kes-amount">
                          {formatKES(s.monthlyAmount)}
                        </td>
                        <td className="py-2.5 text-right text-muted-foreground kes-amount">
                          {formatKES(s.sixMonthTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border">
                      <td colSpan={2} className="py-2.5 text-xs text-muted-foreground font-medium">Total contributions</td>
                      <td className="py-2.5 text-right font-bold text-foreground kes-amount" colSpan={2}>
                        {formatKES(schedule?.reduce((s, r) => s + r.sixMonthTotal, 0) ?? 0)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Overrides */}
        {(overrides?.length ?? 0) > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold">Manual Overrides & Lump Sums</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border">
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Month</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Date</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Override Amount</th>
                      <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Lump Sum</th>
                      <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Reason</th>
                      <th className="text-right py-2 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overrides?.map((o) => (
                      <tr key={o.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                        <td className="py-2.5 pr-4 font-semibold text-foreground">{o.monthNumber}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">
                          {getMonthLabel(startDate, o.monthNumber)}
                        </td>
                        <td className="py-2.5 pr-4 text-right kes-amount text-foreground">
                          {parseFloat(String(o.overrideAmount)) > 0 ? formatKES(parseFloat(String(o.overrideAmount))) : "–"}
                        </td>
                        <td className="py-2.5 pr-4 text-right kes-amount text-primary font-medium">
                          {parseFloat(String(o.lumpSum)) > 0 ? formatKES(parseFloat(String(o.lumpSum))) : "–"}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{o.reason ?? "–"}</td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7"
                              onClick={() => openEdit(o.monthNumber, o as any)}
                            >
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="w-7 h-7 text-destructive hover:text-destructive"
                              onClick={() => { if (!portfolioId) return; deleteMutation.mutate({ portfolioId: portfolioId!, monthNumber: o.monthNumber }); }}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
```

### `client/src/pages/Dashboard.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact, formatPct, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
  Wallet,
  Landmark,
  Shield,
  Target,
  ArrowDownCircle,
  PiggyBank,
  Receipt,
  ArrowRight,
  HelpCircle,
  Pencil,
  Info,
  Clock,
} from "lucide-react";
import { Link } from "wouter";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { CreatePortfolioDialog } from "@/components/PortfolioSelector";
import { Plus, Compass } from "lucide-react";
import { useMemo, useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { rateStaleness } from "@/lib/rateStaleness";
import { cn } from "@/lib/utils";

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  accent = false,
  tooltip,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: React.ElementType;
  accent?: boolean;
  tooltip?: string;
}) {
  return (
    <Card className={`card-hover ${accent ? "border-primary/30 gold-glow" : ""}`}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 mb-1">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
              {tooltip && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="w-3 h-3 text-muted-foreground/60 cursor-help shrink-0" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs">
                    {tooltip}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            <p className={`text-2xl font-bold kes-amount ${accent ? "gradient-text" : "text-foreground"}`}>
              {value}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
          </div>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-3 ${accent ? "bg-primary/15" : "bg-muted"}`}>
            <Icon className={`w-5 h-5 ${accent ? "text-primary" : "text-muted-foreground"}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-2">Month {label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <div className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground kes-amount">{formatKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const { portfolioId, portfolio, portfolios, isLoading: portfoliosLoading } = usePortfolio();
  const [createOpen, setCreateOpen] = useState(false);
  const utils = trpc.useUtils();
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: milestones } = trpc.projection.milestones.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
    const { data: actualsSummary } = trpc.deposits.summary.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const secondaryMmfTotal = secondaryMmfs.reduce((sum, s) => sum + s.currentBalance, 0);
  const updatePortfolioMutation = trpc.portfolios.update.useMutation({
    onSuccess: () => {
      toast.success("Target updated — projection recalculated");
      utils.portfolios.list.invalidate();
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
      setTargetDialogOpen(false);
    },
    onError: () => toast.error("Failed to update target"),
  });

  const { openDrawer } = useDepositDrawer();
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  function openTargetDialog() {
    setTargetInput(String(Number(portfolio?.targetAmount) || 0));
    setTargetDialogOpen(true);
  }

  function saveTarget() {
    if (!portfolioId || !portfolio) return;
    const val = parseFloat(targetInput.replace(/,/g, ""));
    if (!val || val < 100000) {
      toast.error("Please enter a valid target end value (minimum KES 100,000)");
      return;
    }
    if (!portfolio) return;
    updatePortfolioMutation.mutate({
      portfolioId,
      name: portfolio.name,
      targetAmount: val,
      startDate: String(portfolio.startDate).split("T")[0],
      horizonMonths: portfolio.horizonMonths,
      startingContribution: Number(portfolio.startingContribution),
      stepUpAmount: Number(portfolio.stepUpAmount),
      stepUpMonths: portfolio.stepUpMonths,
      safetyFloor: Number(portfolio.safetyFloor),
    });
  }

  const { fundName, fundLabel, fundEar } = useSelectedFund();
  const targetAmount = Number(portfolio?.targetAmount) || 0;
  const horizonMonths = portfolio?.horizonMonths ?? 0;
  const horizonYears = Math.round((horizonMonths / 12) * 10) / 10;
  const horizonYearsLabel = Number.isInteger(horizonYears) ? `${horizonYears}` : horizonYears.toFixed(1);
  // Year gridlines/ticks derived from the actual horizon (every 12 months, plus the final month).
  const yearLabels = useMemo(() => {
    const labels: number[] = [];
    for (let m = 12; m <= horizonMonths; m += 12) labels.push(m);
    if (labels[labels.length - 1] !== horizonMonths) labels.push(horizonMonths);
    return labels;
  }, [horizonMonths]);
  const lastData = projection?.length ? projection[projection.length - 1] : undefined;
  const currentMonth = 1;
  const currentData = projection?.[currentMonth - 1];

  // "Today" per the projection engine = the ending total of the last month the
  // engine seeded from real deposits (isActual). If there are no actuals yet,
  // there is no engine "today" value to reconcile against.
  const projectionToday = useMemo(() => {
    if (!projection?.length) return null as number | null;
    let last: number | null = null;
    for (const r of projection) {
      if (r.isActual) last = r.totalEnd;
    }
    return last;
  }, [projection]);

  // Deep-link: when arriving via the sidebar drift badge (/?reconcile=1), scroll
  // the reconciliation card into view and flash a brief highlight, then strip the
  // query param so a refresh doesn't re-trigger it.
  const reconcileRef = useRef<HTMLDivElement | null>(null);
  const [reconcileFlash, setReconcileFlash] = useState(false);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("reconcile") !== "1") return;
    const timer = window.setTimeout(() => {
      reconcileRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      setReconcileFlash(true);
      window.setTimeout(() => setReconcileFlash(false), 2200);
    }, 300);
    // Clean the param without adding a history entry.
    window.history.replaceState({}, "", window.location.pathname);
    return () => window.clearTimeout(timer);
  }, []);

  const projectedFinalValue = lastData?.totalEnd ?? 0;
  const progressPct = targetAmount > 0 ? Math.min((projectedFinalValue / targetAmount) * 100, 100) : 0;
  const surplusOrShortfall = projectedFinalValue - targetAmount;
  const willHitTarget = projectedFinalValue >= targetAmount;

  const chartData = useMemo(() => {
    if (!projection) return [];
    return projection.map((r) => ({
      month: r.monthNumber,
      total: r.totalEnd,
      mmf: r.mmfEnd,
      tbill: r.tbillEnd,
      ifb: r.ifbEnd,
      fxd: r.fxdEnd,
    }));
  }, [projection]);

  // Whether this plan ever holds government securities (T-bills / IFB / FXD).
  // Short-horizon or MMF-only plans never do, so we avoid claiming "CBK securities".
  const usesGovSecurities = useMemo(
    () => !!projection?.some((r) => r.tbillEnd > 0 || r.ifbEnd > 0 || r.fxdEnd > 0),
    [projection]
  );
  const strategyDescriptor = usesGovSecurities ? `${fundLabel} + CBK securities` : fundLabel;

  // Phase legend derived from the actual projection so band ranges match this
  // portfolio's horizon and phase fractions (not a hardcoded 120-month layout).
  const phaseLegend = useMemo(() => {
    if (!projection?.length) return [] as { label: string; start: number; end: number; color: string }[];
    const colorFor: Record<string, string> = {
      foundation: "oklch(0.65 0.15 200 / 0.5)",
      growth: "oklch(0.70 0.12 160 / 0.5)",
      "de-risking": "oklch(0.78 0.14 85 / 0.5)",
      derisking: "oklch(0.78 0.14 85 / 0.5)",
      "final-liquidity": "oklch(0.65 0.15 280 / 0.5)",
      liquidity: "oklch(0.65 0.15 280 / 0.5)",
    };
    const bands: { label: string; start: number; end: number; color: string }[] = [];
    for (const r of projection) {
      const label = getPhaseName(r.phase);
      const last = bands[bands.length - 1];
      if (last && last.label === label) {
        last.end = r.monthNumber;
      } else {
        bands.push({ label, start: r.monthNumber, end: r.monthNumber, color: colorFor[r.phase] ?? "oklch(0.65 0.15 200 / 0.5)" });
      }
    }
    return bands;
  }, [projection]);

  const currentPhase = currentData ? currentData.phase : "foundation";

  // ── Onboarding empty state: authenticated but no portfolios yet ──────────
  if (!portfoliosLoading && portfolios.length === 0) {
    return (
      <AppShell>
        <div className="min-h-[70vh] flex items-center justify-center p-6">
          <div className="max-w-lg text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
              <Compass className="w-8 h-8 text-primary" />
            </div>
            <h1
              className="text-2xl font-bold text-foreground mb-2"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Create your first portfolio
            </h1>
            <p className="text-sm text-muted-foreground leading-relaxed mb-6">
              A portfolio is a single savings goal — its own target amount, time horizon,
              monthly contribution, and Money Market Fund. Once you create one, the dashboard
              will project your journey month by month and track your real deposits against it.
            </p>
            <Button
              size="lg"
              className="font-semibold"
              onClick={() => setCreateOpen(true)}
            >
              <Plus className="w-4 h-4 mr-1.5" />
              Create a portfolio
            </Button>
            <p className="text-xs text-muted-foreground mt-6">
              New to fixed-income investing in Kenya?{" "}
              <Link href="/getting-started">
                <span className="text-primary underline cursor-pointer">Read the Getting Started guide</span>
              </Link>
              .
            </p>
          </div>
        </div>
        <CreatePortfolioDialog open={createOpen} onOpenChange={setCreateOpen} />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Investment Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {horizonYearsLabel}-year journey to {formatKES(targetAmount)} · {strategyDescriptor}
            </p>
          </div>
          <Badge variant="outline" className={`text-xs px-3 py-1 border ${getPhaseColorClass(currentPhase)}`}>
            {getPhaseName(currentPhase)} Phase
          </Badge>
        </div>

        {/* ── What the engine projection means ───────────────────────────── */}
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 flex gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed space-y-1">
            <p>
              <strong className="text-foreground">What does "Projected at Month {horizonMonths}" mean?</strong>{" "}
              This is the computer's best estimate of how much money you will have after {horizonYearsLabel} years ({horizonMonths} monthly contributions),
              assuming you follow the step-up schedule, the current interest rates stay roughly the same, and every month's earnings
              are automatically reinvested. Think of it as your <em className="text-foreground">financial finish line</em> — the number
              the plan is designed to reach.
            </p>
            <p>
              It is <strong className="text-foreground">not a guarantee</strong> — actual returns will vary as CBK rates change.
              Update the rates in <Link href="/settings"><span className="text-primary underline cursor-pointer">Rate Settings</span></Link> whenever
              you see new CBK auction results to keep the projection accurate.
            </p>
          </div>
        </div>

        {/* ── Goal Progress Card ──────────────────────────────────────────── */}
        <Card className="border-primary/20 gold-glow">
          <CardContent className="p-6">
            <div className="flex items-start justify-between mb-4 gap-4 flex-wrap">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                  Projected Portfolio Value at Year {horizonYearsLabel}
                </p>
                {projLoading ? (
                  <Skeleton className="h-10 w-52 mt-1" />
                ) : (
                  <p className="text-4xl font-bold gradient-text kes-amount" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {formatKES(projectedFinalValue)}
                  </p>
                )}
                <p className="text-xs text-muted-foreground mt-1.5">
                  This is the total portfolio value you will <strong className="text-foreground">hold in your accounts</strong> at the end of Month {horizonMonths} — not what you put in, but what you will have.
                </p>
              </div>

              {/* Target amount — editable */}
              <div className="text-right shrink-0">
                <p className="text-xs text-muted-foreground mb-1">Target End Value</p>
                <div className="flex items-center gap-2 justify-end">
                  {false ? (
                    <Skeleton className="h-7 w-32" />
                  ) : (
                    <p className="text-xl font-bold text-primary kes-amount">
                      {formatKES(targetAmount)}
                    </p>
                  )}
                  <button
                    onClick={openTargetDialog}
                    className="w-6 h-6 rounded-md bg-muted hover:bg-primary/20 flex items-center justify-center transition-colors"
                    title={`Change your target end value (the amount you want to hold at Month ${horizonMonths})`}
                  >
                    <Pencil className="w-3 h-3 text-muted-foreground" />
                  </button>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {willHitTarget ? (
                    <span className="text-emerald-400">
                      ✓ On track — surplus of {formatKES(surplusOrShortfall)}
                    </span>
                  ) : (
                    <span className="text-red-400">
                      ✗ Shortfall of {formatKES(Math.abs(surplusOrShortfall))}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* Progress bar */}
            <div className="relative h-3 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/80 to-primary rounded-full transition-all duration-1000"
                style={{ width: `${progressPct}%` }}
              />
              {[25, 50, 75].map((pct) => (
                <div key={pct} className="absolute top-0 bottom-0 w-px bg-border/50" style={{ left: `${pct}%` }} />
              ))}
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1.5">
              <span>KES 0</span>
              <span>{formatKESCompact(targetAmount * 0.25)}</span>
              <span>{formatKESCompact(targetAmount * 0.5)}</span>
              <span>{formatKESCompact(targetAmount * 0.75)}</span>
              <span>{formatKESCompact(targetAmount)}</span>
            </div>
            {/* Surplus / shortfall callout */}
            {!projLoading && projectedFinalValue > 0 && (
              <div className={`mt-3 rounded-lg px-4 py-3 text-xs flex items-start gap-2 ${
                willHitTarget
                  ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300"
                  : "bg-red-500/10 border border-red-500/20 text-red-300"
              }`}>
                {willHitTarget ? (
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                )}
                <span>
                  {willHitTarget ? (
                    <>
                      <strong>Your plan overshoots the target by {formatKES(surplusOrShortfall)}.</strong>{" "}
                      This is because your contribution step-ups and compound interest naturally produce more than your {formatKES(targetAmount)} goal.
                      The extra {formatKES(surplusOrShortfall)} is a buffer — it protects you if rates fall or you miss a few contributions.
                      The bucket balances above show where all {formatKES(projectedFinalValue)} will be sitting at Year {horizonYearsLabel}.
                    </>
                  ) : (
                    <>
                      <strong>Your plan is {formatKES(Math.abs(surplusOrShortfall))} short of the target.</strong>{" "}
                      Consider increasing your step-up amount or adjusting your goal. Use the{" "}
                      <Link href="/scenarios"><span className="underline cursor-pointer">Scenarios</span></Link> page to find the right step-up.
                    </>
                  )}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Asset Allocation Cards ──────────────────────────────────────── */}
        <div>
          <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
            <Info className="w-3 h-3" />
            These are the <strong className="text-foreground">projected balances in each bucket at Month {horizonMonths}</strong> — how your money is spread across the four investment instruments at the end of the {horizonYearsLabel}-year plan. These figures are driven by your contribution schedule and interest rates, not your goal amount. To see how different step-up amounts affect your outcome, visit the <Link href="/scenarios"><span className="text-primary hover:underline cursor-pointer">Scenarios</span></Link> page.
          </p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {projLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Card key={i}><CardContent className="p-5"><Skeleton className="h-20 w-full" /></CardContent></Card>
              ))
            ) : (
              [
                { title: "MMF Balance", key: "mmfEnd" as const, subtitle: secondaryMmfs.length > 0 ? `${fundName} + ${secondaryMmfs.length} more` : fundName, icon: Wallet, accent: true, tooltip: `Your ${fundName} projected balance at Year ${horizonYearsLabel}${secondaryMmfs.length > 0 ? ` (+ ${secondaryMmfs.length} additional MMF account${secondaryMmfs.length > 1 ? "s" : ""} with KES ${secondaryMmfTotal.toLocaleString("en-KE")} current balance)` : ""}. Earns daily interest (net ~${(fundEar * 0.85).toFixed(1)}% p.a. after 15% WHT).` },
                { title: "T-Bills", key: "tbillEnd" as const, subtitle: "CBK Treasury Bills", icon: TrendingUp, accent: false, tooltip: `Your total invested in CBK Treasury Bills at Year ${horizonYearsLabel}. T-bills are short-term (91–364 days), very safe government instruments. You earn a discount return (net ~7.5% p.a. after 15% WHT deducted at source).` },
                { title: "IFB Holdings", key: "ifbEnd" as const, subtitle: "Tax-exempt bonds", icon: Shield, accent: false, tooltip: `Your total invested in Infrastructure Finance Bonds at Year ${horizonYearsLabel}. IFBs pay a semi-annual coupon (e.g. 12.5% p.a.) and are 100% tax-exempt — you keep every shilling of interest earned.` },
                { title: "FXD Bonds", key: "fxdEnd" as const, subtitle: "Fixed coupon bonds", icon: Landmark, accent: false, tooltip: `Your total invested in Fixed Coupon Bonds at Year ${horizonYearsLabel}. FXDs pay a semi-annual coupon (e.g. 12.35% gross, ~10.5% net after 15% WHT). They provide predictable income but the WHT is deducted before you receive the coupon.` },
              ].map(({ title, key, subtitle, icon, accent, tooltip }) => {
                const bucketValue = lastData?.[key] ?? 0;
                const pctOfTarget = targetAmount > 0 ? ((bucketValue / targetAmount) * 100).toFixed(1) : "0.0";
                return (
                  <Card key={title} className={`card-hover ${accent ? "border-primary/30 gold-glow" : ""}`}>
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 mb-1">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{title}</p>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <HelpCircle className="w-3 h-3 text-muted-foreground/60 cursor-help shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-xs text-xs">{tooltip}</TooltipContent>
                            </Tooltip>
                          </div>
                          <p className={`text-2xl font-bold kes-amount ${accent ? "gradient-text" : "text-foreground"}`}>
                            {formatKESCompact(bucketValue)}
                          </p>
                          <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
                          <p className="text-xs text-muted-foreground/70 mt-0.5">
                            {pctOfTarget}% of {formatKESCompact(targetAmount)} goal
                          </p>
                        </div>
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ml-3 ${accent ? "bg-primary/15" : "bg-muted"}`}>
                          {(() => { const Icon = icon; return <Icon className={`w-5 h-5 ${accent ? "text-primary" : "text-muted-foreground"}`} />; })()}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })
            )}
          </div>
        </div>

        {/* ── Tracked MMF Accounts (multi-MMF rollup) ─────────────────────── */}
        {secondaryMmfs.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Wallet className="w-4 h-4 text-primary" />
                Tracked MMF Accounts
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Current balances you maintain across multiple money market funds. The projection above models your primary fund; these additional accounts are tracked here and rolled into your tax and accrual views.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="rounded-lg border border-border divide-y divide-border">
                <div className="flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{fundName} <span className="text-xs text-muted-foreground">(primary)</span></p>
                    <p className="text-xs text-muted-foreground">Net yield {fundEar.toFixed(2)}% p.a.</p>
                  </div>
                  <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(actualsSummary?.byBucket?.mmf ?? 0)}</p>
                </div>
                {secondaryMmfs.map((m) => (
                  <div key={m.id} className="flex items-center justify-between px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{m.label?.trim() ? `${m.label}` : m.fundName}{m.label?.trim() ? <span className="text-xs text-muted-foreground"> ({m.fundName})</span> : null}</p>
                      <p className="text-xs text-muted-foreground">Net yield {m.ear.toFixed(2)}% p.a.{m.monthlyContribution > 0 ? ` · +${formatKES(m.monthlyContribution)}/mo` : ""}</p>
                    </div>
                    <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(m.currentBalance)}</p>
                  </div>
                ))}
                <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5">
                  <p className="text-sm font-semibold text-foreground">Total tracked MMF</p>
                  <p className="text-sm font-bold kes-amount gradient-text shrink-0">{formatKES((actualsSummary?.byBucket?.mmf ?? 0) + secondaryMmfTotal)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2 flex items-start gap-1.5">
                <Info className="w-3 h-3 mt-0.5 shrink-0" />
                Manage these accounts on the <Link href="/mmf-funds"><span className="text-primary hover:underline cursor-pointer">MMF Funds</span></Link> page. Balances are entered manually.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ── Portfolio Growth Chart ──────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-2 flex-wrap">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-primary" />
                  Portfolio Growth Projection ({horizonMonths} Months)
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Each coloured band shows how much money is in each bucket over time. The dashed line is your {formatKES(targetAmount)} goal.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {projLoading ? (
              <Skeleton className="h-72 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="totalGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.78 0.14 85)" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="oklch(0.78 0.14 85)" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="mmfGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="oklch(0.65 0.15 200)" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="oklch(0.65 0.15 200)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 250)" vertical={false} />
                  <XAxis
                    dataKey="month"
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => (yearLabels.includes(v) ? `Yr ${Math.round((v / 12) * 10) / 10}` : "")}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatKESCompact(v).replace("KES ", "")}
                    width={50}
                  />
                  <RechartsTooltip content={<ChartTooltip />} />
                  <ReferenceLine
                    y={targetAmount}
                    stroke="oklch(0.78 0.14 85)"
                    strokeDasharray="6 3"
                    strokeOpacity={0.6}
                    label={{ value: `${formatKESCompact(targetAmount)} Target`, fill: "oklch(0.78 0.14 85)", fontSize: 10, position: "insideTopRight" }}
                  />
                  {yearLabels.map((m) => (
                    <ReferenceLine key={m} x={m} stroke="oklch(0.30 0.03 250)" strokeDasharray="2 4" />
                  ))}
                  <Area type="monotone" dataKey="mmf" name="MMF" stackId="1" stroke="oklch(0.65 0.15 200)" fill="url(#mmfGrad)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="tbill" name="T-Bills" stackId="1" stroke="oklch(0.70 0.12 160)" fill="oklch(0.70 0.12 160 / 0.1)" strokeWidth={1.5} />
                  <Area type="monotone" dataKey="ifb" name="IFB" stackId="1" stroke="oklch(0.78 0.14 85)" fill="url(#totalGrad)" strokeWidth={2} />
                  <Area type="monotone" dataKey="fxd" name="FXD" stackId="1" stroke="oklch(0.65 0.15 280)" fill="oklch(0.65 0.15 280 / 0.1)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            )}
            <div className="flex flex-wrap gap-3 mt-3 pt-3 border-t border-border">
              {phaseLegend.map((b) => (
                <div key={b.label} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <div className="w-3 h-2 rounded-sm" style={{ background: b.color }} />
                  <span>{b.label} (M{b.start}–{b.end})</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ── Year-End Milestones ─────────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              Year-End Milestones
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              <strong>Projected Total</strong> = the plan’s expected balance for your {formatKES(targetAmount)} goal at that year-end.{" "}
              <strong>Min. Healthy</strong> = the lowest acceptable balance (90% of projected) — if you fall below this, catch-up action is needed.{" "}
              <strong>Engine Value</strong> = what the simulator calculates with your current rate settings. Both columns scale automatically when you change your goal.
            </p>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Year</th>
                    <th className="text-left py-2 pr-4 text-muted-foreground font-medium">Month</th>
                    <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Projected Total</th>
                    <th className="text-right py-2 pr-4 text-muted-foreground font-medium">Min. Healthy</th>
                    <th className="text-right py-2 text-muted-foreground font-medium">
                      <span className="flex items-center gap-1 justify-end">
                        Engine Value
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <HelpCircle className="w-3 h-3 cursor-help" />
                          </TooltipTrigger>
                          <TooltipContent side="top" className="max-w-xs text-xs">
                            This is what the simulator calculates you will have at that month, using your current rate settings. Green = at or above the minimum healthy checkpoint. Red = below the minimum.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {milestones?.map((m) => {
                    const engineValue = projection?.[m.month - 1]?.totalEnd ?? 0;
                    const isOnTrack = engineValue >= m.minHealthyCheckpoint;
                    const isAhead = engineValue >= m.projectedTotal;
                    return (
                      <tr key={m.year} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="py-2.5 pr-4 font-semibold text-foreground">Year {m.year}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground">{m.month}</td>
                        <td className="py-2.5 pr-4 text-right font-medium kes-amount text-foreground">
                          {formatKES(m.projectedTotal)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-muted-foreground kes-amount">
                          {formatKES(m.minHealthyCheckpoint)}
                        </td>
                        <td className="py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isAhead ? (
                              <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                            ) : isOnTrack ? (
                              <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                            ) : (
                              <AlertTriangle className="w-3 h-3 text-red-400 shrink-0" />
                            )}
                            <span className={`font-semibold kes-amount ${isAhead ? "text-emerald-400" : isOnTrack ? "status-on-track" : "status-behind"}`}>
                              {formatKES(engineValue)}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

          </CardContent>
        </Card>

        {/* ── Today Snapshot + Reconciliation ─────────────────────────────── */}
        {actualsSummary && actualsSummary.entryCount > 0 && (() => {
          const primaryMmf = actualsSummary.depositsContributed ?? actualsSummary.byBucket?.mmf ?? 0;
          const sec = actualsSummary.secondaryMmfBalance ?? 0;
          const bank = actualsSummary.bankBalance ?? 0;
          const securitiesValue =
            (actualsSummary.byBucket?.tbill ?? 0) +
            (actualsSummary.byBucket?.ifb ?? 0) +
            (actualsSummary.byBucket?.fxd ?? 0);
          const actualsTotal = actualsSummary.totalContributed ?? 0;
          const rows = [
            { key: "pmmf", label: `${fundName} (primary MMF)`, icon: Wallet, amt: primaryMmf },
            { key: "smmf", label: `Other MMF accounts (${actualsSummary.secondaryCount ?? 0})`, icon: PiggyBank, amt: sec },
            { key: "bank", label: `Bank instruments (${actualsSummary.bankHoldingCount ?? 0})`, icon: Landmark, amt: bank },
            { key: "sec", label: "CBK securities (T-Bills / IFB / FXD)", icon: Shield, amt: securitiesValue },
          ];

          // Reconciliation: live actuals vs the engine's seeded "today" value.
          const hasEngineToday = projectionToday != null;
          const delta = hasEngineToday ? actualsTotal - (projectionToday as number) : 0;
          const denom = hasEngineToday && (projectionToday as number) > 0 ? (projectionToday as number) : actualsTotal || 1;
          const deltaPct = (delta / denom) * 100;
          const absPct = Math.abs(deltaPct);
          const tone = absPct <= 1
            ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
            : absPct <= 5
            ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
            : "bg-red-500/10 text-red-400 border-red-500/30";
          const ReconIcon = absPct <= 1 ? CheckCircle2 : AlertTriangle;

          return (
            <Card
              ref={reconcileRef}
              id="reconciliation-card"
              className={cn(
                "scroll-mt-24 transition-shadow duration-500",
                reconcileFlash && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg"
              )}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <Wallet className="w-4 h-4 text-primary" />
                  Today Snapshot &amp; Reconciliation
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  What you hold right now across every instrument, and how that compares with the
                  projection engine&rsquo;s value for today (the last month it seeds from your real deposits).
                </p>
              </CardHeader>
              <CardContent className="p-4 pt-0 space-y-4">
                {/* Per-instrument breakdown */}
                <div className="rounded-lg border border-border divide-y divide-border">
                  {rows.map((r) => {
                    const Icon = r.icon;
                    const pct = actualsTotal > 0 ? (r.amt / actualsTotal) * 100 : 0;
                    return (
                      <div key={r.key} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="w-7 h-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
                          <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground truncate">{r.label}</p>
                          <p className="text-xs text-muted-foreground">{pct.toFixed(1)}% of holdings</p>
                        </div>
                        <p className="text-sm font-semibold kes-amount text-foreground shrink-0">{formatKES(r.amt)}</p>
                      </div>
                    );
                  })}
                  <div className="flex items-center justify-between px-3 py-2.5 bg-primary/5">
                    <p className="text-sm font-semibold text-foreground">Total held today</p>
                    <p className="text-sm font-bold kes-amount gradient-text shrink-0">{formatKES(actualsTotal)}</p>
                  </div>
                </div>

                {/* Reconciliation row */}
                <div className={`rounded-lg border px-3 py-3 ${tone}`}>
                  <div className="flex items-start gap-2">
                    <ReconIcon className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold">Projection vs Actuals (today)</p>
                      {hasEngineToday ? (
                        <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                          <div>
                            <p className="opacity-80">Engine value (today)</p>
                            <p className="font-semibold kes-amount text-foreground">{formatKES(projectionToday as number)}</p>
                          </div>
                          <div>
                            <p className="opacity-80">Actuals (today)</p>
                            <p className="font-semibold kes-amount text-foreground">{formatKES(actualsTotal)}</p>
                          </div>
                          <div>
                            <p className="opacity-80">Difference</p>
                            <p className="font-semibold kes-amount">
                              {delta >= 0 ? "+" : "−"}{formatKES(Math.abs(delta))} ({delta >= 0 ? "+" : "−"}{absPct.toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-1 text-xs opacity-90">
                          The engine has no seeded &ldquo;today&rdquo; value yet — your portfolio start date is in the
                          current month, so the projection begins from month 0. Record deposits in earlier months
                          to enable a side-by-side comparison.
                        </p>
                      )}
                      {hasEngineToday && (
                        <p className="mt-2 text-xs opacity-90 leading-relaxed">
                          {absPct <= 1
                            ? "Your real holdings track the plan closely — nicely on course."
                            : delta >= 0
                            ? "You are ahead of the plan for this point in time. The engine assumes a fixed monthly schedule; extra deposits or higher balances push actuals above the modelled curve."
                            : "You are behind the plan for this point in time. This is expected if you started recording mid-journey or skipped some scheduled contributions — the engine assumes every month was funded on schedule."}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* ── Live Actuals Panel ──────────────────────────────────────────── */}
        <Card className="border-emerald-500/20">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <ArrowDownCircle className="w-4 h-4 text-emerald-400" />
                  Live Actuals — Real Money Deposited
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  These figures are based on the deposits you have actually recorded. They reflect real money, not projections.
                </p>
              </div>
              <button onClick={openDrawer} className="text-xs text-primary hover:underline flex items-center gap-1">
                Record a deposit <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {actualsSummary && actualsSummary.entryCount === 0 ? (
              <div className="flex items-center gap-3 rounded-lg bg-muted/40 border border-border p-4 text-sm text-muted-foreground">
                <PiggyBank className="w-5 h-5 shrink-0 opacity-50" />
                <span>
                  No deposits recorded yet.{" "}
                  <button onClick={openDrawer} className="text-primary underline">Record your first deposit</button>{" "}
                  to see your live actuals here.
                </span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-emerald-400">Total Contributed</p>
                  <p className="text-2xl font-serif font-bold text-foreground kes-amount">
                    {formatKES(actualsSummary?.totalContributed ?? 0)}
                  </p>
                  <div className="w-full h-1 rounded-full bg-white/10 overflow-hidden mt-2">
                    <div
                      className="h-full rounded-full bg-emerald-400 transition-all duration-700"
                      style={{ width: `${Math.min(100, ((actualsSummary?.totalContributed ?? 0) / targetAmount) * 100)}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {(((actualsSummary?.totalContributed ?? 0) / targetAmount) * 100).toFixed(2)}% of {formatKES(targetAmount)} goal
                  </p>
                </div>

                <div className="rounded-xl bg-white/5 border border-white/10 p-4 space-y-1">
                  <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Remaining to Target</p>
                  <p className="text-2xl font-serif font-bold text-foreground kes-amount">
                    {formatKES(actualsSummary?.remainingToTarget ?? targetAmount)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    Based on {formatKES(targetAmount)} goal
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-white/10">
                    {Object.entries(actualsSummary?.byBucket ?? {}).map(([bucket, amt]) => (
                      <div key={bucket} className="text-xs">
                        <span className="text-muted-foreground uppercase">{bucket}:</span>{" "}
                        <span className="font-semibold text-foreground">{formatKESCompact(amt as number)}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl bg-red-500/10 border border-red-500/20 p-4 space-y-1">
                  <div className="flex items-center gap-1.5">
                    <Receipt className="w-3.5 h-3.5 text-red-400" />
                    <p className="text-xs font-medium uppercase tracking-widest text-red-400">Est. Annual Tax</p>
                  </div>
                  <p className="text-2xl font-serif font-bold text-red-300 kes-amount">
                    {formatKES(actualsSummary?.taxLiability ?? 0)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    15% WHT on MMF, T-Bill &amp; FXD income. Deducted at source — you never pay this separately.
                  </p>
                  <p className="text-xs text-emerald-400 mt-1">
                    IFB bonds: fully tax-exempt
                  </p>
                </div>
              </div>
            )}

            {/* ── Unified live net worth across every destination ──────────── */}
            {actualsSummary && actualsSummary.entryCount > 0 && (() => {
              const primaryMmf = actualsSummary.byBucket?.mmf ?? 0;
              const sec = actualsSummary.secondaryMmfBalance ?? 0;
              const bank = actualsSummary.bankBalance ?? 0;
              const tb = actualsSummary.byBucket?.tbill ?? 0;
              const ifb = actualsSummary.byBucket?.ifb ?? 0;
              const fxd = actualsSummary.byBucket?.fxd ?? 0;
              const net = actualsSummary.totalContributed ?? 0;
              const segs = [
                { key: "pmmf", label: `${fundName} (primary MMF)`, amt: primaryMmf, color: "#34d399" },
                { key: "smmf", label: `Other MMFs (${actualsSummary.secondaryCount ?? 0})`, amt: sec, color: "#6ee7b7" },
                { key: "bank", label: `Bank deposits (${actualsSummary.bankHoldingCount ?? 0})`, amt: bank, color: "#38bdf8" },
                { key: "tb", label: "CBK T-Bills", amt: tb, color: "#60a5fa" },
                { key: "ifb", label: "IFB Bonds", amt: ifb, color: "#a78bfa" },
                { key: "fxd", label: "FXD Bonds", amt: fxd, color: "#fb923c" },
              ].filter((s) => s.amt > 0);
              return (
                <div className="mt-4 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 space-y-3">
                  <div className="flex items-end justify-between flex-wrap gap-2">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-widest text-emerald-400">Live Net Worth</p>
                      <p className="text-2xl font-serif font-bold text-foreground kes-amount">{formatKES(net)}</p>
                      <p className="text-xs text-muted-foreground">Sum of every account you actually own — separate from the projection above.</p>
                    </div>
                  </div>
                  {net > 0 && (
                    <>
                      <div className="w-full h-2.5 rounded-full overflow-hidden flex bg-white/5">
                        {segs.map((s) => (
                          <div key={s.key} style={{ width: `${(s.amt / net) * 100}%`, backgroundColor: s.color }} title={`${s.label}: ${formatKES(s.amt)}`} />
                        ))}
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                        {segs.map((s) => (
                          <div key={s.key} className="flex items-center gap-2 text-xs">
                            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                            <span className="text-muted-foreground truncate">{s.label}</span>
                            <span className="ml-auto font-semibold text-foreground kes-amount shrink-0">{formatKESCompact(s.amt)}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* ── Rate Assumptions ────────────────────────────────────────────── */}
        {settings && (
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm font-semibold text-foreground">Current Rate Assumptions</CardTitle>
                  <p className="text-xs text-muted-foreground mt-1">
                    These are the gross rates used in the projection. The engine deducts 15% WHT on MMF, T-Bill, and FXD income automatically.
                  </p>
                </div>
                <Link href="/settings">
                  <span className="text-xs text-primary hover:underline flex items-center gap-1 cursor-pointer">
                    Update rates <ArrowRight className="w-3 h-3" />
                  </span>
                </Link>
              </div>
              {(() => {
                const s = rateStaleness((settings as any).ratesLastUpdatedAt);
                const tone = s.isVeryStale
                  ? "bg-red-500/10 text-red-400 border-red-500/30"
                  : s.isStale
                  ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
                const Icon = s.isStale ? AlertTriangle : CheckCircle2;
                return (
                  <div className={`mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs ${tone}`}>
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="font-medium">Rates last updated: {s.label}</span>
                    {s.isVeryStale ? (
                      <span className="opacity-90">— more than 30 days old. CBK auction rates change frequently; update them so this projection stays accurate.</span>
                    ) : s.isStale ? (
                      <span className="opacity-90">— over a week old. Consider refreshing from the latest CBK results.</span>
                    ) : (
                      <span className="opacity-90">— recently refreshed.</span>
                    )}
                    {s.isStale && (
                      <Link href="/settings">
                        <span className="underline underline-offset-2 cursor-pointer font-medium ml-auto flex items-center gap-1">
                          <Clock className="w-3 h-3" /> Update now
                        </span>
                      </Link>
                    )}
                  </div>
                );
              })()}
            </CardHeader>
            <CardContent className="p-4 pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {[
                  { label: `${fundLabel} Yield (gross)`, value: formatPct((settings as any).selectedFundEar ?? settings.mmfYield), note: "net ~" + formatPct(((settings as any).selectedFundEar ?? settings.mmfYield) * 0.85) },
                  { label: "91-Day T-Bill", value: formatPct(settings.tbill91Rate), note: "net ~" + formatPct(settings.tbill91Rate * 0.85) },
                  { label: "364-Day T-Bill", value: formatPct(settings.tbill364Rate), note: "net ~" + formatPct(settings.tbill364Rate * 0.85) },
                  { label: "IFB Coupon", value: formatPct(settings.ifbCouponRate), note: "tax-exempt" },
                  { label: "FXD Coupon (gross)", value: formatPct(settings.fxdCouponRate), note: "net ~" + formatPct(settings.fxdCouponRate * 0.85) },
                  { label: "WHT Rate", value: formatPct(settings.withholdingTax), note: "MMF, T-Bill, FXD" },
                ].map(({ label, value, note }) => (
                  <div key={label} className="bg-muted/50 rounded-lg p-3 text-center">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className="text-sm font-bold text-primary">{value}</p>
                    <p className="text-xs text-muted-foreground/70 mt-0.5">{note}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

      </div>

      {/* ── Change Target Dialog ─────────────────────────────────────────── */}
      <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Set Your Target End Value</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-lg bg-muted/40 border border-border p-3 text-xs text-muted-foreground leading-relaxed">
              <p className="mb-2"><strong className="text-foreground">This is the total portfolio value you want to hold at Month {horizonMonths}</strong> — not the sum of what you put in, but the final balance sitting across all your investment buckets at the end of {horizonYearsLabel} years.</p>
              <strong className="text-foreground">What updates when you change this?</strong>
              <ul className="mt-2 space-y-1 list-disc list-inside">
                <li>The progress bar and percentage on the dashboard</li>
                <li>The "Remaining to Target" figure in your live actuals</li>
                <li>The target line on the portfolio growth chart</li>
                <li>The scenario comparison — which step-up amounts hit the new target</li>
                <li>The surplus/shortfall shown next to your goal</li>
              </ul>
              <p className="mt-2">The monthly contribution schedule and rate settings are <strong className="text-foreground">not affected</strong>.</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Target End Value (KES) — what you want to hold at Month {horizonMonths}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-medium">KES</span>
                <Input
                  type="number"
                  step="100000"
                  min="100000"
                  className="pl-12 text-sm"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && saveTarget()}
                  placeholder="5000000"
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Common targets: KES 3M, KES 5M, KES 7.5M, KES 10M
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[3000000, 5000000, 7500000, 10000000].map((preset) => (
                <button
                  key={preset}
                  onClick={() => setTargetInput(String(preset))}
                  className={`text-xs py-1.5 px-2 rounded-md border transition-colors ${
                    parseFloat(targetInput) === preset
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {formatKESCompact(preset)}
                </button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTargetDialogOpen(false)}>Cancel</Button>
            <Button
              onClick={saveTarget}
              disabled={updatePortfolioMutation.isPending}
              className="bg-primary text-primary-foreground"
            >
              {updatePortfolioMutation.isPending ? "Saving…" : "Update Target & Recalculate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AppShell>
  );
}
```

### `client/src/pages/Deposits.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc";
import { formatKES } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import {
  PlusCircle,
  Trash2,
  Wallet,
  TrendingUp,
  ShieldCheck,
  Landmark,
  Info,
  ArrowDownCircle,
  Building2,
  PiggyBank,
  Pencil,
} from "lucide-react";

type Bucket = "mmf" | "tbill" | "ifb" | "fxd";

const GOV_META = {
  tbill: { label: "CBK T-Bills", color: "text-[#60a5fa]", icon: <TrendingUp className="w-4 h-4" /> },
  ifb: { label: "IFB Bonds", color: "text-[#a78bfa]", icon: <ShieldCheck className="w-4 h-4" /> },
  fxd: { label: "FXD Bonds", color: "text-[#fb923c]", icon: <Landmark className="w-4 h-4" /> },
} as const;

const EMPTY_BANK = {
  id: null as number | null,
  bankName: "",
  label: "",
  instrumentType: "call_deposit" as "call_deposit" | "fixed_deposit",
  principal: "",
  interestRate: "",
  rateAsOfDate: new Date().toISOString().slice(0, 10),
  isNegotiable: true,
  tenorMonths: "",
  notes: "",
};

export default function Deposits() {
  const { portfolioId, portfolio } = usePortfolio();
  const { fundName, fundLabel } = useSelectedFund();
  const { openDrawer } = useDepositDrawer();
  const utils = trpc.useUtils();

  const { data: deposits = [], isLoading } = trpc.deposits.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: summary } = trpc.deposits.summary.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: secondaries = [] } = trpc.secondaryMmfs.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });
  const { data: bankHoldings = [] } = trpc.bankHoldings.list.useQuery({ portfolioId: portfolioId! }, { enabled: !!portfolioId });

  const liveTarget = portfolio?.targetAmount ?? 0;

  const deleteMutation = trpc.deposits.delete.useMutation({
    onSuccess: () => {
      utils.deposits.list.invalidate();
      utils.deposits.summary.invalidate();
      utils.secondaryMmfs.list.invalidate();
      utils.bankHoldings.list.invalidate();
      toast.success("Deposit removed");
      setDeleteId(null);
    },
    onError: (err) => toast.error(err.message),
  });

  const addBank = trpc.bankHoldings.add.useMutation({
    onSuccess: () => {
      utils.bankHoldings.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Bank instrument saved");
      setBankDialogOpen(false);
      setBankForm(EMPTY_BANK);
    },
    onError: (err) => toast.error(err.message),
  });
  const updateBank = trpc.bankHoldings.update.useMutation({
    onSuccess: () => {
      utils.bankHoldings.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Bank instrument updated");
      setBankDialogOpen(false);
      setBankForm(EMPTY_BANK);
    },
    onError: (err) => toast.error(err.message),
  });
  const deleteBank = trpc.bankHoldings.remove.useMutation({
    onSuccess: () => {
      utils.bankHoldings.list.invalidate();
      utils.deposits.summary.invalidate();
      toast.success("Bank instrument removed");
      setDeleteBankId(null);
    },
    onError: (err: { message: string }) => toast.error(err.message),
  });

  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [bankDialogOpen, setBankDialogOpen] = useState(false);
  const [bankForm, setBankForm] = useState(EMPTY_BANK);
  const [deleteBankId, setDeleteBankId] = useState<number | null>(null);

  function openBankEdit(h: (typeof bankHoldings)[number]) {
    setBankForm({
      id: h.id,
      bankName: h.bankName,
      label: h.label ?? "",
      instrumentType: h.instrumentType as "call_deposit" | "fixed_deposit",
      principal: String(h.principal),
      interestRate: String(h.interestRate),
      rateAsOfDate: h.rateAsOfDate ? new Date(h.rateAsOfDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
      isNegotiable: h.isNegotiable,
      tenorMonths: h.tenorMonths != null ? String(h.tenorMonths) : "",
      notes: h.notes ?? "",
    });
    setBankDialogOpen(true);
  }

  function submitBank() {
    if (!portfolioId) return;
    if (!bankForm.bankName.trim()) { toast.error("Bank name is required"); return; }
    const principal = parseFloat(bankForm.principal) || 0;
    const interestRate = parseFloat(bankForm.interestRate) || 0;
    const common = {
      portfolioId,
      bankName: bankForm.bankName.trim(),
      label: bankForm.label.trim() || undefined,
      instrumentType: bankForm.instrumentType,
      interestRate,
      rateAsOfDate: bankForm.rateAsOfDate || undefined,
      isNegotiable: bankForm.isNegotiable,
      tenorMonths: bankForm.tenorMonths ? parseInt(bankForm.tenorMonths) : undefined,
      notes: bankForm.notes.trim() || undefined,
    };
    if (bankForm.id) {
      updateBank.mutate({ id: bankForm.id, ...common, principal });
    } else {
      addBank.mutate({ ...common, principal });
    }
  }

  // Resolve a deposit row to a destination label for the history table.
  function destLabelFor(d: { institutionType?: string | null; mmfFundId?: number | null; bankHoldingId?: number | null; bucket: string }) {
    if (d.institutionType === "bank_instrument" && d.bankHoldingId) {
      const h = bankHoldings.find((x) => x.id === d.bankHoldingId);
      return { label: h ? (h.label || `${h.bankName}`) : "Bank deposit", icon: <Building2 className="w-4 h-4" />, color: "text-sky-300", taxFree: false };
    }
    if (d.institutionType === "mmf_fund" && d.mmfFundId) {
      if (portfolio?.mmfFundId === d.mmfFundId) return { label: fundName, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
      const s = secondaries.find((x) => x.mmfFundId === d.mmfFundId);
      return { label: s ? (s.label || s.fundName) : "MMF fund", icon: <PiggyBank className="w-4 h-4" />, color: "text-emerald-300", taxFree: false };
    }
    if (d.bucket === "ifb") return { label: GOV_META.ifb.label, icon: GOV_META.ifb.icon, color: GOV_META.ifb.color, taxFree: true };
    if (d.bucket === "tbill") return { label: GOV_META.tbill.label, icon: GOV_META.tbill.icon, color: GOV_META.tbill.color, taxFree: false };
    if (d.bucket === "fxd") return { label: GOV_META.fxd.label, icon: GOV_META.fxd.icon, color: GOV_META.fxd.color, taxFree: false };
    return { label: fundLabel, icon: <Wallet className="w-4 h-4" />, color: "text-emerald-400", taxFree: false };
  }

  const totalContributed = summary?.totalContributed ?? 0;
  const remainingToTarget = summary?.remainingToTarget ?? liveTarget;
  const taxLiability = summary?.taxLiability ?? 0;
  const taxBreakdown = summary?.taxBreakdown ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0, secondaryMmf: 0, bank: 0 };
  const byBucket = summary?.byBucket ?? { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
  const bankBalance = summary?.bankBalance ?? 0;
  const secondaryMmfBalance = summary?.secondaryMmfBalance ?? 0;
  const progressPct = liveTarget > 0 ? Math.min(100, (totalContributed / liveTarget) * 100) : 0;

  const bankTotal = useMemo(() => bankHoldings.reduce((s, h) => s + h.principal, 0), [bankHoldings]);

  return (
    <div className="p-8 space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Live Deposit Tracker</h1>
          <p className="text-muted-foreground mt-1">
            Record every real deposit into the exact account it went to — this drives your live actuals on the dashboard.
          </p>
        </div>
        <Button
          onClick={openDrawer}
          className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold gap-2"
        >
          <PlusCircle className="w-4 h-4" />
          Record Deposit
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Total Contributed</p>
          <p className="text-2xl font-serif font-bold text-[#c9a84c]">{formatKES(totalContributed)}</p>
          <div className="w-full h-1.5 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full bg-[#c9a84c] transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="text-xs text-muted-foreground">
            {liveTarget > 0 ? `${progressPct.toFixed(1)}% of ${formatKES(liveTarget)} goal` : "No target set"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Remaining to Target</p>
          <p className="text-2xl font-serif font-bold text-foreground">{formatKES(remainingToTarget)}</p>
          <p className="text-xs text-muted-foreground">
            {liveTarget > 0 ? `Based on ${formatKES(liveTarget)} goal` : "Set a target in Settings"}
          </p>
        </div>

        <div className="rounded-xl border border-white/10 bg-white/5 p-5 space-y-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Est. Tax Liability</p>
            <div className="group relative">
              <Info className="w-3 h-3 text-muted-foreground cursor-help" />
              <div className="absolute bottom-5 left-0 z-10 hidden group-hover:block w-56 rounded-lg bg-popover border border-border p-3 text-xs text-muted-foreground shadow-xl">
                15% WHT is deducted at source on MMF interest, bank deposit interest, T-Bill discount, and FXD coupons — all final taxes for resident individuals. IFB bonds are fully tax-exempt.
              </div>
            </div>
          </div>
          <p className="text-2xl font-serif font-bold text-red-400">{formatKES(taxLiability)}</p>
          <div className="text-xs text-muted-foreground space-y-0.5">
            {taxBreakdown.mmf > 0 && <p>MMF: {formatKES(taxBreakdown.mmf)}</p>}
            {(taxBreakdown.bank ?? 0) > 0 && <p>Bank: {formatKES(taxBreakdown.bank)}</p>}
            {taxBreakdown.tbill > 0 && <p>T-Bill: {formatKES(taxBreakdown.tbill)}</p>}
            {taxBreakdown.fxd > 0 && <p>FXD: {formatKES(taxBreakdown.fxd)}</p>}
            {byBucket.ifb > 0 && <p className="text-emerald-400">IFB: Tax-exempt</p>}
            {taxLiability === 0 && byBucket.ifb === 0 && <p>No deposits recorded yet</p>}
          </div>
        </div>
      </div>

      {/* Destination Breakdown */}
      <div className="rounded-xl border border-white/10 bg-white/5 p-5">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-widest mb-4">
          Where your money is
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-400"><Wallet className="w-4 h-4" /><span className="text-xs font-medium">{fundLabel}</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.mmf)}</p>
            <p className="text-xs text-muted-foreground">Primary MMF</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-emerald-300"><PiggyBank className="w-4 h-4" /><span className="text-xs font-medium">Other MMFs</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(secondaryMmfBalance)}</p>
            <p className="text-xs text-muted-foreground">{secondaries.length} account{secondaries.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sky-300"><Building2 className="w-4 h-4" /><span className="text-xs font-medium">Bank</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(bankBalance)}</p>
            <p className="text-xs text-muted-foreground">{bankHoldings.length} instrument{bankHoldings.length !== 1 ? "s" : ""}</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-blue-400"><TrendingUp className="w-4 h-4" /><span className="text-xs font-medium">T-Bills</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.tbill)}</p>
            <p className="text-xs text-muted-foreground">15% WHT</p>
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-violet-400"><ShieldCheck className="w-4 h-4" /><span className="text-xs font-medium">IFB / FXD</span></div>
            <p className="text-lg font-serif font-bold text-foreground">{formatKES(byBucket.ifb + byBucket.fxd)}</p>
            <p className="text-xs text-muted-foreground">Bonds</p>
          </div>
        </div>
      </div>

      {/* Bank Instruments */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-sky-300" />
          <h2 className="text-sm font-semibold text-foreground">Bank Instruments</h2>
          <span className="text-xs text-muted-foreground">— call & fixed deposits ({formatKES(bankTotal)})</span>
          <Button
            size="sm"
            variant="outline"
            className="ml-auto border-white/10 bg-white/5 gap-1.5 h-7 text-xs"
            onClick={() => { setBankForm(EMPTY_BANK); setBankDialogOpen(true); }}
          >
            <PlusCircle className="w-3.5 h-3.5" /> Add Instrument
          </Button>
        </div>
        {bankHoldings.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <Building2 className="w-8 h-8 text-muted-foreground mx-auto opacity-30" />
            <p className="text-muted-foreground text-sm">No bank instruments tracked.</p>
            <p className="text-muted-foreground text-xs">Add a call or fixed deposit to record money held at a commercial bank.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Instrument</TableHead>
                <TableHead className="text-muted-foreground text-xs">Type</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Principal</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Rate</TableHead>
                <TableHead className="text-muted-foreground text-xs">Rate as-of</TableHead>
                <TableHead className="text-muted-foreground text-xs w-20"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {bankHoldings.map((h) => (
                <TableRow key={h.id} className="border-white/10 hover:bg-white/5">
                  <TableCell className="text-sm text-foreground">
                    <div className="font-medium">{h.label || h.bankName}</div>
                    <div className="text-xs text-muted-foreground">{h.bankName}{h.isNegotiable ? " · negotiable" : ""}</div>
                  </TableCell>
                  <TableCell>
                    <Badge className="bg-sky-500/15 text-sky-300 border-sky-500/30 text-xs">
                      {h.instrumentType === "fixed_deposit" ? "Fixed Deposit" : "Call Deposit"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-mono font-semibold text-foreground">{formatKES(h.principal)}</TableCell>
                  <TableCell className="text-right font-mono text-foreground">{h.interestRate.toFixed(2)}%</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {h.rateAsOfDate ? new Date(h.rateAsOfDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-foreground" onClick={() => openBankEdit(h)}>
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => setDeleteBankId(h.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Deposit History Table */}
      <div className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/10 flex items-center gap-2">
          <ArrowDownCircle className="w-4 h-4 text-[#c9a84c]" />
          <h2 className="text-sm font-semibold text-foreground">Deposit History</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            {deposits.length} record{deposits.length !== 1 ? "s" : ""}
          </span>
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-muted-foreground text-sm">Loading deposits…</div>
        ) : deposits.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <ArrowDownCircle className="w-8 h-8 text-muted-foreground mx-auto opacity-40" />
            <p className="text-muted-foreground text-sm">No deposits recorded yet.</p>
            <p className="text-muted-foreground text-xs">Click "Record Deposit" to log your first real contribution.</p>
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="border-white/10 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs">Date</TableHead>
                <TableHead className="text-muted-foreground text-xs">Destination</TableHead>
                <TableHead className="text-muted-foreground text-xs text-right">Amount</TableHead>
                <TableHead className="text-muted-foreground text-xs">Tax Treatment</TableHead>
                <TableHead className="text-muted-foreground text-xs">Notes</TableHead>
                <TableHead className="text-muted-foreground text-xs w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((d) => {
                const dest = destLabelFor(d as never);
                const amount = parseFloat(String(d.amount));
                return (
                  <TableRow key={d.id} className="border-white/10 hover:bg-white/5">
                    <TableCell className="text-sm text-foreground">
                      {new Date(d.depositDate).toLocaleDateString("en-KE", { year: "numeric", month: "short", day: "numeric" })}
                    </TableCell>
                    <TableCell>
                      <div className={`flex items-center gap-2 ${dest.color}`}>
                        {dest.icon}
                        <span className="text-sm font-medium">{dest.label}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-right font-mono font-semibold text-foreground">{formatKES(amount)}</TableCell>
                    <TableCell>
                      {dest.taxFree ? (
                        <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-xs">Tax-Exempt</Badge>
                      ) : (
                        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 text-xs">15% WHT</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground max-w-[180px] truncate">{d.notes ?? "—"}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-400" onClick={() => setDeleteId(d.id)}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Bank instrument dialog */}
      <Dialog open={bankDialogOpen} onOpenChange={setBankDialogOpen}>
        <DialogContent className="bg-[#0f1117] border-white/10 text-foreground max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">{bankForm.id ? "Edit" : "Add"} Bank Instrument</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Bank name</Label>
                <Input value={bankForm.bankName} onChange={(e) => setBankForm((f) => ({ ...f, bankName: e.target.value }))} placeholder="e.g. KCB" className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Label (optional)</Label>
                <Input value={bankForm.label} onChange={(e) => setBankForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Emergency fund" className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Type</Label>
                <Select value={bankForm.instrumentType} onValueChange={(v) => setBankForm((f) => ({ ...f, instrumentType: v as "call_deposit" | "fixed_deposit" }))}>
                  <SelectTrigger className="bg-white/5 border-white/10 h-9 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent className="bg-[#0f1117] border-white/10">
                    <SelectItem value="call_deposit">Call Deposit</SelectItem>
                    <SelectItem value="fixed_deposit">Fixed Deposit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Principal (KES)</Label>
                <Input type="number" min="0" step="1000" value={bankForm.principal} onChange={(e) => setBankForm((f) => ({ ...f, principal: e.target.value }))} placeholder="e.g. 200000" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Interest rate (% p.a.)</Label>
                <Input type="number" min="0" step="0.01" value={bankForm.interestRate} onChange={(e) => setBankForm((f) => ({ ...f, interestRate: e.target.value }))} placeholder="e.g. 9.50" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Rate as-of date</Label>
                <Input type="date" value={bankForm.rateAsOfDate} onChange={(e) => setBankForm((f) => ({ ...f, rateAsOfDate: e.target.value }))} className="bg-white/5 border-white/10 h-9 text-sm" />
              </div>
            </div>
            {bankForm.instrumentType === "fixed_deposit" && (
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Tenor (months, optional)</Label>
                <Input type="number" min="0" value={bankForm.tenorMonths} onChange={(e) => setBankForm((f) => ({ ...f, tenorMonths: e.target.value }))} placeholder="e.g. 12" className="bg-white/5 border-white/10 font-mono h-9 text-sm" />
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-3 py-2.5">
              <div>
                <Label className="text-xs text-foreground">Negotiated rate</Label>
                <p className="text-xs text-muted-foreground">This rate was individually negotiated with the bank</p>
              </div>
              <Switch checked={bankForm.isNegotiable} onCheckedChange={(c) => setBankForm((f) => ({ ...f, isNegotiable: c }))} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Notes (optional)</Label>
              <Textarea value={bankForm.notes} onChange={(e) => setBankForm((f) => ({ ...f, notes: e.target.value }))} className="bg-white/5 border-white/10 resize-none h-14 text-sm" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-white/10" onClick={() => setBankDialogOpen(false)}>Cancel</Button>
            <Button className="bg-[#c9a84c] hover:bg-[#b8943f] text-black font-semibold" onClick={submitBank} disabled={addBank.isPending || updateBank.isPending}>
              {addBank.isPending || updateBank.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete deposit confirmation */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this deposit?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This will permanently remove the deposit record and update your actuals summary.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ portfolioId, id: deleteId })} className="bg-red-600 hover:bg-red-700 text-white">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete bank instrument confirmation */}
      <AlertDialog open={deleteBankId !== null} onOpenChange={(o) => !o && setDeleteBankId(null)}>
        <AlertDialogContent className="bg-[#0d1117] border-white/10 text-foreground">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this bank instrument?</AlertDialogTitle>
            <AlertDialogDescription className="text-muted-foreground">
              This removes the instrument and its principal from your actuals. Deposit history rows that referenced it will remain but show as a generic bank deposit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteBankId !== null && portfolioId && deleteBank.mutate({ id: deleteBankId, portfolioId })} className="bg-red-600 hover:bg-red-700 text-white">Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

### `client/src/pages/GettingStarted.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Circle, ChevronRight, ChevronDown, ExternalLink, Smartphone, CreditCard,
  FileText, Shield, Building2, BookOpen, AlertCircle, Phone, Globe, Clock, Search,
  TrendingUp, Landmark, Users, Star, Wand2, BookMarked, ArrowRight, LayoutDashboard,
  Wallet, Receipt, SlidersHorizontal
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

// ─── Guided demo: first-steps path + glossary ───────────────────────────────
const FIRST_STEPS: { icon: React.ElementType; title: string; desc: string; href: string; cta: string }[] = [
  { icon: SlidersHorizontal, title: "1. Set your plan & rates", desc: "Confirm your target, horizon, monthly contribution and the current MMF/T-bill/bond rates.", href: "/settings", cta: "Open Settings" },
  { icon: Wallet, title: "2. Record where your money is", desc: "Log deposits into each MMF, bank deposit or government security so the tracker mirrors reality.", href: "/deposits", cta: "Record a deposit" },
  { icon: LayoutDashboard, title: "3. Read your dashboard", desc: "See your live net worth, allocation and the projection toward your goal in one place.", href: "/", cta: "View Dashboard" },
  { icon: TrendingUp, title: "4. Test scenarios", desc: "Find the minimum monthly contribution that reaches your target, and try what-ifs.", href: "/scenarios", cta: "Open Scenarios" },
  { icon: Receipt, title: "5. Check your tax", desc: "Review the 15% withholding tax on each income source and your blended net yield.", href: "/tax-summary", cta: "Open Tax Summary" },
];

const GLOSSARY: { term: string; def: string }[] = [
  { term: "EAR (Effective Annual Rate)", def: "The true annualised yield once compounding is included. MMFs quote a net EAR after the manager's fee; the tracker applies 15% withholding tax on top." },
  { term: "WHT (Withholding Tax)", def: "Tax deducted at source before you receive interest. In Kenya it is 15% on MMF, T-bill and FXD income. IFB (infrastructure bond) interest is tax-exempt." },
  { term: "T-Bill", def: "A short-term government security sold at a discount over 91, 182 or 364 days. You earn the difference between the discounted price and the face value at maturity." },
  { term: "IFB (Infrastructure Bond)", def: "A long-dated government bond funding infrastructure. Its coupon is tax-exempt, making its net yield higher than a comparable taxable bond." },
  { term: "FXD (Fixed-Coupon Treasury Bond)", def: "A government bond paying a fixed semi-annual coupon (around 12.35% gross). The 15% WHT is deducted before the coupon reaches you." },
  { term: "Call deposit", def: "A bank deposit that earns interest while remaining accessible on short notice. Rates are usually negotiable for larger balances." },
  { term: "Fixed deposit", def: "A bank deposit locked for a set term at an agreed rate; interest is typically paid at maturity." },
  { term: "Duration", def: "A measure of how sensitive a bond's price is to interest-rate changes. Longer duration means larger price swings when rates move." },
];

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountStatus = "not_started" | "in_progress" | "opened";

interface AccountDetails {
  accountNumber?: string;
  phoneNumber?: string;
  notes?: string;
  openedDate?: string;
}

interface AccountState {
  status: AccountStatus;
  details: AccountDetails;
}

type FundCategory = "independent" | "insurance" | "bank" | "sacco";

interface MmfFundInfo {
  id: string;
  rank: number;
  name: string;
  company: string;
  category: FundCategory;
  ear: string;
  netYield: string;
  minInvestment: string;
  mgmtFee: string;
  aum: string;
  website: string;
  portalUrl?: string;
  mpesaPaybill?: string;
  phone?: string;
  email?: string;
  openingSteps: string[];
  documents: string[];
  notes?: string;
}

// ─── All 27 MMF Fund Data ─────────────────────────────────────────────────────

const MMF_FUNDS: MmfFundInfo[] = [
  {
    id: "nabo",
    rank: 1,
    name: "Nabo Africa Money Market Fund",
    company: "Nabo Capital",
    category: "independent",
    ear: "13.54%",
    netYield: "11.51%",
    minInvestment: "KES 100,000",
    mgmtFee: "2.25%",
    aum: "KES 6.2B",
    website: "https://nabocapital.com",
    portalUrl: "https://nabocapital.com/invest",
    phone: "+254 709 170 000",
    email: "info@nabocapital.com",
    openingSteps: [
      "Visit nabocapital.com and click 'Invest Now' or 'Open Account'.",
      "Complete the online application form with your full name, ID/Passport number, KRA PIN, and bank details.",
      "Upload KYC documents: National ID (front & back), KRA PIN certificate, and a passport photo.",
      "Fund your account with the minimum KES 100,000 via bank transfer or EFT to Nabo Capital's designated account.",
      "Await account activation confirmation by email (typically 1–3 business days).",
      "Log in to your Nabo investor portal to monitor your balance and returns.",
    ],
    documents: ["National ID or Passport (front & back)", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months) for source of funds"],
    notes: "Highest-yielding fund in Kenya (Jun 2026). Minimum KES 100,000 is the highest among all funds — suitable for lump-sum investors.",
  },
  {
    id: "cytonn",
    rank: 2,
    name: "Cytonn Money Market Fund",
    company: "Cytonn Asset Managers",
    category: "independent",
    ear: "12.00%",
    netYield: "10.20%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 2.0B",
    website: "https://cytonnmm.com",
    portalUrl: "https://cytonnmm.com",
    mpesaPaybill: "525900",
    phone: "+254 709 170 000",
    email: "mm@cytonn.com",
    openingSteps: [
      "Visit cytonnmm.com and click 'Open Account'.",
      "Fill in the online registration form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make an initial deposit of at least KES 1,000 via M-Pesa Paybill 525900 (Account: your phone number) or bank transfer.",
      "Receive your account confirmation email within 1–2 business days.",
      "Access the Cytonn investor portal to track your investment and request withdrawals.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Second-highest yield in Kenya. Very low minimum of KES 1,000 makes it accessible. M-Pesa deposits supported.",
  },
  {
    id: "etica",
    rank: 3,
    name: "Etica Money Market Fund",
    company: "Etica Capital",
    category: "independent",
    ear: "10.97%",
    netYield: "9.32%",
    minInvestment: "KES 100",
    mgmtFee: "2.00%",
    aum: "KES 12.5B",
    website: "https://eticacapital.com",
    portalUrl: "https://eticacapital.com/invest",
    phone: "+254 700 000 000",
    email: "info@eticacapital.com",
    openingSteps: [
      "Visit eticacapital.com and navigate to the Money Market Fund section.",
      "Click 'Open Account' and complete the online KYC form.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your first deposit of as little as KES 100 via M-Pesa or bank transfer.",
      "Receive account activation confirmation within 1–2 business days.",
      "Log in to the Etica investor portal to view your balance and transaction history.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Lowest minimum investment in Kenya at KES 100. Excellent for beginners and small savers. Large AUM of KES 12.5B indicates strong investor confidence.",
  },
  {
    id: "lofty-corban",
    rank: 4,
    name: "Lofty Corban Money Market Fund",
    company: "Lofty Corban Investment Group",
    category: "independent",
    ear: "10.64%",
    netYield: "9.04%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 4.4B",
    website: "https://loftycorban.co.ke",
    portalUrl: "https://loftycorban.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@loftycorban.co.ke",
    openingSteps: [
      "Visit loftycorban.co.ke and navigate to the Money Market Fund page.",
      "Complete the online account opening form with your personal and financial details.",
      "Upload KYC documents as prompted.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access your investor dashboard to monitor returns and make additional contributions.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Fourth-highest yield in Kenya. Growing fund with KES 4.4B AUM.",
  },
  {
    id: "avrocap",
    rank: 5,
    name: "Avrocap Money Market Fund",
    company: "Avrocap",
    category: "independent",
    ear: "10.43%",
    netYield: "8.87%",
    minInvestment: "KES 3,000",
    mgmtFee: "2.00%",
    aum: "KES 550M",
    website: "https://avrocap.co.ke",
    portalUrl: "https://avrocap.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@avrocap.co.ke",
    openingSteps: [
      "Visit avrocap.co.ke and click 'Invest' or 'Open Account'.",
      "Complete the online registration form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Deposit the minimum KES 3,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Monitor your investment via the Avrocap investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Fifth-highest yield. Smaller fund (KES 550M AUM) — growing boutique asset manager.",
  },
  {
    id: "madison",
    rank: 6,
    name: "Madison Money Market Fund",
    company: "Madison Asset Management",
    category: "insurance",
    ear: "10.42%",
    netYield: "8.86%",
    minInvestment: "KES 5,000",
    mgmtFee: "0.00%",
    aum: "KES 6.3B",
    website: "https://madisonasset.co.ke",
    portalUrl: "https://madisonasset.co.ke",
    phone: "+254 719 048 000",
    email: "info@madisonasset.co.ke",
    openingSteps: [
      "Visit madisonasset.co.ke and navigate to the Money Market Fund section.",
      "Download the account opening form or apply online.",
      "Complete the form with your personal details, KRA PIN, and bank account information.",
      "Submit KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 5,000 via bank transfer or M-Pesa.",
      "Receive your account confirmation and log in to the Madison investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address (utility bill or bank statement)"],
    notes: "Notable for 0% management fee — one of only two funds with no management fee. Backed by Madison Insurance Group.",
  },
  {
    id: "faulu",
    rank: 7,
    name: "Faulu Money Market Fund",
    company: "Faulu Microfinance Bank",
    category: "bank",
    ear: "10.35%",
    netYield: "8.80%",
    minInvestment: "KES 1,000",
    mgmtFee: "1.50%",
    aum: "KES 305M",
    website: "https://faulukenya.com",
    portalUrl: "https://faulukenya.com/investments",
    phone: "+254 711 085 000",
    email: "info@faulukenya.com",
    openingSteps: [
      "Visit faulukenya.com or walk into any Faulu branch.",
      "Request the Money Market Fund application form from a customer service representative.",
      "Fill in your personal details, KRA PIN, and bank/M-Pesa details.",
      "Submit your KYC documents at the branch or upload them online.",
      "Make your initial deposit of KES 1,000 via Faulu M-Pesa or bank transfer.",
      "Receive your account activation confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Microfinance bank-backed fund. Lowest management fee among bank-backed funds at 1.50%. Good for Faulu existing customers.",
  },
  {
    id: "kuza",
    rank: 8,
    name: "Kuza Money Market Fund",
    company: "Kuza Asset Management",
    category: "independent",
    ear: "10.35%",
    netYield: "8.80%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 2.4B",
    website: "https://kuzaasset.com",
    portalUrl: "https://kuzaasset.com/invest",
    phone: "+254 700 000 000",
    email: "info@kuzaasset.com",
    openingSteps: [
      "Visit kuzaasset.com and click 'Open Account'.",
      "Complete the online application form with your personal and financial details.",
      "Upload your National ID and KRA PIN certificate.",
      "Deposit the minimum KES 5,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access the Kuza investor portal to manage your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Growing independent asset manager with KES 2.4B AUM.",
  },
  {
    id: "old-mutual",
    rank: 9,
    name: "Old Mutual Money Market Fund",
    company: "Old Mutual Investment Group",
    category: "insurance",
    ear: "10.13%",
    netYield: "8.61%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 24.3B",
    website: "https://oldmutual.co.ke",
    portalUrl: "https://oldmutual.co.ke/investments/money-market-fund",
    phone: "+254 722 206 914",
    email: "ke.clientservices@oldmutual.com",
    openingSteps: [
      "Visit oldmutual.co.ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Receive account confirmation within 1–3 business days and access the Old Mutual investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Large, established fund with KES 24.3B AUM. Part of the Old Mutual Group — one of Africa's largest financial services companies.",
  },
  {
    id: "jubilee",
    rank: 10,
    name: "Jubilee Money Market Fund",
    company: "Jubilee Financial Services",
    category: "insurance",
    ear: "10.05%",
    netYield: "8.54%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 11.6B",
    website: "https://jubileefinancialservices.com",
    portalUrl: "https://jubileefinancialservices.com/invest",
    phone: "+254 703 099 000",
    email: "info@jubileefinancialservices.com",
    openingSteps: [
      "Visit jubileefinancialservices.com and navigate to the Money Market Fund section.",
      "Complete the online application form or visit a Jubilee branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 5,000 via bank transfer or M-Pesa.",
      "Receive your account confirmation and access the Jubilee investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Backed by Jubilee Insurance — one of Kenya's largest insurance groups. KES 11.6B AUM reflects strong institutional backing.",
  },
  {
    id: "orient-kasha",
    rank: 11,
    name: "Orient Kasha Money Market Fund",
    company: "Orient Asset Managers",
    category: "independent",
    ear: "10.01%",
    netYield: "8.51%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 497M",
    website: "https://orientasset.co.ke",
    portalUrl: "https://orientasset.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@orientasset.co.ke",
    openingSteps: [
      "Visit orientasset.co.ke and navigate to the Kasha Money Market Fund page.",
      "Complete the online account opening form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access the Orient investor portal to monitor your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Boutique independent asset manager. Low minimum of KES 1,000.",
  },
  {
    id: "britam",
    rank: 12,
    name: "Britam Money Market Fund",
    company: "Britam Asset Managers",
    category: "insurance",
    ear: "9.72%",
    netYield: "8.26%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 14.8B",
    website: "https://britam.com",
    portalUrl: "https://britam.com/ke/investments/money-market-fund",
    mpesaPaybill: "220388",
    phone: "+254 703 094 000",
    email: "customerservice@britam.com",
    openingSteps: [
      "Visit britam.com/ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your full name, ID number, KRA PIN, and bank account details.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 1,000 via M-Pesa Paybill 220388 or bank transfer.",
      "Receive your account confirmation within 1–3 business days and access the Britam investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Large, well-established fund with KES 14.8B AUM. Britam is a leading pan-African financial services group. M-Pesa Paybill: 220388.",
  },
  {
    id: "apa",
    rank: 13,
    name: "Apollo Money Market Fund",
    company: "APA Life Assurance (Apollo)",
    category: "insurance",
    ear: "9.14%",
    netYield: "7.77%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 4.1B",
    website: "https://apalife.co.ke",
    portalUrl: "https://apalife.co.ke/investments",
    phone: "+254 703 095 000",
    email: "info@apalife.co.ke",
    openingSteps: [
      "Visit apalife.co.ke and navigate to the Apollo Money Market Fund section.",
      "Complete the online application form or visit an APA branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 1,000 via M-Pesa or bank transfer.",
      "Receive your account activation confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Backed by APA Insurance (Apollo Group). KES 4.1B AUM.",
  },
  {
    id: "dry-associates",
    rank: 14,
    name: "Dry Associates Money Market Fund",
    company: "Dry Associates Investment Bank",
    category: "independent",
    ear: "9.10%",
    netYield: "7.74%",
    minInvestment: "KES 1,000,000",
    mgmtFee: "2.00%",
    aum: "KES 4.1B",
    website: "https://dryassociates.com",
    portalUrl: "https://dryassociates.com/invest",
    phone: "+254 722 200 565",
    email: "info@dryassociates.com",
    openingSteps: [
      "Contact Dry Associates directly via phone (+254 722 200 565) or email (info@dryassociates.com) to initiate the account opening process.",
      "You will be assigned a relationship manager who will guide you through the application.",
      "Complete the account opening forms provided by your relationship manager.",
      "Submit certified copies of your National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum investment of KES 1,000,000 to the designated Dry Associates account.",
      "Receive your account confirmation and access your investment statement.",
    ],
    documents: ["National ID or Passport (certified copy)", "KRA PIN certificate", "Passport-size photo", "Bank statement (6 months)", "Source of funds declaration"],
    notes: "Highest minimum investment at KES 1,000,000 — designed for high-net-worth individuals. Boutique investment bank with personalised service.",
  },
  {
    id: "genafrica",
    rank: 15,
    name: "GenAfrica Money Market Fund",
    company: "GenAfrica Asset Managers",
    category: "independent",
    ear: "9.05%",
    netYield: "7.69%",
    minInvestment: "KES 500,000",
    mgmtFee: "2.00%",
    aum: "KES 4.9B",
    website: "https://genafrica.com",
    portalUrl: "https://genafrica.com/invest",
    phone: "+254 709 170 000",
    email: "info@genafrica.com",
    openingSteps: [
      "Visit genafrica.com and navigate to the Money Market Fund section.",
      "Complete the online application form or contact GenAfrica directly.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum KES 500,000 to the GenAfrica designated account.",
      "Receive your account confirmation and access the GenAfrica investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months)"],
    notes: "High minimum of KES 500,000. Institutional-grade fund manager with KES 4.9B AUM.",
  },
  {
    id: "kcb",
    rank: 16,
    name: "KCB Money Market Fund",
    company: "KCB Bank Kenya",
    category: "bank",
    ear: "9.03%",
    netYield: "7.68%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 17.7B",
    website: "https://kcbgroup.com",
    portalUrl: "https://kcbgroup.com/investments",
    mpesaPaybill: "522522",
    phone: "+254 711 087 000",
    email: "customercare@kcbgroup.com",
    openingSteps: [
      "Log in to the KCB mobile app or internet banking, or visit any KCB branch.",
      "Navigate to Investments → Money Market Fund and click 'Invest'.",
      "If you are an existing KCB customer, your KYC is already on file — simply accept the terms and invest.",
      "If new to KCB, open a KCB account first, then proceed with the MMF application.",
      "Make your initial deposit of KES 5,000 via KCB mobile app, internet banking, or M-Pesa Paybill 522522.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo (if new KCB customer)"],
    notes: "Seamless for existing KCB customers — no additional KYC required. KES 17.7B AUM. M-Pesa Paybill: 522522.",
  },
  {
    id: "genghis",
    rank: 17,
    name: "Hela Imara Money Market Fund",
    company: "Genghis Capital",
    category: "independent",
    ear: "8.92%",
    netYield: "7.58%",
    minInvestment: "KES 500",
    mgmtFee: "2.00%",
    aum: "KES 589M",
    website: "https://genghiscapital.co.ke",
    portalUrl: "https://genghiscapital.co.ke/invest",
    phone: "+254 719 028 000",
    email: "info@genghiscapital.co.ke",
    openingSteps: [
      "Visit genghiscapital.co.ke and navigate to the Hela Imara Money Market Fund.",
      "Click 'Open Account' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 500 via M-Pesa or bank transfer.",
      "Receive your account confirmation within 1–2 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Very low minimum of KES 500. Genghis Capital is a licensed stockbroker and investment bank.",
  },
  {
    id: "sanlam",
    rank: 18,
    name: "Sanlam Allianz Money Market Fund",
    company: "SanlamAllianz Kenya",
    category: "insurance",
    ear: "8.82%",
    netYield: "7.50%",
    minInvestment: "KES 2,500",
    mgmtFee: "2.00%",
    aum: "KES 114.2B",
    website: "https://sanlamallianz.co.ke",
    portalUrl: "https://sanlamallianz.co.ke",
    phone: "0800 723 456",
    email: "info@sanlamallianz.co.ke",
    openingSteps: [
      "Visit sanlamallianz.co.ke or call 0800 723 456 (toll-free) to request an application form.",
      "Complete the MMF application form with your full name, ID/Passport number, KRA PIN, physical address, and bank account details.",
      "Submit KYC documents: National ID (front & back), KRA PIN certificate, passport photo, and proof of address.",
      "Submit the completed form by email, at a SanlamAllianz branch, or via their online portal.",
      "Receive your account number and welcome letter within 1–3 business days.",
      "Make your first deposit of KES 2,500 via M-Pesa (Paybill in welcome letter) or bank transfer.",
      "Set up a monthly standing order to automate your contributions.",
    ],
    documents: ["National ID or Passport (front & back)", "KRA PIN certificate", "Passport-size photo", "Proof of address (utility bill or bank statement, max 3 months old)"],
    notes: "Largest MMF in Kenya by AUM at KES 114.2B. Toll-free customer care: 0800 723 456.",
  },
  {
    id: "cic",
    rank: 19,
    name: "CIC Money Market Fund",
    company: "CIC Asset Management",
    category: "insurance",
    ear: "8.43%",
    netYield: "7.17%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 78.9B",
    website: "https://cic.co.ke",
    portalUrl: "https://cic.co.ke/investments",
    mpesaPaybill: "510400",
    phone: "+254 703 099 120",
    email: "info@cic.co.ke",
    openingSteps: [
      "Visit cic.co.ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 5,000 via M-Pesa Paybill 510400 or bank transfer.",
      "Receive your account confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Second-largest MMF by AUM at KES 78.9B. Backed by CIC Insurance Group — a cooperative-linked insurer. M-Pesa Paybill: 510400.",
  },
  {
    id: "cpf",
    rank: 20,
    name: "CPF Money Market Fund",
    company: "CPF Financial Services",
    category: "independent",
    ear: "8.11%",
    netYield: "6.89%",
    minInvestment: "KES 1,000",
    mgmtFee: "3.00%",
    aum: "KES 3.3B",
    website: "https://cpffinancialservices.co.ke",
    portalUrl: "https://cpffinancialservices.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@cpffinancialservices.co.ke",
    openingSteps: [
      "Visit cpffinancialservices.co.ke and navigate to the Money Market Fund section.",
      "Complete the online application form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access your investor dashboard to track your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Highest management fee at 3.00% — factor this into your net yield calculations. KES 3.3B AUM.",
  },
  {
    id: "co-op",
    rank: 21,
    name: "Co-op Money Market Fund",
    company: "Co-operative Bank of Kenya",
    category: "bank",
    ear: "7.95%",
    netYield: "6.76%",
    minInvestment: "KES 500",
    mgmtFee: "0.90%",
    aum: "KES 21.6B",
    website: "https://co-opbank.co.ke",
    portalUrl: "https://co-opbank.co.ke/investments",
    mpesaPaybill: "400200",
    phone: "+254 703 027 000",
    email: "customercare@co-opbank.co.ke",
    openingSteps: [
      "Log in to the Co-op Bank mobile app or internet banking, or visit any Co-op Bank branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Co-op customer, your KYC is already on file.",
      "Accept the fund terms and conditions and enter your initial investment amount (minimum KES 500).",
      "Confirm the transaction via M-Pesa, Co-op mobile banking, or bank transfer.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Co-op customer)"],
    notes: "Lowest management fee among bank-backed funds at 0.90%. Very low minimum of KES 500. Seamless for existing Co-op Bank customers. M-Pesa Paybill: 400200.",
  },
  {
    id: "icea-lion",
    rank: 22,
    name: "ICEA Lion Money Market Fund",
    company: "ICEA Lion Asset Management",
    category: "insurance",
    ear: "7.62%",
    netYield: "6.48%",
    minInvestment: "KES 500",
    mgmtFee: "2.00%",
    aum: "KES 20.4B",
    website: "https://icealion.co.ke",
    portalUrl: "https://icealion.co.ke/investments",
    phone: "+254 722 208 450",
    email: "info@icealion.co.ke",
    openingSteps: [
      "Visit icealion.co.ke and navigate to Asset Management → Money Market Fund.",
      "Complete the online application form or visit an ICEA Lion branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 500 via M-Pesa or bank transfer.",
      "Receive your account confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Very low minimum of KES 500. Large fund with KES 20.4B AUM. ICEA Lion is a leading East African insurance and asset management group.",
  },
  {
    id: "safaricom",
    rank: 23,
    name: "Ziidi Money Market Fund",
    company: "Safaricom (M-Pesa)",
    category: "bank",
    ear: "6.85%",
    netYield: "5.82%",
    minInvestment: "KES 100",
    mgmtFee: "2.00%",
    aum: "KES 2.3B",
    website: "https://safaricom.co.ke/ziidi",
    portalUrl: "https://safaricom.co.ke/ziidi",
    mpesaPaybill: "M-Pesa app",
    phone: "*234#",
    email: "ziidi@safaricom.co.ke",
    openingSteps: [
      "Open the M-Pesa app on your Safaricom line and navigate to 'Ziidi' under the Invest section.",
      "Alternatively, dial *234# and select the Ziidi option.",
      "Accept the terms and conditions — your M-Pesa KYC is used automatically (no additional documents required).",
      "Enter the amount you wish to invest (minimum KES 100).",
      "Confirm the transaction with your M-Pesa PIN.",
      "Your investment is activated instantly and you can withdraw at any time via M-Pesa.",
    ],
    documents: ["Safaricom M-Pesa line (KYC already done via Safaricom)"],
    notes: "Easiest and fastest to open — no paperwork, fully in-app via M-Pesa. Lowest minimum at KES 100. Ideal for emergency fund or small savings. Instant withdrawals to M-Pesa.",
  },
  {
    id: "ncba",
    rank: 24,
    name: "NCBA Fixed Income Fund",
    company: "NCBA Bank Kenya",
    category: "bank",
    ear: "6.61%",
    netYield: "5.62%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 10.5B",
    website: "https://ncbagroup.com",
    portalUrl: "https://ncbagroup.com/investments",
    mpesaPaybill: "880100",
    phone: "+254 711 056 000",
    email: "customercare@ncbagroup.com",
    openingSteps: [
      "Log in to the NCBA mobile app or internet banking, or visit any NCBA branch.",
      "Navigate to Investments → Fixed Income Fund.",
      "If you are an existing NCBA customer, your KYC is already on file.",
      "Complete the fund application form and accept the terms.",
      "Make your initial deposit of KES 1,000 via NCBA mobile banking or M-Pesa Paybill 880100.",
      "Your investment is activated within 1 business day.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new NCBA customer)"],
    notes: "Note: This is a Fixed Income Fund, not a pure MMF — it may hold longer-duration bonds. Seamless for existing NCBA/Loop customers. M-Pesa Paybill: 880100.",
  },
  {
    id: "stanbic",
    rank: 25,
    name: "Stanbic Money Market Fund",
    company: "Stanbic Bank Kenya",
    category: "bank",
    ear: "5.20%",
    netYield: "4.42%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 2.3B",
    website: "https://stanbicbank.co.ke",
    portalUrl: "https://stanbicbank.co.ke/investments",
    phone: "+254 711 079 000",
    email: "customercare@stanbicbank.co.ke",
    openingSteps: [
      "Log in to the Stanbic mobile app or internet banking, or visit any Stanbic branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Stanbic customer, your KYC is already on file.",
      "Complete the fund application and accept the terms.",
      "Make your initial deposit of KES 1,000 via Stanbic mobile banking or bank transfer.",
      "Your investment is activated within 1–2 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Stanbic customer)"],
    notes: "Part of Standard Bank Group (South Africa). Lower yield relative to peers — consider higher-yielding alternatives unless you are an existing Stanbic customer.",
  },
  {
    id: "equity",
    rank: 26,
    name: "Equity Money Market Fund",
    company: "Equity Bank Kenya",
    category: "bank",
    ear: "5.14%",
    netYield: "4.37%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 1.5B",
    website: "https://equitybankgroup.com",
    portalUrl: "https://equitybankgroup.com/investments",
    mpesaPaybill: "247247",
    phone: "+254 763 000 000",
    email: "customercare@equitybank.co.ke",
    openingSteps: [
      "Log in to the Equity mobile app (Equity Mobile) or visit any Equity Bank branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Equity customer, your KYC is already on file.",
      "Accept the fund terms and enter your initial investment (minimum KES 1,000).",
      "Confirm the transaction via Equity Mobile or M-Pesa Paybill 247247.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Equity customer)"],
    notes: "Seamless for Equity Bank's large customer base. Lower yield — consider higher-yielding alternatives unless you are an existing Equity customer. M-Pesa Paybill: 247247.",
  },
  {
    id: "african-alliance",
    rank: 27,
    name: "African Alliance Money Market Fund",
    company: "African Alliance Kenya",
    category: "independent",
    ear: "3.91%",
    netYield: "3.32%",
    minInvestment: "KES 100,000",
    mgmtFee: "2.00%",
    aum: "—",
    website: "https://africanalliance.co.ke",
    portalUrl: "https://africanalliance.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@africanalliance.co.ke",
    openingSteps: [
      "Visit africanalliance.co.ke and navigate to the Money Market Fund section.",
      "Contact African Alliance directly to initiate the account opening process.",
      "Complete the application form with your personal details and KRA PIN.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum KES 100,000 to the African Alliance designated account.",
      "Receive your account confirmation and access your investment statement.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months)"],
    notes: "Lowest yield in Kenya at 3.91% EAR — significantly below the industry average of 8.98%. High minimum of KES 100,000. Consider higher-yielding alternatives.",
  },
];

const CATEGORY_LABELS: Record<FundCategory, string> = {
  independent: "Independent Asset Managers",
  insurance: "Insurance-Backed Funds",
  bank: "Bank-Backed Funds",
  sacco: "SACCO-Linked Funds",
};

const CATEGORY_ICONS: Record<FundCategory, React.ElementType> = {
  independent: TrendingUp,
  insurance: Shield,
  bank: Landmark,
  sacco: Users,
};

const CATEGORY_COLORS: Record<FundCategory, string> = {
  independent: "text-amber-400",
  insurance: "text-blue-400",
  bank: "text-emerald-400",
  sacco: "text-purple-400",
};

// ─── Convert DB row to local AccountState ────────────────────────────────────

function dbRowToState(row: { isOpened: boolean; accountNumber?: string | null; phoneNumber?: string | null; notes?: string | null; dateOpened?: string | null } | undefined): AccountState {
  if (!row) return { status: "not_started", details: {} };
  return {
    status: row.isOpened ? "opened" : "not_started",
    details: {
      accountNumber: row.accountNumber ?? undefined,
      phoneNumber: row.phoneNumber ?? undefined,
      notes: row.notes ?? undefined,
      openedDate: row.dateOpened ?? undefined,
    },
  };
}

// ─── Step Component ───────────────────────────────────────────────────────────

function Step({
  number, title, description, icon: Icon, detail, link, linkLabel, badge,
}: {
  number: number;
  title: string;
  description: string;
  icon: React.ElementType;
  detail?: string;
  link?: string;
  linkLabel?: string;
  badge?: string;
}) {
  return (
    <div className="flex gap-4 group">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0 text-primary font-bold text-sm">
          {number}
        </div>
        <div className="w-px flex-1 bg-border mt-2 min-h-[24px]" />
      </div>
      <div className="pb-6 flex-1">
        <div className="flex items-start gap-2 flex-wrap">
          <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
            {detail && (
              <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed italic">{detail}</p>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 mt-2 transition-colors"
              >
                {linkLabel ?? link}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Account Status Dialog ────────────────────────────────────────────────────

function AccountStatusDialog({
  open, onClose, accountType, state, onSave, isSaving,
}: {
  open: boolean;
  onClose: () => void;
  accountType: "mmf" | "dhow";
  state: AccountState;
  onSave: (newState: AccountState) => void;
  isSaving?: boolean;
}) {
  const isMmf = accountType === "mmf";
  const title = isMmf ? "MMF Account" : "CBK DhowCSD Account";

  const [status, setStatus] = useState<AccountStatus>(state.status);
  const [accountNumber, setAccountNumber] = useState(state.details.accountNumber ?? "");
  const [phoneNumber, setPhoneNumber] = useState(state.details.phoneNumber ?? "");
  const [openedDate, setOpenedDate] = useState(state.details.openedDate ?? "");
  const [notes, setNotes] = useState(state.details.notes ?? "");

  useEffect(() => {
    if (open) {
      setStatus(state.status);
      setAccountNumber(state.details.accountNumber ?? "");
      setPhoneNumber(state.details.phoneNumber ?? "");
      setOpenedDate(state.details.openedDate ?? "");
      setNotes(state.details.notes ?? "");
    }
  }, [open, state]);

  function handleSave() {
    onSave({
      status,
      details: {
        accountNumber: accountNumber.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        openedDate: openedDate || undefined,
        notes: notes.trim() || undefined,
      },
    });
    onClose();
    toast.success(`${title} status updated`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label className="text-xs font-medium">Account Status</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["not_started", "in_progress", "opened"] as AccountStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {s === "not_started" ? "Not Started" : s === "in_progress" ? "In Progress" : "Opened ✓"}
                </button>
              ))}
            </div>
          </div>

          {status === "opened" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isMmf ? "MMF Account / Reference Number" : "DhowCSD Account Number (CDS-XXXXXXXX)"}
                </Label>
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder={isMmf ? "e.g. MMF-123456" : "e.g. CDS-00123456"}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isMmf ? "Registered M-Pesa / Phone Number" : "Registered Phone Number"}
                </Label>
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 0712 345 678"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date Account Opened</Label>
                <Input
                  type="date"
                  value={openedDate}
                  onChange={(e) => setOpenedDate(e.target.value)}
                  className="text-sm"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Pending KYC verification, waiting for activation SMS..."
              className="text-sm min-h-[60px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save Status"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AccountStatus }) {
  if (status === "opened") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 rounded-full px-2.5 py-0.5">
        <CheckCircle2 className="w-3 h-3" /> Account Opened
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2.5 py-0.5">
        <Clock className="w-3 h-3" /> In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-2.5 py-0.5">
      <Circle className="w-3 h-3" /> Not Started
    </span>
  );
}

// ─── MMF Fund Card (accordion) ────────────────────────────────────────────────

function MmfFundCard({ fund }: { fund: MmfFundInfo }) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = CATEGORY_ICONS[fund.category];
  const categoryColor = CATEGORY_COLORS[fund.category];
  const isPrimary = fund.id === "sanlam";

  return (
    <div className={`rounded-lg border transition-all duration-200 ${
      expanded ? "border-primary/40 bg-card" : "border-border bg-card/50 hover:border-border/80"
    } ${isPrimary ? "ring-1 ring-primary/30" : ""}`}>
      {/* Header row */}
      <button
        className="w-full text-left p-4 flex items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Rank badge */}
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 ${
          fund.rank <= 5 ? "bg-amber-400/20 text-amber-400 border border-amber-400/40" : "bg-muted text-muted-foreground border border-border"
        }`}>
          {fund.rank}
        </div>

        {/* Fund info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground leading-snug">{fund.name}</span>
            {isPrimary && (
              <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30 border px-1.5 py-0">
                Your Plan Fund
              </Badge>
            )}
            {fund.rank <= 5 && !isPrimary && (
              <Badge className="text-[10px] bg-amber-400/10 text-amber-400 border-amber-400/30 border px-1.5 py-0">
                Top 5
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <CategoryIcon className={`w-3 h-3 ${categoryColor}`} />
            <span className="text-xs text-muted-foreground">{fund.company}</span>
          </div>
          {/* Key metrics row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs font-semibold text-emerald-400">{fund.ear} EAR</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Min {fund.minInvestment}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Fee {fund.mgmtFee}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">AUM {fund.aum}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-1 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
          {/* Notes callout */}
          {fund.notes && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Note: </strong>{fund.notes}
            </div>
          )}

          {/* Two-column layout for steps + documents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Opening steps */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                Account Opening Steps
              </p>
              <ol className="space-y-2">
                {fund.openingSteps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Documents + Contact */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-primary" />
                  Required Documents
                </p>
                <ul className="space-y-1">
                  {fund.documents.map((doc, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-primary" />
                  Contact & Links
                </p>
                <div className="space-y-1">
                  {fund.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="w-3 h-3 shrink-0" /> {fund.phone}
                    </p>
                  )}
                  {fund.email && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Globe className="w-3 h-3 shrink-0" /> {fund.email}
                    </p>
                  )}
                  {fund.mpesaPaybill && fund.mpesaPaybill !== "M-Pesa app" && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Smartphone className="w-3 h-3 shrink-0" /> M-Pesa Paybill: {fund.mpesaPaybill}
                    </p>
                  )}
                  <a
                    href={fund.portalUrl ?? fund.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mt-1"
                  >
                    Open Account Portal <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GettingStarted() {
  const { portfolioId, mode, setMode } = usePortfolio();
  const seedSample = trpc.testMode.seedSample.useMutation({
    onSuccess: () => toast.success("Sample data loaded in Test mode. Explore freely — your live data is untouched."),
    onError: (err) => toast.error(`Could not load sample data: ${err.message}`),
  });
  const { fundName, fundLabel, fundCompany } = useSelectedFund();
  const [openDialog, setOpenDialog] = useState<"mmf" | "dhow" | null>(null);

  // Match the portfolio's selected MMF to the catalog so the walkthrough uses
  // its real website / contacts / minimum, instead of a hardcoded provider.
  const selectedFundRecord = useMemo(() => {
    if (!fundName) return undefined;
    const q = fundName.toLowerCase();
    return (
      MMF_FUNDS.find((f) => f.name.toLowerCase() === q) ??
      MMF_FUNDS.find((f) => f.name.toLowerCase().includes(q) || q.includes(f.company.toLowerCase()))
    );
  }, [fundName]);
  const providerName = fundCompany && fundCompany !== "—" ? fundCompany : (selectedFundRecord?.company ?? fundName ?? "your MMF provider");
  const providerSite = selectedFundRecord?.website;
  const providerPortal = selectedFundRecord?.portalUrl ?? selectedFundRecord?.website;
  const providerPhone = selectedFundRecord?.phone;
  const providerEmail = selectedFundRecord?.email;
  const providerMin = selectedFundRecord?.minInvestment ?? "the fund minimum";

  // Whether the active portfolio actually holds government securities. If not
  // (MMF-only or very short horizon), we hide the CBK DhowCSD walkthrough.
  const { data: projection } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const usesGovSecurities = useMemo(
    () => !!projection?.some((r) => r.tbillEnd > 0 || r.ifbEnd > 0 || r.fxdEnd > 0),
    [projection]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FundCategory | "all">("all");
  const [activeTab, setActiveTab] = useState<"primary" | "all-mmfs">("primary");
  const utils = trpc.useUtils();

  // Load account statuses from database
  const { data: dbStatuses = [] } = trpc.accountStatus.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const upsertMutation = trpc.accountStatus.upsert.useMutation({
    onSuccess: () => {
      utils.accountStatus.list.invalidate();
      toast.success("Account status saved.");
      setOpenDialog(null);
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const mmfRow = dbStatuses.find((s) => s.accountType === "mmf");
  const dhowRow = dbStatuses.find((s) => s.accountType === "dhowcsd");
  const mmf = dbRowToState(mmfRow);
  const dhow = dbRowToState(dhowRow);

  function updateState(type: "mmf" | "dhow", newState: AccountState) {
    if (!portfolioId) return;
    const dbType = type === "dhow" ? "dhowcsd" : "mmf";
    upsertMutation.mutate({
      portfolioId,
      accountType: dbType,
      isOpened: newState.status === "opened",
      accountNumber: newState.details.accountNumber,
      phoneNumber: newState.details.phoneNumber,
      dateOpened: newState.details.openedDate,
      notes: newState.details.notes,
    });
  }

  // Filter funds
  const filteredFunds = useMemo(() => {
    let funds = MMF_FUNDS;
    if (activeCategory !== "all") {
      funds = funds.filter((f) => f.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      funds = funds.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.company.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
      );
    }
    return funds;
  }, [searchQuery, activeCategory]);

  const categories: Array<{ key: FundCategory | "all"; label: string; count: number }> = [
    { key: "all", label: "All Funds", count: MMF_FUNDS.length },
    { key: "independent", label: "Independent", count: MMF_FUNDS.filter((f) => f.category === "independent").length },
    { key: "insurance", label: "Insurance-Backed", count: MMF_FUNDS.filter((f) => f.category === "insurance").length },
    { key: "bank", label: "Bank-Backed", count: MMF_FUNDS.filter((f) => f.category === "bank").length },
  ];

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-8 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Getting Started
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-by-step guide to opening your investment accounts — your primary strategy accounts and all 27 CMA-regulated Kenyan MMFs.
          </p>
        </div>

        {/* Guided demo: sample data + first steps + glossary */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-3 border-primary/30 bg-primary/5">
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-2 mt-0.5"><Wand2 className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-sm font-semibold text-foreground">New here? Try it instantly with sample data</p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                    Load a realistic demo portfolio (two MMFs, a bank fixed deposit and government securities) into an isolated <span className="font-medium text-foreground">Test mode</span>. Your live data is never touched, and you can reset it anytime.
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0"
                disabled={seedSample.isPending}
                onClick={() => {
                  if (mode !== "sandbox") setMode("sandbox");
                  seedSample.mutate();
                }}
              >
                {seedSample.isPending ? "Loading sample…" : (<>Load sample data <ArrowRight className="ml-1 h-4 w-4" /></>)}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Your first 5 steps
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {FIRST_STEPS.map((s) => (
                <Link key={s.title} href={s.href}>
                  <div className="group h-full rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:border-primary/50 hover:bg-primary/5 cursor-pointer flex flex-col">
                    <s.icon className="h-4 w-4 text-primary mb-2" />
                    <p className="text-sm font-medium leading-snug">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex-1">{s.desc}</p>
                    <span className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1">
                      {s.cta} <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-amber-400" /> Terms glossary
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="text-xs">
                  <span className="font-semibold text-foreground">{g.term}.</span>{" "}
                  <span className="text-muted-foreground">{g.def}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setActiveTab("primary")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "primary"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Primary Strategy Accounts
          </button>
          <button
            onClick={() => setActiveTab("all-mmfs")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "all-mmfs"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All 27 MMFs Guide
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: Primary Strategy Accounts                                   */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "primary" && (
          <div className="space-y-8">
            {/* Account Status Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* MMF Card */}
              <Card className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${mmf.status === "opened" ? "bg-emerald-400" : mmf.status === "in_progress" ? "bg-amber-400" : "bg-muted"}`} />
                <CardContent className="p-4 pl-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Money Market Fund</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">{fundName || "Your Money Market Fund"}</p>
                      {mmf.status === "opened" && mmf.details.accountNumber && (
                        <p className="text-xs text-muted-foreground mt-1">Ref: {mmf.details.accountNumber}</p>
                      )}
                      {mmf.details.notes && mmf.status !== "opened" && (
                        <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-2">{mmf.details.notes}</p>
                      )}
                    </div>
                    <Building2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <StatusBadge status={mmf.status} />
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setOpenDialog("mmf")}>
                      Update <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* DhowCSD Card — only when the plan uses government securities */}
              {usesGovSecurities && (
              <Card className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${dhow.status === "opened" ? "bg-emerald-400" : dhow.status === "in_progress" ? "bg-amber-400" : "bg-muted"}`} />
                <CardContent className="p-4 pl-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">CBK Securities Platform</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">CBK DhowCSD</p>
                      {dhow.status === "opened" && dhow.details.accountNumber && (
                        <p className="text-xs text-muted-foreground mt-1">CDS: {dhow.details.accountNumber}</p>
                      )}
                      {dhow.details.notes && dhow.status !== "opened" && (
                        <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-2">{dhow.details.notes}</p>
                      )}
                    </div>
                    <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center justify-between mt-3">
                    <StatusBadge status={dhow.status} />
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setOpenDialog("dhow")}>
                      Update <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </div>

            {/* Estimated time */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                {usesGovSecurities ? (
                  <><strong className="text-foreground">Estimated time to open both accounts:</strong> {providerName} typically takes 1–3 business days after you submit your application. CBK DhowCSD takes 3–5 business days. You can start both processes simultaneously. Once both are open, you are ready to make your first investment contribution.</>
                ) : (
                  <><strong className="text-foreground">Estimated time to open your account:</strong> {providerName} typically takes 1–3 business days after you submit your application. Once it is open, you are ready to make your first investment contribution. This plan invests through your Money Market Fund only — no CBK securities account is required.</>
                )}
              </div>
            </div>

            {/* ── SECTION 1: Primary MMF ── */}
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {usesGovSecurities ? "Part 1 — " : ""}Open Your {fundName || "MMF"} Account
                  </h2>
                  <p className="text-xs text-muted-foreground">{usesGovSecurities ? "Your monthly contributions land here first before sweeping to government securities" : "Your monthly contributions are invested here"}</p>
                </div>
              </div>

              <div className="ml-4 border-l border-border pl-4">
                <Step number={1} icon={Globe} title={`Visit the ${providerName} website`} description={`Go to the ${providerName} website and navigate to the Money Market Fund section. You can also call their customer care line to request an application form.`} link={providerSite} linkLabel={providerSite ? providerSite.replace(/^https?:\/\//, "") : undefined} badge={providerSite ? "Online" : undefined} />
                <Step number={2} icon={FileText} title="Download and complete the MMF application form" description={`Fill in your personal details: full name, ID/passport number, KRA PIN, physical address, and bank account details (for redemptions). The form is available on the ${providerName} website or at any branch.`} detail="Tip: Your KRA PIN is mandatory. If you do not have one, register at itax.kra.go.ke before applying." />
                <Step number={3} icon={CreditCard} title="Prepare your KYC documents" description="You will need: (1) Copy of your National ID or Passport, (2) Copy of your KRA PIN certificate, (3) One passport-sized photo, (4) Proof of address (utility bill or bank statement not older than 3 months)." badge="Required" />
                <Step number={4} icon={FileText} title="Submit your application" description={`Submit the completed form and KYC documents by email, at a ${providerName} branch, or through their online portal. You will receive a confirmation email and your account number within 1–3 business days.`} link={providerSite} linkLabel={providerSite ? "Visit provider site" : undefined} />
                <Step number={5} icon={Smartphone} title="Make your first deposit via M-Pesa or bank transfer" description={`Once your account is activated, make your first contribution via M-Pesa (Paybill: check your welcome letter) or bank transfer. The minimum initial investment is ${providerMin}.`} detail="Your MMF starts earning interest from the day your deposit is received and confirmed. Interest accrues daily and is credited monthly." />
                <Step number={6} icon={Phone} title="Set up monthly standing order" description="Automate your monthly contributions by setting up a standing order from your bank or M-Pesa. This ensures you never miss a contribution and removes the discipline burden." detail="Recommended: set the standing order for the 1st of each month to align with your contribution schedule in this tracker." />
              </div>
            </div>

            {/* ── SECTION 2: CBK DhowCSD — only when the plan uses gov securities ── */}
            {usesGovSecurities && (
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Shield className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    Part 2 — Open Your CBK DhowCSD Account
                  </h2>
                  <p className="text-xs text-muted-foreground">The Central Bank of Kenya's platform for buying T-Bills, IFBs, and FXD bonds directly</p>
                </div>
              </div>

              <div className="ml-4 border-l border-border pl-4">
                <Step number={1} icon={Globe} title="Visit the CBK DhowCSD portal" description="Go to dhowcsd.centralbank.go.ke — the Central Bank of Kenya's Central Securities Depository platform. This is where you will buy and hold all your government securities (T-Bills, IFBs, and FXD bonds)." link="https://dhowcsd.centralbank.go.ke" linkLabel="dhowcsd.centralbank.go.ke" badge="Online" />
                <Step number={2} icon={FileText} title="Register for a DhowCSD account" description="Click 'Register' and fill in your personal details: full name, National ID number, KRA PIN, date of birth, phone number, and email address. You will also need to provide your bank account details for settlement." detail="Important: Use the exact name as it appears on your National ID. Mismatches will cause your application to be rejected." />
                <Step number={3} icon={CreditCard} title="Complete identity verification (KYC)" description="Upload clear scans of: (1) Your National ID (front and back), (2) Your KRA PIN certificate, (3) A selfie or passport photo. CBK will verify your identity against IPRS (Integrated Population Registration System)." badge="Required" />
                <Step number={4} icon={Building2} title="Link your bank account for settlement" description="Add your bank account (must be in your name) for receiving coupon payments and maturity proceeds. CBK supports all major Kenyan banks. Ensure your bank account name matches your ID exactly." detail="You can link an M-Pesa account as well, but a bank account is recommended for larger settlement amounts." />
                <Step number={5} icon={Shield} title="Wait for account activation (3–5 business days)" description="CBK will review your application and send you an activation email with your CDS account number (format: CDS-XXXXXXXX). Keep this number safe — you will need it for all future transactions." detail="If you do not receive your activation email within 5 business days, call CBK on 0709 081 000 or email dhowcsd@centralbank.go.ke." />
                <Step number={6} icon={Smartphone} title="Place your first T-Bill bid" description="Once activated, log in to DhowCSD and navigate to 'Primary Market'. Select the T-Bill tenor you want (91-day, 182-day, or 364-day) and enter your bid amount (minimum KES 50,000 face value). Bids are accepted every Monday for Tuesday auctions." detail="For your first purchase, use the 91-day T-Bill to get comfortable with the process. The minimum competitive bid is KES 50,000 face value." badge="First purchase" />
                <Step number={7} icon={BookOpen} title="Log your purchase in the CBK Securities Register" description="After your bid is accepted, go to the CBK Securities page in this tracker and log your purchase with the face value, issue date, maturity date, and coupon rate. The tracker will automatically calculate your next coupon date and maturity event." />
              </div>
            </div>
            )}

            {/* Key contacts */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Phone className="w-4 h-4 text-primary" />
                  Key Contacts
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">{providerName}</p>
                    {providerPhone && <p className="text-muted-foreground">Phone: {providerPhone}</p>}
                    {providerEmail && <p className="text-muted-foreground">Email: {providerEmail}</p>}
                    {providerSite && (
                      <a href={providerSite} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                        {providerSite.replace(/^https?:\/\//, "")} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!providerPhone && !providerEmail && !providerSite && (
                      <p className="text-muted-foreground">Contact details are available on your fund's welcome letter.</p>
                    )}
                  </div>
                  {usesGovSecurities && (
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">CBK DhowCSD Support</p>
                    <p className="text-muted-foreground">Phone: 0709 081 000</p>
                    <p className="text-muted-foreground">Email: dhowcsd@centralbank.go.ke</p>
                    <a href="https://dhowcsd.centralbank.go.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                      dhowcsd.centralbank.go.ke <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: All 27 MMFs Guide                                           */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "all-mmfs" && (
          <div className="space-y-6">
            {/* Intro */}
            <div className="bg-muted/40 border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                <strong className="text-foreground">27 CMA-regulated Money Market Funds</strong> are tracked below, ranked by Effective Annual Rate (EAR) as of June 2026 (source: Serrari Group). Each entry includes account-opening steps, required documents, minimum investment, and contact details.
              </p>
              <p>
                Rates change frequently — always verify the current EAR on{" "}
                <a href="https://serrarigroup.com/ke/mmf/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5">
                  Serrari Group <ExternalLink className="w-3 h-3" />
                </a>{" "}
                before opening an account. All funds require a KRA PIN — register at{" "}
                <a href="https://itax.kra.go.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5">
                  itax.kra.go.ke <ExternalLink className="w-3 h-3" />
                </a>{" "}
                if you do not have one.
              </p>
            </div>

            {/* Category summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["independent", "insurance", "bank"] as FundCategory[]).map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                const color = CATEGORY_COLORS[cat];
                const count = MMF_FUNDS.filter((f) => f.category === cat).length;
                const topEar = Math.max(...MMF_FUNDS.filter((f) => f.category === cat).map((f) => parseFloat(f.ear)));
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      activeCategory === cat
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card/50 hover:border-border/80"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${color} mb-1.5`} />
                    <p className="text-xs font-semibold text-foreground">{CATEGORY_LABELS[cat]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{count} funds · up to {topEar.toFixed(2)}%</p>
                  </button>
                );
              })}
              <button
                onClick={() => setActiveCategory("all")}
                className={`rounded-lg border p-3 text-left transition-all ${
                  activeCategory === "all"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card/50 hover:border-border/80"
                }`}
              >
                <Star className="w-4 h-4 text-amber-400 mb-1.5" />
                <p className="text-xs font-semibold text-foreground">All Funds</p>
                <p className="text-xs text-muted-foreground mt-0.5">27 funds · avg 8.98%</p>
              </button>
            </div>

            {/* Search + filter bar */}
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by fund name or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              {(searchQuery || activeCategory !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => { setSearchQuery(""); setActiveCategory("all"); }}
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Results count */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {filteredFunds.length === MMF_FUNDS.length
                  ? `Showing all ${MMF_FUNDS.length} funds`
                  : `Showing ${filteredFunds.length} of ${MMF_FUNDS.length} funds`}
                {activeCategory !== "all" && ` · ${CATEGORY_LABELS[activeCategory as FundCategory]}`}
              </p>
              <a
                href="https://serrarigroup.com/ke/mmf/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              >
                Live rates on Serrari <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Fund accordion list */}
            <div className="space-y-2">
              {filteredFunds.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No funds match your search. Try a different name or company.
                </div>
              ) : (
                filteredFunds.map((fund) => (
                  <MmfFundCard key={fund.id} fund={fund} />
                ))
              )}
            </div>

            {/* Disclaimer */}
            <div className="bg-muted/30 border border-border/50 rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Disclaimer:</strong> The account-opening steps, contact details, and minimum investment figures above are based on publicly available information as of June 2026. Fund details change — always verify directly with the fund manager before investing. This is not financial advice. All investments carry risk and past performance does not guarantee future returns. All funds listed are regulated by the Capital Markets Authority (CMA) of Kenya.
            </div>
          </div>
        )}
      </div>

      {/* Account Status Dialogs */}
      <AccountStatusDialog
        open={openDialog === "mmf"}
        onClose={() => setOpenDialog(null)}
        accountType="mmf"
        state={mmf}
        onSave={(s) => updateState("mmf", s)}
      />
      <AccountStatusDialog
        open={openDialog === "dhow"}
        onClose={() => setOpenDialog(null)}
        accountType="dhow"
        state={dhow}
        onSave={(s) => updateState("dhow", s)}
      />
    </AppShell>
  );
}
```

### `client/src/pages/Home.tsx`

```tsx
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { getLoginUrl } from "@/const";
import { Streamdown } from 'streamdown';

/**
 * All content in this page are only for example, replace with your own feature implementation
 * When building pages, remember your instructions in Frontend Workflow, Frontend Best Practices, Design Guide and Common Pitfalls
 */
export default function Home() {
  // The userAuth hooks provides authentication state
  // To implement login/logout functionality, simply call logout() or redirect to getLoginUrl()
  let { user, loading, error, isAuthenticated, logout } = useAuth();

  // If theme is switchable in App.tsx, we can implement theme toggling like this:
  // const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen flex flex-col">
      <main>
        {/* Example: lucide-react for icons */}
        <Loader2 className="animate-spin" />
        Example Page
        {/* Example: Streamdown for markdown rendering */}
        <Streamdown>Any **markdown** content</Streamdown>
        <Button variant="default">Example Button</Button>
      </main>
    </div>
  );
}
```

### `client/src/pages/Ledger.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, getMonthLabel, getPhaseName, getPhaseColorClass } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BookOpen, RefreshCw, Search } from "lucide-react";
import { useState, useMemo } from "react";
import { toast } from "sonner";

export default function Ledger() {
  const { portfolioId, portfolio } = usePortfolio();
  const { data: projection, isLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const syncMutation = trpc.ledger.sync.useMutation({
    onSuccess: () => toast.success("Ledger synced with latest projection"),
    onError: () => toast.error("Failed to sync ledger"),
  });
  const handleSync = () => { if (portfolioId) syncMutation.mutate({ portfolioId }); };

  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 24;

  const filtered = useMemo(() => {
    if (!projection) return [];
    if (!search) return projection;
    const q = search.toLowerCase();
    return projection.filter(
      (r) =>
        String(r.monthNumber).includes(q) ||
        r.mainAction?.toLowerCase().includes(q) ||
        r.phase.toLowerCase().includes(q)
    );
  }, [projection, search]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paged = filtered.slice((page - 1) * pageSize, page * pageSize);

  const startDate = portfolio?.startDate ? String(portfolio.startDate).split("T")[0] : "2026-07-01";

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              Month-by-Month Ledger
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Complete 120-month projection of your investment journey
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncMutation.isPending}
            className="gap-2"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
            Sync
          </Button>
        </div>

        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-3">
              <BookOpen className="w-4 h-4 text-primary" />
              <CardTitle className="text-sm font-semibold">Transaction Ledger</CardTitle>
              <div className="ml-auto flex items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    className="pl-8 h-8 text-xs w-48"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Mth</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Date</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Save</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">CBK In</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">MMF→Dhow</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium">Main Action</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">MMF End</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">T-Bill</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">IFB</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">FXD</th>
                    <th className="text-right px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Total</th>
                    <th className="text-left px-4 py-3 text-muted-foreground font-medium whitespace-nowrap">Phase</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 10 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/50">
                          {Array.from({ length: 12 }).map((_, j) => (
                            <td key={j} className="px-4 py-3">
                              <Skeleton className="h-3 w-full" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : paged.map((r) => (
                        <tr
                          key={r.monthNumber}
                          className="border-b border-border/40 hover:bg-muted/20 transition-colors"
                        >
                          <td className="px-4 py-2.5 font-semibold text-foreground">{r.monthNumber}</td>
                          <td className="px-4 py-2.5 text-muted-foreground whitespace-nowrap">
                            {getMonthLabel(startDate, r.monthNumber)}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-foreground">
                            {r.contribution > 0 ? formatKES(r.contribution) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.cbkCashIn > 0 ? (
                              <span className="status-on-track font-medium">{formatKES(r.cbkCashIn)}</span>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount">
                            {r.mmfToDhow > 0 ? (
                              <span className="text-primary font-medium">{formatKES(r.mmfToDhow)}</span>
                            ) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-muted-foreground max-w-xs truncate" title={r.mainAction}>
                            {r.mainAction}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-foreground font-medium">
                            {formatKES(r.mmfEnd)}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.tbillEnd > 0 ? formatKES(r.tbillEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.ifbEnd > 0 ? formatKES(r.ifbEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                            {r.fxdEnd > 0 ? formatKES(r.fxdEnd) : "–"}
                          </td>
                          <td className="px-4 py-2.5 text-right kes-amount font-bold text-foreground">
                            {formatKES(r.totalEnd)}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge
                              variant="outline"
                              className={`text-xs px-2 py-0.5 border ${getPhaseColorClass(r.phase)}`}
                            >
                              {getPhaseName(r.phase).split(" ")[0]}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length} months
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}>
                    Next
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```

### `client/src/pages/MmfAccrual.tsx`

```tsx
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CalendarClock,
  Coins,
  Percent,
  TrendingUp,
  Info,
  Receipt,
  Layers,
} from "lucide-react";
import { simulateAccrual, type DayRow } from "@shared/accrual";

/** Format a number as KES currency. */
function kes(n: number, dp = 2): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

/** A single MMF account to simulate — either the primary fund or a tracked secondary account. */
interface AccrualAccount {
  /** Stable selector key. */
  key: string;
  /** Display name shown in the selector and summaries. */
  name: string;
  /** Fund record id (mmfFunds.id), used to read accrual settings. */
  fundId: number | null;
  /** Starting balance for this account (KES). */
  balance: number;
  /** Net yield (EAR) for this account's fund. */
  ear: number;
  /** Day-count basis (360 / 365). */
  dayCount: number;
  /** Crediting frequency. */
  crediting: "daily" | "monthly";
  /** Withholding tax rate (%). */
  whtRate: number;
}

export default function MmfAccrual() {
  const { portfolioId } = usePortfolio();
  const fund = useSelectedFund();

  // Full fund catalogue (for per-fund accrual settings: day-count, crediting, WHT).
  const { data: funds } = trpc.mmfFunds.list.useQuery(undefined, { enabled: true });
  const fundRecord = useMemo(
    () => funds?.find((f) => f.id === fund.fundId) ?? null,
    [funds, fund.fundId]
  );

  // Tracked secondary MMF accounts for this portfolio.
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  // Current MMF deposits → suggested primary starting balance.
  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Primary-MMF balance = primary-MMF deposit rows only. Bank-instrument and
  // secondary-MMF deposits also carry bucket "mmf" but belong to their own
  // accounts (each secondary is simulated separately below), and government
  // securities live in the register, so all of those are excluded here.
  const secondaryFundIds = useMemo(
    () => new Set((secondaryMmfs ?? []).map((s) => s.mmfFundId).filter((id): id is number => typeof id === "number")),
    [secondaryMmfs]
  );
  const mmfBalance = useMemo(() => {
    if (!deposits) return 0;
    return deposits
      .filter((d) => {
        if (d.bucket !== "mmf") return false;
        const inst = (d as { institutionType?: string | null }).institutionType;
        if (inst === "bank_instrument" || inst === "government_security") return false;
        const fundId = (d as { mmfFundId?: number | null }).mmfFundId;
        if (inst === "mmf_fund" && fundId != null && secondaryFundIds.has(fundId)) return false;
        return true;
      })
      .reduce((s, d) => s + Number(d.amount), 0);
  }, [deposits, secondaryFundIds]);

  // Primary fund accrual settings (fall back to sane defaults).
  const primaryDayCount = (fundRecord?.dayCountBasis as number) ?? 365;
  const primaryCrediting = (fundRecord?.creditingFrequency as "daily" | "monthly") ?? "daily";
  const primaryWht = fundRecord ? Number(fundRecord.whtRate) : 15;

  // Build the list of selectable accounts: Primary first, then each secondary.
  const accounts = useMemo<AccrualAccount[]>(() => {
    const list: AccrualAccount[] = [
      {
        key: "primary",
        name: `${fund.fundName} (primary)`,
        fundId: fund.fundId ?? null,
        balance: mmfBalance,
        ear: fund.fundEar,
        dayCount: primaryDayCount,
        crediting: primaryCrediting,
        whtRate: primaryWht,
      },
    ];
    for (const s of secondaryMmfs) {
      const rec = funds?.find((f) => f.id === s.mmfFundId);
      list.push({
        key: `secondary-${s.id}`,
        name: s.label?.trim() ? `${s.label} (${s.fundName})` : s.fundName,
        fundId: s.mmfFundId,
        balance: s.currentBalance,
        ear: s.ear,
        dayCount: (rec?.dayCountBasis as number) ?? 365,
        crediting: (rec?.creditingFrequency as "daily" | "monthly") ?? "daily",
        whtRate: rec ? Number(rec.whtRate) : 15,
      });
    }
    return list;
  }, [fund.fundName, fund.fundId, fund.fundEar, mmfBalance, primaryDayCount, primaryCrediting, primaryWht, secondaryMmfs, funds]);

  const hasSecondary = secondaryMmfs.length > 0;

  // Selection: "primary", "secondary-<id>", or "blended".
  const [selection, setSelection] = useState<string>("primary");
  const [horizon, setHorizon] = useState<string>("30");
  // Per-account principal override (keyed by account key). Empty = use account's own balance.
  const [principal, setPrincipal] = useState<string>("");

  const days = Math.max(1, Math.min(366, Number(horizon) || 30));
  const isBlended = selection === "blended";

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.key === selection) ?? accounts[0],
    [accounts, selection]
  );

  // Reset the principal override whenever the user changes which account is selected.
  // (Kept simple: clearing on change avoids stale per-account overrides.)
  const effectivePrincipal =
    !isBlended && principal !== ""
      ? Math.max(0, Number(principal) || 0)
      : (selectedAccount?.balance ?? 0);

  // Run the (untouched) per-fund accrual engine for each account in scope.
  const perAccountRows = useMemo(() => {
    const scope = isBlended ? accounts : selectedAccount ? [selectedAccount] : [];
    return scope.map((acc) => {
      const startBal =
        !isBlended && principal !== "" ? Math.max(0, Number(principal) || 0) : acc.balance;
      const rows = simulateAccrual(startBal, acc.ear, acc.dayCount, acc.whtRate, acc.crediting, days);
      const gross = rows.reduce((s, r) => s + r.grossInterest, 0);
      const wht = rows.reduce((s, r) => s + r.wht, 0);
      const net = rows.reduce((s, r) => s + r.netInterest, 0);
      const closing = rows.length ? rows[rows.length - 1].closingBalance : startBal;
      return { account: acc, startBal, rows, gross, wht, net, closing };
    });
  }, [isBlended, accounts, selectedAccount, principal, days]);

  // Blended daily rows = element-wise sum across accounts (same day index).
  const blendedRows = useMemo<DayRow[]>(() => {
    if (!isBlended) return perAccountRows[0]?.rows ?? [];
    const out: DayRow[] = [];
    for (let i = 0; i < days; i++) {
      let opening = 0, gross = 0, wht = 0, net = 0, closing = 0;
      for (const pa of perAccountRows) {
        const r = pa.rows[i];
        if (!r) continue;
        opening += r.openingBalance;
        gross += r.grossInterest;
        wht += r.wht;
        net += r.netInterest;
        closing += r.closingBalance;
      }
      out.push({ day: i + 1, openingBalance: opening, grossInterest: gross, wht, netInterest: net, closingBalance: closing });
    }
    return out;
  }, [isBlended, perAccountRows, days]);

  const rows = isBlended ? blendedRows : perAccountRows[0]?.rows ?? [];
  const totalGross = rows.reduce((s, r) => s + r.grossInterest, 0);
  const totalWht = rows.reduce((s, r) => s + r.wht, 0);
  const totalNet = rows.reduce((s, r) => s + r.netInterest, 0);
  const startingTotal = isBlended
    ? accounts.reduce((s, a) => s + a.balance, 0)
    : effectivePrincipal;
  const finalBalance = rows.length ? rows[rows.length - 1].closingBalance : startingTotal;

  // "If you withdrew today" — one full day across the active scope.
  const oneDayGross = isBlended
    ? perAccountRows.reduce((s, pa) => s + pa.startBal * (pa.account.ear / 100 / pa.account.dayCount), 0)
    : effectivePrincipal * ((selectedAccount?.ear ?? 0) / 100 / (selectedAccount?.dayCount ?? 365));
  const oneDayWht = isBlended
    ? perAccountRows.reduce((s, pa) => s + pa.startBal * (pa.account.ear / 100 / pa.account.dayCount) * (pa.account.whtRate / 100), 0)
    : oneDayGross * ((selectedAccount?.whtRate ?? 15) / 100);
  const oneDayNet = oneDayGross - oneDayWht;

  // Blended weighted-average net yield, for display.
  const blendedEar = useMemo(() => {
    const totalBal = accounts.reduce((s, a) => s + a.balance, 0);
    if (totalBal <= 0) return accounts.length ? accounts.reduce((s, a) => s + a.ear, 0) / accounts.length : 0;
    return accounts.reduce((s, a) => s + a.ear * a.balance, 0) / totalBal;
  }, [accounts]);

  const headerEar = isBlended ? blendedEar : selectedAccount?.ear ?? 0;
  const headerDayCount = isBlended ? null : selectedAccount?.dayCount ?? 365;
  const headerCrediting = isBlended ? null : selectedAccount?.crediting ?? "daily";
  const headerWht = isBlended ? null : selectedAccount?.whtRate ?? 15;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CalendarClock className="w-5 h-5 text-primary" />
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
              Daily MMF Accrual Ledger
            </h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-3xl">
            Money market funds accrue interest <strong>every day</strong> and quote a net yield after
            the manager's fee. This ledger shows how interest builds day by day, how much withholding
            tax (WHT) is deducted, and what you would actually receive if you withdrew.
            {hasSecondary ? (
              <> You can view a single MMF account or a <strong>blended view</strong> across all the funds you track.</>
            ) : null}
          </p>
        </div>

        {/* Account selector */}
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="py-4 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="space-y-1.5 flex-1 min-w-0">
                <Label>MMF Account</Label>
                <Select value={selection} onValueChange={(v) => { setSelection(v); setPrincipal(""); }}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.key} value={a.key}>
                        {a.name}
                      </SelectItem>
                    ))}
                    {hasSecondary && (
                      <SelectItem value="blended">Blended — all MMF accounts</SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {!fund.hasFund && (
                  <p className="text-xs text-amber-500">
                    No primary fund selected — using fallback rate. Pick one on MMF Funds.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-muted-foreground">{isBlended ? "Accounts" : "Fund"}</p>
                <p className="font-semibold text-sm flex items-center gap-1">
                  {isBlended && <Layers className="w-3 h-3 text-primary" />}
                  {isBlended ? `${accounts.length} MMF account${accounts.length > 1 ? "s" : ""}` : selectedAccount?.name}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{isBlended ? "Weighted Net Yield" : "Net Yield (EAR)"}</p>
                <p className="font-semibold text-sm flex items-center gap-1">
                  <Percent className="w-3 h-3 text-primary" />
                  {headerEar.toFixed(2)}% p.a.
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Day-Count Basis</p>
                <p className="font-semibold text-sm">{headerDayCount ? `Actual / ${headerDayCount}` : "Per fund"}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Crediting</p>
                <p className="font-semibold text-sm capitalize">{headerCrediting ?? "Per fund"}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Inputs */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accrual Inputs</CardTitle>
            <CardDescription>
              {isBlended
                ? "Blended view uses each account's tracked balance and its own fund's yield/WHT. Adjust per-account balances on MMF Funds."
                : "Defaults to this account's tracked balance. Adjust to model any amount or horizon. All figures are deterministic — no forecasts."}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="principal">Starting Balance (KES)</Label>
              <Input
                id="principal"
                type="number"
                inputMode="decimal"
                disabled={isBlended}
                placeholder={selectedAccount?.balance ? String(selectedAccount.balance) : "e.g. 100000"}
                value={isBlended ? String(startingTotal) : principal}
                onChange={(e) => setPrincipal(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {isBlended
                  ? `Sum of all tracked MMF balances: ${kes(startingTotal)}`
                  : principal === "" && (selectedAccount?.balance ?? 0) > 0
                    ? `Using this account's tracked balance: ${kes(selectedAccount?.balance ?? 0)}`
                    : "Enter the amount currently in the fund."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="horizon">Days to Project</Label>
              <Select value={horizon} onValueChange={setHorizon}>
                <SelectTrigger id="horizon">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="7">7 days (1 week)</SelectItem>
                  <SelectItem value="30">30 days (1 month)</SelectItem>
                  <SelectItem value="90">90 days (1 quarter)</SelectItem>
                  <SelectItem value="180">180 days (6 months)</SelectItem>
                  <SelectItem value="365">365 days (1 year)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Withholding Tax Rate</Label>
              <div className="h-9 flex items-center px-3 rounded-md border border-input bg-muted/30 text-sm">
                {headerWht !== null ? `${headerWht.toFixed(2)}% (final tax on interest)` : "Per fund (see breakdown)"}
              </div>
              <p className="text-xs text-muted-foreground">
                Editable per-fund on MMF Funds → fund settings.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Coins className="w-3.5 h-3.5" /> Gross Interest ({days}d)
              </div>
              <p className="text-xl font-bold">{kes(totalGross)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Receipt className="w-3.5 h-3.5" /> WHT Deducted
              </div>
              <p className="text-xl font-bold text-red-500">−{kes(totalWht)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <TrendingUp className="w-3.5 h-3.5" /> Net Interest
              </div>
              <p className="text-xl font-bold text-primary">{kes(totalNet)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                <Coins className="w-3.5 h-3.5" /> Balance After {days}d
              </div>
              <p className="text-xl font-bold">{kes(finalBalance)}</p>
            </CardContent>
          </Card>
        </div>

        {/* Per-account breakdown (blended only) */}
        {isBlended && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Layers className="w-4 h-4 text-primary" /> Per-Account Contribution ({days}d)
              </CardTitle>
              <CardDescription>
                Each fund accrues on its own yield, day-count, and WHT rate. The blended totals above are the sum of these rows.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Account</TableHead>
                      <TableHead className="text-right">Net Yield</TableHead>
                      <TableHead className="text-right">Starting Balance</TableHead>
                      <TableHead className="text-right">Gross</TableHead>
                      <TableHead className="text-right">WHT</TableHead>
                      <TableHead className="text-right">Net</TableHead>
                      <TableHead className="text-right">Closing</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {perAccountRows.map((pa) => (
                      <TableRow key={pa.account.key}>
                        <TableCell className="font-medium">{pa.account.name}</TableCell>
                        <TableCell className="text-right tabular-nums">{pa.account.ear.toFixed(2)}%</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(pa.startBal)}</TableCell>
                        <TableCell className="text-right tabular-nums">{kes(pa.gross)}</TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">−{kes(pa.wht)}</TableCell>
                        <TableCell className="text-right tabular-nums text-primary">{kes(pa.net)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">{kes(pa.closing)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Withdraw today readout */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Info className="w-4 h-4 text-primary" /> If you withdrew today
            </CardTitle>
            <CardDescription>
              One full day of accrual on {kes(startingTotal)}{isBlended ? " across all MMF accounts" : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">Gross / day</span>
                <span className="font-semibold">{kes(oneDayGross, 4)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                <span className="text-muted-foreground">WHT / day</span>
                <span className="font-semibold text-red-500">−{kes(oneDayWht, 4)}</span>
              </div>
              <div className="flex items-center justify-between rounded-md bg-primary/10 px-3 py-2">
                <span className="text-muted-foreground">Net / day</span>
                <span className="font-semibold text-primary">{kes(oneDayNet, 4)}</span>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-3">
              Most Kenyan MMFs allow withdrawal within 1–3 business days and you keep all net interest
              accrued up to the withdrawal date. There is no penalty for withdrawing — unlike a fixed deposit.
            </p>
          </CardContent>
        </Card>

        {/* Daily breakdown table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Day-by-Day Breakdown{isBlended ? " (blended)" : ""}</CardTitle>
            <CardDescription>
              {isBlended
                ? "Each day shows the combined opening, gross, WHT, net, and closing across all MMF accounts."
                : (headerCrediting === "daily"
                  ? "Net interest is added to the balance each day, so tomorrow's interest is calculated on a slightly larger balance (daily compounding)."
                  : "Interest accrues daily on the period's opening balance and is credited (compounded) every 30 days.")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border overflow-x-auto max-h-[480px] overflow-y-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-16">Day</TableHead>
                    <TableHead className="text-right">Opening</TableHead>
                    <TableHead className="text-right">Gross</TableHead>
                    <TableHead className="text-right">WHT</TableHead>
                    <TableHead className="text-right">Net</TableHead>
                    <TableHead className="text-right">Closing</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.day}>
                      <TableCell className="font-medium">{r.day}</TableCell>
                      <TableCell className="text-right tabular-nums">{kes(r.openingBalance)}</TableCell>
                      <TableCell className="text-right tabular-nums">{kes(r.grossInterest, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-red-500">−{kes(r.wht, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums text-primary">{kes(r.netInterest, 4)}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{kes(r.closingBalance)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Tax explainer */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Receipt className="w-4 h-4 text-primary" /> How MMF interest is taxed in Kenya
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              Interest earned on a money market fund is subject to a{" "}
              <strong className="text-foreground">withholding tax</strong> (commonly 15%), which the
              fund manager deducts at source before crediting your account. For most individuals this
              is a <strong className="text-foreground">final tax</strong> — you do not pay any further
              income tax on it and it does not need to be declared as additional taxable income.
            </p>
            <p>
              The yield (EAR) quoted by the fund is typically the{" "}
              <strong className="text-foreground">net-of-fee</strong> figure but{" "}
              <strong className="text-foreground">before</strong> withholding tax. That is why the
              "Net Interest" you actually keep in the table above is lower than a naive balance × yield
              calculation.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              <Badge variant="secondary">15% WHT — final tax on interest</Badge>
              <Badge variant="secondary">No early-withdrawal penalty</Badge>
              <Badge variant="secondary">Daily accrual</Badge>
            </div>
            <p className="text-xs pt-2">
              Source: PwC Worldwide Tax Summaries (Kenya), withholding tax on "interest — other" = 15%.
              Rates are user-editable; confirm current rules with KRA or a tax adviser. This tool is for
              tracking and education, not tax advice.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```

### `client/src/pages/MmfFunds.tsx`

```tsx
import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { ArrowUpDown, ArrowUp, ArrowDown, Search, Plus, Pencil, Trash2, CheckCircle2, Circle, Info, PlusCircle, X, Star } from "lucide-react";
import { formatKES } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

type Fund = {
  id: number;
  fundName: string;
  company: string;
  grossYield: number;
  ear: number;
  managementFee: number;
  minInvestment: number;
  aumMillions: number | null;
  asOfDate: string | null;
  source: string | null;
  isActive: boolean;
};

type SortKey = "fundName" | "ear" | "grossYield" | "managementFee" | "minInvestment" | "aumMillions";
type SortDir = "asc" | "desc";

const INDUSTRY_AVG_EAR = 9.24; // Jun 2026 Serrari data (mean of 27 active funds)

function FundFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Fund>;
  onSave: (data: Omit<Fund, "id" | "isActive" | "createdAt" | "updatedAt">) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    fundName: initial?.fundName ?? "",
    company: initial?.company ?? "",
    grossYield: String(initial?.grossYield ?? ""),
    ear: String(initial?.ear ?? ""),
    managementFee: String(initial?.managementFee ?? "2.0"),
    minInvestment: String(initial?.minInvestment ?? "1000"),
    aumMillions: String(initial?.aumMillions ?? ""),
    asOfDate: initial?.asOfDate ?? "",
    source: initial?.source ?? "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    if (!form.fundName.trim() || !form.company.trim()) {
      toast.error("Fund name and company are required.");
      return;
    }
    const ear = parseFloat(form.ear);
    const grossYield = parseFloat(form.grossYield);
    if (isNaN(ear) || ear <= 0) { toast.error("EAR must be a positive number."); return; }
    if (isNaN(grossYield) || grossYield <= 0) { toast.error("Gross yield must be a positive number."); return; }
    onSave({
      fundName: form.fundName.trim(),
      company: form.company.trim(),
      grossYield,
      ear,
      managementFee: parseFloat(form.managementFee) || 2.0,
      minInvestment: parseFloat(form.minInvestment) || 1000,
      aumMillions: form.aumMillions ? parseFloat(form.aumMillions) : null,
      asOfDate: form.asOfDate || null,
      source: form.source || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Fund" : "Add MMF Fund"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Fund Name *</Label>
            <Input value={form.fundName} onChange={set("fundName")} placeholder="e.g. Cytonn Money Market Fund" />
          </div>
          <div className="col-span-2">
            <Label>Fund Manager / Company *</Label>
            <Input value={form.company} onChange={set("company")} placeholder="e.g. Cytonn Investments" />
          </div>
          <div>
            <Label>Gross Yield (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.grossYield} onChange={set("grossYield")} placeholder="e.g. 16.0" />
          </div>
          <div>
            <Label>EAR net of fee (% p.a.) *</Label>
            <Input type="number" step="0.01" value={form.ear} onChange={set("ear")} placeholder="e.g. 13.9" />
          </div>
          <div>
            <Label>Management Fee (% p.a.)</Label>
            <Input type="number" step="0.01" value={form.managementFee} onChange={set("managementFee")} placeholder="2.0" />
          </div>
          <div>
            <Label>Min. Investment (KES)</Label>
            <Input type="number" step="1" value={form.minInvestment} onChange={set("minInvestment")} placeholder="1000" />
          </div>
          <div>
            <Label>AUM (KES millions)</Label>
            <Input type="number" step="0.01" value={form.aumMillions} onChange={set("aumMillions")} placeholder="optional" />
          </div>
          <div>
            <Label>Data as of Date</Label>
            <Input type="date" value={form.asOfDate} onChange={set("asOfDate")} />
          </div>
          <div className="col-span-2">
            <Label>Source URL / Reference</Label>
            <Input value={form.source} onChange={set("source")} placeholder="e.g. https://cytonn.com/..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function MmfFunds() {
  const { portfolioId, portfolio } = usePortfolio();
  const utils = trpc.useUtils();

  const { data: funds = [], isLoading } = trpc.mmfFunds.list.useQuery();

  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("ear");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [addOpen, setAddOpen] = useState(false);
  const [editFund, setEditFund] = useState<Fund | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  // ── Secondary MMF accounts ──
  const { data: secondaryMmfs = [], isLoading: secondaryLoading } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const [addSecondaryOpen, setAddSecondaryOpen] = useState(false);
  const [editSecondary, setEditSecondary] = useState<typeof secondaryMmfs[0] | null>(null);
  const [secondaryForm, setSecondaryForm] = useState({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" });

  const addSecondaryMutation = trpc.secondaryMmfs.add.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); setAddSecondaryOpen(false); setSecondaryForm({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" }); toast.success("Additional MMF account added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateSecondaryMutation = trpc.secondaryMmfs.update.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); setEditSecondary(null); toast.success("Account updated."); },
    onError: (e) => toast.error(e.message),
  });
  const removeSecondaryMutation = trpc.secondaryMmfs.remove.useMutation({
    onSuccess: () => { utils.secondaryMmfs.list.invalidate({ portfolioId: portfolioId! }); toast.success("Account removed."); },
    onError: (e) => toast.error(e.message),
  });

  function openEditSecondary(item: typeof secondaryMmfs[0]) {
    setEditSecondary(item);
    setSecondaryForm({
      mmfFundId: String(item.mmfFundId),
      label: item.label ?? "",
      currentBalance: String(item.currentBalance),
      monthlyContribution: String(item.monthlyContribution),
      notes: item.notes ?? "",
    });
  }

  function handleSaveSecondary(isEdit: boolean) {
    if (!portfolioId) return;
    const mmfFundId = parseInt(secondaryForm.mmfFundId);
    if (!mmfFundId) { toast.error("Please select a fund."); return; }
    const currentBalance = parseFloat(secondaryForm.currentBalance) || 0;
    const monthlyContribution = parseFloat(secondaryForm.monthlyContribution) || 0;
    if (isEdit && editSecondary) {
      updateSecondaryMutation.mutate({ id: editSecondary.id, portfolioId, mmfFundId, label: secondaryForm.label || undefined, currentBalance, monthlyContribution, notes: secondaryForm.notes || undefined });
    } else {
      addSecondaryMutation.mutate({ portfolioId, mmfFundId, label: secondaryForm.label || undefined, currentBalance, monthlyContribution, notes: secondaryForm.notes || undefined });
    }
  }

  const addMutation = trpc.mmfFunds.add.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setAddOpen(false); toast.success("Fund added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.mmfFunds.update.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setEditFund(null); toast.success("Fund updated."); },
    onError: (e) => toast.error(e.message),
  });
  const deactivateMutation = trpc.mmfFunds.deactivate.useMutation({
    onSuccess: () => { utils.mmfFunds.list.invalidate(); setDeleteId(null); toast.success("Fund removed."); },
    onError: (e) => toast.error(e.message),
  });
  const selectFundMutation = trpc.mmfFunds.selectFund.useMutation({
    onSuccess: () => {
      utils.portfolios.list.invalidate();
      if (portfolioId) {
        utils.portfolios.get.invalidate({ portfolioId });
        utils.projection.run.invalidate({ portfolioId });
        utils.projection.milestones.invalidate({ portfolioId });
        utils.projection.scenarios.invalidate({ portfolioId });
      }
      toast.success("Fund selection saved. Projection updated.");
    },
    onError: (e) => toast.error(e.message),
  });

  const selectedFundId = portfolio?.mmfFundId ?? null;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return funds.filter(
      (f) =>
        f.fundName.toLowerCase().includes(q) ||
        f.company.toLowerCase().includes(q)
    );
  }, [funds, search]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = a[sortKey] ?? 0;
      const bv = b[sortKey] ?? 0;
      if (typeof av === "string" && typeof bv === "string")
        return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
      return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
  }, [filtered, sortKey, sortDir]);

  const top5Ear = useMemo(() => {
    return [...funds].sort((a, b) => b.ear - a.ear).slice(0, 5).map((f) => f.id);
  }, [funds]);

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ArrowUpDown className="w-3 h-3 opacity-40 ml-1" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 ml-1 text-primary" />
      : <ArrowDown className="w-3 h-3 ml-1 text-primary" />;
  };

  const selectedFund = funds.find((f) => f.id === selectedFundId);

  return (
    <div className="p-6 space-y-6 max-w-6xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MMF Fund Tracker</h1>
          <p className="text-muted-foreground text-sm mt-1">
            27 CMA-regulated Kenyan money market funds. Select one to use its EAR in your projection.
            {" "}Data from{" "}
            <a
              href="https://serrarigroup.com/ke/mmf/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline text-primary hover:text-primary/80 font-medium"
            >
              Serrari Group
            </a>
            {" "}(updated daily).
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm">
          <Plus className="w-4 h-4 mr-1" /> Add Fund
        </Button>
      </div>

      {/* Selected fund banner */}
      {selectedFund ? (
        <Card className="border-primary/40 bg-primary/5">
          <CardContent className="py-3 px-4 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              <span className="text-sm font-medium">
                Projection uses <strong>{selectedFund.fundName}</strong> ({selectedFund.ear.toFixed(2)}% EAR)
              </span>
              <Badge variant="secondary" className="text-xs">WHT applied by engine</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
              disabled={selectFundMutation.isPending}
            >
              Switch to manual rate
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 px-4 flex items-center gap-2">
            <Info className="w-4 h-4 text-amber-600 shrink-0" />
            <p className="text-sm text-amber-800 dark:text-amber-300">
              No fund selected — projection uses the manual MMF yield from Rate Settings.
              Select a fund below to use its published EAR instead.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Industry average note */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Info className="w-3 h-3" />
        Industry average EAR (Jun 2026): <strong>{INDUSTRY_AVG_EAR}%</strong> ·{" "}
        <a
          href="https://serrarigroup.com/ke/mmf/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-foreground"
        >
          Verify on Serrari ↗
        </a>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          className="pl-9"
          placeholder="Search by name or company…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-4 py-3 font-medium w-8">#</th>
                <th className="text-left px-4 py-3 font-medium">
                  <button className="flex items-center" onClick={() => handleSort("fundName")}>
                    Fund <SortIcon k="fundName" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("ear")}>
                    EAR (%) <SortIcon k="ear" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("grossYield")}>
                    Gross (%) <SortIcon k="grossYield" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("managementFee")}>
                    Fee (%) <SortIcon k="managementFee" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("minInvestment")}>
                    Min (KES) <SortIcon k="minInvestment" />
                  </button>
                </th>
                <th className="text-right px-4 py-3 font-medium">
                  <button className="flex items-center ml-auto" onClick={() => handleSort("aumMillions")}>
                    AUM (M) <SortIcon k="aumMillions" />
                  </button>
                </th>
                <th className="text-left px-4 py-3 font-medium">As of</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">Loading…</td></tr>
              )}
              {!isLoading && sorted.length === 0 && (
                <tr><td colSpan={9} className="text-center py-8 text-muted-foreground">No funds found.</td></tr>
              )}
              {sorted.map((fund, idx) => {
                const isSelected = fund.id === selectedFundId;
                const isTop5 = top5Ear.includes(fund.id);
                const vsAvg = fund.ear - INDUSTRY_AVG_EAR;
                return (
                  <tr
                    key={fund.id}
                    className={`border-b transition-colors ${isSelected ? "bg-primary/8" : "hover:bg-muted/30"}`}
                  >
                    <td className="px-4 py-3 text-muted-foreground text-xs">{idx + 1}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="font-medium flex items-center gap-1.5">
                            {fund.fundName}
                            {isTop5 && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                                Top 5
                              </Badge>
                            )}
                            {isSelected && (
                              <Badge className="text-[10px] py-0 px-1.5 bg-primary/15 text-primary border-primary/30">
                                Selected
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground">{fund.company}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-semibold ${fund.ear >= INDUSTRY_AVG_EAR ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"}`}>
                        {fund.ear.toFixed(2)}%
                      </span>
                      <div className="text-[10px] text-muted-foreground">
                        {vsAvg >= 0 ? "+" : ""}{vsAvg.toFixed(1)}% vs avg
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.grossYield.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">{fund.managementFee.toFixed(2)}%</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.minInvestment.toLocaleString("en-KE")}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {fund.aumMillions != null ? fund.aumMillions.toLocaleString("en-KE", { maximumFractionDigits: 0 }) : "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-xs">
                      {fund.asOfDate ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {isSelected ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs border-primary/40 text-primary"
                            onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: null })}
                            disabled={selectFundMutation.isPending}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" /> Selected
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => portfolioId && selectFundMutation.mutate({ portfolioId, mmfFundId: fund.id })}
                            disabled={selectFundMutation.isPending}
                          >
                            <Circle className="w-3 h-3 mr-1" /> Select
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => setEditFund(fund)}
                        >
                          <Pencil className="w-3 h-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(fund.id)}
                        >
                          <Trash2 className="w-3 h-3" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* ── Secondary MMF Accounts Section ── */}
      <Card className="border-primary/20 bg-primary/3">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-primary" />
                Additional MMF Accounts
              </CardTitle>
              <CardDescription className="mt-1 text-xs">
                Track other MMF funds you invest in alongside your primary fund. Each is projected forward with its own EAR and contribution. Use <strong>Set as primary</strong> to make any account drive the headline projection.
              </CardDescription>
            </div>
            <Button size="sm" onClick={() => { setSecondaryForm({ mmfFundId: "", label: "", currentBalance: "", monthlyContribution: "", notes: "" }); setAddSecondaryOpen(true); }} disabled={!portfolioId}>
              <Plus className="w-4 h-4 mr-1" /> Add Account
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {secondaryLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
          {!secondaryLoading && secondaryMmfs.length === 0 && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Info className="w-4 h-4 shrink-0" />
              No additional MMF accounts yet. Click <strong>Add Account</strong> to start tracking another fund.
            </div>
          )}
          {secondaryMmfs.length > 0 && (
            <div className="space-y-3">
              {secondaryMmfs.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/60 bg-background/60 p-3 flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm text-foreground">{item.label || item.fundName}</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{item.ear.toFixed(2)}% EAR</Badge>
                      {item.mmfFundId != null && item.mmfFundId === selectedFundId && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-primary text-primary-foreground">
                          <Star className="w-2.5 h-2.5 mr-0.5" /> Primary
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{item.company}</p>
                    <div className="flex items-center gap-4 mt-1.5 text-xs text-muted-foreground">
                      <span>Balance: <strong className="text-foreground kes-amount">{formatKES(item.currentBalance)}</strong></span>
                      <span>Monthly: <strong className="text-foreground kes-amount">{formatKES(item.monthlyContribution)}</strong></span>
                    </div>
                    {item.notes && <p className="text-xs text-muted-foreground mt-1 italic">{item.notes}</p>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {item.mmfFundId != null && item.mmfFundId !== selectedFundId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => portfolioId && item.mmfFundId != null && selectFundMutation.mutate({ portfolioId, mmfFundId: item.mmfFundId })}
                        disabled={selectFundMutation.isPending}
                        title="Use this fund's EAR to drive the projection"
                      >
                        <Star className="w-3 h-3 mr-1" /> Set as primary
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEditSecondary(item)}>
                      <Pencil className="w-3 h-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => portfolioId && removeSecondaryMutation.mutate({ id: item.id, portfolioId })} disabled={removeSecondaryMutation.isPending}>
                      <X className="w-3 h-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add / Edit Secondary MMF Dialog */}
      <Dialog open={addSecondaryOpen || !!editSecondary} onOpenChange={(v) => { if (!v) { setAddSecondaryOpen(false); setEditSecondary(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editSecondary ? "Edit MMF Account" : "Add MMF Account"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label className="text-xs">Fund *</Label>
              <Select value={secondaryForm.mmfFundId} onValueChange={(v) => setSecondaryForm((f) => ({ ...f, mmfFundId: v }))}>
                <SelectTrigger className="mt-1">
                  <SelectValue placeholder="Select a fund…" />
                </SelectTrigger>
                <SelectContent>
                  {funds.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fundName} ({f.ear.toFixed(2)}% EAR)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Custom Label (optional)</Label>
              <Input className="mt-1" placeholder="e.g. Cytonn MMF (emergency fund)" value={secondaryForm.label} onChange={(e) => setSecondaryForm((f) => ({ ...f, label: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Current Balance (KES)</Label>
                <Input className="mt-1" type="number" step="100" min="0" placeholder="0" value={secondaryForm.currentBalance} onChange={(e) => setSecondaryForm((f) => ({ ...f, currentBalance: e.target.value }))} />
              </div>
              <div>
                <Label className="text-xs">Monthly Contribution (KES)</Label>
                <Input className="mt-1" type="number" step="100" min="0" placeholder="0" value={secondaryForm.monthlyContribution} onChange={(e) => setSecondaryForm((f) => ({ ...f, monthlyContribution: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Notes (optional)</Label>
              <Textarea className="mt-1 text-xs" rows={2} placeholder="Any notes about this account…" value={secondaryForm.notes} onChange={(e) => setSecondaryForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAddSecondaryOpen(false); setEditSecondary(null); }}>Cancel</Button>
            <Button onClick={() => handleSaveSecondary(!!editSecondary)} disabled={addSecondaryMutation.isPending || updateSecondaryMutation.isPending}>
              {addSecondaryMutation.isPending || updateSecondaryMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <p className="text-xs text-muted-foreground">
        EAR = Effective Annual Rate net of management fee, before 15% WHT. WHT is applied by the projection engine.
        Data last updated 21 Jun 2026 from{" "}
        <a
          href="https://serrarigroup.com/ke/mmf/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline text-primary hover:text-primary/80"
        >
          serrarigroup.com/ke/mmf/
        </a>
        {" "}— click to verify current rates, then use the Edit button to update any fund.
      </p>

      {/* Add dialog */}
      <FundFormDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSave={(data) => addMutation.mutate({ ...data, aumMillions: data.aumMillions ?? undefined, asOfDate: data.asOfDate ?? undefined, source: data.source ?? undefined })}
        saving={addMutation.isPending}
      />

      {/* Edit dialog */}
      {editFund && (
        <FundFormDialog
          open={!!editFund}
          onClose={() => setEditFund(null)}
          initial={editFund}
          onSave={(data) => updateMutation.mutate({ id: editFund.id, fundName: data.fundName, company: data.company, grossYield: data.grossYield, ear: data.ear, managementFee: data.managementFee, minInvestment: data.minInvestment, aumMillions: data.aumMillions ?? undefined, asOfDate: data.asOfDate ?? undefined, source: data.source ?? undefined })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Fund?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will deactivate the fund and remove it from the list. The fund will no longer appear in the selector.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && deactivateMutation.mutate({ id: deleteId })}
              disabled={deactivateMutation.isPending}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### `client/src/pages/MmfStrategy.tsx`

```tsx
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  PieChart,
  Pencil,
  Landmark,
  Building2,
  Banknote,
  Globe,
  Wallet,
  Info,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Pin,
} from "lucide-react";

interface CompositionRow {
  id: number;
  mmfFundId: number;
  govSecurities: number;
  govTbills: number;
  govTbonds: number;
  govIfb: number;
  bankInstruments: number;
  corporateDebt: number;
  cashEquivalents: number;
  offshoreRegional: number;
  realEstate: number;
  otherAssets: number;
  bankNote: string | null;
  corporateNote: string | null;
  cashNote: string | null;
  offshoreNote: string | null;
  realEstateNote: string | null;
  otherNote: string | null;
  notes: string | null;
  asOfDate: string | Date | null;
  source: string | null;
  isEstimate: boolean;
  fundName: string;
  company: string;
  ear: number;
  grossYield: number;
  managementFee: number;
}

const GOV_SUB = [
  { key: "govTbills", label: "T-Bills" },
  { key: "govTbonds", label: "T-Bonds" },
  { key: "govIfb", label: "IFB" },
] as const;

const SEGMENTS = [
  { key: "govSecurities", label: "Government Securities", icon: Landmark, color: "bg-emerald-500" },
  { key: "bankInstruments", label: "Bank Deposits & CDs", icon: Banknote, color: "bg-sky-500" },
  { key: "corporateDebt", label: "Corporate Debt / CP", icon: Building2, color: "bg-amber-500" },
  { key: "cashEquivalents", label: "Cash & Equivalents", icon: Wallet, color: "bg-violet-500" },
  { key: "offshoreRegional", label: "Offshore / Regional", icon: Globe, color: "bg-rose-500" },
  { key: "realEstate", label: "Real Estate / Property", icon: Building2, color: "bg-orange-600" },
  { key: "otherAssets", label: "Other", icon: Wallet, color: "bg-slate-500" },
] as const;

// Maps each allocation segment to its detail-note field for the per-segment readout.
const SEGMENT_NOTES = [
  { key: "bankInstruments", noteKey: "bankNote", label: "Bank Deposits & CDs", icon: Banknote, color: "text-sky-600 dark:text-sky-400", bg: "border-sky-500/20 bg-sky-500/5" },
  { key: "corporateDebt", noteKey: "corporateNote", label: "Corporate Debt / Commercial Paper", icon: Building2, color: "text-amber-600 dark:text-amber-400", bg: "border-amber-500/20 bg-amber-500/5" },
  { key: "cashEquivalents", noteKey: "cashNote", label: "Cash & Equivalents", icon: Wallet, color: "text-violet-600 dark:text-violet-400", bg: "border-violet-500/20 bg-violet-500/5" },
  { key: "offshoreRegional", noteKey: "offshoreNote", label: "Offshore / Regional", icon: Globe, color: "text-rose-600 dark:text-rose-400", bg: "border-rose-500/20 bg-rose-500/5" },
  { key: "realEstate", noteKey: "realEstateNote", label: "Real Estate / Property", icon: Building2, color: "text-orange-600 dark:text-orange-400", bg: "border-orange-500/20 bg-orange-500/5" },
  { key: "otherAssets", noteKey: "otherNote", label: "Other Assets", icon: Wallet, color: "text-slate-600 dark:text-slate-400", bg: "border-slate-500/20 bg-slate-500/5" },
] as const;

function AllocationBar({ row, className = "h-3" }: { row: CompositionRow; className?: string }) {
  return (
    <div className={`flex w-full overflow-hidden rounded-full bg-muted ${className}`}>
      {SEGMENTS.map((s) => {
        const v = row[s.key] as number;
        if (v <= 0) return null;
        return (
          <div
            key={s.key}
            className={s.color}
            style={{ width: `${v}%` }}
            title={`${s.label}: ${v}%`}
          />
        );
      })}
    </div>
  );
}

// Compact label for the single largest allocation segment, for the table row summary.
function topSegment(row: CompositionRow) {
  let best: { label: string; v: number } | null = null;
  for (const s of SEGMENTS) {
    const v = row[s.key] as number;
    if (v > 0 && (!best || v > best.v)) best = { label: s.label, v };
  }
  return best;
}

type SortKey = "ear" | "grossYield" | "managementFee" | "fundName";

// Expanded detail row content for a single fund composition (progressive disclosure).
function CompositionDetail({ row, onEdit }: { row: CompositionRow; onEdit: () => void }) {
  return (
    <div className="px-4 py-4 space-y-4">
      {/* Full-width allocation bar with per-segment percentages */}
      <div className="space-y-2">
        <AllocationBar row={row} className="h-3" />
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5 text-xs">
          {SEGMENTS.map((s) => {
            const v = row[s.key] as number;
            if (v <= 0) return null;
            return (
              <div key={s.key} className="flex items-center justify-between">
                <span className="text-muted-foreground flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-sm ${s.color}`} />
                  {s.label}
                </span>
                <span className="font-medium tabular-nums">{v}%</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Yield + fee summary chips */}
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Net EAR <strong className="text-primary tabular-nums">{row.ear.toFixed(2)}%</strong>
        </span>
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Gross <strong className="tabular-nums">{row.grossYield.toFixed(2)}%</strong>
        </span>
        <span className="rounded-md border border-border bg-background px-2 py-1">
          Mgmt fee <strong className="tabular-nums">{row.managementFee.toFixed(2)}%</strong>
        </span>
      </div>

      {/* Government securities breakdown */}
      {row.govSecurities > 0 && (row.govTbills > 0 || row.govTbonds > 0 || row.govIfb > 0) && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-600 dark:text-emerald-400">
            <Landmark className="w-3 h-3" />
            Government Securities breakdown ({row.govSecurities}% of fund)
          </div>
          <div className="grid grid-cols-3 gap-2 text-[11px]">
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govTbills}%</span>
              <span className="text-muted-foreground">Treasury Bills</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govTbonds}%</span>
              <span className="text-muted-foreground">Treasury Bonds (FXD)</span>
            </div>
            <div className="flex flex-col">
              <span className="font-semibold tabular-nums text-foreground">{row.govIfb}%</span>
              <span className="text-muted-foreground">Infrastructure (IFB)</span>
            </div>
          </div>
          <p className="text-[10px] text-muted-foreground/80 pt-0.5">
            Percentages are of the whole fund. T-bills dominate the short end; IFB coupons are tax-exempt.
          </p>
        </div>
      )}

      {/* Per-segment detail notes */}
      {SEGMENT_NOTES.some((s) => (row[s.key] as number) > 0 && row[s.noteKey]) && (
        <div className="grid sm:grid-cols-2 gap-2">
          {SEGMENT_NOTES.map((s) => {
            const pct = row[s.key] as number;
            const note = row[s.noteKey] as string | null;
            if (pct <= 0 || !note) return null;
            const Icon = s.icon;
            return (
              <div key={s.key} className={`rounded-lg border p-2.5 ${s.bg}`}>
                <div className={`flex items-center gap-1.5 text-xs font-medium ${s.color}`}>
                  <Icon className="w-3 h-3" />
                  {s.label} ({pct}% of fund)
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{note}</p>
              </div>
            );
          })}
        </div>
      )}

      {/* Real estate note shown even at 0% to clarify MMFs cannot hold property */}
      {row.realEstate === 0 && row.realEstateNote && (
        <div className="rounded-lg border border-orange-500/20 bg-orange-500/5 p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-orange-600 dark:text-orange-400">
            <Building2 className="w-3 h-3" />
            Real Estate / Property (0%)
          </div>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{row.realEstateNote}</p>
        </div>
      )}

      {row.notes && (
        <p className="text-xs text-muted-foreground border-t pt-2">{row.notes}</p>
      )}

      <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1 border-t">
        <span>{row.source ? `Source: ${row.source}` : row.isEstimate ? "Estimated from fund mandate" : "From published factsheet"}</span>
        <button onClick={onEdit} className="hover:text-foreground flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Edit
        </button>
      </div>
    </div>
  );
}

export default function MmfStrategy() {
  const fund = useSelectedFund();
  const utils = trpc.useUtils();
  const { data: rows, isLoading } = trpc.mmfComposition.list.useQuery();
  const { data: funds } = trpc.mmfFunds.list.useQuery();

  const [editOpen, setEditOpen] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("ear");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [form, setForm] = useState({
    mmfFundId: 0,
    govSecurities: "0",
    govTbills: "0",
    govTbonds: "0",
    govIfb: "0",
    bankInstruments: "0",
    corporateDebt: "0",
    cashEquivalents: "0",
    offshoreRegional: "0",
    realEstate: "0",
    otherAssets: "0",
    bankNote: "",
    corporateNote: "",
    cashNote: "",
    offshoreNote: "",
    realEstateNote: "",
    otherNote: "",
    notes: "",
    source: "",
    isEstimate: true,
  });

  const upsert = trpc.mmfComposition.upsert.useMutation({
    onSuccess: () => {
      utils.mmfComposition.list.invalidate();
      setEditOpen(false);
      toast.success("Composition saved");
    },
    onError: (e) => toast.error(e.message),
  });

  // Sort by the chosen column, then always float the user's selected fund to
  // the very top so it is easy to locate when comparing.
  const sorted = useMemo(() => {
    const list = [...(rows ?? [])];
    list.sort((a, b) => {
      let cmp: number;
      if (sortKey === "fundName") cmp = a.fundName.localeCompare(b.fundName);
      else cmp = (a[sortKey] as number) - (b[sortKey] as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
    list.sort((a, b) => {
      const aSel = a.mmfFundId === fund.fundId ? 0 : 1;
      const bSel = b.mmfFundId === fund.fundId ? 0 : 1;
      return aSel - bSel;
    });
    return list;
  }, [rows, sortKey, sortDir, fund.fundId]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "fundName" ? "asc" : "desc");
    }
  }

  const govSubTotal =
    Number(form.govTbills) + Number(form.govTbonds) + Number(form.govIfb);

  const formTotal =
    Number(form.govSecurities) +
    Number(form.bankInstruments) +
    Number(form.corporateDebt) +
    Number(form.cashEquivalents) +
    Number(form.offshoreRegional) +
    Number(form.realEstate) +
    Number(form.otherAssets);

  function openEdit(row?: CompositionRow) {
    if (row) {
      setForm({
        mmfFundId: row.mmfFundId,
        govSecurities: String(row.govSecurities),
        govTbills: String(row.govTbills),
        govTbonds: String(row.govTbonds),
        govIfb: String(row.govIfb),
        bankInstruments: String(row.bankInstruments),
        corporateDebt: String(row.corporateDebt),
        cashEquivalents: String(row.cashEquivalents),
        offshoreRegional: String(row.offshoreRegional),
        realEstate: String(row.realEstate),
        otherAssets: String(row.otherAssets),
        bankNote: row.bankNote ?? "",
        corporateNote: row.corporateNote ?? "",
        cashNote: row.cashNote ?? "",
        offshoreNote: row.offshoreNote ?? "",
        realEstateNote: row.realEstateNote ?? "",
        otherNote: row.otherNote ?? "",
        notes: row.notes ?? "",
        source: row.source ?? "",
        isEstimate: row.isEstimate,
      });
    } else {
      setForm({
        mmfFundId: funds?.[0]?.id ?? 0,
        govSecurities: "0",
        govTbills: "0",
        govTbonds: "0",
        govIfb: "0",
        bankInstruments: "0",
        corporateDebt: "0",
        cashEquivalents: "0",
        offshoreRegional: "0",
        realEstate: "0",
        otherAssets: "0",
        bankNote: "",
        corporateNote: "",
        cashNote: "",
        offshoreNote: "",
        realEstateNote: "",
        otherNote: "",
        notes: "",
        source: "",
        isEstimate: true,
      });
    }
    setEditOpen(true);
  }

  function save() {
    if (!form.mmfFundId) {
      toast.error("Select a fund");
      return;
    }
    if (Math.abs(formTotal - 100) > 0.5) {
      toast.error(`Allocations must sum to 100% (currently ${formTotal.toFixed(1)}%)`);
      return;
    }
    if (govSubTotal > 0 && Math.abs(govSubTotal - Number(form.govSecurities)) > 0.5) {
      toast.error(
        `Gov-securities breakdown (${govSubTotal.toFixed(1)}%) must match the Government Securities total (${Number(form.govSecurities).toFixed(1)}%)`
      );
      return;
    }
    upsert.mutate({
      mmfFundId: form.mmfFundId,
      govSecurities: Number(form.govSecurities),
      govTbills: Number(form.govTbills),
      govTbonds: Number(form.govTbonds),
      govIfb: Number(form.govIfb),
      bankInstruments: Number(form.bankInstruments),
      corporateDebt: Number(form.corporateDebt),
      cashEquivalents: Number(form.cashEquivalents),
      offshoreRegional: Number(form.offshoreRegional),
      realEstate: Number(form.realEstate),
      otherAssets: Number(form.otherAssets),
      bankNote: form.bankNote || undefined,
      corporateNote: form.corporateNote || undefined,
      cashNote: form.cashNote || undefined,
      offshoreNote: form.offshoreNote || undefined,
      realEstateNote: form.realEstateNote || undefined,
      otherNote: form.otherNote || undefined,
      notes: form.notes || undefined,
      source: form.source || undefined,
      isEstimate: form.isEstimate,
    });
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <PieChart className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                MMF Strategy &amp; Composition
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              What each money market fund actually holds. MMFs invest in
              short-term, high-quality instruments — government securities,
              bank deposits, near-cash and short corporate paper. The mix
              explains why yields differ and how much credit/duration risk a
              fund takes to reach its rate.
            </p>
          </div>
          <Button onClick={() => openEdit()} className="shrink-0">
            <Pencil className="w-4 h-4 mr-2" /> Edit Composition
          </Button>
        </div>

        {/* Legend */}
        <Card>
          <CardContent className="py-4">
            <div className="flex flex-wrap gap-4">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="flex items-center gap-2 text-sm">
                  <span className={`w-3 h-3 rounded-sm ${s.color}`} />
                  <span className="text-muted-foreground">{s.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Comparison table (default scannable view) */}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : sorted.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              No composition data yet. Click "Edit Composition" to add one.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-xs text-muted-foreground">
                    <th className="text-left font-medium py-2.5 px-4">
                      <button onClick={() => toggleSort("fundName")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Fund <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap">
                      <button onClick={() => toggleSort("ear")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Net EAR <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap hidden sm:table-cell">
                      <button onClick={() => toggleSort("grossYield")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Gross <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-right font-medium py-2.5 px-3 whitespace-nowrap hidden sm:table-cell">
                      <button onClick={() => toggleSort("managementFee")} className="inline-flex items-center gap-1 hover:text-foreground">
                        Fee <ArrowUpDown className="w-3 h-3 opacity-60" />
                      </button>
                    </th>
                    <th className="text-left font-medium py-2.5 px-3 w-[34%] hidden md:table-cell">Allocation</th>
                    <th className="py-2.5 px-3 w-8"></th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((row) => {
                    const isSelected = row.mmfFundId === fund.fundId;
                    const isOpen = expandedId === row.id;
                    const top = topSegment(row);
                    return (
                      <>
                        <tr
                          key={row.id}
                          onClick={() => setExpandedId(isOpen ? null : row.id)}
                          className={`border-b border-border cursor-pointer transition-colors hover:bg-muted/40 ${isSelected ? "bg-primary/5" : ""}`}
                        >
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              {isSelected && <Pin className="w-3 h-3 text-primary shrink-0" />}
                              <div className="min-w-0">
                                <div className="font-medium text-foreground flex items-center gap-1.5 flex-wrap">
                                  <span className="truncate">{row.fundName}</span>
                                  {isSelected && <Badge className="text-[10px]">Your Fund</Badge>}
                                  {row.isEstimate ? (
                                    <Badge variant="outline" className="text-[9px]">Estimate</Badge>
                                  ) : (
                                    <Badge variant="secondary" className="text-[9px]">Factsheet</Badge>
                                  )}
                                </div>
                                <div className="text-xs text-muted-foreground truncate">{row.company}{top ? ` \u00b7 mostly ${top.label} (${top.v}%)` : ""}</div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-primary tabular-nums whitespace-nowrap">{row.ear.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">{row.grossYield.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 text-right text-muted-foreground tabular-nums whitespace-nowrap hidden sm:table-cell">{row.managementFee.toFixed(2)}%</td>
                          <td className="py-2.5 px-3 hidden md:table-cell"><AllocationBar row={row} className="h-2.5" /></td>
                          <td className="py-2.5 px-3 text-muted-foreground">{isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</td>
                        </tr>
                        {isOpen && (
                          <tr className="border-b border-border bg-muted/20">
                            <td colSpan={6} className="p-0">
                              <CompositionDetail row={row} onEdit={() => openEdit(row)} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        <p className="text-xs text-muted-foreground flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          Allocations are drawn from the most recent published fund factsheets
          where available, otherwise estimated from the fund's mandate. All
          values are editable and should be refreshed as new factsheets are
          released.
        </p>
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Fund Composition</DialogTitle>
            <DialogDescription>
              Allocations must sum to 100%. Current total:{" "}
              <span
                className={
                  Math.abs(formTotal - 100) > 0.5
                    ? "text-red-500 font-semibold"
                    : "text-primary font-semibold"
                }
              >
                {formTotal.toFixed(1)}%
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Fund</Label>
              <Select
                value={String(form.mmfFundId)}
                onValueChange={(v) => setForm((f) => ({ ...f, mmfFundId: Number(v) }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select a fund" />
                </SelectTrigger>
                <SelectContent>
                  {(funds ?? []).map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fundName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {SEGMENTS.map((s) => (
                <div key={s.key} className="space-y-1.5">
                  <Label className="text-xs">{s.label} (%)</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={form[s.key]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [s.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
            {/* Government Securities sub-breakdown */}
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <Landmark className="w-3 h-3" /> Government Securities breakdown
                </Label>
                <span
                  className={
                    Math.abs(govSubTotal - Number(form.govSecurities)) > 0.5
                      ? "text-[11px] text-red-500 font-semibold"
                      : "text-[11px] text-muted-foreground"
                  }
                >
                  {govSubTotal.toFixed(1)}% / {Number(form.govSecurities).toFixed(1)}%
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {GOV_SUB.map((s) => (
                  <div key={s.key} className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">{s.label}</Label>
                    <Input
                      type="number"
                      inputMode="decimal"
                      value={form[s.key]}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, [s.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-muted-foreground">
                These three should add up to the Government Securities total above. Percentages are of the whole fund.
              </p>
            </div>
            {/* Per-segment detail notes */}
            <div className="rounded-lg border p-3 space-y-2">
              <Label className="text-xs font-medium">Segment detail notes (holdings + indicative rates)</Label>
              {SEGMENT_NOTES.map((s) => (
                <div key={s.noteKey} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">{s.label}</Label>
                  <Textarea
                    rows={2}
                    value={form[s.noteKey]}
                    onChange={(e) => setForm((f) => ({ ...f, [s.noteKey]: e.target.value }))}
                    placeholder={`e.g. how this fund uses ${s.label.toLowerCase()}`}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Source (URL or note)</Label>
              <Input
                value={form.source}
                onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}
                placeholder="e.g. fund factsheet Q2 2026"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Notes</Label>
              <Textarea
                value={form.notes}
                rows={2}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={upsert.isPending}>
              {upsert.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
```

### `client/src/pages/NotFound.tsx`

```tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();

  const handleGoHome = () => {
    setLocation("/");
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100">
      <Card className="w-full max-w-lg mx-4 shadow-lg border-0 bg-white/80 backdrop-blur-sm">
        <CardContent className="pt-8 pb-8 text-center">
          <div className="flex justify-center mb-6">
            <div className="relative">
              <div className="absolute inset-0 bg-red-100 rounded-full animate-pulse" />
              <AlertCircle className="relative h-16 w-16 text-red-500" />
            </div>
          </div>

          <h1 className="text-4xl font-bold text-slate-900 mb-2">404</h1>

          <h2 className="text-xl font-semibold text-slate-700 mb-4">
            Page Not Found
          </h2>

          <p className="text-slate-600 mb-8 leading-relaxed">
            Sorry, the page you are looking for doesn't exist.
            <br />
            It may have been moved or deleted.
          </p>

          <div
            id="not-found-button-group"
            className="flex flex-col sm:flex-row gap-3 justify-center"
          >
            <Button
              onClick={handleGoHome}
              className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg"
            >
              <Home className="w-4 h-4 mr-2" />
              Go Home
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### `client/src/pages/OtherAssets.tsx`

```tsx
import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, TrendingUp, BookOpen, AlertTriangle, Info, ChevronDown, ChevronUp } from "lucide-react";
import { formatKES } from "@/lib/format";

const ASSET_CLASSES = [
  { value: "real_estate", label: "Real Estate" },
  { value: "equity", label: "Equities / Stocks" },
  { value: "pension", label: "Pension / NSSF" },
  { value: "sacco", label: "SACCO Shares" },
  { value: "business", label: "Business / Enterprise" },
  { value: "crypto", label: "Crypto / Digital Assets" },
  { value: "insurance", label: "Insurance / Endowment" },
  { value: "other", label: "Other" },
];

const INCOME_TYPES = [
  { value: "dividend", label: "Dividend" },
  { value: "rental", label: "Rental Income" },
  { value: "interest", label: "Interest" },
  { value: "bonus", label: "Bonus / Distribution" },
  { value: "sale", label: "Proceeds from Sale" },
  { value: "other", label: "Other" },
];

// Types matching the router's return shape
type Holding = {
  id: number;
  portfolioId: number;
  assetClass: string;
  name: string;
  description: string | null;
  currentValue: number;
  purchaseValue: number | null;
  purchaseDate: string | null;
  assumedReturnConservative: number | null;
  assumedReturnBase: number | null;
  assumedReturnOptimistic: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type IncomeRecord = {
  id: number;
  holdingId: number;
  amount: number;
  incomeDate: string;
  incomeType: string;
  notes: string | null;
  createdAt: Date;
};

function HoldingFormDialog({
  open,
  onClose,
  initial,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Partial<Holding>;
  onSave: (data: {
    assetClass: string;
    name: string;
    description?: string;
    currentValue: number;
    purchaseValue?: number;
    purchaseDate?: string;
    assumedReturnConservative?: number;
    assumedReturnBase?: number;
    assumedReturnOptimistic?: number;
    notes?: string;
  }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    assetClass: initial?.assetClass ?? "real_estate",
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    currentValue: String(initial?.currentValue ?? ""),
    purchaseValue: String(initial?.purchaseValue ?? ""),
    purchaseDate: initial?.purchaseDate ?? "",
    assumedReturnConservative: String(initial?.assumedReturnConservative ?? ""),
    assumedReturnBase: String(initial?.assumedReturnBase ?? ""),
    assumedReturnOptimistic: String(initial?.assumedReturnOptimistic ?? ""),
    notes: initial?.notes ?? "",
  });

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    if (!form.name.trim()) { toast.error("Asset name is required."); return; }
    const currentValue = parseFloat(form.currentValue);
    if (isNaN(currentValue) || currentValue < 0) { toast.error("Current value must be a non-negative number."); return; }
    onSave({
      assetClass: form.assetClass,
      name: form.name.trim(),
      description: form.description || undefined,
      currentValue,
      purchaseValue: form.purchaseValue ? parseFloat(form.purchaseValue) : undefined,
      purchaseDate: form.purchaseDate || undefined,
      assumedReturnConservative: form.assumedReturnConservative ? parseFloat(form.assumedReturnConservative) : undefined,
      assumedReturnBase: form.assumedReturnBase ? parseFloat(form.assumedReturnBase) : undefined,
      assumedReturnOptimistic: form.assumedReturnOptimistic ? parseFloat(form.assumedReturnOptimistic) : undefined,
      notes: form.notes || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? "Edit Asset" : "Add Asset"}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3 py-2">
          <div className="col-span-2">
            <Label>Asset Class</Label>
            <Select value={form.assetClass} onValueChange={(v) => setForm((f) => ({ ...f, assetClass: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {ASSET_CLASSES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="col-span-2">
            <Label>Asset Name *</Label>
            <Input value={form.name} onChange={set("name")} placeholder="e.g. Nairobi Apartment, Safaricom shares" />
          </div>
          <div className="col-span-2">
            <Label>Description</Label>
            <Input value={form.description} onChange={set("description")} placeholder="optional notes" />
          </div>
          <div>
            <Label>Current Value (KES) *</Label>
            <Input type="number" step="1" value={form.currentValue} onChange={set("currentValue")} placeholder="0" />
          </div>
          <div>
            <Label>Purchase Value (KES)</Label>
            <Input type="number" step="1" value={form.purchaseValue} onChange={set("purchaseValue")} placeholder="optional" />
          </div>
          <div>
            <Label>Purchase Date</Label>
            <Input type="date" value={form.purchaseDate} onChange={set("purchaseDate")} />
          </div>
          <div className="col-span-2">
            <Separator className="my-1" />
            <p className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              Scenario returns are for planning only — not investment advice. All figures are assumed, not guaranteed.
            </p>
          </div>
          <div>
            <Label>Conservative return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnConservative} onChange={set("assumedReturnConservative")} placeholder="e.g. 3.0" />
          </div>
          <div>
            <Label>Base return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnBase} onChange={set("assumedReturnBase")} placeholder="e.g. 6.0" />
          </div>
          <div>
            <Label>Optimistic return (% p.a.)</Label>
            <Input type="number" step="0.1" value={form.assumedReturnOptimistic} onChange={set("assumedReturnOptimistic")} placeholder="e.g. 10.0" />
          </div>
          <div className="col-span-2">
            <Label>Notes</Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IncomeFormDialog({
  open,
  onClose,
  holdingId,
  portfolioId,
  onSave,
  saving,
}: {
  open: boolean;
  onClose: () => void;
  holdingId: number;
  portfolioId: number;
  onSave: (data: { holdingId: number; portfolioId: number; incomeType: string; amount: number; incomeDate: string; notes?: string }) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    incomeType: "dividend",
    amount: "",
    incomeDate: new Date().toISOString().split("T")[0],
    notes: "",
  });
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSave = () => {
    const amount = parseFloat(form.amount);
    if (isNaN(amount) || amount <= 0) { toast.error("Amount must be a positive number."); return; }
    if (!form.incomeDate) { toast.error("Date is required."); return; }
    onSave({ holdingId, portfolioId, incomeType: form.incomeType, amount, incomeDate: form.incomeDate, notes: form.notes || undefined });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Log Income</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Income Type</Label>
            <Select value={form.incomeType} onValueChange={(v) => setForm((f) => ({ ...f, incomeType: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {INCOME_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Amount (KES) *</Label>
            <Input type="number" step="1" value={form.amount} onChange={set("amount")} placeholder="0" />
          </div>
          <div>
            <Label>Date Received *</Label>
            <Input type="date" value={form.incomeDate} onChange={set("incomeDate")} />
          </div>
          <div>
            <Label>Notes</Label>
            <Input value={form.notes} onChange={set("notes")} placeholder="optional" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HoldingCard({
  holding,
  portfolioId,
  horizonYears,
  onEdit,
  onDelete,
}: {
  holding: Holding;
  portfolioId: number;
  horizonYears: number;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showIncome, setShowIncome] = useState(false);
  const [addIncomeOpen, setAddIncomeOpen] = useState(false);
  const utils = trpc.useUtils();

  const { data: incomeList = [] } = trpc.otherHoldings.listIncome.useQuery(
    { holdingId: holding.id, portfolioId },
    { enabled: showIncome }
  );

  const addIncomeMutation = trpc.otherHoldings.addIncome.useMutation({
    onSuccess: () => {
      utils.otherHoldings.listIncome.invalidate({ holdingId: holding.id, portfolioId });
      utils.otherHoldings.list.invalidate();
      setAddIncomeOpen(false);
      toast.success("Income logged.");
    },
    onError: (e) => toast.error(e.message),
  });

  const assetLabel = ASSET_CLASSES.find((c) => c.value === holding.assetClass)?.label ?? holding.assetClass;
  const gain = holding.purchaseValue != null ? holding.currentValue - holding.purchaseValue : null;
  const gainPct = gain != null && holding.purchaseValue ? (gain / holding.purchaseValue) * 100 : null;

  const totalIncome = incomeList.reduce((sum, i) => sum + i.amount, 0);

  const hasScenarios = holding.assumedReturnConservative != null || holding.assumedReturnBase != null || holding.assumedReturnOptimistic != null;
  const scenarioYears = horizonYears;
  const scenarioYearsLabel = Number.isInteger(scenarioYears) ? `${scenarioYears}` : scenarioYears.toFixed(1);
  const scenarioValue = (rate: number | null) =>
    rate != null ? holding.currentValue * Math.pow(1 + rate / 100, scenarioYears) : null;

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold truncate">{holding.name}</span>
              <Badge variant="outline" className="text-xs shrink-0">{assetLabel}</Badge>
            </div>
            {holding.description && (
              <p className="text-xs text-muted-foreground mt-0.5">{holding.description}</p>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
              <Pencil className="w-3 h-3" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
              <Trash2 className="w-3 h-3" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <p className="text-xs text-muted-foreground">Current Value</p>
            <p className="font-semibold text-sm">{formatKES(holding.currentValue)}</p>
          </div>
          {holding.purchaseValue != null && (
            <div>
              <p className="text-xs text-muted-foreground">Purchase Value</p>
              <p className="text-sm">{formatKES(holding.purchaseValue)}</p>
            </div>
          )}
          {gain != null && (
            <div>
              <p className="text-xs text-muted-foreground">Unrealised G/L</p>
              <p className={`text-sm font-medium ${gain >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-500"}`}>
                {gain >= 0 ? "+" : ""}{formatKES(gain)}
                {gainPct != null && <span className="text-xs ml-1">({gainPct >= 0 ? "+" : ""}{gainPct.toFixed(1)}%)</span>}
              </p>
            </div>
          )}
        </div>

        {hasScenarios && (
          <div className="rounded-md bg-muted/40 p-3 space-y-1.5">
            <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
              <AlertTriangle className="w-3 h-3 text-amber-500" />
              Assumed {scenarioYearsLabel}-year scenario — not a forecast or advice
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              {[
                { label: "Conservative", rate: holding.assumedReturnConservative, color: "text-muted-foreground" },
                { label: "Base", rate: holding.assumedReturnBase, color: "text-foreground" },
                { label: "Optimistic", rate: holding.assumedReturnOptimistic, color: "text-emerald-600 dark:text-emerald-400" },
              ].map(({ label, rate, color }) => {
                const val = scenarioValue(rate);
                return (
                  <div key={label} className="text-center">
                    <p className="text-muted-foreground">{label}</p>
                    <p className={`font-medium ${color}`}>
                      {val != null ? formatKES(val) : "—"}
                    </p>
                    {rate != null && <p className="text-muted-foreground">{rate}% p.a.</p>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Income section */}
        <div>
          <button
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowIncome((v) => !v)}
          >
            {showIncome ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Income log {showIncome && incomeList.length > 0 && `(${incomeList.length} entries · ${formatKES(totalIncome)} total)`}
          </button>
          {showIncome && (
            <div className="mt-2 space-y-1.5">
              {incomeList.length === 0 && (
                <p className="text-xs text-muted-foreground">No income logged yet.</p>
              )}
              {incomeList.map((inc) => (
                <div key={inc.id} className="flex items-center justify-between text-xs py-1 border-b last:border-0">
                  <div>
                    <span className="font-medium">{INCOME_TYPES.find((t) => t.value === inc.incomeType)?.label ?? inc.incomeType}</span>
                    {inc.notes && <span className="text-muted-foreground ml-1">· {inc.notes}</span>}
                  </div>
                  <div className="text-right">
                    <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatKES(inc.amount)}</span>
                    <span className="text-muted-foreground ml-2">{inc.incomeDate}</span>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs mt-1"
                onClick={() => setAddIncomeOpen(true)}
              >
                <Plus className="w-3 h-3 mr-1" /> Log Income
              </Button>
            </div>
          )}
        </div>
      </CardContent>

      {addIncomeOpen && (
        <IncomeFormDialog
          open={addIncomeOpen}
          onClose={() => setAddIncomeOpen(false)}
          holdingId={holding.id}
          portfolioId={portfolioId}
          onSave={(data) => addIncomeMutation.mutate(data)}
          saving={addIncomeMutation.isPending}
        />
      )}
    </Card>
  );
}

export default function OtherAssets() {
  const { portfolioId, portfolio } = usePortfolio();
  const portfolioLabel = portfolio?.name?.trim() || "your investment portfolio";
  const utils = trpc.useUtils();

  const { data: holdings = [], isLoading } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const [addOpen, setAddOpen] = useState(false);
  const [editHolding, setEditHolding] = useState<Holding | null>(null);
  const [deleteId, setDeleteId] = useState<number | null>(null);

  const addMutation = trpc.otherHoldings.add.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setAddOpen(false); toast.success("Asset added."); },
    onError: (e) => toast.error(e.message),
  });
  const updateMutation = trpc.otherHoldings.update.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setEditHolding(null); toast.success("Asset updated."); },
    onError: (e) => toast.error(e.message),
  });
  const deleteMutation = trpc.otherHoldings.delete.useMutation({
    onSuccess: () => { utils.otherHoldings.list.invalidate(); setDeleteId(null); toast.success("Asset removed."); },
    onError: (e) => toast.error(e.message),
  });

  const totalValue = holdings.reduce((sum, h) => sum + h.currentValue, 0);
  const byClass = ASSET_CLASSES.map((c) => ({
    ...c,
    total: holdings.filter((h) => h.assetClass === c.value).reduce((s, h) => s + h.currentValue, 0),
  })).filter((c) => c.total > 0);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Other Assets</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track holdings outside {portfolioLabel} — real estate, equities, pension, SACCO, and more.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} size="sm" disabled={!portfolioId}>
          <Plus className="w-4 h-4 mr-1" /> Add Asset
        </Button>
      </div>

      {/* Education banner */}
      <Card className="border-blue-500/30 bg-blue-500/5">
        <CardContent className="py-3 px-4 space-y-1">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
            <p className="text-sm font-medium text-blue-800 dark:text-blue-300">Why track other assets here?</p>
          </div>
          <p className="text-xs text-blue-700 dark:text-blue-400 pl-6">
            {portfolioLabel} (T-bills, IFBs, FXDs, MMF) is your liquid, fixed-income savings plan.
            Other assets — property, equities, pension — form the rest of your net worth.
            Tracking them together gives you a complete picture without mixing the projection math.
            Scenario returns entered here are <strong>your own assumptions</strong>, not forecasts.
          </p>
        </CardContent>
      </Card>

      {/* Net worth summary */}
      {holdings.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Net Worth Snapshot</CardTitle>
            <CardDescription className="text-xs">Current values as you have entered them — not market-linked or auto-updated.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold">{formatKES(totalValue)}</span>
              <span className="text-muted-foreground text-sm">total across {holdings.length} holding{holdings.length !== 1 ? "s" : ""}</span>
            </div>
            {byClass.length > 1 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {byClass.map((c) => (
                  <div key={c.value} className="rounded-md bg-muted/40 p-2">
                    <p className="text-xs text-muted-foreground">{c.label}</p>
                    <p className="text-sm font-semibold">{formatKES(c.total)}</p>
                    <p className="text-xs text-muted-foreground">{((c.total / totalValue) * 100).toFixed(1)}%</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Holdings list */}
      {isLoading && <p className="text-muted-foreground text-sm">Loading…</p>}
      {!isLoading && holdings.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <TrendingUp className="w-8 h-8 text-muted-foreground mx-auto" />
            <p className="text-muted-foreground text-sm">No assets tracked yet.</p>
            <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
              <Plus className="w-4 h-4 mr-1" /> Add your first asset
            </Button>
          </CardContent>
        </Card>
      )}
      <div className="space-y-3">
        {holdings.map((h) => (
          <HoldingCard
            key={h.id}
            holding={h}
            portfolioId={portfolioId!}
            horizonYears={(portfolio?.horizonMonths ?? 120) / 12}
            onEdit={() => setEditHolding(h)}
            onDelete={() => setDeleteId(h.id)}
          />
        ))}
      </div>

      <p className="text-xs text-muted-foreground flex items-start gap-1">
        <Info className="w-3 h-3 mt-0.5 shrink-0" />
        All values are entered manually and are not connected to live market data.
        Scenario projections use simple compound interest on your entered return assumptions.
        Nothing here constitutes financial advice.
      </p>

      {/* Add dialog */}
      {addOpen && portfolioId && (
        <HoldingFormDialog
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onSave={(data) => addMutation.mutate({ portfolioId, ...data, assetClass: data.assetClass as "real_estate" | "equity" | "etf" | "pension" | "sacco" | "business" | "crypto" | "insurance" | "other" })}
          saving={addMutation.isPending}
        />
      )}

      {/* Edit dialog */}
      {editHolding && portfolioId && (
        <HoldingFormDialog
          open={!!editHolding}
          onClose={() => setEditHolding(null)}
          initial={editHolding}
          onSave={(data) => updateMutation.mutate({ id: editHolding.id, portfolioId, ...data })}
          saving={updateMutation.isPending}
        />
      )}

      {/* Delete confirm */}
      <Dialog open={deleteId !== null} onOpenChange={(v) => !v && setDeleteId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove Asset?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This will permanently delete the asset and all its income records.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => deleteId !== null && portfolioId && deleteMutation.mutate({ id: deleteId, portfolioId })}
              disabled={deleteMutation.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### `client/src/pages/PortfolioReview.tsx`

```tsx
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Briefcase,
  Printer,
  TrendingUp,
  TrendingDown,
  CalendarClock,
  History,
  Target,
  Gauge,
} from "lucide-react";

function kes(n: number, dp = 0): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

const ASSET_LABELS: Record<string, string> = {
  real_estate: "Real Estate",
  equity: "Equities",
  etf: "ETFs",
  pension: "Pension",
  sacco: "SACCO",
  business: "Business",
  crypto: "Crypto",
  insurance: "Insurance",
  other: "Other",
};

const ALLOC_COLORS = [
  "bg-primary",
  "bg-sky-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-emerald-500",
  "bg-cyan-500",
  "bg-orange-500",
];

function daysUntil(d: string | Date): number {
  const t = new Date(d).getTime();
  return Math.ceil((t - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function PortfolioReview() {
  const { portfolioId, portfolio } = usePortfolio();
  const fund = useSelectedFund();

  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: holdings } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: benchmarks } = trpc.benchmarks.list.useQuery();
  const { data: secondary } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: audit } = trpc.audit.list.useQuery(
    { portfolioId: portfolioId!, limit: 25 },
    { enabled: !!portfolioId }
  );

  // ─── Net worth allocation ───────────────────────────────────────────────
  // MMF bucket = primary-MMF deposit rows only. Bank- and secondary-MMF
  // deposits are represented by their own balances (secondaryTotal / holdings),
  // and government securities are valued from the REGISTER (source of truth),
  // so those deposit rows are excluded here to avoid double-counting.
  const buckets = useMemo(() => {
    const acc = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
    (deposits ?? []).forEach((d) => {
      const inst = (d as { institutionType?: string | null }).institutionType;
      if (inst === "government_security" || inst === "bank_instrument") return;
      if (d.bucket === "mmf") acc.mmf += Number(d.amount);
    });
    (securities ?? []).forEach((s) => {
      if (s.isMatured) return;
      const face = Number(s.faceValue);
      if (s.securityType.startsWith("tbill")) acc.tbill += face;
      else if (s.securityType === "ifb") acc.ifb += face;
      else acc.fxd += face;
    });
    return acc;
  }, [deposits, securities]);

  const secondaryTotal = useMemo(
    () =>
      (secondary ?? []).reduce(
        (s: number, m: { currentBalance: number }) => s + Number(m.currentBalance ?? 0),
        0
      ),
    [secondary]
  );

  const allocation = useMemo(() => {
    const items: { label: string; value: number }[] = [];
    const fixedIncome =
      buckets.mmf + buckets.tbill + buckets.ifb + buckets.fxd + secondaryTotal;
    if (fixedIncome > 0)
      items.push({ label: "Fixed Income (MMF + CBK)", value: fixedIncome });
    const byClass: Record<string, number> = {};
    (holdings ?? []).forEach((h) => {
      byClass[h.assetClass] = (byClass[h.assetClass] ?? 0) + h.currentValue;
    });
    Object.entries(byClass).forEach(([k, v]) =>
      items.push({ label: ASSET_LABELS[k] ?? k, value: v })
    );
    return items.sort((a, b) => b.value - a.value);
  }, [buckets, holdings, secondaryTotal]);

  const netWorth = allocation.reduce((s, a) => s + a.value, 0);

  // ─── Benchmark comparison ───────────────────────────────────────────────
  const bench = useMemo(() => {
    const map: Record<string, { label: string; value: number }> = {};
    (benchmarks ?? []).forEach((b) => {
      map[b.metricKey] = { label: b.label, value: b.value };
    });
    return map;
  }, [benchmarks]);

  const yourYield = fund.fundEar;
  const benchRows = [
    { key: "your", label: `Your Fund (${fund.fundLabel})`, value: yourYield, highlight: true },
    bench["mmf_market_avg"] && { key: "mmf_market_avg", ...bench["mmf_market_avg"], highlight: false },
    bench["mmf_leaders_avg"] && { key: "mmf_leaders_avg", ...bench["mmf_leaders_avg"], highlight: false },
    bench["deposit_rate_avg"] && { key: "deposit_rate_avg", ...bench["deposit_rate_avg"], highlight: false },
    bench["tbill_91"] && { key: "tbill_91", ...bench["tbill_91"], highlight: false },
    bench["cbr"] && { key: "cbr", ...bench["cbr"], highlight: false },
    bench["inflation"] && { key: "inflation", ...bench["inflation"], highlight: false },
  ].filter(Boolean) as { key: string; label: string; value: number; highlight: boolean }[];

  const maxBench = Math.max(...benchRows.map((b) => b.value), 1);
  const inflation = bench["inflation"]?.value ?? 0;
  const realYield = yourYield - inflation;

  // ─── Liquidity calendar ─────────────────────────────────────────────────
  const upcoming = useMemo(() => {
    return (securities ?? [])
      .filter((s) => !s.isMatured)
      .map((s) => ({
        ...s,
        days: daysUntil(s.maturityDate),
      }))
      .filter((s) => s.days >= 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 12);
  }, [securities]);

  return (
    <AppShell>
      <div className="space-y-6 print:space-y-4">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Briefcase className="w-5 h-5 text-primary" />
              <h1
                className="text-2xl font-bold"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                Portfolio Review
              </h1>
            </div>
            <p className="text-muted-foreground text-sm max-w-3xl">
              A money-manager's one-page review of{" "}
              <strong>{portfolio?.name ?? "your portfolio"}</strong>: net-worth
              allocation, how your fund stacks up against market benchmarks,
              upcoming liquidity events, and a full change history.
            </p>
          </div>
          <Button
            variant="outline"
            className="shrink-0 print:hidden bg-background"
            onClick={() => window.print()}
          >
            <Printer className="w-4 h-4 mr-2" /> Print / Save as PDF
          </Button>
        </div>

        {/* Net worth */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" /> Net-Worth Allocation
            </CardTitle>
            <CardDescription>
              Total tracked net worth:{" "}
              <span className="text-foreground font-semibold">
                {kes(netWorth)}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {netWorth === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No assets recorded yet.
              </p>
            ) : (
              <>
                <div className="flex h-4 w-full overflow-hidden rounded-full bg-muted">
                  {allocation.map((a, i) => (
                    <div
                      key={a.label}
                      className={ALLOC_COLORS[i % ALLOC_COLORS.length]}
                      style={{ width: `${(a.value / netWorth) * 100}%` }}
                      title={`${a.label}: ${((a.value / netWorth) * 100).toFixed(1)}%`}
                    />
                  ))}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  {allocation.map((a, i) => (
                    <div
                      key={a.label}
                      className="flex items-center justify-between"
                    >
                      <span className="flex items-center gap-2 text-muted-foreground">
                        <span
                          className={`w-2.5 h-2.5 rounded-sm ${ALLOC_COLORS[i % ALLOC_COLORS.length]}`}
                        />
                        {a.label}
                      </span>
                      <span className="font-medium tabular-nums">
                        {((a.value / netWorth) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Benchmark comparison */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Gauge className="w-4 h-4 text-primary" /> Benchmark Comparison
            </CardTitle>
            <CardDescription>
              Your fund's net yield vs the market. Real yield (after inflation):{" "}
              <span
                className={
                  realYield >= 0
                    ? "text-primary font-semibold"
                    : "text-red-500 font-semibold"
                }
              >
                {realYield >= 0 ? "+" : ""}
                {realYield.toFixed(2)}%
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {benchRows.map((b) => (
              <div key={b.key} className="flex items-center gap-3">
                <div className="w-44 shrink-0 text-sm truncate">
                  {b.label}
                </div>
                <div className="flex-1 h-6 rounded bg-muted overflow-hidden relative">
                  <div
                    className={
                      b.highlight ? "h-full bg-primary" : "h-full bg-muted-foreground/40"
                    }
                    style={{ width: `${(b.value / maxBench) * 100}%` }}
                  />
                </div>
                <div
                  className={`w-16 text-right text-sm tabular-nums ${
                    b.highlight ? "font-bold text-primary" : "font-medium"
                  }`}
                >
                  {b.value.toFixed(2)}%
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground pt-2">
              Benchmarks are editable in the data layer and dated to their source
              (Serrari comparator, CBK, KNBS). Beating the market average and
              staying above inflation are the two key tests for a cash fund.
            </p>
          </CardContent>
        </Card>

        {/* Liquidity calendar */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <CalendarClock className="w-4 h-4 text-primary" /> Liquidity Calendar
            </CardTitle>
            <CardDescription>
              Upcoming CBK security maturities — cash becoming available for
              reinvestment or withdrawal. (MMF balances are liquid within 1–3
              days and are not listed here.)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No upcoming maturities. Add CBK securities to see your liquidity
                schedule.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Security</TableHead>
                      <TableHead className="text-right">Face Value</TableHead>
                      <TableHead>Matures</TableHead>
                      <TableHead className="text-right">In</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {upcoming.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium uppercase">
                          {s.securityType.replace("_", "-")}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {kes(Number(s.faceValue))}
                        </TableCell>
                        <TableCell>
                          {new Date(s.maturityDate).toLocaleDateString("en-KE")}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={s.days <= 30 ? "default" : "secondary"}
                            className="text-[10px]"
                          >
                            {s.days} {s.days === 1 ? "day" : "days"}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Audit trail */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4 text-primary" /> Change History
            </CardTitle>
            <CardDescription>
              Recent edits to rates, composition and benchmarks for this account.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!audit || audit.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                No changes recorded yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {audit.map((a) => (
                  <li
                    key={a.id}
                    className="flex items-start gap-3 text-sm border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="mt-0.5">
                      {a.action === "create" ? (
                        <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
                      ) : a.action === "delete" ? (
                        <TrendingDown className="w-3.5 h-3.5 text-red-500" />
                      ) : (
                        <Pencil2 />
                      )}
                    </span>
                    <div className="flex-1">
                      <p>{a.summary ?? `${a.action} on ${a.entity}`}</p>
                      <p className="text-xs text-muted-foreground">
                        {a.changedByName ? `${a.changedByName} · ` : ""}
                        {new Date(a.createdAt).toLocaleString("en-KE")}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Pencil2() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-amber-500"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  );
}
```

### `client/src/pages/Scenarios.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CheckCircle2, XCircle, Info, AlertTriangle, Lightbulb } from "lucide-react";
import { SecondaryWhatIf } from "@/components/SecondaryWhatIf";

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-card border border-border rounded-lg p-3 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-2">Step-Up: +KES {label?.toLocaleString()}/period</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 mb-1">
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-semibold text-foreground kes-amount">{formatKES(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function Scenarios() {
  const { portfolioId, portfolio } = usePortfolio();

  const { data: scenarios, isLoading } = trpc.projection.scenarios.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // The user's CURRENT plan projection — single source of truth for surplus/shortfall.
  const { data: projection, isLoading: projLoading } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // The solver, run at the portfolio's own step-up cadence. Same engine, same inputs.
  const { data: solver, isLoading: solverLoading } = trpc.projection.solve.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const targetAmount = Number(portfolio?.targetAmount ?? 0);
  const horizonMonths = portfolio?.horizonMonths ?? 120;
  const stepUpMonths = portfolio?.stepUpMonths ?? 6;
  const currentStepUp = Number(portfolio?.stepUpAmount ?? 0);
  const currentStart = Number(portfolio?.startingContribution ?? 0);

  // The user's current projected ending value (last row of their real projection).
  const currentEndingValue = projection?.length ? projection[projection.length - 1].totalEnd : 0;
  const currentGap = currentEndingValue - targetAmount;
  const currentHits = currentGap >= 0;

  // Derive the recommended step-up dynamically: the LOWEST step-up in the scenario
  // set whose projection reaches the target. Never hardcoded.
  const recommendedScenario = scenarios
    ?.slice()
    .sort((a, b) => a.stepUp - b.stepUp)
    .find((s) => s.hitsTarget);
  const recommendedStepUp = recommendedScenario?.stepUp ?? null;

  const chartData = scenarios?.map((s) => ({
    stepUp: s.stepUp,
    "Projected Value": s.projectedEndingValue,
    hitsTarget: s.hitsTarget,
    isRecommended: s.stepUp === recommendedStepUp,
  }));

  const everythingLoading = isLoading || projLoading || solverLoading;

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Scenario Comparison
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Side-by-side projections for different step-up amounts — see which path reaches {formatKES(targetAmount)} over {horizonMonths} months
          </p>
          <p className="text-xs text-muted-foreground/80 mt-1.5 max-w-3xl">
            These are <strong>forward-looking</strong> projections from today over the full {horizonMonths}-month horizon. They start from your scheduled
            primary contribution and include your tracked secondary MMF accounts, but they do <strong>not</strong> replay past recorded deposits —
            every scenario uses the same engine, target and accounts so the only thing that differs between them is the step-up.
          </p>
        </div>

        {/* ── Your current plan: real status from the solver/projection ── */}
        <Card className={currentHits ? "border-emerald-500/30" : "border-amber-500/30"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              {currentHits ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              )}
              Your Current Plan
            </CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            {everythingLoading ? (
              <Skeleton className="h-24 w-full" />
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Month 1 saving</p>
                    <p className="text-sm font-bold text-foreground kes-amount">{formatKES(currentStart)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Step-up / {stepUpMonths} mo</p>
                    <p className="text-sm font-bold text-foreground kes-amount">
                      {currentStepUp > 0 ? `+${formatKES(currentStepUp)}` : "None"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Projected at Month {horizonMonths}</p>
                    <p className="text-sm font-bold text-foreground kes-amount">{formatKES(currentEndingValue)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">vs {formatKESCompact(targetAmount)} target</p>
                    <p className={`text-sm font-bold kes-amount ${currentHits ? "status-on-track" : "status-behind"}`}>
                      {currentHits ? "+" : "−"}{formatKES(Math.abs(currentGap))}
                    </p>
                  </div>
                </div>

                {currentHits ? (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    On your current settings, the projection reaches {formatKES(currentEndingValue)} at Month {horizonMonths} —
                    a surplus of {formatKES(currentGap)} above your {formatKES(targetAmount)} target. You can adjust your
                    target, horizon, contribution, or step-up at any time on the Rate Settings page; this page updates
                    automatically.
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    On your current settings, the projection reaches {formatKES(currentEndingValue)} at Month {horizonMonths} —
                    a shortfall of {formatKES(Math.abs(currentGap))} below your {formatKES(targetAmount)} target. See the
                    options below to close the gap.
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── How to reach your target (solver-driven) ── */}
        {!everythingLoading && solver && (
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-primary" />
                How to Reach {formatKES(targetAmount)}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-5 pt-0 space-y-3">
              {solver.feasible ? (
                <>
                  <p className="text-sm text-foreground leading-relaxed">
                    To reach <strong>{formatKES(targetAmount)}</strong> in {horizonMonths} months
                    {solver.stepUpAmount > 0 ? (
                      <> with a <strong>{formatKES(solver.stepUpAmount)}</strong> step-up every {stepUpMonths} months</>
                    ) : (
                      <> with flat contributions (no step-up)</>
                    )}
                    , start at <strong className="text-primary">{formatKES(solver.requiredStartingContribution)}/month</strong>.
                    That path is projected to end at {formatKES(solver.projectedEndingValue)} (total contributed
                    {" "}{formatKES(solver.totalContributed)}).
                  </p>

                  {currentStart < solver.requiredStartingContribution && (
                    <div className="rounded-md bg-amber-500/10 border border-amber-500/25 p-3 text-xs text-muted-foreground leading-relaxed">
                      Your current Month-1 saving of {formatKES(currentStart)} is below the {formatKES(solver.requiredStartingContribution)} this
                      plan needs. Options to close the gap: <strong className="text-foreground">raise your starting contribution</strong> to
                      {" "}{formatKES(solver.requiredStartingContribution)}, <strong className="text-foreground">increase the step-up</strong> (see the table below),
                      add a <strong className="text-foreground">one-off lump sum</strong> on the Contributions page, <strong className="text-foreground">extend the horizon</strong>,
                      or <strong className="text-foreground">lower the target</strong>.
                    </div>
                  )}

                  {recommendedStepUp !== null && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Holding your Month-1 saving at {formatKES(currentStart)}, the smallest step-up in the table below that still
                      reaches {formatKESCompact(targetAmount)} is <strong className="text-foreground">+{formatKES(recommendedStepUp)}</strong> every
                      {" "}{stepUpMonths} months.
                    </p>
                  )}

                  {solver.isShortHorizon && (
                    <p className="text-xs text-amber-300/90 leading-relaxed">
                      This is a short-horizon plan ({horizonMonths} months). The strategy uses MMF + 91-day T-bills only, so
                      returns are limited and the result is primarily contribution-driven.
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-md bg-destructive/10 border border-destructive/25 p-3 flex gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {solver.message}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              Projected Value at Month {horizonMonths} by Step-Up Amount
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            {isLoading ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.25 0.03 250)" vertical={false} />
                  <XAxis
                    dataKey="stepUp"
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => `+${v.toLocaleString()}`}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v) => formatKESCompact(v).replace("KES ", "")}
                    width={55}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Projected Value" radius={[6, 6, 0, 0]}>
                    <LabelList
                      dataKey="Projected Value"
                      position="top"
                      formatter={(v: number) => formatKESCompact(v).replace("KES ", "")}
                      style={{ fontSize: 10, fill: "oklch(0.60 0.02 250)" }}
                    />
                    {chartData?.map((entry, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={
                          entry.hitsTarget
                            ? entry.isRecommended
                              ? "oklch(0.78 0.14 85)"
                              : "oklch(0.70 0.12 160)"
                            : "oklch(0.40 0.05 250)"
                        }
                        fillOpacity={entry.isRecommended ? 1 : 0.75}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
            {/* Legend */}
            <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
              <div className="w-3 h-3 rounded-sm" style={{ background: "oklch(0.78 0.14 85)" }} />
              <span>{recommendedStepUp !== null ? `Smallest step-up that reaches ${formatKESCompact(targetAmount)} (+${recommendedStepUp.toLocaleString()})` : "No step-up reaches target"}</span>
              <div className="w-3 h-3 rounded-sm ml-3" style={{ background: "oklch(0.70 0.12 160)" }} />
              <span>Reaches target</span>
              <div className="w-3 h-3 rounded-sm ml-3" style={{ background: "oklch(0.40 0.05 250)" }} />
              <span>Below target</span>
            </div>
          </CardContent>
        </Card>

        {/* Comparison Table */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Detailed Comparison</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Step-Up / Period</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Final Monthly Saving</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Total Contributed</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Projected End Value</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">vs {formatKESCompact(targetAmount)} Target</th>
                      <th className="text-center px-4 py-3 text-muted-foreground font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scenarios?.map((s) => {
                      const gap = s.projectedEndingValue - targetAmount;
                      const isRecommended = s.stepUp === recommendedStepUp;
                      return (
                        <tr
                          key={s.stepUp}
                          className={`border-b border-border/40 transition-colors ${
                            isRecommended
                              ? "bg-primary/5 hover:bg-primary/10"
                              : "hover:bg-muted/20"
                          }`}
                        >
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-foreground">
                                +KES {s.stepUp.toLocaleString()}
                              </span>
                              {isRecommended && (
                                <Badge className="text-xs bg-primary/20 text-primary border-primary/30 border">
                                  Smallest that reaches target
                                </Badge>
                              )}
                              {s.stepUp === currentStepUp && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  Your plan
                                </Badge>
                              )}
                              {s.stepUp === 0 && (
                                <Badge variant="outline" className="text-xs text-muted-foreground">
                                  No step-up
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-medium text-foreground kes-amount">
                            {formatKES(s.finalMonthlySaving)}
                          </td>
                          <td className="px-4 py-3 text-right text-muted-foreground kes-amount">
                            {formatKES(s.totalContributed)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold kes-amount">
                            <span className={s.hitsTarget ? "text-primary" : "text-muted-foreground"}>
                              {formatKES(s.projectedEndingValue)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right kes-amount">
                            <span className={gap >= 0 ? "status-on-track font-medium" : "status-behind font-medium"}>
                              {gap >= 0 ? "+" : ""}{formatKES(Math.abs(gap))} {gap >= 0 ? "surplus" : "shortfall"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            {s.hitsTarget ? (
                              <CheckCircle2 className="w-4 h-4 status-on-track mx-auto" />
                            ) : (
                              <XCircle className="w-4 h-4 text-destructive mx-auto" />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* What-if overlay for secondary MMF contributions */}
        {portfolioId && (
          <SecondaryWhatIf
            portfolioId={portfolioId}
            primaryContribution={currentStart}
            primaryStepUp={currentStepUp}
            stepUpMonths={stepUpMonths}
          />
        )}

        {/* Methodology note */}
        <Card className="border-border/60">
          <CardContent className="p-5">
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Info className="w-4 h-4 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">How these figures are produced</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Every number on this page comes from the same projection engine used across the app, applied to this
                  portfolio's own target, horizon, start date, selected fund, rates, and contribution schedule. The
                  "How to reach" guidance and the green/red table are computed from that single engine — they will always
                  agree. Change any setting on the Rate Settings or Contributions page and this page recalculates
                  automatically.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```

### `client/src/pages/Securities.tsx`

```tsx
import { usePortfolio } from "@/contexts/PortfolioContext";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { formatKES, formatPct, getSecurityLabel } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, Plus, Trash2, CheckCircle2, Clock, Pencil, Link2, Info, RefreshCw, Wallet, RotateCcw, AlertTriangle, SplitSquareHorizontal, ArrowRightLeft } from "lucide-react";
import { useState, useMemo, useEffect } from "react";
import { useMaturingWindow } from "@/hooks/useMaturingWindow";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";

interface SecurityForm {
  securityType: "tbill_91" | "tbill_182" | "tbill_364" | "ifb" | "fxd";
  faceValue: number;
  issueDate: string;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  notes: string;
}

function daysUntil(dateStr: string | Date): number {
  const d = new Date(dateStr);
  const now = new Date();
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function nextCouponDate(issueDate: string | Date, maturityDate: string | Date): string {
  const issue = new Date(issueDate);
  const maturity = new Date(maturityDate);
  const now = new Date();
  // Semi-annual coupons: every 6 months from issue
  let next = new Date(issue);
  while (next <= now && next < maturity) {
    next.setMonth(next.getMonth() + 6);
  }
  if (next >= maturity) return "At maturity";
  return next.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export default function Securities() {
  const { portfolioId } = usePortfolio();
  const utils = trpc.useUtils();
  const { data: securities, isLoading } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const addMutation = trpc.securities.add.useMutation({
    onSuccess: () => {
      toast.success("Security added to register");
      utils.securities.list.invalidate();
      setOpen(false);
    },
    onError: () => toast.error("Failed to add security"),
  });
  const deleteMutation = trpc.securities.delete.useMutation({
    onSuccess: () => {
      toast.success("Security removed");
      utils.securities.list.invalidate();
    },
    onError: () => toast.error("Failed to remove security"),
  });
  function invalidateAll() {
    utils.securities.list.invalidate();
    utils.deposits.list.invalidate({ portfolioId: portfolioId! });
    utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
    utils.projection.run.invalidate({ portfolioId: portfolioId! });
    utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
  }
  const updateMutation = trpc.securities.update.useMutation({
    onSuccess: (res) => {
      toast.success(
        res?.linkedDepositSynced
          ? "Security updated — linked deposit synced"
          : "Security updated"
      );
      invalidateAll();
      setEditId(null);
    },
    onError: () => toast.error("Failed to update security"),
  });
  const recycleMutation = trpc.securities.recycle.useMutation({
    onSuccess: (res) => {
      const msg =
        res?.mode === "mmf"
          ? `Rolled KES ${Math.round(res.amount).toLocaleString()} into your primary MMF`
          : res?.mode === "rebuy"
            ? `Re-bought KES ${Math.round(res?.amount ?? 0).toLocaleString()} on rollover`
            : `Split rollover: KES ${Math.round(res?.mmfPortion ?? 0).toLocaleString()} to MMF + KES ${Math.round(res?.rebuyPortion ?? 0).toLocaleString()} re-bought`;
      toast.success(msg);
      invalidateAll();
      setRecycleFor(null);
    },
    onError: (err) => toast.error(err?.message ?? "Failed to recycle security"),
  });

  // ── Maturity-recycling prompt state ────────────────────────────────────
  const [recycleFor, setRecycleFor] = useState<NonNullable<typeof securities>[number] | null>(null);

  // Deposits list lets us flag which register rows have a linked deposit that
  // will be synced automatically when the security is edited.
  const { data: depositList } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const linkedSecurityIds = useMemo(
    () =>
      new Set(
        (depositList ?? [])
          .map((d) => (d as { securityId?: number | null }).securityId)
          .filter((id): id is number => typeof id === "number")
      ),
    [depositList]
  );

  // ── Edit dialog state ──────────────────────────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const editForm = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });
  const editType = editForm.watch("securityType");
  const editIsBond = editType === "ifb" || editType === "fxd";

  function openEdit(s: NonNullable<typeof securities>[number]) {
    editForm.reset({
      securityType: s.securityType as SecurityForm["securityType"],
      faceValue: parseFloat(String(s.faceValue)) || 50000,
      issueDate: new Date(s.issueDate).toISOString().split("T")[0],
      maturityDate: new Date(s.maturityDate).toISOString().split("T")[0],
      couponRate: parseFloat(String(s.couponRate)) || 0,
      isTaxExempt: !!s.isTaxExempt,
      notes: s.notes ?? "",
    });
    setEditId(s.id);
  }

  function onEditSubmit(data: SecurityForm) {
    if (editId == null) return;
    updateMutation.mutate({
      id: editId,
      securityType: data.securityType,
      faceValue: data.faceValue,
      issueDate: data.issueDate,
      maturityDate: data.maturityDate,
      couponRate: editIsBond ? data.couponRate : 0,
      isTaxExempt: data.securityType === "ifb" ? true : data.isTaxExempt,
      notes: data.notes,
    });
  }

  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, control, watch } = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });

  const secType = watch("securityType");
  const isBond = secType === "ifb" || secType === "fxd";

  function onSubmit(data: SecurityForm) {
    if (!portfolioId) return;
      addMutation.mutate({
        portfolioId: portfolioId!,
      ...data,
      couponRate: isBond ? data.couponRate : 0,
      isTaxExempt: secType === "ifb" ? true : data.isTaxExempt,
    });
  }

  // Group by type
  const active = securities?.filter((s) => !s.isMatured) ?? [];
  const matured = securities?.filter((s) => s.isMatured) ?? [];

  const totalFaceValue = active.reduce((sum, s) => sum + parseFloat(String(s.faceValue)), 0);

  // Lots maturing within the chosen window (including any already past due) so a
  // rollover prompt is surfaced before the cash sits idle. Sorted soonest-first.
  // The window (30/60/90 days) is user-configurable and shared with the sidebar badge.
  const [maturingWindow, setMaturingWindow] = useMaturingWindow();
  const maturingSoon = useMemo(
    () =>
      active
        .map((s) => ({ s, days: daysUntil(s.maturityDate) }))
        .filter(({ days }) => days <= maturingWindow)
        .sort((a, b) => a.days - b.days),
    [active, maturingWindow]
  );
  const soonFaceValue = maturingSoon.reduce((sum, { s }) => sum + parseFloat(String(s.faceValue)), 0);

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              CBK Securities Register
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track individual T-bill and bond purchases with coupon and maturity schedules
            </p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Add Security
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add CBK Security</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Security Type</Label>
                  <Controller
                    name="securityType"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tbill_91">91-Day T-Bill</SelectItem>
                          <SelectItem value="tbill_182">182-Day T-Bill</SelectItem>
                          <SelectItem value="tbill_364">364-Day T-Bill</SelectItem>
                          <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                          <SelectItem value="fxd">Fixed Coupon Bond (FXD) — 15% WHT</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Face Value (KES)</Label>
                    <Input type="number" step="50000" min="50000" {...register("faceValue", { valueAsNumber: true })} />
                  </div>
                  {isBond && (
                    <div className="space-y-1.5">
                      <Label className="text-xs">Coupon Rate (%)</Label>
                      <Input type="number" step="0.01" min="0" {...register("couponRate", { valueAsNumber: true })} />
                    </div>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Issue Date</Label>
                    <Input type="date" {...register("issueDate")} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Maturity Date</Label>
                    <Input type="date" {...register("maturityDate")} required />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input placeholder="e.g. IFB/2026/10Y" {...register("notes")} />
                </div>
                <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                  {addMutation.isPending ? "Adding..." : "Add to Register"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Holdings", value: active.length, suffix: "securities" },
            { label: "Total Face Value", value: formatKES(totalFaceValue), suffix: "" },
            { label: "T-Bills", value: active.filter((s) => s.securityType.startsWith("tbill")).length, suffix: "active" },
            { label: "Bonds (IFB+FXD)", value: active.filter((s) => !s.securityType.startsWith("tbill")).length, suffix: "active" },
          ].map(({ label, value, suffix }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-bold text-foreground kes-amount">{value}</p>
                {suffix && <p className="text-xs text-muted-foreground">{suffix}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Maturing-soon window selector (always visible so the user can widen/narrow the lookahead) */}
        {active.length > 0 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Maturing-soon window:</span>
            <div className="inline-flex rounded-lg bg-muted/40 p-0.5">
              {([30, 60, 90] as const).map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => setMaturingWindow(w)}
                  className={
                    "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors " +
                    (maturingWindow === w
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {w}d
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Maturing-soon alert */}
        {maturingSoon.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-amber-500/15 p-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {maturingSoon.length} {maturingSoon.length === 1 ? "lot" : "lots"} maturing within {maturingWindow} days
                  <span className="text-muted-foreground font-normal"> · {formatKES(soonFaceValue)} face value</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Roll these over so the proceeds keep earning instead of sitting idle.
                </p>
              </div>
            </div>
            <div className="space-y-1.5">
              {maturingSoon.map(({ s, days }) => (
                <div
                  key={s.id}
                  className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-card/60 px-3 py-2"
                >
                  <Badge variant="outline" className="text-xs shrink-0">{getSecurityLabel(s.securityType)}</Badge>
                  <span className="text-xs font-semibold text-foreground kes-amount shrink-0">
                    {formatKES(parseFloat(String(s.faceValue)))}
                  </span>
                  <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                    {days <= 0
                      ? `Due · matured ${new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`
                      : `${days} day${days === 1 ? "" : "s"} left · ${new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1.5 text-xs shrink-0 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
                    onClick={() => setRecycleFor(s)}
                  >
                    <RefreshCw className="w-3 h-3" /> Recycle
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Active Securities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Landmark className="w-4 h-4 text-primary" />
              Active Holdings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : active.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No active securities. Add your first T-bill or bond purchase above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Face Value</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Issue Date</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Maturity Date</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Days Left</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Next Coupon</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tax</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => {
                      const days = daysUntil(s.maturityDate);
                      const isBondType = !s.securityType.startsWith("tbill");
                      return (
                        <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-xs">
                                {getSecurityLabel(s.securityType)}
                              </Badge>
                              {linkedSecurityIds.has(s.id) && (
                                <span title="Linked to a recorded deposit — edits sync automatically">
                                  <Link2 className="w-3 h-3 text-primary/70" />
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground kes-amount">
                            {formatKES(parseFloat(String(s.faceValue)))}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.issueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                            {s.updatedAt && (
                              <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                                edited {new Date(s.updatedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {days > 0 ? (
                              <span className={days < 30 ? "text-destructive font-semibold" : days < 90 ? "text-primary font-medium" : "text-muted-foreground"}>
                                {days}d
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 gap-1">
                                <Clock className="w-3 h-3" /> Due
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground">
                            {isBondType ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {isBondType ? nextCouponDate(s.issueDate, s.maturityDate) : "–"}
                          </td>
                          <td className="px-4 py-3">
                            {s.isTaxExempt ? (
                              <Badge variant="outline" className="text-xs phase-growth border">Tax-Exempt</Badge>
                            ) : isBondType ? (
                              <Badge variant="outline" className="text-xs phase-de-risking border">15% WHT</Badge>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {days <= 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-7 h-7 text-amber-400 hover:text-amber-300"
                                  title="Recycle proceeds (roll into MMF or re-buy)"
                                  onClick={() => setRecycleFor(s)}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Edit security"
                                onClick={() => openEdit(s)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Mark as matured"
                                onClick={() => updateMutation.mutate({ id: s.id, isMatured: true })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMutation.mutate({ id: s.id })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Matured */}
        {matured.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                Matured / Closed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Face Value</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Maturity Date</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matured.map((s) => {
                      const rolledInto = s.rolledIntoId
                        ? securities?.find((x) => x.id === s.rolledIntoId)
                        : undefined;
                      return (
                      <tr key={s.id} className="border-b border-border/40">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className="text-xs opacity-60 w-fit">
                              {getSecurityLabel(s.securityType)}
                            </Badge>
                            {s.rolledIntoId && (
                              <span
                                className="flex items-center gap-1 text-[10px] text-primary/80"
                                title={rolledInto ? `Replacement: ${getSecurityLabel(rolledInto.securityType)} #${rolledInto.id}` : undefined}
                              >
                                <ArrowRightLeft className="w-3 h-3 shrink-0" />
                                rolled into #{s.rolledIntoId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                          {formatKES(parseFloat(String(s.faceValue)))}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {!s.securityType.startsWith("tbill") ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.rolledIntoId ? (
                            <span className="text-[11px] text-muted-foreground italic">Recycled</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 text-xs"
                              onClick={() => setRecycleFor(s)}
                            >
                              <RefreshCw className="w-3 h-3" /> Roll over
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Edit Security Dialog ─────────────────────────────────────── */}
        <Dialog open={editId != null} onOpenChange={(o) => !o && setEditId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit CBK Security</DialogTitle>
            </DialogHeader>
            {editId != null && linkedSecurityIds.has(editId) && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  This entry is linked to a recorded deposit. Changing the face value or
                  issue date will update that deposit automatically so your live actuals,
                  accrual ledger, and tax summary stay in sync.
                </span>
              </div>
            )}
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Security Type</Label>
                <Controller
                  name="securityType"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tbill_91">91-Day T-Bill</SelectItem>
                        <SelectItem value="tbill_182">182-Day T-Bill</SelectItem>
                        <SelectItem value="tbill_364">364-Day T-Bill</SelectItem>
                        <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                        <SelectItem value="fxd">Fixed Coupon Bond (FXD) — 15% WHT</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Face Value (KES)</Label>
                  <Input type="number" step="50000" min="50000" {...editForm.register("faceValue", { valueAsNumber: true })} />
                </div>
                {editIsBond && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">Coupon Rate (%)</Label>
                    <Input type="number" step="0.01" min="0" {...editForm.register("couponRate", { valueAsNumber: true })} />
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Issue Date</Label>
                  <Input type="date" {...editForm.register("issueDate")} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Maturity Date</Label>
                  <Input type="date" {...editForm.register("maturityDate")} required />
                </div>
              </div>
              {editType !== "ifb" && editIsBond && (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <Label className="text-xs">Tax-exempt</Label>
                  <Controller
                    name="isTaxExempt"
                    control={editForm.control}
                    render={({ field }) => (
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Input placeholder="e.g. IFB/2026/10Y" {...editForm.register("notes")} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditId(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Maturity Recycling Dialog ──────────────────────────────── */}
        <RecycleDialog
          security={recycleFor}
          onClose={() => setRecycleFor(null)}
          onConfirm={(payload) =>
            recycleFor && recycleMutation.mutate({ id: recycleFor.id, ...payload })
          }
          isPending={recycleMutation.isPending}
        />
      </div>
    </AppShell>
  );
}

// ── Maturity-recycling prompt ───────────────────────────────────────────────
type RecyclePayload =
  | { mode: "mmf"; amount: number; depositDate: string }
  | { mode: "rebuy"; amount: number; depositDate: string }
  | { mode: "split"; mmfAmount: number; rebuyAmount: number; depositDate: string };

function RecycleDialog({
  security,
  onClose,
  onConfirm,
  isPending,
}: {
  security: { id: number; securityType: string; faceValue: string } | null;
  onClose: () => void;
  onConfirm: (payload: RecyclePayload) => void;
  isPending: boolean;
}) {
  const face = security ? parseFloat(String(security.faceValue)) || 0 : 0;
  const [mode, setMode] = useState<"mmf" | "rebuy" | "split">("mmf");
  const [amount, setAmount] = useState<number>(face);
  const [mmfAmount, setMmfAmount] = useState<number>(Math.round(face / 2));
  const [depositDate, setDepositDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // Reset the form whenever a new security is selected.
  useEffect(() => {
    if (security) {
      const f = parseFloat(String(security.faceValue)) || 0;
      setMode("mmf");
      setAmount(f);
      setMmfAmount(Math.round(f / 2));
      setDepositDate(new Date().toISOString().split("T")[0]);
    }
  }, [security]);

  const typeLabel = security ? getSecurityLabel(security.securityType) : "";
  // For split mode the re-buy side is whatever is left of the total amount.
  const rebuyAmount = Math.max(Math.round((amount - mmfAmount) * 100) / 100, 0);
  const splitValid = mode !== "split" || (mmfAmount > 0 && rebuyAmount > 0 && mmfAmount <= amount);
  const canConfirm = !isPending && amount > 0 && splitValid;

  function confirm() {
    if (!canConfirm) return;
    if (mode === "split") {
      onConfirm({ mode: "split", mmfAmount, rebuyAmount, depositDate });
    } else {
      onConfirm({ mode, amount, depositDate });
    }
  }

  const modes: { key: "mmf" | "rebuy" | "split"; label: string; icon: typeof Wallet }[] = [
    { key: "mmf", label: "To MMF", icon: Wallet },
    { key: "rebuy", label: "Re-buy", icon: RotateCcw },
    { key: "split", label: "Split", icon: SplitSquareHorizontal },
  ];

  return (
    <Dialog open={security != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-400" /> Recycle Matured Proceeds
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            Your <span className="font-medium text-foreground">{typeLabel}</span> has reached
            maturity. Choose where the redeemed cash goes — this marks the old lot closed and
            records the redeployment so your live actuals stay accurate.
          </div>

          {/* Mode switch */}
          <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted/40 p-1">
            {modes.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={
                  "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors " +
                  (mode === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{mode === "split" ? "Total proceeds (KES)" : "Amount (KES)"}</Label>
              <Input
                type="number"
                step="1000"
                min="1"
                value={Number.isFinite(amount) ? amount : 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  setAmount(v);
                  if (mmfAmount > v) setMmfAmount(v);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Redeploy date</Label>
              <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </div>
          </div>

          {/* Split allocation */}
          {mode === "split" && (
            <div className="space-y-2 rounded-lg border border-border bg-card/50 px-3 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Wallet className="w-3.5 h-3.5 text-primary" /> To MMF
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Re-buy <RotateCcw className="w-3.5 h-3.5 text-primary" />
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={amount}
                step={1000}
                value={mmfAmount}
                onChange={(e) => setMmfAmount(parseFloat(e.target.value) || 0)}
                className="w-full accent-primary"
              />
              {/* One-tap laddering presets — set the MMF portion to a common ratio. */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground mr-0.5">Ladder:</span>
                {([
                  { label: "25 / 75", mmf: 0.25 },
                  { label: "50 / 50", mmf: 0.5 },
                  { label: "75 / 25", mmf: 0.75 },
                ] as const).map((p) => {
                  const target = Math.round((amount * p.mmf) / 1000) * 1000;
                  const isActivePreset = Math.abs(mmfAmount - target) < 1;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setMmfAmount(Math.min(target, amount))}
                      className={
                        "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors " +
                        (isActivePreset
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30")
                      }
                      title={`MMF ${Math.round(p.mmf * 100)}% / re-buy ${Math.round((1 - p.mmf) * 100)}%`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-muted-foreground">MMF portion</Label>
                  <Input
                    type="number"
                    step="1000"
                    min="0"
                    max={amount}
                    value={Number.isFinite(mmfAmount) ? mmfAmount : 0}
                    onChange={(e) => setMmfAmount(Math.min(parseFloat(e.target.value) || 0, amount))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Re-buy portion</Label>
                  <Input
                    type="number"
                    value={Number.isFinite(rebuyAmount) ? rebuyAmount : 0}
                    readOnly
                    className="h-8 text-xs bg-muted/40"
                  />
                </div>
              </div>
              {!splitValid && (
                <p className="text-[11px] text-destructive">
                  Both sides must be greater than zero and sum to the total proceeds.
                </p>
              )}
            </div>
          )}

          {mode !== "split" && (
            <p className="text-xs text-muted-foreground">
              {mode === "mmf"
                ? "Parks the full amount in your money-market fund as a liquid deposit."
                : `Creates a fresh ${typeLabel} for the same tenor, issued on the redeploy date.`}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={confirm} disabled={!canConfirm}>
              {isPending ? "Recycling…" : mode === "split" ? "Split & redeploy" : mode === "mmf" ? "Roll into MMF" : "Re-buy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

### `client/src/pages/Settings.tsx`

```tsx
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Settings as SettingsIcon, RefreshCw, Info, Pencil } from "lucide-react";
import { UpdateRatesPanel } from "@/components/UpdateRatesPanel";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { useEffect } from "react";
import { History, TrendingUp } from "lucide-react";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";

// ─── Rate-only form ────────────────────────────────────────────────────────────

interface RateForm {
  mmfYield: number;
  tbill91Rate: number;
  tbill182Rate: number;
  tbill364Rate: number;
  ifbCouponRate: number;
  fxdCouponRate: number;
  withholdingTax: number;
}

// ─── Plan-level form ──────────────────────────────────────────────────────────

interface PlanForm {
  name: string;
  description: string;
  targetAmount: number;
  startDate: string;
  horizonMonths: number;
  startingContribution: number;
  stepUpAmount: number;
  stepUpMonths: number;
  safetyFloor: number;
}

function RateField({ label, name, register, description }: {
  label: string;
  name: keyof RateForm;
  register: ReturnType<typeof useForm<RateForm>>["register"];
  description?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-foreground">{label}</Label>
      <div className="relative">
        <Input
          type="number"
          step="0.01"
          min="0"
          className="pr-8 text-sm"
          {...register(name, { valueAsNumber: true })}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

function RateHistorySection({ portfolioId }: { portfolioId: number }) {
  const { data: history, isLoading } = trpc.settings.getRateHistory.useQuery({ portfolioId });

  if (isLoading) return null;
  if (!history || history.length === 0) {
    return (
      <Card className="mt-2">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <History className="w-4 h-4 text-primary" />
            Rate Change History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <p className="text-xs text-muted-foreground">No rate changes recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mt-2">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-primary" />
          Rate Change History
        </CardTitle>
        <p className="text-xs text-muted-foreground mt-1">
          Each entry shows the rates that took effect on that date. Only future months are affected by each change.
        </p>
      </CardHeader>
      <CardContent className="p-4 pt-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left pb-2 pr-3 font-medium text-muted-foreground">Effective Date</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">MMF</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">T-Bill 91d</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">T-Bill 364d</th>
              <th className="text-right pb-2 pr-3 font-medium text-muted-foreground">IFB</th>
              <th className="text-right pb-2 font-medium text-muted-foreground">FXD</th>
            </tr>
          </thead>
          <tbody>
            {[...history].reverse().map((row) => (
              <tr key={row.id} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-3 text-foreground font-medium">{row.effectiveDate}</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.mmfYield.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.tbill91Rate.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.tbill364Rate.toFixed(2)}%</td>
                <td className="py-2 pr-3 text-right text-muted-foreground">{row.ifbCouponRate.toFixed(2)}%</td>
                <td className="py-2 text-right text-muted-foreground">{row.fxdCouponRate.toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

export default function Settings() {
  const { portfolioId, portfolio, refetch: refetchPortfolios } = usePortfolio();
  const { fundLabel: selectedFundLabel, fundEar: selectedFundEar } = useSelectedFund();
  const utils = trpc.useUtils();

  // ─── Rate form ──────────────────────────────────────────────────────────────
  const { data: rateSettings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  const rateForm = useForm<RateForm>({
    defaultValues: {
      mmfYield: 8.78,
      tbill91Rate: 8.8206,
      tbill182Rate: 8.7782,
      tbill364Rate: 8.9746,
      ifbCouponRate: 12.5,
      fxdCouponRate: 12.35,
      withholdingTax: 15,
    },
  });

  useEffect(() => {
    if (rateSettings) {
      rateForm.reset({
        mmfYield: rateSettings.mmfYield,
        tbill91Rate: rateSettings.tbill91Rate,
        tbill182Rate: rateSettings.tbill182Rate,
        tbill364Rate: rateSettings.tbill364Rate,
        ifbCouponRate: rateSettings.ifbCouponRate,
        fxdCouponRate: rateSettings.fxdCouponRate,
        withholdingTax: rateSettings.withholdingTax,
      });
    }
  }, [rateSettings]);

  const saveRatesMutation = trpc.rateUpdate.save.useMutation({
    onSuccess: () => {
      toast.success("Rates saved — projection recalculated");
      utils.settings.get.invalidate({ portfolioId: portfolioId! });
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.scenarios.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.deposits.summary.invalidate({ portfolioId: portfolioId! });
    },
    onError: () => toast.error("Failed to save rates"),
  });

  function onSaveRates(data: RateForm) {
    if (!portfolioId) return;
    saveRatesMutation.mutate({ portfolioId, ...data });
  }

  // ─── Plan form ──────────────────────────────────────────────────────────────
  const planForm = useForm<PlanForm>({
    defaultValues: {
      name: "",
      description: "",
      targetAmount: 5000000,
      startDate: "2026-07-01",
      horizonMonths: 120,
      startingContribution: 2500,
      stepUpAmount: 3000,
      stepUpMonths: 6,
      safetyFloor: 50000,
    },
  });

  useEffect(() => {
    if (portfolio) {
      planForm.reset({
        name: portfolio.name,
        description: portfolio.description ?? "",
        targetAmount: portfolio.targetAmount,
        startDate: portfolio.startDate,
        horizonMonths: portfolio.horizonMonths,
        startingContribution: portfolio.startingContribution,
        stepUpAmount: portfolio.stepUpAmount,
        stepUpMonths: portfolio.stepUpMonths,
        safetyFloor: portfolio.safetyFloor,
      });
    }
  }, [portfolio]);

  const updatePortfolioMutation = trpc.portfolios.update.useMutation({
    onSuccess: () => {
      toast.success("Portfolio plan updated");
      refetchPortfolios();
      utils.portfolios.list.invalidate();
      utils.projection.run.invalidate({ portfolioId: portfolioId! });
      utils.projection.milestones.invalidate({ portfolioId: portfolioId! });
      utils.projection.scenarios.invalidate({ portfolioId: portfolioId! });
    },
    onError: () => toast.error("Failed to update portfolio"),
  });

  function onSavePlan(data: PlanForm) {
    if (!portfolioId) return;
    updatePortfolioMutation.mutate({ portfolioId, ...data });
  }

  // Auto-derived MMF safety floor recommendation, recomputed live from the
  // currently-entered starting contribution (falls back to the saved value).
  const watchedContribution = planForm.watch("startingContribution");
  const { data: derivedFloor } = trpc.settings.derivedSafetyFloor.useQuery(
    { portfolioId: portfolioId!, startingContribution: Number(watchedContribution) || undefined },
    { enabled: !!portfolioId }
  );

  if (!portfolioId) {
    return (
      <AppShell>
        <div className="p-8 text-muted-foreground text-sm">Select a portfolio to view settings.</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Settings
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure rates and plan parameters for <strong>{portfolio?.name}</strong>.
          </p>
        </div>

        {/* ── Plan Settings ── */}
        <form onSubmit={planForm.handleSubmit(onSavePlan)} className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Pencil className="w-4 h-4 text-primary" />
                Portfolio Plan
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Change the goal, horizon, or contribution schedule. The projection recalculates immediately.
              </p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Portfolio Name</Label>
                <Input {...planForm.register("name")} />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs font-medium">Description (optional)</Label>
                <Input {...planForm.register("description")} placeholder="Notes about this goal" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Target End Value (KES)</Label>
                <Input type="number" step="100000" min="0" {...planForm.register("targetAmount", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">Total portfolio value to hold at end of horizon</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Horizon (months)</Label>
                <Input type="number" min="12" max="240" {...planForm.register("horizonMonths", { valueAsNumber: true })} />
                <p className="text-xs text-muted-foreground">12–240 months (1–20 years)</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Start Date</Label>
                <Input type="date" {...planForm.register("startDate")} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Starting Monthly Contribution (KES)</Label>
                <Input type="number" step="100" min="0" {...planForm.register("startingContribution", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Amount per Period (KES)</Label>
                <Input type="number" step="100" min="0" {...planForm.register("stepUpAmount", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Step-Up Every N Months</Label>
                <Input type="number" step="1" min="1" max="24" {...planForm.register("stepUpMonths", { valueAsNumber: true })} />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">MMF Safety Floor (KES)</Label>
                <Input type="number" step="1000" min="0" {...planForm.register("safetyFloor", { valueAsNumber: true })} />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">Minimum MMF balance kept before sweeping surplus into government securities (when your plan uses them)</p>
                </div>
                {derivedFloor && (
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      Recommended: <strong className="text-foreground">{derivedFloor.derived.toLocaleString("en-KE")}</strong>{" "}
                      <span className="text-muted-foreground/70">(auto from your contribution &amp; sweep lot)</span>
                    </span>
                    <button
                      type="button"
                      className="text-primary hover:underline disabled:opacity-50"
                      disabled={Number(planForm.watch("safetyFloor")) === derivedFloor.derived}
                      onClick={() => planForm.setValue("safetyFloor", derivedFloor.derived, { shouldDirty: true })}
                    >
                      Use auto value
                    </button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
          <Button type="submit" variant="outline" className="w-full sm:w-auto" disabled={updatePortfolioMutation.isPending}>
            {updatePortfolioMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Saving…</> : "Save Plan Settings"}
          </Button>
        </form>

        {/* ── Rate Settings ── */}
        <div className="bg-muted/40 border border-border rounded-lg p-4 flex gap-3">
          <Info className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">All rates are gross rates.</strong> The engine deducts 15% WHT on MMF, T-Bill, and FXD income automatically. IFB coupons are tax-exempt.
          </div>
        </div>

        <form onSubmit={rateForm.handleSubmit(onSaveRates)} className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <SettingsIcon className="w-4 h-4 text-primary" />
                {selectedFundLabel} Yield
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Enter the gross effective annual yield shown by {selectedFundLabel}. Current fund EAR: {selectedFundEar.toFixed(2)}%.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <RateField label={`${selectedFundLabel} Annual Yield (Gross)`} name="mmfYield" register={rateForm.register} description={`Current EAR: ${selectedFundEar.toFixed(2)}% → net ≈ ${(selectedFundEar * 0.85).toFixed(2)}%`} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Treasury Bill Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Enter the gross auction rate.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField label="91-Day T-Bill (Gross)" name="tbill91Rate" register={rateForm.register} description="Default: 8.82%" />
              <RateField label="182-Day T-Bill (Gross)" name="tbill182Rate" register={rateForm.register} description="Default: 8.78%" />
              <RateField label="364-Day T-Bill (Gross)" name="tbill364Rate" register={rateForm.register} description="Default: 8.97%" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold">CBK Bond Rates</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">IFB: tax-exempt. FXD: 15% WHT deducted.</p>
            </CardHeader>
            <CardContent className="p-4 pt-0 grid grid-cols-1 sm:grid-cols-3 gap-4">
              <RateField label="IFB Coupon Rate (Gross = Net)" name="ifbCouponRate" register={rateForm.register} description="Tax-exempt. Default: 12.5%" />
              <RateField label="FXD Coupon Rate (Gross)" name="fxdCouponRate" register={rateForm.register} description="Default: 12.35% → net ≈ 10.5%" />
              <RateField label="Withholding Tax Rate" name="withholdingTax" register={rateForm.register} description="Default: 15%" />
            </CardContent>
          </Card>

          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-4 flex gap-3">
            <TrendingUp className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Rate changes only affect future months.</strong> A snapshot is recorded with today's date as the effective date.
            </div>
          </div>

          <Button type="submit" className="w-full sm:w-auto" disabled={saveRatesMutation.isPending}>
            {saveRatesMutation.isPending ? <><RefreshCw className="w-3.5 h-3.5 mr-2 animate-spin" />Saving…</> : "Save Rates & Recalculate"}
          </Button>
        </form>

        <UpdateRatesPanel portfolioId={portfolioId} />
        <RateHistorySection portfolioId={portfolioId} />
      </div>
    </AppShell>
  );
}
```

### `client/src/pages/TaxSummary.tsx`

```tsx
import { useMemo } from "react";
import { AppShell } from "@/components/AppShell";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Receipt, Percent, ShieldCheck, TrendingDown, Info } from "lucide-react";

function kes(n: number, dp = 0): string {
  return n.toLocaleString("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

interface TaxLine {
  source: string;
  basis: number; // annual income before tax
  rate: number; // WHT %
  tax: number;
  net: number;
  exempt: boolean;
  note: string;
}

export default function TaxSummary() {
  const { portfolioId } = usePortfolio();
  const fund = useSelectedFund();

  const { data: deposits } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: settings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: holdings } = trpc.otherHoldings.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const { data: secondaryMmfs = [] } = trpc.secondaryMmfs.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );

  // Bucket balances.
  // MMF bucket = primary-MMF deposit rows only (gov-security, bank, and
  // secondary-MMF deposits are represented by their own destinations and are
  // excluded here to avoid double-counting). T-bill / IFB / FXD buckets come
  // from the SECURITIES REGISTER — the single source of truth — using unmatured
  // face values, so this page reconciles with the Dashboard's Live Net Worth.
  const buckets = useMemo(() => {
    const acc = { mmf: 0, tbill: 0, ifb: 0, fxd: 0 };
    (deposits ?? []).forEach((d) => {
      const inst = (d as { institutionType?: string | null }).institutionType;
      if (inst === "government_security" || inst === "bank_instrument") return;
      if (d.bucket === "mmf") acc.mmf += Number(d.amount);
    });
    (securities ?? []).forEach((s) => {
      if (s.isMatured) return;
      const face = Number(s.faceValue);
      if (s.securityType.startsWith("tbill")) acc.tbill += face;
      else if (s.securityType === "ifb") acc.ifb += face;
      else acc.fxd += face;
    });
    return acc;
  }, [deposits, securities]);

  const whtRate = settings?.withholdingTax ?? 15;
  const mmfYield = fund.fundEar || settings?.mmfYield || 8.78;
  // Total balance + gross income across ALL tracked MMF accounts (primary + secondary).
  const secondaryMmfBalance = secondaryMmfs.reduce((s, m) => s + m.currentBalance, 0);
  const tbillRate = settings?.tbill364Rate ?? 8.97;
  const ifbRate = settings?.ifbCouponRate ?? 12.5;
  const fxdRate = settings?.fxdCouponRate ?? 12.35;

  // Build tax lines (annualised, based on current balances)
  const lines: TaxLine[] = useMemo(() => {
    const result: TaxLine[] = [];

    // MMF interest — primary fund (15% WHT, final).
    if (buckets.mmf > 0) {
      const basis = buckets.mmf * (mmfYield / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: `${fund.fundLabel} interest (primary)`,
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "Withheld at source by fund manager; final tax.",
      });
    }

    // MMF interest — each tracked secondary account, at its own yield/WHT.
    secondaryMmfs.forEach((m) => {
      if (m.currentBalance <= 0) return;
      const basis = m.currentBalance * (m.ear / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: `${m.label?.trim() ? `${m.label} — ` : ""}${m.fundName} interest`,
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "Additional tracked MMF account; WHT withheld at source by fund manager.",
      });
    });

    // T-bill discount income — 15% WHT
    if (buckets.tbill > 0) {
      const basis = buckets.tbill * (tbillRate / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: "Treasury Bill discount income",
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "15% WHT on T-bill interest (discount).",
      });
    }

    // IFB coupon — exempt
    if (buckets.ifb > 0) {
      const basis = buckets.ifb * (ifbRate / 100);
      result.push({
        source: "Infrastructure Bond (IFB) coupon",
        basis,
        rate: 0,
        tax: 0,
        net: basis,
        exempt: true,
        note: "Infrastructure bonds are tax-exempt under the Income Tax Act.",
      });
    }

    // FXD coupon — 15% WHT (10% if tenor >= 10 years; user can adjust)
    if (buckets.fxd > 0) {
      const basis = buckets.fxd * (fxdRate / 100);
      const tax = basis * (whtRate / 100);
      result.push({
        source: "Fixed-Coupon Treasury Bond (FXD) coupon",
        basis,
        rate: whtRate,
        tax,
        net: basis - tax,
        exempt: false,
        note: "15% WHT (10% applies to bonds of 10+ year tenor).",
      });
    }

    // Equity dividends — 5% WHT, final (estimate using assumedReturnBase as dividend yield proxy if present)
    (holdings ?? [])
      .filter((h) => h.assetClass === "equity")
      .forEach((h) => {
        const divYield = h.assumedReturnBase ?? 0;
        if (divYield > 0) {
          const basis = h.currentValue * (divYield / 100);
          const tax = basis * 0.05;
          result.push({
            source: `Dividends — ${h.name}`,
            basis,
            rate: 5,
            tax,
            net: basis - tax,
            exempt: false,
            note: "5% WHT on dividends (final tax for resident individuals).",
          });
        }
      });

    return result;
  }, [buckets, mmfYield, tbillRate, ifbRate, fxdRate, whtRate, fund.fundLabel, holdings, secondaryMmfs]);

  // Gross annual MMF income across all accounts (for blended yield weighting).
  const secondaryMmfGross = secondaryMmfs.reduce((s, m) => s + m.currentBalance * (m.ear / 100), 0);

  const totalGross = lines.reduce((s, l) => s + l.basis, 0);
  const totalTax = lines.reduce((s, l) => s + l.tax, 0);
  const totalNet = lines.reduce((s, l) => s + l.net, 0);
  const effectiveTaxRate = totalGross > 0 ? (totalTax / totalGross) * 100 : 0;

  const fixedIncomeTotal =
    buckets.mmf + secondaryMmfBalance + buckets.tbill + buckets.ifb + buckets.fxd;
  const grossYieldBlended =
    fixedIncomeTotal > 0
      ? ((buckets.mmf * mmfYield +
          secondaryMmfGross * 100 +
          buckets.tbill * tbillRate +
          buckets.ifb * ifbRate +
          buckets.fxd * fxdRate) /
          fixedIncomeTotal)
      : 0;
  const netYieldBlended =
    fixedIncomeTotal > 0
      ? (lines
          .filter((l) =>
            ["interest", "discount", "coupon"].some((k) => l.source.toLowerCase().includes(k))
          )
          .reduce((s, l) => s + l.net, 0) /
          fixedIncomeTotal) *
        100
      : 0;

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Receipt className="w-5 h-5 text-primary" />
            <h1
              className="text-2xl font-bold"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Tax Summary &amp; Yield Reconciliation
            </h1>
          </div>
          <p className="text-muted-foreground text-sm max-w-3xl">
            An annualised, whole-portfolio view of the withholding tax (WHT)
            applied to each income source at current balances and rates, and a
            reconciliation of your <strong>gross</strong> quoted yield against
            the <strong>net-of-tax</strong> return you actually keep.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1">
                Gross Annual Income
              </p>
              <p className="text-xl font-bold">{kes(totalGross)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <TrendingDown className="w-3.5 h-3.5" /> Total Tax (annual)
              </p>
              <p className="text-xl font-bold text-red-500">−{kes(totalTax)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1">
                Net Annual Income
              </p>
              <p className="text-xl font-bold text-primary">{kes(totalNet)}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="py-4">
              <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">
                <Percent className="w-3.5 h-3.5" /> Effective Tax Rate
              </p>
              <p className="text-xl font-bold">
                {effectiveTaxRate.toFixed(1)}%
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Tax lines table */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tax by Income Source</CardTitle>
            <CardDescription>
              Annualised on current balances. Empty buckets are omitted.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {lines.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                No income-generating balances recorded yet. Add deposits or
                holdings to see your tax breakdown.
              </p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Income Source</TableHead>
                      <TableHead className="text-right">Gross / yr</TableHead>
                      <TableHead className="text-right">Rate</TableHead>
                      <TableHead className="text-right">Tax</TableHead>
                      <TableHead className="text-right">Net / yr</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {lines.map((l, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <div className="font-medium">{l.source}</div>
                          <div className="text-xs text-muted-foreground">
                            {l.note}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {kes(l.basis)}
                        </TableCell>
                        <TableCell className="text-right">
                          {l.exempt ? (
                            <Badge variant="secondary" className="gap-1">
                              <ShieldCheck className="w-3 h-3" /> Exempt
                            </Badge>
                          ) : (
                            `${l.rate.toFixed(0)}%`
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-500">
                          {l.tax > 0 ? `−${kes(l.tax)}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-primary font-medium">
                          {kes(l.net)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Yield reconciliation */}
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">
              Fixed-Income Yield Reconciliation
            </CardTitle>
            <CardDescription>
              Blended across all your MMF account{secondaryMmfs.length > 0 ? "s" : ""}, T-bill, IFB and FXD balances
              ({kes(fixedIncomeTotal)} total).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  Blended Gross Yield
                </p>
                <p className="text-2xl font-bold">
                  {grossYieldBlended.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Weighted average of quoted rates.
                </p>
              </div>
              <div className="rounded-lg bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  Tax Drag
                </p>
                <p className="text-2xl font-bold text-red-500">
                  −{(grossYieldBlended - netYieldBlended).toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Yield lost to withholding tax.
                </p>
              </div>
              <div className="rounded-lg bg-primary/10 p-4">
                <p className="text-xs text-muted-foreground">
                  Blended Net Yield
                </p>
                <p className="text-2xl font-bold text-primary">
                  {netYieldBlended.toFixed(2)}%
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  What you actually keep after tax.
                </p>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-4 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Infrastructure bonds (IFB) lift the net yield because their coupon
              is tax-exempt — the more weight in IFBs, the smaller the gap
              between gross and net.
            </p>
          </CardContent>
        </Card>

        {/* Disclaimer */}
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">
              Estimates are annualised on current balances and the rates in your
              Rate Settings, applying Kenyan WHT rules (15% on most interest, 5%
              on dividends, IFB coupon exempt, 10% on 10+ year bonds). They are
              for tracking and education only and are not tax advice. Confirm
              current rules with KRA or a qualified tax adviser.
            </p>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```
