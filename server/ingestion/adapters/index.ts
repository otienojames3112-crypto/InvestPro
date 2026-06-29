/**
 * Part 7.2 — adapter registry. One entry per authoritative origin. The runner and
 * the scheduler iterate this map; tests import individual adapters directly.
 */
import type { SourceAdapter, SourceId } from "../../../shared/ingestion";
import { nseAdapter } from "./nse";
import { cbkAdapter } from "./cbk";
import { fundFactsheetAdapter } from "./fundFactsheet";

export const ADAPTERS: Record<SourceId, SourceAdapter> = {
  nse: nseAdapter,
  cbk_dhowcsd: cbkAdapter,
  fund_factsheet: fundFactsheetAdapter,
};

export { nseAdapter, cbkAdapter, fundFactsheetAdapter };
