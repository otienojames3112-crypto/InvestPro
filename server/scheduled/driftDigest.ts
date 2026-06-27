import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { notifyOwner } from "../_core/notification";
import {
  getPortfolioByDriftDigestTaskUid,
  setDriftDigestPending,
} from "../db";
import { computeDriftForPortfolio } from "../routers";
import { shouldSendDriftDigest, buildDriftDigestMessage } from "../../shared/liquidAllocator";

/**
 * R68 — daily liquid-drift digest.
 *
 * Triggered by a Heartbeat cron created in the `bankHoldings.setDriftDigest`
 * mutation. The platform POSTs here once a day; we look up the portfolio by the
 * cron's `task_uid` (never by request body), and send ONE summary notification
 * when there is a current breach or a pending one flagged since the last digest.
 * Idempotent: clears the pending flag after a send, returns 2xx for orphans so
 * the platform stops retrying.
 */
export async function driftDigestHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }

    const portfolio = await getPortfolioByDriftDigestTaskUid(user.taskUid);
    if (!portfolio) {
      // Orphan cron (digest turned off / portfolio deleted). 2xx so forge stops.
      return res.json({ ok: true, skipped: "orphan" });
    }

    // Digest mode could have been turned off without the cron being deleted yet.
    if ((portfolio as { driftDigestMode?: string }).driftDigestMode !== "digest") {
      return res.json({ ok: true, skipped: "digest-off" });
    }

    const pending = Boolean((portfolio as { driftDigestPending?: boolean }).driftDigestPending);
    const drift = await computeDriftForPortfolio(portfolio.id, portfolio.userId);

    if (!shouldSendDriftDigest({ breached: drift.breached, pending })) {
      return res.json({ ok: true, sent: false, reason: "nothing-to-report" });
    }

    const msg = buildDriftDigestMessage({
      totalDrift: drift.totalDrift,
      thresholdValue: drift.thresholdValue,
      thresholdPct: drift.thresholdPct,
      breachedNow: drift.breached,
    });
    try {
      await notifyOwner(msg);
    } catch {
      // Best-effort; still clear pending so we don't double-report next day.
    }
    await setDriftDigestPending(portfolio.id, false);

    return res.json({ ok: true, sent: true, breachedNow: drift.breached });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return res.status(500).json({
      error,
      stack,
      context: { url: req.originalUrl, taskUid: (req.body as { taskUid?: string })?.taskUid },
      timestamp: new Date().toISOString(),
    });
  }
}
