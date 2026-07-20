import { useState, useEffect, useRef, useCallback } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  Sparkles,
  Send,
  Bot,
  User,
  ShieldCheck,
  ExternalLink,
  ArrowRight,
  Inbox,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  History,
  Loader2,
  FileText,
  Paperclip,
  ChevronDown,
  Link2,
  Image as ImageIcon,
  Type as TypeIcon,
  MessageSquarePlus,
  Pencil,
  GitBranch,
  Archive,
  Plus,
  FileCheck2,
  FileWarning,
  FileSearch,
  Search,
} from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { catalogueLabel, suggestFollowUpQuestions, type ReferenceCatalogue, bankInstrumentTypeLabel, cbkSecurityTypeLabel, cbkTaxExemptLabel, cbkNetYieldAfterWht } from "@shared/researchPipeline";
import { parseCandidatePhrases } from "@shared/candidatePhrases";
import {
  getCatalogueFieldContract,
  projectFindingToContractDisplayRows,
  projectFindingToContractFigures,
  resolveRawFigureKey,
} from "@shared/catalogueFieldContracts";
import { SOURCE_CLASS_LABELS, isSourceClass } from "@shared/instrumentProfile";
import { formatRelativeTime } from "@/lib/format";
import { formatUtcYmd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AiPrincipleBanner } from "@/pages/AiIntake";
import { InstrumentProfilePreview } from "@/components/InstrumentProfilePreview";

/* ── Small shared bits ─────────────────────────────────────────────────────── */

/** Round 102 — map a detected source class to the catalogue it targets. */
function catalogueLabelForSourceClass(sc: string): string {
  if (sc.startsWith("cbk_")) return "CBK Securities Reference";
  if (sc.startsWith("mmf_")) return "MMF Market";
  if (sc.startsWith("bank_")) return "Bank Product Catalogue";
  if (sc.startsWith("market_asset_")) return "Market Assets Reference";
  return "Reference Catalogue";
}

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "Anything" },
  { value: "mmf", label: "MMF market" },
  { value: "bank", label: "Bank products" },
  { value: "cbk", label: "CBK securities" },
  { value: "market_asset", label: "Market assets" },
  { value: "macro", label: "Macro / context" },
];

type Scope = "any" | "mmf" | "bank" | "cbk" | "market_asset" | "macro";

/**
 * Market-asset search design (2026-07-13) — the "Asset type" selector shown only
 * when Focus = "Market assets". Deliberately limited to the four subtypes that
 * already have a registered route in `authoritativeSourcesFor("market_asset", ...)`
 * (shared/authoritativeSources.ts) — ETF/property/pension/other have NO route there
 * and are intentionally excluded, not just deferred by omission. Subtype is set
 * ONLY by explicit manager selection here — never inferred from the question text.
 * This foundation slice only collects the value; it is not yet sent to the server
 * or consulted by search (that wiring is later, staged per-subtype: REIT, then
 * equity, then offshore fund, then SACCO).
 */
type MarketAssetSubtype = "equity" | "reit" | "offshore_fund" | "sacco";

const MARKET_ASSET_SUBTYPE_OPTIONS: { value: MarketAssetSubtype; label: string }[] = [
  { value: "equity", label: "Equity" },
  { value: "reit", label: "REIT" },
  { value: "offshore_fund", label: "Offshore fund" },
  { value: "sacco", label: "SACCO" },
];

