import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { notifyOwner } from "../_core/notification";
import { runAllAdapters } from "../ingestion/runner";

/**
 * Part 7.2 — scheduled opportunity ingestion.
 *
 * The platform POSTs here on the cron cadence (per-source cadences are declared in
 * SOURCE_POLICIES; in practice one daily job runs every adapter, and each adapter
 * only meaningfully changes on its own publish cadence). We run every adapter,
 * which fetches → parses → upserts as scraped_unverified and flags (never applies)
 * conflicts against human-checked figures. The handler is cron-only and idempotent:
 * re-running simply refreshes fetchedAt and re-detects the same conflicts.
 *
 * It notifies the owner ONLY when a run surfaces new conflicts or an adapter
 * errored, so a clean run is silent.
 */
export async function opportunityIngestHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron) {
      return res.status(403).json({ error: "cron-only" });
    }

    const reports = await runAllAdapters();
    const totalConflicts = reports.reduce((n, r) => n + r.conflicts, 0);
    const failed = reports.filter((r) => !r.ok);

    if (totalConflicts > 0 || failed.length > 0) {
      const lines = reports.map(
        (r) =>
          `• ${r.sourceId}: ${r.ok ? "ok" : "FAILED"} — ${r.instruments} instrument(s), ${r.changed} updated, ${r.conflicts} conflict(s)${r.error ? ` [${r.error}]` : ""}`,
      );
      try {
        await notifyOwner({
          title:
            totalConflicts > 0
              ? `Ingestion: ${totalConflicts} figure conflict(s) need review`
              : `Ingestion: ${failed.length} source(s) failed`,
          content: lines.join("\n"),
        });
      } catch {
        // Best-effort notification.
      }
    }

    return res.json({ ok: true, reports });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return res.status(500).json({ error, stack, timestamp: new Date().toISOString() });
  }
}
