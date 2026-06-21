/**
 * Scheduled rate fetch handler — POST /api/scheduled/rateFetch
 *
 * Called either:
 * 1. By the daily Heartbeat cron (user.isCron === true)
 * 2. Manually via the tRPC mutation `rateRefresh.triggerFetch`
 *
 * Fetches rates from CBK and SanlamAllianz, validates them, and writes
 * pending_rate_fetches rows for the user to review.
 * NEVER auto-saves to rate_settings — user must confirm each rate.
 */

import type { Request, Response } from "express";
import { fetchAllRates } from "./rateFetcher";
import {
  insertPendingRateFetch,
  insertRateFetchLog,
  getRateSettings,
  dismissAllPendingRateFetches,
  getUserByOpenId,
} from "./db";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";

export async function scheduledRateFetchHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);

    // For cron calls, user.id is -1; resolve the real owner userId
    let userId: number;
    if (user.isCron) {
      // Look up the project owner by their openId
      const ownerOpenId = ENV.ownerOpenId;
      if (!ownerOpenId) {
        return res.status(500).json({ error: "OWNER_OPEN_ID not configured" });
      }
      const owner = await getUserByOpenId(ownerOpenId);
      if (!owner) {
        return res.json({ ok: true, skipped: "owner-not-found" });
      }
      userId = owner.id;
    } else {
      userId = user.id;
    }

    // Fetch from both sources
    const results = await fetchAllRates();

    // Load current stored settings for comparison
    const dbSettings = await getRateSettings(userId);
    const storedRates: Record<string, number> = {
      mmfYield: parseFloat(String(dbSettings?.mmfYield ?? "8.78")),
      tbill91Rate: parseFloat(String(dbSettings?.tbill91Rate ?? "8.8206")),
      tbill182Rate: parseFloat(String(dbSettings?.tbill182Rate ?? "8.7782")),
      tbill364Rate: parseFloat(String(dbSettings?.tbill364Rate ?? "8.9746")),
      ifbCouponRate: parseFloat(String(dbSettings?.ifbCouponRate ?? "12.5")),
      fxdCouponRate: parseFloat(String(dbSettings?.fxdCouponRate ?? "12.35")),
      withholdingTax: parseFloat(String(dbSettings?.withholdingTax ?? "15")),
    };

    // Dismiss stale pending fetches before writing new ones
    await dismissAllPendingRateFetches(userId);

    let totalInserted = 0;
    const errors: string[] = [];

    for (const result of results) {
      // Log the fetch attempt
      await insertRateFetchLog({
        userId,
        source: result.source,
        success: result.success,
        errorMessage: result.errorMessage ?? null,
        fetchedAt: new Date(result.fetchedAt),
        rawPayload: result.rates.length > 0 ? JSON.stringify(result.rates) : null,
        taskUid: user.isCron ? (user.taskUid ?? null) : null,
      });

      if (!result.success) {
        errors.push(`${result.source}: ${result.errorMessage}`);
        continue;
      }

      for (const rate of result.rates) {
        const storedValue = storedRates[rate.rateField] ?? 0;
        await insertPendingRateFetch({
          userId,
          rateField: rate.rateField,
          fetchedValue: String(rate.value),
          storedValue: String(storedValue),
          sourceUrl: rate.sourceUrl,
          sourceLabel: rate.sourceLabel,
          cadenceNote: rate.cadenceNote ?? null,
          status: "pending",
        });
        totalInserted++;
      }
    }

    return res.json({
      ok: true,
      inserted: totalInserted,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[scheduledRateFetch] error:", message);
    return res.status(500).json({
      error: message,
      timestamp: new Date().toISOString(),
    });
  }
}