const CONFIDENCE_META: Record<string, { label: string; className: string }> = {
  low: { label: "low confidence", className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
  medium: { label: "medium confidence", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  high: { label: "high confidence", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

function fmtFields(fields: Record<string, unknown> | null | undefined): { key: string; value: string; missing?: boolean }[] {
  if (!fields) return [];
  return Object.entries(fields)
    .filter(([k, v]) => !k.startsWith("_") && v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => ({
      key: k,
      value: String(v) === "missing_from_source" ? "Missing from source" : String(v),
      missing: String(v) === "missing_from_source",
    }));
}

/* ── Round 98: Comparison Diff Table ──────────────────────────────────────── */

function ComparisonDiffTable({ extractedFields }: { extractedFields: Record<string, unknown> | null | undefined }) {
  if (!extractedFields) return null;
  const proposalType = extractedFields._proposalType as string | undefined;
  if (!proposalType || proposalType === "create") return null;

  let changedFields: string[] = [];
  let currentValues: { field: string; value: string }[] = [];
  try {
    const cf = extractedFields._changedFields;
    changedFields = typeof cf === "string" ? JSON.parse(cf) : Array.isArray(cf) ? cf : [];
    const cv = extractedFields._currentValues;
    currentValues = typeof cv === "string" ? JSON.parse(cv) : Array.isArray(cv) ? cv : [];
  } catch { /* ignore parse errors */ }

  if (changedFields.length === 0) return null;

  const currentMap = new Map(currentValues.map((c) => [c.field, c.value]));
  const matchedRow = extractedFields._matchedCurrentRow as string | undefined;
  const impactNote = extractedFields._impactNote as string | undefined;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {proposalType === "stale" ? (
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
        ) : (
          <Pencil className="w-3.5 h-3.5 text-blue-500" />
        )}
        <span>
          {proposalType === "stale" ? "Stale row" : "Changes vs current"}
          {matchedRow && <span className="text-foreground ml-1">— {matchedRow}</span>}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-muted-foreground">
              <th className="text-left font-medium py-1 pr-3">Field</th>
              <th className="text-left font-medium py-1 pr-3">Current</th>
              <th className="text-left font-medium py-1">Proposed</th>
            </tr>
          </thead>
          <tbody>
            {changedFields.map((field) => {
              const current = currentMap.get(field) ?? "—";
              const proposed = extractedFields[field];
              const proposedStr = proposed === undefined || proposed === null ? "—" : String(proposed);
              return (
                <tr key={field} className="border-t border-border/50">
                  <td className="py-1.5 pr-3 text-muted-foreground whitespace-nowrap">{field}</td>
                  <td className="py-1.5 pr-3 tabular-nums text-red-600/80 line-through">{current}</td>
                  <td className="py-1.5 tabular-nums font-medium text-emerald-600">{proposedStr}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {impactNote && (
        <p className="text-[11px] text-muted-foreground italic mt-1">{impactNote}</p>
      )}
    </div>
  );
}

/* ── Finding type (now carries Round 88 versioning fields) ──────────────────── */

export type Finding = {
  id: number;
  instrumentName: string;
  issuer: string | null;
  assetClass: string | null;
  targetCatalogue: string | null;
  currency: string | null;
  extractedFields: Record<string, unknown> | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  /** The task this finding was produced by — used to borrow its as-of date for the
   *  sources-used panel on the paired assistant turn (findings carry as-of; messages don't). */
  taskId: number | null;
  /** Round 91 — already present on the payload; typed here so the sources-used panel
   *  can read it without a server change. */
  sourceKind: "url" | "text" | "pdf" | "image" | null;
  checkedAt: number | null;
  sourceAsOf: number | null;
  confidence: string;
  missingFields: string[] | null;
  /** Stage 5 — the SAME missing fields as missingFields, structured as {key, label}
   *  pairs (computed fresh server-side; never persisted). Drives the follow-up
   *  question suggestions on the finding card. */
  missingRules: { key: string; label: string }[] | null;
  warnings: string[] | null;
  rawExcerpt: string | null;
  status: string;
  draftedUpdateId: number | null;
  threadId: number | null;
  supersededById: number | null;
  supersedesId: number | null;
  correctedBy: string | null;
  correctedAt: number | null;
  correctionReason: string | null;
};

type Message = {
  id: number;
  threadId: number;
  role: "user" | "assistant";
  content: string;
  sourceKind: string | null;
  sourceRef: string | null;
  sourceLabel: string | null;
  taskId: number | null;
  createdAt: string | Date | null;
  /** Stage 4 · sources-used panel — the task's ACTUAL source-read outcome (not just
   *  whether a source was attached): true = read succeeded, false = attached but
   *  failed to read, null = no source was attached for this turn. Shared by the user
   *  and assistant message of a turn (they carry the same taskId). */
  sourceGrounded: boolean | null;
};

/* ── Round 91: source-read status (mirror of server SourceReadResult) ───────── */

/**
 * The JSON the server persists on a task after `readSource` runs. It is deliberately
 * SEPARATE from the AI answer: a manager can see the source was read (or exactly why it
 * could not be) independently of whether the model produced anything. `ok:false` never
 * means “the AI failed” — it means the SOURCE could not be turned into text.
 */
export type SourceStatus =
  | {
      ok: true;
      kind: "url" | "text" | "pdf" | "image";
      label: string;
      url?: string;
      chars?: number;
      thin?: boolean;
      warnings?: string[];
    }
  | {
      ok: false;
      kind: "url" | "text" | "pdf" | "image";
      reason: "url_unreadable" | "thin_fetch" | "pdf_unreadable" | "image_unreadable" | "storage_error";
      message: string;
      retryHint: string;
    };

/** Shared source-kind icon (url/pdf/image/text). `className` lets call sites match
 *  their own sizing — the compact Transcript badges use a smaller icon than the
 *  full-width SourceStatusPanel. Consolidates what used to be two near-duplicate
 *  helpers (this one, and Transcript's SOURCE_KIND_ICON). */
function sourceKindIcon(kind: string | null, className = "w-3.5 h-3.5") {
  if (kind === "url") return <Link2 className={className} />;
  if (kind === "pdf") return <FileText className={className} />;
  if (kind === "image") return <ImageIcon className={className} />;
  if (kind === "text") return <TypeIcon className={className} />;
  return null;
}

/**
 * Renders the source-read outcome as a compact panel. Green when the source was read
 * (with char count + any thin-page / AI-transcription caveats); amber when it could NOT
 * be read, showing the human message + the exact retry hint (paste text / upload a PDF /
 * upload a screenshot). Renders nothing when there is no status (e.g. no source attached).
 */
export function SourceStatusPanel({ status }: { status: SourceStatus | null | undefined }) {
  if (!status) return null;
  if (status.ok) {
    return (
      <div className="rounded-md border border-emerald-500/25 bg-emerald-500/[0.06] px-3 py-2 text-xs text-foreground">
        <div className="flex items-center gap-2 font-medium">
          <FileCheck2 className="w-3.5 h-3.5 text-emerald-600" />
          <span className="inline-flex items-center gap-1">
            {sourceKindIcon(status.kind)} Source read
          </span>
          {typeof status.chars === "number" && (
            <span className="text-muted-foreground">· {status.chars.toLocaleString()} characters</span>
          )}
        </div>
        <div className="mt-1 truncate text-muted-foreground" title={status.url ?? status.label}>
          {status.label}
          {status.url ? ` — ${status.url}` : ""}
        </div>
        {status.warnings && status.warnings.length > 0 && (
          <ul className="mt-1.5 space-y-1">
            {status.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-amber-600">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.08] px-3 py-2 text-xs text-foreground">
      <div className="flex items-center gap-2 font-medium text-amber-700">
        <FileWarning className="w-3.5 h-3.5" />
        <span className="inline-flex items-center gap-1">{sourceKindIcon(status.kind)} Couldn&rsquo;t read the source</span>
      </div>
      <div className="mt-1">{status.message}</div>
      <div className="mt-1 text-muted-foreground">{status.retryHint}</div>
    </div>
  );
}

/* ── Round 96: pollable research-task flow (shared by Ask AI + Catalogue Review) ─
 *
 * Every AI enquiry/review runs as a SERVER task that we drive without holding one
 * long request open:
 *   1. start*  → persists a queued task, returns { taskId, threadId } immediately
 *   2. process → kicks the task's read→ask→extract pipeline (may run long server-side)
 *   3. poll getTask every ~1.4s → surface the live STAGE label until a terminal stage
 * The staged status (queued → reading source → asking AI → extracting → done) is shown
 * to the manager so a slow source read never looks like a hang. Terminal stages are
 * done / needs_source_fix / failed. This mirrors the serverless-friendly contract and
 * keeps the strict review gate (unreadable source ⇒ needs_source_fix, zero findings).
 */

export type TaskStage =
  | "queued"
  | "reading_source"
  | "asking_ai"
  | "extracting"
  | "done"
  | "needs_source_fix"
  | "failed";

export const STAGE_LABELS: Record<TaskStage, string> = {
  queued: "Queued…",
  reading_source: "Reading source…",
  asking_ai: "Asking AI…",
  extracting: "Extracting findings…",
  done: "Done",
  needs_source_fix: "Couldn’t read the source",
  failed: "Failed",
};

const ACTIVE_STAGES: TaskStage[] = ["queued", "reading_source", "asking_ai", "extracting"];
export function isActiveStage(stage: string | null | undefined): boolean {
  return !!stage && (ACTIVE_STAGES as string[]).includes(stage);
}

/** A compact live progress row for an in-flight task (spinner + staged label). */
export function TaskStageProgress({ stage }: { stage: TaskStage | null }) {
  if (!stage || !isActiveStage(stage)) return null;
  const order: TaskStage[] = ["queued", "reading_source", "asking_ai", "extracting"];
  const activeIdx = order.indexOf(stage);
  return (
    <div className="rounded-md border border-primary/25 bg-primary/[0.04] px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2 font-medium text-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
        {STAGE_LABELS[stage]}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        {order.map((s, i) => (
          <div
            key={s}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= activeIdx ? "bg-primary" : "bg-border",
            )}
            title={STAGE_LABELS[s]}
          />
        ))}
      </div>
    </div>
  );
}

/** Round 103 — extraction diagnostic when extraction was expected but produced nothing. */
export type ExtractionDiagnostic = {
  attempted: boolean;
  reason: string | null;
  sourceClass: string | null;
  charsRead: number;
  forcedByIntent: boolean;
};

export type ResearchTaskResult = {
  taskId: number;
  threadId: number | null;
  answer: string;
  model: string | null;
  findings: Finding[];
  stage: TaskStage;
  sourceStatus: SourceStatus | null;
  /** Round 102 — detected source class when structured extraction ran. */
  sourceClass?: string | null;
  /** Round 103 — extraction diagnostic when extraction was expected but produced nothing. */
  extractionDiagnostic?: ExtractionDiagnostic | null;
};

/**
 * Drive one research task from start to a terminal stage. Returns a `run(start)`
 * callback: `start` is an async fn that creates the queued task and returns
 * `{ taskId, threadId }` (e.g. `startResearchTask` or `startReviewTask`). The hook
 * then calls `processResearchTask` and polls `getTask` until a terminal stage,
 * exposing `stage` (for the live label) and the final `result`.
 */
export function useResearchTaskPoller() {
  const utils = trpc.useUtils();
  const process = trpc.research.processResearchTask.useMutation();
  const [stage, setStage] = useState<TaskStage | null>(null);
  const [running, setRunning] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    return () => {
      cancelled.current = true;
    };
  }, []);

  const run = useCallback(
    async (
      start: () => Promise<{ taskId: number; threadId: number | null }>,
      /** Round 102 — optional intake mode forwarded to processResearchTask. */
      opts?: { intakeMode?: "ask" | "extract" },
    ): Promise<ResearchTaskResult> => {
      cancelled.current = false;
      setRunning(true);
      setStage("queued");
      try {
        const { taskId } = await start();
        // Kick the pipeline. This resolves when the task reaches a terminal stage;
        // meanwhile we poll getTask so the UI shows intermediate stages promptly.
        const processing = process.mutateAsync({ taskId, intakeMode: opts?.intakeMode });
        let reachedTerminal = false;
        const poll = async () => {
          while (!cancelled.current && !reachedTerminal) {
            await new Promise((r) => setTimeout(r, 1400));
            if (cancelled.current) return;
            try {
              const snap = await utils.research.getTask.fetch({ id: taskId });
              const st = (snap.task?.stage ?? "queued") as TaskStage;
              setStage(st);
              if (!isActiveStage(st)) reachedTerminal = true;
            } catch {
              /* transient poll error — keep polling until process resolves */
            }
          }
        };
        const polling = poll();
        // The authoritative terminal state is whatever `processResearchTask` returns
        // (it resolves the task to a terminal stage). The poll loop only exists to keep
        // the live STAGE label fresh while process is in flight.
        const done = await processing;
        reachedTerminal = true;
        await polling.catch(() => {});
        const finalStage = (done.stage ?? "done") as TaskStage;
        setStage(finalStage);
        const result: ResearchTaskResult = {
          taskId: done.taskId,
          threadId: done.threadId ?? null,
          answer: done.answer ?? "",
          model: done.model ?? null,
          findings: (done.findings ?? []) as unknown as Finding[],
          stage: finalStage,
          sourceStatus: (done.sourceStatus ?? null) as SourceStatus | null,
          sourceClass: (done as Record<string, unknown>).sourceClass as string | null | undefined,
          extractionDiagnostic: (done as Record<string, unknown>).extractionDiagnostic as ExtractionDiagnostic | null | undefined,
        };
        return result;
      } finally {
        setRunning(false);
      }
    },
    [process, utils],
  );

  const reset = useCallback(() => {
    setStage(null);
    setRunning(false);
  }, []);

  return { run, stage, running, reset };
}

/* ── Correct-a-figure dialog: versions the finding + drafts the fix ─────────── */

function CorrectFigureDialog({
  finding,
  open,
  onOpenChange,
  onDone,
}: {
  finding: Finding;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onDone: () => void;
}) {
  // Stage 10b-2b — for CBK only, the dropdown now offers established
  // contract fields with their clean labels, sourced back to the RAW key a
  // correction must actually overwrite (resolveRawFigureKey — never the
  // canonical key when the raw extraction used an alias, which would leave
  // a stale duplicate figure behind). Every other catalogue keeps the
  // original unfiltered fmtFields behavior — raw keys, no established-field
  // filtering — completely unchanged.
  const cbkCorrectionContract = finding.targetCatalogue === "cbk" ? getCatalogueFieldContract("cbk") : null;
  const cbkCorrectionFields = cbkCorrectionContract
    ? (() => {
        const raw = (finding.extractedFields ?? {}) as Record<string, unknown>;
        const out: { key: string; value: string; missing?: boolean; label: string }[] = [];
        for (const f of cbkCorrectionContract.fields) {
          if (f.storageStatus !== "column" && f.storageStatus !== "extendedFields") continue;
          const rawKey = resolveRawFigureKey(f, raw);
          if (!rawKey) continue;
          out.push({ key: rawKey, value: String(raw[rawKey]), missing: false, label: f.label });
        }
        return out;
      })()
    : null;
  const fields = cbkCorrectionFields ?? fmtFields(finding.extractedFields).map((f) => ({ ...f, label: f.key }));
  const [field, setField] = useState<string>(fields[0]?.key ?? "");
  const [newValue, setNewValue] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  // Round 2 — a manager-cited source for THIS corrected value, first-class alongside an
  // AI-found one. The original finding's source (if any) is reused by default; a manager
  // supplies their own only when the value comes from somewhere else. When the original
  // has NO source at all, one is mandatory here (every field must carry a source + as-of).
  const hasOriginalSource = Boolean(finding.sourceLabel || finding.sourceUrl);
  const [useOwnSource, setUseOwnSource] = useState<boolean>(!hasOriginalSource);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [sourceUrl, setSourceUrl] = useState<string>("");
  const [sourceAsOf, setSourceAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const correct = trpc.research.correctFinding.useMutation({
    onSuccess: () => {
      toast.success("Correction recorded and drafted into the review queue — approve it there to update the catalogue.");
      onOpenChange(false);
      setNewValue("");
      setReason("");
      setUseOwnSource(!hasOriginalSource);
      setSourceLabel("");
      setSourceUrl("");
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  const oldValue = fields.find((f) => f.key === field)?.value ?? "—";
  const sourceRequired = useOwnSource || !hasOriginalSource;
  const canSubmit =
    field.trim() !== "" &&
    newValue.trim() !== "" &&
    reason.trim().length >= 3 &&
    (!sourceRequired || sourceLabel.trim() !== "") &&
    !correct.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4 text-primary" /> Correct a figure
          </DialogTitle>
          <DialogDescription>
            This never edits the original finding or any catalogue. It records a new, corrected version and drafts a
            governed edit (old → new + your reason) into the review queue for you to approve.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Figure to correct</Label>
            {fields.length > 0 ? (
              <Select value={field} onValueChange={setField}>
                <SelectTrigger className="bg-background">
                  <SelectValue placeholder="Pick a figure" />
                </SelectTrigger>
                <SelectContent>
                  {fields.map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label} (currently {f.value})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                placeholder="Figure key, e.g. yieldPct"
                value={field}
                onChange={(e) => setField(e.target.value)}
                className="bg-background"
              />
            )}
          </div>

          <div className="flex items-center gap-3 text-sm">
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Current value</Label>
              <div className="mt-1 rounded-md border border-border bg-muted/40 px-3 py-2 tabular-nums text-muted-foreground line-through">
                {oldValue}
              </div>
            </div>
            <ArrowRight className="w-4 h-4 mt-5 shrink-0 text-muted-foreground" />
            <div className="flex-1">
              <Label className="text-xs text-muted-foreground">Corrected value</Label>
              <Input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="e.g. 15.98"
                className="mt-1 bg-background tabular-nums"
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Reason (recorded on the correction + review item)</Label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. The fact sheet quotes the net effective annual rate; the AI read the gross figure."
              rows={3}
            />
          </div>

          {/* Round 2 — source for the corrected value. Every field, AI-found or
              manager-entered, carries its own source + as-of date. */}
          <div className="space-y-2 rounded-md border border-border p-3">
            {hasOriginalSource ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">Source for this value</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setUseOwnSource((v) => !v)}
                  >
                    {useOwnSource ? "Use the original source instead" : "I have a different source"}
                  </Button>
                </div>
                {!useOwnSource && (
                  <p className="text-xs text-muted-foreground">
                    Reusing the finding's original source: <span className="font-medium">{finding.sourceLabel ?? finding.sourceUrl}</span>
                    {finding.sourceAsOf ? ` (as of ${formatUtcYmd(finding.sourceAsOf)})` : ""}.
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This finding has no source. Provide one for your corrected value below — every figure must carry a source.
              </p>
            )}
            {sourceRequired && (
              <div className="space-y-2 pt-1">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source label (e.g. publication, document, or bank statement)</Label>
                  <Input
                    value={sourceLabel}
                    onChange={(e) => setSourceLabel(e.target.value)}
                    placeholder="e.g. CIC MMF fact sheet, June 2026"
                    className="bg-background"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Source URL (optional)</Label>
                    <Input
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://…"
                      className="bg-background"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">As of date</Label>
                    <Input
                      type="date"
                      value={sourceAsOf}
                      onChange={(e) => setSourceAsOf(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)} disabled={correct.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              correct.mutate({
                findingId: finding.id,
                field: field.trim(),
                newValue: newValue.trim(),
                reason: reason.trim(),
                ...(sourceRequired
                  ? {
                      sourceLabel: sourceLabel.trim(),
                      ...(sourceUrl.trim() !== "" ? { sourceUrl: sourceUrl.trim() } : {}),
                      ...(sourceAsOf.trim() !== "" ? { sourceAsOf: sourceAsOf.trim() } : {}),
                    }
                  : {}),
              })
            }
            disabled={!canSubmit}
          >
            {correct.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Pencil className="w-3.5 h-3.5 mr-1.5" />}
            Record correction & draft fix
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── A single finding card (draft / dismiss / correct) ──────────────────────── */

export function FindingCard({
  finding,
  onChanged,
  onSuggestQuestion,
}: {
  finding: Finding;
  onChanged: () => void;
  /** Stage 5 — populates the enclosing follow-up composer with a suggested question
   *  and sets its source mode to "reuse previous". Optional: other FindingCard call
   *  sites (catalogue review, superseded findings) have no composer to fill, and the
   *  suggestion chips simply don't render when this is omitted. */
  onSuggestQuestion?: (text: string) => void;
}) {
  const [correctOpen, setCorrectOpen] = useState(false);
  const draft = trpc.research.draftFromFinding.useMutation({
    onSuccess: () => {
      toast.success("Drafted into the review queue — nothing changes until you approve it there.");
      onChanged();
    },
    onError: (err) => toast.error(err.message),
  });
  const dismiss = trpc.research.dismissFinding.useMutation({
    onSuccess: () => {
      toast.success("Finding dismissed.");
      onChanged();
    },
    onError: (err) => toast.error(err.message),
  });

  const conf = CONFIDENCE_META[finding.confidence] ?? CONFIDENCE_META.low;
  const fields = fmtFields(finding.extractedFields);
  const missing = finding.missingFields ?? [];
  // Slice 8b — MMF findings only: project the finding into the fixed MMF catalogue
  // field contract (shared/catalogueFieldContracts.ts) instead of an arbitrary raw
  // extracted-field list. mmfContract is null for every other catalogue, so nothing
  // below changes for CBK/bank/market-asset findings (those stay on 8a's foundation
  // only, not yet wired).
  const mmfContract = finding.targetCatalogue === "mmf" ? getCatalogueFieldContract("mmf") : null;
  // sourceLink/sourceAsOf are excluded from THIS grid only — they're already shown,
  // correctly formatted (a real date, a real link), by the card's existing source
  // line below. The contract itself still fully defines both (and drives the
  // figures projection's exclusion logic) — this is a display-only omission to
  // avoid a raw duplicate epoch-ms string, not a contract change.
  const mmfDisplayRows = mmfContract
    ? projectFindingToContractDisplayRows(mmfContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8c — Bank findings only, same pattern as Slice 8b's MMF wiring above.
  // bankContract is null for every other catalogue, so nothing below changes for
  // MMF/CBK/market-asset findings (MMF stays on 8b's own wiring; CBK/market-asset
  // stay on 8a's foundation only, not yet wired).
  const bankContract = finding.targetCatalogue === "bank" ? getCatalogueFieldContract("bank") : null;
  const bankDisplayRows = bankContract
    ? projectFindingToContractDisplayRows(bankContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8d — CBK findings only, same pattern as Slices 8b/8c above. cbkContract
  // is null for every other catalogue, so nothing below changes for MMF/bank/
  // market-asset findings (market-asset stays on 8a's foundation only, not yet
  // wired).
  const cbkContract = finding.targetCatalogue === "cbk" ? getCatalogueFieldContract("cbk") : null;
  const cbkDisplayRows = cbkContract
    ? projectFindingToContractDisplayRows(cbkContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8e-1 — Market asset EQUITY findings only, same pattern as Slices
  // 8b/8c/8d above. equityContract is null for every other catalogue/subtype, so
  // nothing below changes for MMF/bank/CBK findings, or for REIT/offshore-fund/
  // SACCO/other market-asset subtypes (those stay on 8a's foundation only, not
  // yet wired — their own slices come later).
  const equityContract =
    finding.targetCatalogue === "market_asset" && finding.assetClass === "equity"
      ? getCatalogueFieldContract("market_asset", "equity")
      : null;
  const equityDisplayRows = equityContract
    ? projectFindingToContractDisplayRows(equityContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8e-2 — Market asset REIT findings only, same pattern as Slice 8e-1
  // above. reitContract is null for every other catalogue/subtype, so nothing
  // below changes for MMF/bank/CBK/Equity findings, or for offshore-fund/SACCO/
  // other market-asset subtypes (those stay on 8a's foundation only, not yet
  // wired — their own slices come later).
  const reitContract =
    finding.targetCatalogue === "market_asset" && finding.assetClass === "reit"
      ? getCatalogueFieldContract("market_asset", "reit")
      : null;
  const reitDisplayRows = reitContract
    ? projectFindingToContractDisplayRows(reitContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8e-3 — Market asset Offshore fund findings only, same pattern as
  // Slice 8e-2 above. offshoreFundContract is null for every other catalogue/
  // subtype, so nothing below changes for MMF/bank/CBK/Equity/REIT findings,
  // or for SACCO/other market-asset subtypes (those stay on 8a's foundation
  // only, not yet wired — their own slice comes later).
  const offshoreFundContract =
    finding.targetCatalogue === "market_asset" && finding.assetClass === "offshore_fund"
      ? getCatalogueFieldContract("market_asset", "offshore_fund")
      : null;
  const offshoreFundDisplayRows = offshoreFundContract
    ? projectFindingToContractDisplayRows(offshoreFundContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Slice 8e-4 — Market asset SACCO findings only, the LAST market-asset
  // subtype. Unlike Equity/REIT/Offshore fund, SACCO shares assetClass "alt"
  // with ETF/property/pension/other (assetClassForMarketAssetType has no
  // distinct "sacco" value) — so it can't be gated on finding.assetClass the
  // same way. Instead this checks the raw AI-extracted assetType directly,
  // mirroring detectMarketAssetSacco()'s own primary detection signal in
  // shared/researchPipeline.ts. saccoContract is null for every other
  // catalogue/subtype, so nothing below changes for MMF/bank/CBK/Equity/REIT/
  // Offshore-fund findings, or for ETF/property/pension/other market-asset
  // subtypes (those have no contract at all — see UNSUPPORTED_MARKET_ASSET_SUBTYPES).
  const saccoContract =
    finding.targetCatalogue === "market_asset" &&
    String(finding.extractedFields?.assetType ?? "").trim().toLowerCase() === "sacco"
      ? getCatalogueFieldContract("market_asset", "sacco")
      : null;
  const saccoDisplayRows = saccoContract
    ? projectFindingToContractDisplayRows(saccoContract, finding).filter(
        (row) => row.key !== "sourceLink" && row.key !== "sourceAsOf",
      )
    : null;
  // Stage 5 — deterministic, template-based follow-up questions for each missing
  // gate field (pure, no LLM). Never implies a value was found — only asks. Stage
  // 7c sharpens the wording when Stage 7b's extraction already found a candidate
  // phrase for that field (parsed safely — malformed/absent JSON just yields no
  // candidates, falling back to the exact same generic questions as before).
  const candidatePhrases = parseCandidatePhrases(finding.extractedFields?._candidatePhrases);
  const suggestedFollowUps = suggestFollowUpQuestions(finding.missingRules ?? [], finding.instrumentName, candidatePhrases);
  const warnings = finding.warnings ?? [];
  const isDrafted = finding.status === "drafted";
  const isDismissed = finding.status === "dismissed";
  const isSuperseded = finding.status === "superseded" || finding.supersededById != null;
  const isCorrection = finding.supersedesId != null;
  const busy = draft.isPending || dismiss.isPending;

  return (
    <Card className={`overflow-hidden ${isDismissed || isSuperseded ? "opacity-60" : ""} ${isCorrection ? "border-primary/30" : ""}`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              <Bot className="w-4 h-4 text-violet-500 shrink-0" />
              {finding.instrumentName}
              {finding.targetCatalogue && (
                <Badge variant="outline" className="font-normal text-[11px]">
                  {catalogueLabel(finding.targetCatalogue as ReferenceCatalogue)}
                </Badge>
              )}
              {(() => {
                try {
                  const raw = finding.extractedFields?._extendedFields;
                  if (!raw) return null;
                  const ext = typeof raw === "string" ? JSON.parse(raw as string) : raw;
                  const sc = ext?.sourceClass;
                  if (sc && isSourceClass(sc) && sc !== "unknown") {
                    return (
                      <Badge variant="outline" className="font-normal text-[11px] bg-violet-500/10 text-violet-600 border-violet-500/20">
                        {SOURCE_CLASS_LABELS[sc]}
                      </Badge>
                    );
                  }
                } catch { /* ignore parse errors */ }
                return null;
              })()}
              <Badge variant="outline" className={`font-normal text-[11px] ${conf.className}`}>
                {conf.label}
              </Badge>
              {/* Round 98: Proposal type badge */}
              {(() => {
                const pt = finding.extractedFields?._proposalType as string | undefined;
                if (!pt) return null;
                if (pt === "create") return (
                  <Badge variant="outline" className="font-normal text-[11px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                    <Plus className="w-3 h-3 mr-0.5" /> New
                  </Badge>
                );
                if (pt === "update") return (
                  <Badge variant="outline" className="font-normal text-[11px] bg-blue-500/10 text-blue-600 border-blue-500/20">
                    <Pencil className="w-3 h-3 mr-0.5" /> Update
                  </Badge>
                );
                if (pt === "stale") return (
                  <Badge variant="outline" className="font-normal text-[11px] bg-amber-500/10 text-amber-600 border-amber-500/20">
                    <AlertTriangle className="w-3 h-3 mr-0.5" /> Stale
                  </Badge>
                );
                return null;
              })()}
              {isCorrection && (
                <Badge variant="outline" className="font-normal text-[11px] bg-primary/10 text-primary border-primary/20">
                  <GitBranch className="w-3 h-3 mr-1" /> corrected version
                </Badge>
              )}
              {isSuperseded && (
                <Badge variant="outline" className="font-normal text-[11px]">
                  superseded
                </Badge>
              )}
              {isDrafted && (
                <Badge variant="outline" className="font-normal text-[11px] bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
                  <CheckCircle2 className="w-3 h-3 mr-1" /> in review queue
                </Badge>
              )}
              {isDismissed && (
                <Badge variant="outline" className="font-normal text-[11px]">
                  dismissed
                </Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1">
              {finding.issuer ? `${finding.issuer} · ` : ""}
              {finding.currency ?? "KES"}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Round 98: Diff table for update/stale proposals */}
        <ComparisonDiffTable extractedFields={finding.extractedFields} />

        {/* Slice 8b — the fixed MMF quick-decision fields from the catalogue field
            contract, in contract order. This is the PRIMARY view for an MMF finding;
            the raw/grouped extraction below becomes secondary source context — never
            removed, just no longer the first thing a manager maps from. Every other
            catalogue is untouched (mmfDisplayRows is null for them). */}
        {mmfDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                MMF catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {mmfDisplayRows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {row.value ? (
                      <span className="font-medium tabular-nums">{row.value}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slice 8c — the fixed Bank quick-decision fields from the catalogue field
            contract, in contract order. Same purpose as the MMF block above: PRIMARY
            view for a Bank finding, raw/grouped extraction below becomes secondary
            source context. Every other catalogue is untouched (bankDisplayRows is
            null for them). */}
        {bankDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                Bank catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {bankDisplayRows.map((row) => {
                // Stage 10b-1b — productType is still the raw enum
                // ("fixed_deposit") until promotion canonicalizes it; show
                // the same clean label BankInstruments.tsx's own catalogue
                // table and ResearchDesk.tsx's review queue/approval modal use.
                const displayValue =
                  row.key === "productType" ? (bankInstrumentTypeLabel(row.value) ?? row.value) : row.value;
                return (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {displayValue ? (
                      <span className="font-medium tabular-nums">{displayValue}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Slice 8d — the fixed CBK quick-decision fields from the catalogue field
            contract, in contract order. Same purpose as the MMF/Bank blocks above:
            PRIMARY view for a CBK finding, raw/grouped extraction below becomes
            secondary source context. Every other catalogue is untouched
            (cbkDisplayRows is null for them). */}
        {cbkDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                CBK catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {cbkDisplayRows.map((row) => {
                // Stage 10b-2 — securityType/taxExempt are still the raw
                // extraction value ("treasury_bill", "true"/"false") until
                // promotion/display formats them; show the same clean labels
                // the CBK catalogue table and ResearchDesk.tsx use.
                // Stage 10b-2b — netYieldAfterWht computed from the SAME
                // sibling rows (yieldPct/whtRule/taxExempt), instead of
                // always falling through to the generic "calculated at
                // approval" placeholder below — a live QA repro showed this
                // computable value ("10.50% at 15% WHT") going unshown.
                const displayValue =
                  row.key === "securityType"
                    ? (cbkSecurityTypeLabel(row.value) ?? row.value)
                    : row.key === "taxExempt"
                      ? (cbkTaxExemptLabel(row.value) ?? row.value)
                      : row.key === "netYieldAfterWht"
                        ? (() => {
                            const y = cbkDisplayRows.find((r) => r.key === "yieldPct")?.value ?? null;
                            const w = cbkDisplayRows.find((r) => r.key === "whtRule")?.value ?? null;
                            const t = cbkDisplayRows.find((r) => r.key === "taxExempt")?.value ?? null;
                            const net = cbkNetYieldAfterWht(y, w, t);
                            return net === null ? null : `${net.toFixed(2)}%`;
                          })()
                        : row.value;
                return (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {displayValue ? (
                      <span className="font-medium tabular-nums">{displayValue}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Slice 8e-1 — the fixed Equity quick-decision fields from the catalogue
            field contract, in contract order. Same purpose as the MMF/Bank/CBK
            blocks above: PRIMARY view for an Equity finding, raw/grouped
            extraction below becomes secondary source context. Every other
            catalogue/subtype is untouched (equityDisplayRows is null for them). */}
        {equityDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                Equity catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {equityDisplayRows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {row.value ? (
                      <span className="font-medium tabular-nums">{row.value}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slice 8e-2 — the fixed REIT quick-decision fields from the catalogue
            field contract, in contract order. Same purpose as the MMF/Bank/CBK/
            Equity blocks above: PRIMARY view for a REIT finding, raw/grouped
            extraction below becomes secondary source context. Every other
            catalogue/subtype is untouched (reitDisplayRows is null for them). */}
        {reitDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                REIT catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {reitDisplayRows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {row.value ? (
                      <span className="font-medium tabular-nums">{row.value}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slice 8e-3 — the fixed Offshore fund quick-decision fields from the
            catalogue field contract, in contract order. Same purpose as the
            MMF/Bank/CBK/Equity/REIT blocks above: PRIMARY view for an offshore
            fund finding, raw/grouped extraction below becomes secondary source
            context. Every other catalogue/subtype is untouched
            (offshoreFundDisplayRows is null for them). */}
        {offshoreFundDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                Offshore fund catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {offshoreFundDisplayRows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {row.value ? (
                      <span className="font-medium tabular-nums">{row.value}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Slice 8e-4 — the fixed SACCO quick-decision fields from the catalogue
            field contract, in contract order — the LAST market-asset subtype.
            Same purpose as the MMF/Bank/CBK/Equity/REIT/Offshore-fund blocks
            above: PRIMARY view for a SACCO finding, raw/grouped extraction below
            becomes secondary source context. Every other catalogue/subtype is
            untouched (saccoDisplayRows is null for them). */}
        {saccoDisplayRows && (
          <div className="rounded-lg border border-primary/25 bg-primary/[0.03] overflow-hidden">
            <div className="px-3 py-2 border-b border-primary/15 bg-primary/[0.05]">
              <span className="text-xs font-medium text-foreground uppercase tracking-wide">
                SACCO catalogue fields
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 px-3 py-2.5">
              {saccoDisplayRows.map((row) => (
                <div key={row.key} className="min-w-0">
                  <span className="text-[11px] text-muted-foreground">
                    {row.label}
                    {row.required && <span className="text-amber-600"> *</span>}
                  </span>
                  <div className="text-sm truncate">
                    {row.value ? (
                      <span className="font-medium tabular-nums">{row.value}</span>
                    ) : row.storageStatus === "computed" ? (
                      <span className="text-muted-foreground/60 italic text-xs">calculated at approval</span>
                    ) : row.storageStatus === "missingRequiresMigration" ? (
                      <span className="text-muted-foreground/60 italic text-xs">not yet trackable</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Round 102 — grouped instrument profile preview (replaces flat field list when _extendedFields is present) */}
        {(mmfDisplayRows ||
          bankDisplayRows ||
          cbkDisplayRows ||
          equityDisplayRows ||
          reitDisplayRows ||
          offshoreFundDisplayRows ||
          saccoDisplayRows) && (
          <p className="text-[11px] text-muted-foreground -mb-1">Additional extracted details:</p>
        )}
        {(() => {
          const extRaw = finding.extractedFields?._extendedFields;
          if (extRaw) {
            return <InstrumentProfilePreview extendedFieldsRaw={extRaw} missingFields={finding.missingFields} />;
          }
          // Fallback: flat field list for findings without a rich profile
          return fields.length > 0 ? (
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              {fields.map((f) => (
                <div key={f.key} className="text-sm">
                  <span className="text-muted-foreground">{f.key}: </span>
                  {f.missing ? (
                    <span className="italic text-amber-600 text-xs">Missing from source</span>
                  ) : (
                    <span className="font-medium tabular-nums">{f.value}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic">No figures extracted — identity only.</p>
          );
        })()}

        {isCorrection && finding.correctionReason && (
          <div className="flex items-start gap-2 rounded-md border border-primary/25 bg-primary/[0.05] px-3 py-2 text-xs text-foreground">
            <Pencil className="w-3.5 h-3.5 mt-0.5 shrink-0 text-primary" />
            <span>
              Corrected{finding.correctedBy ? ` by ${finding.correctedBy}` : ""}: {finding.correctionReason}
            </span>
          </div>
        )}

        {finding.rawExcerpt && (
          <p className="flex items-start gap-1.5 text-xs text-muted-foreground italic border-l-2 border-border pl-2.5">
            <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>&ldquo;{finding.rawExcerpt}&rdquo;</span>
          </p>
        )}

        {missing.length > 0 && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs">
            <div className="flex items-center gap-2 mb-1.5">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
              <span className="font-medium text-amber-700">
                {missing.length} field{missing.length === 1 ? "" : "s"} missing for a complete{" "}
                {finding.targetCatalogue ? catalogueLabel(finding.targetCatalogue as ReferenceCatalogue) : "catalogue"} entry
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 ml-5.5 pl-0.5">
              {missing.map((m) => (
                <Badge
                  key={m}
                  variant="outline"
                  className="font-normal text-[10px] bg-amber-500/10 text-amber-700 border-amber-500/25 px-1.5 py-0"
                >
                  {m}
                </Badge>
              ))}
            </div>
            <p className="text-[11px] text-amber-600/80 mt-1.5 ml-5.5 pl-0.5">
              You can still draft it and vouch a value at approval.
            </p>
            {/* Stage 5 — suggested follow-up questions. Only rendered when a composer
                is available to receive them (onSuggestQuestion is optional). Clicking
                only fills the composer below — it never sends, never auto-fills a
                field, and never drafts or approves anything on its own. */}
            {onSuggestQuestion && suggestedFollowUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2 ml-5.5 pl-0.5">
                {suggestedFollowUps.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onSuggestQuestion(s.question)}
                    className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-background px-2.5 py-1 text-[11px] text-amber-700 hover:bg-amber-500/10 transition-colors"
                  >
                    <MessageSquarePlus className="w-3 h-3" /> Ask: {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {warnings.length > 0 && (
          <ul className="text-xs text-muted-foreground space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0 text-amber-500" /> {w}
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
          <span>
            Source: <span className="text-foreground">{finding.sourceLabel ?? "Ask-AI research (unverified)"}</span>
          </span>
          {finding.sourceUrl && (
            <a
              href={finding.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-primary hover:underline"
            >
              open <ExternalLink className="w-3 h-3" />
            </a>
          )}
          {finding.sourceAsOf && <span>· as of {formatUtcYmd(finding.sourceAsOf)}</span>}
        </div>

        {/* Round 103 — unsourced finding warning */}
        {finding.extractedFields?._unsourced === "true" && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
            <span className="text-amber-700 dark:text-amber-300">
              <span className="font-medium">Not grounded in a source.</span> This finding is based on general knowledge and should be verified with a primary source before drafting.
            </span>
          </div>
        )}

        {!isDrafted && !isDismissed && !isSuperseded && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button
              size="sm"
              onClick={() => {
                // Slice 8b/8c/8d/8e-1/8e-2/8e-3/8e-4 — MMF, Bank, CBK, Equity, REIT,
                // Offshore fund and SACCO findings draft ONLY their fixed catalogue
                // contract's figures, never the raw arbitrary extraction. undefined
                // for every other catalogue/subtype leaves draftFromFinding's
                // existing default (the finding's raw extractedFields) completely
                // unchanged.
                const mmfFigures = mmfContract ? projectFindingToContractFigures(mmfContract, finding) : undefined;
                const bankFigures = bankContract ? projectFindingToContractFigures(bankContract, finding) : undefined;
                const cbkFigures = cbkContract ? projectFindingToContractFigures(cbkContract, finding) : undefined;
                const equityFigures = equityContract ? projectFindingToContractFigures(equityContract, finding) : undefined;
                const reitFigures = reitContract ? projectFindingToContractFigures(reitContract, finding) : undefined;
                const offshoreFundFigures = offshoreFundContract
                  ? projectFindingToContractFigures(offshoreFundContract, finding)
                  : undefined;
                const saccoFigures = saccoContract ? projectFindingToContractFigures(saccoContract, finding) : undefined;
                draft.mutate({
                  findingId: finding.id,
                  figures:
                    mmfFigures ??
                    bankFigures ??
                    cbkFigures ??
                    equityFigures ??
                    reitFigures ??
                    offshoreFundFigures ??
                    saccoFigures,
                });
              }}
              disabled={busy}
              variant={finding.extractedFields?._unsourced === "true" ? "outline" : "default"}
              className={finding.extractedFields?._unsourced === "true" ? "bg-background" : ""}
            >
              {draft.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
              )}
              {finding.extractedFields?._unsourced === "true" ? "Draft anyway (unverified)" : "Draft into review queue"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => setCorrectOpen(true)}
              disabled={busy}
            >
              <Pencil className="w-3.5 h-3.5 mr-1.5" /> Correct a figure
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="bg-background"
              onClick={() => dismiss.mutate({ findingId: finding.id })}
              disabled={busy}
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Dismiss
            </Button>
          </div>
        )}
      </CardContent>

      <CorrectFigureDialog finding={finding} open={correctOpen} onOpenChange={setCorrectOpen} onDone={onChanged} />
    </Card>
  );
}

/* ── Unified source attachment (item 1): url | text | pdf | image ───────────── */

type SourceMode = "url" | "text" | "pdf" | "image";

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function imageMimeFor(file: File): "image/png" | "image/jpeg" | "image/webp" {
  const t = file.type.toLowerCase();
  if (t.includes("webp")) return "image/webp";
  if (t.includes("jpeg") || t.includes("jpg")) return "image/jpeg";
  return "image/png";
}

export type AskSource =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string }
  | { kind: "pdf"; fileKey: string }
  | { kind: "image"; fileKey: string };

/**
 * A self-contained source attachment editor. Manages its own mode + inputs and,
 * on submit, resolves any file upload before handing back a ready AskSource (or
 * null when nothing is attached). Reused by both the opening box and the follow-up
 * composer so every turn can carry its OWN source.
 */
export function useSourceAttachment(opts?: { followUp?: boolean; initialUrl?: string }) {
  const followUp = opts?.followUp ?? false;
  const upload = trpc.opportunities.aiUploadDocument.useMutation();
  const [show, setShow] = useState(!!opts?.initialUrl);
  const [mode, setMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState(opts?.initialUrl ?? "");
  const [text, setText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [label, setLabel] = useState("");
  const [uploading, setUploading] = useState(false);

  const provided =
    show &&
    (mode === "url"
      ? /^https?:\/\//.test(url.trim())
      : mode === "text"
        ? text.trim().length >= 20
        : mode === "pdf"
          ? !!pdfFile
          : !!imageFile);

  function reset() {
    setShow(false);
    setUrl("");
    setText("");
    setPdfFile(null);
    setImageFile(null);
    setLabel("");
  }

  async function resolve(): Promise<{ source: AskSource | null; label: string | null }> {
    const lbl = label.trim() === "" ? null : label.trim();
    if (!provided) return { source: null, label: null };
    if (mode === "url") return { source: { kind: "url", url: url.trim() }, label: lbl };
    if (mode === "text") return { source: { kind: "text", text: text.trim() }, label: lbl };
    if (mode === "pdf" && pdfFile) {
      setUploading(true);
      try {
        const base64 = await fileToBase64(pdfFile);
        const { fileKey } = await upload.mutateAsync({ base64, fileName: pdfFile.name, mimeType: "application/pdf" });
        return { source: { kind: "pdf", fileKey }, label: lbl };
      } finally {
        setUploading(false);
      }
    }
    if (mode === "image" && imageFile) {
      setUploading(true);
      try {
        const base64 = await fileToBase64(imageFile);
        const { fileKey } = await upload.mutateAsync({ base64, fileName: imageFile.name, mimeType: imageMimeFor(imageFile) });
        return { source: { kind: "image", fileKey }, label: lbl };
      } finally {
        setUploading(false);
      }
    }
    return { source: null, label: null };
  }

  const MODE_TABS: { value: SourceMode; label: string; icon: React.ReactNode }[] = [
    { value: "url", label: "URL", icon: <Link2 className="w-3.5 h-3.5" /> },
    { value: "text", label: "Paste text", icon: <TypeIcon className="w-3.5 h-3.5" /> },
    { value: "pdf", label: "Upload PDF", icon: <FileText className="w-3.5 h-3.5" /> },
    { value: "image", label: "Upload image", icon: <ImageIcon className="w-3.5 h-3.5" /> },
  ];

  const node = (
    <Collapsible open={show} onOpenChange={setShow}>
      <CollapsibleTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground -ml-2">
          <Paperclip className="w-3.5 h-3.5 mr-1.5" />
          {show
            ? "Hide source"
            : followUp
              ? "Add another source for this follow-up (optional)"
              : "Add a source for this question (optional)"}
          <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${show ? "rotate-180" : ""}`} />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 rounded-lg border border-dashed p-3 mt-2">
        <p className="text-[11px] text-muted-foreground leading-relaxed">
          Attach one source and the assistant grounds its answer in it. A URL is fetched and stripped to text; a PDF or
          screenshot is read directly. Nothing is written to a catalogue — findings land in the review queue for you to
          approve.
        </p>
        <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1 w-fit">
          {MODE_TABS.map((m) => (
            <button
              key={m.value}
              type="button"
              onClick={() => setMode(m.value)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                mode === m.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Source label (optional)</Label>
          <Input
            placeholder="e.g. CIC MMF fact sheet, May 2026"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="bg-background"
          />
        </div>
        {mode === "url" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Source URL (the assistant will read it)</Label>
            <Input placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} className="bg-background" />
          </div>
        )}
        {mode === "text" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Paste source text</Label>
            <Textarea
              placeholder="Paste a fact-sheet, auction result, or price table…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={5}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">{text.trim().length} characters</p>
          </div>
        )}
        {mode === "pdf" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Upload a PDF (the assistant reads it directly)</Label>
            <Input type="file" accept="application/pdf" onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)} className="bg-background" />
            {pdfFile && (
              <p className="text-[11px] text-muted-foreground">
                {pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        )}
        {mode === "image" && (
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Upload a screenshot / photo (a vision AI transcribes only what is printed)
            </Label>
            <Input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
              className="bg-background"
            />
            {imageFile && (
              <p className="text-[11px] text-muted-foreground">
                {imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );

  return { node, resolve, reset, uploading, provided };
}

/* ── Conversation transcript (thread turns) ─────────────────────────────────── */

/** What context did a given assistant answer draw on? Derived from message order:
 *  a non-first turn had the earlier conversation to lean on, and the paired user
 *  turn's sourceKind tells us whether a fresh source was attached to that turn. */
function contextNote(messages: Message[], index: number): string | null {
  const m = messages[index];
  if (m.role !== "assistant") return null;
  // Find the user turn this answer responds to (the nearest preceding user message).
  let userIdx = -1;
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userIdx = i;
      break;
    }
  }
  const hadPrior = userIdx > 0; // any earlier turn exists before this user turn
  const hadNewSource = userIdx >= 0 && !!messages[userIdx].sourceKind;
  if (hadPrior && hadNewSource) return "Answered using the earlier conversation and the source you attached to this follow-up.";
  if (hadPrior) return "Answered using the earlier conversation in this enquiry.";
  if (hadNewSource) return "Answered using the source you attached.";
  return null;
}

/** The user turn a given assistant answer responds to (nearest preceding user message). */
function pairedUserMessage(messages: Message[], assistantIndex: number): Message | null {
  for (let i = assistantIndex - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i];
  }
  return null;
}

/**
 * Stage 4 · sources-used panel — a compact, per-answer summary of what grounded
 * THIS turn. Distinct from `SourceStatusPanel` above (which shows the live read
 * outcome of the enquiry currently being submitted, and disappears once the turn is
 * folded into history): this renders for every historical turn in the transcript,
 * from data already on the paired user message (`sourceKind`/`sourceRef`/
 * `sourceLabel` — what was ATTACHED) plus the task's actual read outcome
 * (`grounded` — whether it was successfully READ), so a failed or unattempted read
 * is never shown as if the answer were grounded. Visibility only — reads existing
 * fields, writes nothing, changes no extraction/search/approval behaviour.
 */
function SourcesUsedPanel({
  sourceKind,
  sourceLabel,
  sourceRef,
  asOf,
  grounded,
}: {
  sourceKind: string | null;
  sourceLabel: string | null;
  sourceRef: string | null;
  asOf: number | null;
  grounded: boolean | null;
}) {
  if (!sourceKind) {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        No source — general knowledge.
      </p>
    );
  }
  if (grounded !== true) {
    // Attached but the read failed (or the read outcome is unknown) — never claim
    // grounding without positive confirmation from the task's sourceStatus.
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-600">
        <AlertTriangle className="w-3 h-3 shrink-0" />
        Source attached but not read; answer may be ungrounded.
      </p>
    );
  }
  const isAiSearch = (sourceLabel ?? "").startsWith("AI search:");
  const openUrl = sourceKind === "url" ? sourceRef : null;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
      {sourceKindIcon(sourceKind, "w-3 h-3")}
      <span className="text-foreground">{sourceLabel ?? sourceKind}</span>
      {isAiSearch && (
        <Badge
          variant="outline"
          className="font-normal text-[10px] px-1 py-0 gap-0.5 bg-violet-500/10 text-violet-600 border-violet-500/20"
        >
          <Search className="w-2.5 h-2.5 mr-0.5" /> AI search
        </Badge>
      )}
      {openUrl && (
        <a
          href={openUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
        >
          open <ExternalLink className="w-2.5 h-2.5" />
        </a>
      )}
      {asOf != null && <span>· as of {formatUtcYmd(asOf)}</span>}
    </div>
  );
}

function Transcript({ messages, findings }: { messages: Message[]; findings: Finding[] }) {
  return (
    <div className="space-y-4">
      {messages.map((m, idx) =>
        m.role === "user" ? (
          <div key={m.id} className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm whitespace-pre-wrap">{m.content}</p>
              {m.sourceKind && (
                <div className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground">
                  {sourceKindIcon(m.sourceKind, "w-3 h-3")}
                  <span>{m.sourceLabel ?? m.sourceKind}</span>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div key={m.id} className="flex items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-500/10">
              <Bot className="w-3.5 h-3.5 text-violet-500" />
            </div>
            <div className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2">
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <Streamdown>{m.content}</Streamdown>
              </div>
              {contextNote(messages, idx) && (
                <p className="mt-1.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <GitBranch className="w-3 h-3 shrink-0" />
                  {contextNote(messages, idx)}
                </p>
              )}
              {(() => {
                const paired = pairedUserMessage(messages, idx);
                const asOf =
                  m.taskId != null
                    ? findings.find((f) => f.taskId === m.taskId && f.sourceAsOf != null)?.sourceAsOf ?? null
                    : null;
                return (
                  <SourcesUsedPanel
                    sourceKind={paired?.sourceKind ?? null}
                    sourceLabel={paired?.sourceLabel ?? null}
                    sourceRef={paired?.sourceRef ?? null}
                    asOf={asOf}
                    grounded={m.sourceGrounded}
                  />
                );
              })()}
            </div>
          </div>
        ),
      )}
    </div>
  );
}

/* ── The active conversation: transcript + accumulated findings + follow-up ──── */

function Conversation({ threadId, onExit }: { threadId: number; onExit: () => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.research.getThread.useQuery({ id: threadId });
  const [question, setQuestion] = useState("");
  const [allowUnsourced, setAllowUnsourced] = useState(false);
  // Step 4.2b-iii — explicit opt-in to search authoritative CBK sources when no
  // manual source is attached (see OpeningPanel). The thread's scope is fixed, so
  // there is no Focus selector here to reset this on — the checkbox is simply
  // disabled outside a CBK-scoped enquiry.
  const [allowSearch, setAllowSearch] = useState(false);
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  // Round 92 — explicit per-follow-up source behaviour.
  const [sourceMode, setSourceMode] = useState<"reuse_previous" | "new" | "none">("reuse_previous");
  // Round 102 — intake mode for follow-ups ("extract" forces structured extraction on new source).
  const [intakeMode, setIntakeMode] = useState<"ask" | "extract">("ask");
  // Round 103 — follow-up source-class detection and extraction diagnostic.
  const [followUpSourceClass, setFollowUpSourceClass] = useState<string | null>(null);
  const [extractionDiag, setExtractionDiag] = useState<ExtractionDiagnostic | null>(null);
  const src = useSourceAttachment({ followUp: true });

  // Round 96 — follow-ups run as a pollable task (start → process → poll) so a slow
  // source read shows a live stage instead of blocking one long request.
  const startTask = trpc.research.startResearchTask.useMutation();
  const poller = useResearchTaskPoller();
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || poller.running || src.uploading;
  const canAsk = question.trim().length >= 4 && !busy;

  async function submitFollowUp() {
    if (!canAsk) return;
    setSubmitting(true);
    try {
      setSourceStatus(null);
      const { source, label } = await src.resolve();
      // A freshly attached source implies "add another source"; otherwise honour the mode.
      const mode: "reuse_previous" | "new" | "none" = source ? "new" : sourceMode;
      // Round 102 — when a new source is attached, auto-switch to "extract" mode.
      const effectiveIntakeMode: "ask" | "extract" = source ? "extract" : intakeMode;
      const res = await poller.run(async () => {
        const started = await startTask.mutateAsync({
          question: question.trim(),
          scope: (data?.thread?.scope ?? "any") as Scope,
          threadId,
          source: source ?? undefined,
          sourceLabel: label ?? undefined,
          allowUnsourced: source ? allowUnsourced : undefined,
          allowSearch: !source && (data?.thread?.scope === "cbk" || data?.thread?.scope === "mmf" || data?.thread?.scope === "bank") ? allowSearch : undefined,
          sourceMode: mode,
          intakeMode: effectiveIntakeMode,
        });
        return { taskId: started.taskId, threadId: started.threadId };
      }, { intakeMode: effectiveIntakeMode });
      setSourceStatus(res.sourceStatus);
      setFollowUpSourceClass(res.sourceClass ?? null);
      setExtractionDiag(res.extractionDiagnostic ?? null);
      if (res.stage === "needs_source_fix") {
        toast.error("I couldn\u2019t read that source. Fix it and retry, or tick \u201cAnswer without the source\u201d to proceed on general knowledge.");
      } else if (res.stage === "failed") {
        toast.error("The enquiry failed. Please try again.");
      } else if (res.extractionDiagnostic?.attempted && res.findings.length === 0) {
        // Round 103 — extraction was expected but produced nothing: show diagnostic toast.
        toast.warning(
          res.extractionDiagnostic.reason ?? "Extraction produced no findings from this source.",
          { duration: 8000 },
        );
        setQuestion("");
        src.reset();
      } else {
        toast.success(
          res.findings.length > 0
            ? `Answered \u2014 ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"} added below.`
            : "Answered \u2014 no structured findings this time.",
        );
        setQuestion("");
        src.reset();
      }
      utils.research.getThread.invalidate({ id: threadId });
      utils.research.listThreads.invalidate();
      utils.research.newFindingsCount.invalidate();
      utils.researchPipeline.digest.invalidate();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  // Stage 5 — a suggested follow-up chip fills the composer and switches to
  // "reuse previous source" (the whole point is re-reading the SAME source), but
  // never sends anything itself. The manager reviews/edits the text and presses
  // Send follow-up manually, exactly like any other turn.
  function onSuggestQuestion(text: string) {
    setQuestion(text);
    setSourceMode("reuse_previous");
    toast.success("Follow-up question added below — review and send when ready.");
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  const thread = data?.thread;
  const messages = (data?.messages ?? []) as Message[];
  const findings = (data?.findings ?? []) as Finding[];
  // Active (non-superseded) findings first, corrections grouped naturally by recency.
  const liveFindings = findings.filter((f) => f.status !== "superseded" && f.supersededById == null);
  const supersededFindings = findings.filter((f) => f.status === "superseded" || f.supersededById != null);

  const refetch = () => {
    utils.research.getThread.invalidate({ id: threadId });
    utils.research.newFindingsCount.invalidate();
    utils.researchPipeline.digest.invalidate();
    utils.researchPipeline.listUpdates.invalidate();
    utils.researchPipeline.pendingCount.invalidate();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-2 truncate">
            <MessageSquarePlus className="w-4 h-4 text-primary shrink-0" />
            {thread?.title ?? "Enquiry"}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {thread?.scope && thread.scope !== "any" ? `Focus: ${thread.scope} · ` : ""}
            An ongoing enquiry — follow-ups keep the earlier context.
          </p>
        </div>
        <Button size="sm" variant="outline" className="bg-background shrink-0" onClick={onExit}>
          <Plus className="w-3.5 h-3.5 mr-1.5" /> New enquiry
        </Button>
      </div>

      <Card>
        <CardContent className="pt-5">
          <Transcript messages={messages} findings={findings} />
        </CardContent>
      </Card>

      {/* Follow-up composer */}
      <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent">
        <CardContent className="pt-5 space-y-3">
          <Label className="text-xs text-muted-foreground">Ask a follow-up</Label>
          <Textarea
            placeholder="e.g. And the 182-day one? · What is that net of the 15% withholding tax?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submitFollowUp();
            }}
          />
          {/* Round 92 — how this follow-up treats sources. A fresh attachment below always wins. */}
          {!src.provided && (
            <div className="space-y-1.5">
              <div className="flex flex-wrap gap-1.5">
                {([
                  ["reuse_previous", "Use previous source"],
                  ["new", "Add another source"],
                  ["none", "Ask without source"],
                ] as const).map(([val, lbl]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSourceMode(val)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs transition-colors",
                      sourceMode === val
                        ? "border-primary bg-primary/10 text-foreground font-medium"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {sourceMode === "new"
                  ? "Attach a document or URL below — I\u2019ll use the earlier conversation context plus the new source."
                  : sourceMode === "none"
                    ? "Using earlier conversation context."
                    : "Using the previous source from this enquiry, plus the earlier conversation context."}
              </p>
            </div>
          )}
          {/* Step 4.2b-iii — search opt-in, offered only when no manual source is
              attached this turn (manual source always wins). CBK, MMF, and bank (Stage 7f). */}
          {!src.provided && (
            <label
              className={cn(
                "flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs cursor-pointer",
                thread?.scope === "cbk" || thread?.scope === "mmf" || thread?.scope === "bank"
                  ? "text-muted-foreground"
                  : "text-muted-foreground/60 cursor-not-allowed",
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={allowSearch}
                disabled={thread?.scope !== "cbk" && thread?.scope !== "mmf" && thread?.scope !== "bank"}
                onChange={(e) => setAllowSearch(e.target.checked)}
              />
              <span>
                <span
                  className={cn(
                    "font-medium",
                    thread?.scope === "cbk" || thread?.scope === "mmf" || thread?.scope === "bank"
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {thread?.scope === "mmf"
                    ? "Search for a cited fund-manager source if I don’t attach a source."
                    : thread?.scope === "bank"
                      ? "Search for a cited bank product page if I don’t attach a source."
                      : "Search authoritative CBK sources if I don’t attach a source."}
                </span>{" "}
                {thread?.scope === "cbk"
                  ? "The AI looks up a current, cited CBK source — never from its own memory — and grounds the answer in it, exactly as if you’d pasted the link yourself."
                  : thread?.scope === "mmf"
                    ? "The AI searches for a current, cited fund-manager factsheet (or CMA data as a cross-check) — never from its own memory. MMF sources vary by fund manager, so please verify the cited source before relying on it."
                    : thread?.scope === "bank"
                      ? "The AI searches for a current, cited bank rates/product page — never from its own memory. Bank sources vary by bank, so please verify the cited source before relying on it."
                      : "Only available for enquiries focused on “CBK securities,” “MMF market,” or “Bank products.”"}
              </span>
            </label>
          )}
          {src.provided && (
            <p className="text-[11px] text-muted-foreground">Using previous context + this new source.</p>
          )}
          {poller.running && <TaskStageProgress stage={poller.stage} />}
          {sourceStatus && <SourceStatusPanel status={sourceStatus} />}
          {/* Round 103 — follow-up source-class detection panel */}
          {followUpSourceClass && !poller.running && (
            <div className="rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs flex items-center gap-2">
              <FileSearch className="w-3.5 h-3.5 text-primary shrink-0" />
              <span>
                <span className="font-medium">Detected:</span>{" "}
                {SOURCE_CLASS_LABELS[followUpSourceClass as keyof typeof SOURCE_CLASS_LABELS] ?? followUpSourceClass}
                {" "}→{" "}
                <span className="text-muted-foreground">{catalogueLabelForSourceClass(followUpSourceClass)}</span>
              </span>
            </div>
          )}
          {/* Round 103 — extraction diagnostic panel */}
          {extractionDiag?.attempted && extractionDiag.reason && !poller.running && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-amber-800 dark:text-amber-300">Extraction produced no findings</p>
                <p className="text-muted-foreground mt-0.5">{extractionDiag.reason}</p>
                {extractionDiag.charsRead > 0 && (
                  <p className="text-muted-foreground mt-0.5">
                    Source read: {extractionDiag.charsRead.toLocaleString()} chars
                    {extractionDiag.forcedByIntent && " (intent-detected)"}
                  </p>
                )}
              </div>
            </div>
          )}
          {src.provided && (
            <label className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 accent-primary"
                checked={allowUnsourced}
                onChange={(e) => setAllowUnsourced(e.target.checked)}
              />
              <span>
                <span className="font-medium text-foreground">Answer even if I can&rsquo;t read the source.</span> The
                answer will be marked <em>not grounded in the source</em> and must be verified. Leave unticked to be told
                to fix the source first.
              </span>
            </label>
          )}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {src.node}
            <div className="flex-1" />
            <Button onClick={() => void submitFollowUp()} disabled={!canAsk}>
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              {src.uploading ? "Uploading…" : poller.running ? (poller.stage ? STAGE_LABELS[poller.stage] : "Asking…") : "Send follow-up"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Findings for the whole thread */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
          <Inbox className="w-4 h-4 text-primary" /> Findings from this enquiry
          <span className="text-xs font-normal text-muted-foreground">({liveFindings.length})</span>
        </h3>
        {liveFindings.length === 0 ? (
          <Empty className="py-8">
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              No structured findings yet. Ask a question that touches specific figures, or attach a source.
            </p>
          </Empty>
        ) : (
          <div className="space-y-3">
            {liveFindings.map((f) => (
              <FindingCard key={f.id} finding={f} onChanged={refetch} onSuggestQuestion={onSuggestQuestion} />
            ))}
          </div>
        )}

        {supersededFindings.length > 0 && (
          <Collapsible className="mt-4">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="text-xs text-muted-foreground -ml-2">
                <History className="w-3.5 h-3.5 mr-1.5" />
                Show superseded versions ({supersededFindings.length})
                <ChevronDown className="w-3.5 h-3.5 ml-1" />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-3">
              {supersededFindings.map((f) => (
                <FindingCard key={f.id} finding={f} onChanged={refetch} />
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
    </div>
  );
}

/* ── The opening enquiry box (starts a NEW thread) ──────────────────────────── */

function OpeningPanel({ onStarted }: { onStarted: (threadId: number) => void }) {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState<Scope>("any");
  const [allowUnsourced, setAllowUnsourced] = useState(false);
  // Step 4.2b-iii — explicit opt-in to search authoritative CBK sources when no
  // manual source is attached. CBK-only; reset whenever Focus leaves "cbk" so a
  // stale checked-but-disabled checkbox never lingers.
  const [allowSearch, setAllowSearch] = useState(false);
  // Market-asset search design (2026-07-13) — explicit subtype, required before a
  // future market-asset search can be enabled. Reset whenever Focus leaves
  // "market_asset" (see the Focus onValueChange below) so a stale selection never
  // lingers. NOT yet sent to the server and NOT consulted by search in this slice.
  const [marketAssetSubtype, setMarketAssetSubtype] = useState<MarketAssetSubtype | "">("");
  const [sourceStatus, setSourceStatus] = useState<SourceStatus | null>(null);
  // Round 102 — intake mode: "ask" (default conversational) or "extract" (force structured extraction).
  const [intakeMode, setIntakeMode] = useState<"ask" | "extract">("ask");
  const [detectedSourceClass, setDetectedSourceClass] = useState<string | null>(null);
  const src = useSourceAttachment();

  // Round 96 — the opening enquiry runs as a pollable task too, so the manager sees a
  // live stage (reading source → asking AI → extracting) instead of one long request.
  const startTask = trpc.research.startResearchTask.useMutation();
  const poller = useResearchTaskPoller();
  const [submitting, setSubmitting] = useState(false);

  const busy = submitting || poller.running || src.uploading;
  const canAsk = question.trim().length >= 4 && !busy;
  // Market-asset search design (2026-07-13) — REIT + equity + offshore fund + SACCO
  // slices (the full staged rollout). Market-asset search is enabled ONLY when
  // Focus = "Market assets" AND the manager explicitly selected one of the four
  // subtypes with a registered authoritative-source route — ETF/property/pension/
  // other stay unsearchable (no route exists for them at all).
  const marketAssetSearchReady =
    scope === "market_asset" &&
    (marketAssetSubtype === "reit" ||
      marketAssetSubtype === "equity" ||
      marketAssetSubtype === "offshore_fund" ||
      marketAssetSubtype === "sacco");

  async function submit() {
    if (!canAsk) return;
    setSubmitting(true);
    try {
      setSourceStatus(null);
      const { source, label } = await src.resolve();
      const res = await poller.run(async () => {
        const started = await startTask.mutateAsync({
          question: question.trim(),
          scope,
          source: source ?? undefined,
          sourceLabel: label ?? undefined,
          allowUnsourced: source ? allowUnsourced : undefined,
          allowSearch: !source && (scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady) ? allowSearch : undefined,
          // Market-asset search design — carried ONLY for scope === "market_asset", so
          // resolveSearchSource can gate search server-side. Never inferred; always the
          // manager's explicit dropdown selection (or undefined if none/not applicable).
          marketAssetSubtype: scope === "market_asset" && marketAssetSubtype ? marketAssetSubtype : undefined,
          intakeMode,
        });
        return { taskId: started.taskId, threadId: started.threadId };
      }, { intakeMode });
      setSourceStatus(res.sourceStatus);
      setDetectedSourceClass(res.sourceClass ?? null);
      if (res.stage === "needs_source_fix") {
        // The attached source could not be read and the manager did NOT pre-authorise
        // answering without it: no briefing, no findings. Point them at the fix.
        toast.error("I couldn’t read that source. Fix it and retry, or tick “Answer without the source” to proceed on general knowledge.");
        return;
      }
      if (res.stage === "failed") {
        toast.error("The enquiry failed. Please try again.");
        return;
      }
      toast.success(
        res.findings.length > 0
          ? `Briefing ready — ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"} to triage.`
          : "Briefing ready — no structured findings this time.",
      );
      utils.research.listThreads.invalidate();
      utils.research.newFindingsCount.invalidate();
      utils.researchPipeline.digest.invalidate();
      if (res.threadId != null) onStarted(res.threadId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" /> Ask AI a question — then keep the conversation going
          <InfoHint side="bottom" iconClassName="ml-0.5">
            Ask in plain English. Your question opens an enquiry you can follow up on — each follow-up keeps the earlier
            context, and each turn can attach its own source (URL, pasted text, PDF, or screenshot). You get a briefing
            plus structured findings you can triage into the review queue. It can sort and compare the facts it finds,
            but it never writes to a catalogue, never tells you what to buy or sell, and never recommends one instrument
            over another — you make every decision.
          </InfoHint>
        </CardTitle>
        <CardDescription>
          e.g. &ldquo;What are the current 91/182/364-day T-bill yields, and the top KES money-market fund effective
          rates?&rdquo;
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Ask about yields, rates, prices, tenors…"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          rows={3}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submit();
          }}
        />
        {poller.running && <TaskStageProgress stage={poller.stage} />}
        {sourceStatus && <SourceStatusPanel status={sourceStatus} />}
        {src.provided && (
          <label className="flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={allowUnsourced}
              onChange={(e) => setAllowUnsourced(e.target.checked)}
            />
            <span>
              <span className="font-medium text-foreground">Answer even if I can&rsquo;t read the source.</span>{" "}
              If the attached source can&rsquo;t be fetched or transcribed, answer from general knowledge instead of
              stopping &mdash; the answer will be clearly marked as <em>not grounded in the source</em> and must be
              verified before acting. Leave unticked to be told to fix the source first.
            </span>
          </label>
        )}
        {/* Step 4.2b-iii — search opt-in, offered only when no manual source is attached
            (manual source always wins). CBK, MMF, and bank (Stage 7f); market_asset +
            REIT, Equity, Offshore fund, or SACCO (Market-asset search design,
            2026-07-13 — full staged rollout). SACCO carries the highest source-trust
            risk of the four market_asset subtypes (thousands of small, thinly-
            indexed SACCOs), so its copy is deliberately the strongest-worded verify
            caveat, and it never implies SASRA supplies dividend/rebate figures — it's
            a regulatory-status cross-check only. */}
        {!src.provided && (
          <label
            className={cn(
              "flex items-start gap-2 rounded-md border border-border bg-background px-3 py-2 text-xs cursor-pointer",
              scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady
                ? "text-muted-foreground"
                : "text-muted-foreground/60 cursor-not-allowed",
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5 accent-primary"
              checked={allowSearch}
              disabled={scope !== "cbk" && scope !== "mmf" && scope !== "bank" && !marketAssetSearchReady}
              onChange={(e) => setAllowSearch(e.target.checked)}
            />
            <span>
              <span
                className={cn(
                  "font-medium",
                  scope === "cbk" || scope === "mmf" || scope === "bank" || marketAssetSearchReady
                    ? "text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {scope === "mmf"
                  ? "Search for a cited fund-manager source if I don’t attach a source."
                  : scope === "bank"
                    ? "Search for a cited bank product page if I don’t attach a source."
                    : scope === "market_asset"
                      ? marketAssetSubtype === "equity"
                        ? "Search for a cited NSE/equity source if I don’t attach a source."
                        : marketAssetSubtype === "offshore_fund"
                          ? "Search for a cited fund-manager/NAV source if I don’t attach a source."
                          : marketAssetSubtype === "sacco"
                            ? "Search for a cited SACCO source if I don’t attach a source."
                            : "Search for a cited NSE/REIT source if I don’t attach a source."
                      : "Search authoritative CBK sources if I don’t attach a source."}
              </span>{" "}
              {scope === "cbk"
                ? "The AI looks up a current, cited CBK source — never from its own memory — and grounds the answer in it, exactly as if you’d pasted the link yourself."
                : scope === "mmf"
                  ? "The AI searches for a current, cited fund-manager factsheet (or CMA data as a cross-check) — never from its own memory. MMF sources vary by fund manager, so please verify the cited source before relying on it."
                  : scope === "bank"
                    ? "The AI searches for a current, cited bank rates/product page — never from its own memory. Bank sources vary by bank, so please verify the cited source before relying on it."
                    : marketAssetSearchReady
                      ? marketAssetSubtype === "equity"
                        ? "The AI searches for a current, cited NSE listing or equity source — never from its own memory. Please verify the cited source before relying on it."
                        : marketAssetSubtype === "offshore_fund"
                          ? "The AI searches for a current, cited fund-manager NAV/factsheet source — never from its own memory. Offshore fund sources vary by fund manager, so please verify the cited source before relying on it."
                          : marketAssetSubtype === "sacco"
                            ? "The AI searches for a current, cited SACCO source (or SASRA as a regulatory-status cross-check only — never a source of dividend or rebate figures) — never from its own memory. SACCO sources vary widely and are less consistently published than other market assets, so please verify the cited source carefully before relying on it."
                            : "The AI searches for a current, cited NSE listing or REIT source — never from its own memory. Please verify the cited source before relying on it."
                      : scope === "market_asset"
                        ? "Select “REIT,” “Equity,” “Offshore fund,” or “SACCO” as the Asset type above to enable search for this Focus."
                        : "Only available when Focus (below) is set to “CBK securities,” “MMF market,” “Bank products,” or “Market assets” with Asset type = REIT, Equity, Offshore fund, or SACCO."}
            </span>
          </label>
        )}
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Focus</Label>
            <Select
              value={scope}
              onValueChange={(v) => {
                setScope(v as Scope);
                if (v !== "cbk" && v !== "mmf" && v !== "bank") setAllowSearch(false);
                if (v !== "market_asset") setMarketAssetSubtype("");
              }}
            >
              <SelectTrigger className="w-[180px] bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Market-asset search design (2026-07-13) — explicit "Asset type" selector,
              shown only for Focus = "Market assets". Limited to the four subtypes that
              have a registered authoritative-source route (equity/REIT/offshore fund/
              SACCO) — ETF/property/pension/other are deliberately excluded, not just
              deferred (no route exists for them at all). Full staged rollout complete:
              search is enabled for all four listed subtypes. Changing subtype resets
              the search checkbox whenever the new value doesn't match any of the four
              search-enabled ones, so a stale checked-but-about-to-be-disabled state
              never lingers, same pattern as the Focus reset below — though in
              practice, since every OPTION in this dropdown is search-enabled, that
              only fires when clearing the selection entirely. */}
          {scope === "market_asset" && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Asset type</Label>
              <Select
                value={marketAssetSubtype}
                onValueChange={(v) => {
                  const next = v as MarketAssetSubtype;
                  setMarketAssetSubtype(next);
                  if (next !== "reit" && next !== "equity" && next !== "offshore_fund" && next !== "sacco") {
                    setAllowSearch(false);
                  }
                }}
              >
                <SelectTrigger className="w-[180px] bg-background">
                  <SelectValue placeholder="Select asset type…" />
                </SelectTrigger>
                <SelectContent>
                  {MARKET_ASSET_SUBTYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground max-w-[180px]">
                {marketAssetSubtype === "sacco"
                  ? "AI search is available for SACCO. SACCO sources vary the most — please verify the cited source carefully."
                  : marketAssetSubtype
                    ? "AI search is available for this Asset type."
                    : "Required before AI search for market assets can be enabled."}
              </p>
            </div>
          )}
          {/* Round 102 — intake mode selector */}
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Mode</Label>
            <div className="flex gap-1">
              {(["ask", "extract"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setIntakeMode(m)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    intakeMode === m
                      ? "border-primary bg-primary/10 text-foreground font-medium"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "ask" ? "Ask / explain" : "Extract facts"}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1" />
          <Button onClick={() => void submit()} disabled={!canAsk}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
            {src.uploading ? "Uploading\u2026" : poller.running ? (poller.stage ? STAGE_LABELS[poller.stage] : "Asking\u2026") : "Ask"}
          </Button>
        </div>
        {/* Round 102 — detected source-class panel */}
        {detectedSourceClass && isSourceClass(detectedSourceClass) && (
          <div className="rounded-md border border-primary/20 bg-primary/[0.04] px-3 py-2 text-xs flex items-center gap-2">
            <FileCheck2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span>
              <span className="font-medium">Detected:</span>{" "}
              {SOURCE_CLASS_LABELS[detectedSourceClass as keyof typeof SOURCE_CLASS_LABELS]} \u2014 findings will target the{" "}
              <span className="font-medium">{catalogueLabelForSourceClass(detectedSourceClass)}</span> catalogue.
            </span>
          </div>
        )}
        {src.node}
      </CardContent>
    </Card>
  );
}

/* ── Enquiry history (past threads) ─────────────────────────────────────────── */

function ThreadHistory({ onOpen }: { onOpen: (threadId: number) => void }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.research.listThreads.useQuery({ limit: 50 });
  const archive = trpc.research.setThreadArchived.useMutation({
    onSuccess: () => {
      toast.success("Enquiry archived.");
      utils.research.listThreads.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  const threads = data?.threads ?? [];

  if (threads.length === 0) {
    return (
      <Empty className="py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <History className="w-8 h-8 text-muted-foreground/60" />
          <p className="font-medium text-sm">No enquiries yet.</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Ask a research question and it will be logged here as an enquiry you can reopen and follow up on.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-2.5">
      {threads.map((t) => (
        <Card key={t.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm truncate">{t.title}</CardTitle>
                <CardDescription className="mt-0.5 flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-normal text-[11px]">
                    {t.scope}
                  </Badge>
                  {t.updatedAt && <span>· {formatRelativeTime(new Date(t.updatedAt).getTime())}</span>}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" className="bg-background" onClick={() => onOpen(t.id)}>
                  Open
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => archive.mutate({ id: t.id, archived: true })}
                  disabled={archive.isPending}
                >
                  <Archive className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function AskAI({ embedded = false }: { embedded?: boolean } = {}) {
  void embedded;
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  return (
    <div className="space-y-6">
      <AiPrincipleBanner />

      {activeThreadId != null ? (
        <Conversation threadId={activeThreadId} onExit={() => setActiveThreadId(null)} />
      ) : (
        <OpeningPanel onStarted={(id) => setActiveThreadId(id)} />
      )}

      {/* Enquiry history — reopen a past thread to continue it. */}
      <Collapsible open={showHistory} onOpenChange={setShowHistory}>
        <div className="flex items-center gap-2 border-t pt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground -ml-2">
              <History className="w-3.5 h-3.5 mr-1.5" />
              {showHistory ? "Hide enquiry history" : "Show enquiry history"}
              <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <span className="text-[11px] text-muted-foreground">Past enquiries — reopen one to continue it.</span>
        </div>
        <CollapsibleContent className="mt-3">
          <ThreadHistory
            onOpen={(id) => {
              setActiveThreadId(id);
              setShowHistory(false);
            }}
          />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
