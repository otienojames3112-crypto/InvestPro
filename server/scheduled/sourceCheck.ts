import type { Request, Response } from "express";
import { sdk } from "../_core/sdk";
import { notifyOwner } from "../_core/notification";
import {
  sourcesDueForAgentCheck,
  flagStaleSources,
  countPendingResearchUpdates,
} from "../db";

/**
 * Round 82 — scheduled source-check agent (project-level Heartbeat).
 *
 * Runs on a cadence (created out-of-band via `manus-heartbeat` after deploy) and
 * performs read-only housekeeping over the source registry:
 *   1. Flags long-overdue active sources (≥ 3× cadence) as `stale`.
 *   2. Computes which sources are DUE for a fresh review.
 *   3. Notifies the owner ONCE with a digest of what needs a look.
 *
 * It NEVER writes to a live catalogue and NEVER approves anything: it only nudges
 * the maintainer to open the Research Desk and re-check due sources. The actual
 * re-checking + any resulting pending updates stay a human, governed action.
 *
 * Idempotent: flagging stale is a set-to-same-value no-op on reruns; the digest is
 * a best-effort notification. Auth is the standard cron shape (`user.isCron`).
 */
export async function sourceCheckHandler(req: Request, res: Response) {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!user.isCron || !user.taskUid) {
      return res.status(403).json({ error: "cron-only" });
    }

    const now = Date.now();
    const flagged = await flagStaleSources(now);
    const due = await sourcesDueForAgentCheck(now);
    const pending = await countPendingResearchUpdates();

    // Nothing actionable — stay quiet so the owner isn't pinged for no reason.
    if (due.length === 0 && flagged === 0) {
      return res.json({ ok: true, notified: false, reason: "nothing-due", pending });
    }

    const lines: string[] = [];
    if (due.length > 0) {
      lines.push(
        `${due.length} source${due.length === 1 ? "" : "s"} due for a fresh review:`,
        ...due.slice(0, 12).map((s) => `• ${s.label}${s.url ? ` — ${s.url}` : ""}`),
      );
      if (due.length > 12) lines.push(`…and ${due.length - 12} more.`);
    }
    if (flagged > 0) {
      lines.push(`${flagged} long-overdue source${flagged === 1 ? " was" : "s were"} flagged stale.`);
    }
    if (pending > 0) {
      lines.push(`${pending} change${pending === 1 ? "" : "s"} still await review on the Research Desk.`);
    }
    lines.push("", "Open Research → Research Desk → Sources to re-check them. Nothing was changed automatically.");

    try {
      await notifyOwner({
        title: `Source check: ${due.length} due to review`,
        content: lines.join("\n"),
      });
    } catch {
      // Best-effort; the stale flags are already persisted.
    }

    return res.json({ ok: true, notified: true, due: due.length, flagged, pending });
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
