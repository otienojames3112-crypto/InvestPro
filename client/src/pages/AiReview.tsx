import { useState } from "react";
import { Link } from "wouter";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  Bot,
  Check,
  Pencil,
  Trash2,
  Quote,
  ExternalLink,
  ShieldAlert,
  EyeOff,
  CheckCircle2,
  FileText,
  ScrollText,
  Search,
  AlertTriangle,
  User as UserIcon,
  Image as ImageIcon,
  Maximize2,
} from "lucide-react";
import type { FieldProvenance, FieldProvenanceMap, FieldKey } from "@shared/provenance";
import { InfoHint } from "@/components/InfoHint";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const FIELD_LABELS: Record<string, string> = {
  price: "Price",
  yield: "Yield",
  coupon: "Coupon",
  tenor: "Tenor",
  maturity: "Maturity",
  distribution: "Distribution",
  fx: "FX rate",
  expense: "Expense ratio",
  trailingReturn: "Trailing return",
};

/**
 * Part 8 (deeper spec) — the maintainer REVIEW QUEUE. This is the on-ramp to trust:
 * every figure an AI extracted that no human has confirmed yet shows here, grouped by
 * instrument, with the value side-by-side with the verbatim source span it was read
 * from. A maintainer acts per-figure (never all-or-nothing):
 *   - Confirm  → the figure is correct as read         → human_verified
 *   - Correct  → enter the right value from the source  → human_entered
 *   - Reject   → it was a misread/hallucination, drop it (only ai_extracted may be dropped)
 * Rows whose every figure is still ai_extracted are HIDDEN from the public catalog until
 * at least one figure is confirmed — this page is where that first confirmation happens.
 */
export default function AiReview({ embedded = false }: { embedded?: boolean } = {}) {
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";

  if (!isMaintainer) {
    return (
      <AppShell embedded={embedded}>
        <div className="container py-10 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" /> AI review queue
              </CardTitle>
              <CardDescription>
                {isAuthenticated
                  ? "Confirming AI-extracted figures against their source is a maintainer-only task. Ask an administrator for access."
                  : "Sign in as a maintainer to review AI-extracted figures against their cited sources."}
              </CardDescription>
            </CardHeader>
            {!isAuthenticated && (
              <CardContent>
                <Button onClick={() => (window.location.href = getLoginUrl())}>Sign in</Button>
              </CardContent>
            )}
          </Card>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell embedded={embedded}>
      <div className="container py-8 max-w-4xl space-y-6">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" /> AI review queue
          </h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            Every figure an AI read from a document, awaiting your confirmation against the source. Act on each
            figure on its own — confirm it as read, correct it to the right value, or reject a misread. Nothing
            here is trusted, ranked, or public until <strong className="text-foreground">you</strong> confirm it.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <Link href="/ai-intake">
            <Button size="sm" variant="outline">
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Add from a document
            </Button>
          </Link>
        </div>

        <Tabs defaultValue="queue" className="w-full">
          <TabsList>
            <TabsTrigger value="queue">
              <Bot className="w-3.5 h-3.5 mr-1.5" /> Review queue
            </TabsTrigger>
            <TabsTrigger value="audit">
              <ScrollText className="w-3.5 h-3.5 mr-1.5" /> Audit trail
              <InfoHint side="bottom" iconClassName="ml-1.5">A log of every AI intake call — which document, what was extracted, which model, when, and by whom — so a wrong figure can be traced to its origin and costs stay visible.</InfoHint>
            </TabsTrigger>
          </TabsList>
          <TabsContent value="queue" className="mt-5">
            <ReviewQueue />
          </TabsContent>
          <TabsContent value="audit" className="mt-5">
            <AuditTrail />
          </TabsContent>
        </Tabs>
      </div>
    </AppShell>
  );
}

/**
 * Part 8 (item 6) — the AI INTAKE AUDIT TRAIL. Every extraction and discovery call is
 * logged: what document, what was extracted, which model, when, and by which maintainer.
 * This gives cost visibility and lets a wrong figure be traced back to its origin call.
 * Maintainer-only; end users never see this.
 */
function AuditTrail() {
  const { data, isLoading } = trpc.opportunities.aiAuditLog.useQuery({ limit: 100 });
  const entries = data?.entries ?? [];

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <Empty className="border rounded-xl py-16">
        <div className="flex flex-col items-center gap-2 text-center">
          <ScrollText className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No AI intake calls yet. Every extraction and discovery run will be logged here for cost visibility and
            traceability.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Showing the most recent {entries.length} AI intake call{entries.length === 1 ? "" : "s"}. Each row is one
        billable model call, traceable to its document and the maintainer who triggered it.
      </p>
      <ul className="space-y-2.5">
        {entries.map((e) => (
          <AuditRow key={e.id} entry={e} />
        ))}
      </ul>
    </div>
  );
}

type AuditEntry = {
  id: number;
  action: string;
  maintainerName: string | null;
  maintainerOpenId: string;
  aiModel: string | null;
  sourceKind: string | null;
  sourceLabel: string | null;
  sourceUrl: string | null;
  hintName: string | null;
  universeDescription: string | null;
  resultName: string | null;
  extractedFields: unknown;
  figureCount: number | null;
  flaggedCount: number | null;
  candidateCount: number | null;
  inputChars: number | null;
  ok: boolean;
  error: string | null;
  createdAt: Date | string;
};

function AuditRow({ entry }: { entry: AuditEntry }) {
  const isExtract = entry.action === "extract";
  const when = new Date(entry.createdAt).toLocaleString();
  const fields = Array.isArray(entry.extractedFields) ? (entry.extractedFields as string[]) : [];

  return (
    <li className="rounded-lg border border-border p-3 space-y-2">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant="secondary" className="text-[11px] shrink-0">
            {isExtract ? (
              <>
                <FileText className="w-3 h-3 mr-1" /> extract
              </>
            ) : (
              <>
                <Search className="w-3 h-3 mr-1" /> discover
              </>
            )}
          </Badge>
          <span className="font-medium text-sm truncate">
            {isExtract
              ? entry.resultName ?? entry.sourceLabel ?? "(document)"
              : entry.universeDescription ?? "(universe)"}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {entry.ok ? (
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/40 text-[10px]">
              <CheckCircle2 className="w-3 h-3 mr-1" /> ok
            </Badge>
          ) : (
            <Badge variant="outline" className="text-red-500 border-red-500/40 text-[10px]">
              <AlertTriangle className="w-3 h-3 mr-1" /> failed
            </Badge>
          )}
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">{when}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <UserIcon className="w-3 h-3" /> {entry.maintainerName ?? entry.maintainerOpenId}
        </span>
        {entry.aiModel && <span>model: {entry.aiModel}</span>}
        {isExtract && entry.sourceKind && <span>source: {entry.sourceKind}</span>}
        {typeof entry.inputChars === "number" && <span>{entry.inputChars.toLocaleString()} chars</span>}
        {isExtract && typeof entry.figureCount === "number" && (
          <span>
            {entry.figureCount} figure{entry.figureCount === 1 ? "" : "s"}
          </span>
        )}
        {isExtract && (entry.flaggedCount ?? 0) > 0 && (
          <span className="text-orange-500">{entry.flaggedCount} flagged</span>
        )}
        {!isExtract && typeof entry.candidateCount === "number" && (
          <span>{entry.candidateCount} candidates proposed</span>
        )}
      </div>

      {isExtract && fields.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {fields.map((f) => (
            <Badge key={f} variant="outline" className="text-[10px]">
              {FIELD_LABELS[f] ?? f}
            </Badge>
          ))}
        </div>
      )}

      {entry.sourceUrl && (
        <a
          href={entry.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-primary inline-flex items-center gap-1 hover:underline"
        >
          <ExternalLink className="w-3 h-3" /> source document
        </a>
      )}

      {!entry.ok && entry.error && (
        <p className="text-[11px] text-red-500 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
          <span>{entry.error}</span>
        </p>
      )}
    </li>
  );
}

function ReviewQueue() {
  const { data, isLoading } = trpc.opportunities.aiReviewQueue.useQuery();
  const items = data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <Empty className="border rounded-xl py-16">
        <div className="flex flex-col items-center gap-2 text-center">
          <CheckCircle2 className="w-8 h-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Nothing awaiting review. AI-extracted figures appear here until you confirm them against their source.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item) => (
        <InstrumentReviewCard
          key={item.row.ref}
          row={item.row}
          aiFigureCount={item.aiFigureCount}
          hiddenFromCatalog={item.hiddenFromCatalog}
          sourceImageUrls={item.sourceImageUrls ?? []}
        />
      ))}
    </div>
  );
}

type Row = {
  ref: string;
  name: string;
  assetClass: string;
  issuer: string | null;
  currency: string | null;
  fieldProvenance: unknown;
};

function InstrumentReviewCard({
  row,
  aiFigureCount,
  hiddenFromCatalog,
  sourceImageUrls,
}: {
  row: Row;
  aiFigureCount: number;
  hiddenFromCatalog: boolean;
  sourceImageUrls: string[];
}) {
  const map = (row.fieldProvenance ?? {}) as FieldProvenanceMap;
  // Only the figures still awaiting confirmation (ai_extracted) belong in the queue.
  const aiFigures = (Object.entries(map) as [FieldKey, FieldProvenance | undefined][])
    .filter(([, p]) => p?.verificationState === "ai_extracted")
    .map(([key, p]) => ({ key, p: p as FieldProvenance }));

  return (
    <Card className="border-orange-500/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              <Bot className="w-4 h-4 text-orange-500 shrink-0" />
              <span className="truncate">{row.name}</span>
            </CardTitle>
            <CardDescription className="mt-1 flex items-center gap-2 flex-wrap">
              {row.issuer && <span>{row.issuer}</span>}
              <Badge variant="secondary" className="text-[11px]">
                {row.assetClass}
              </Badge>
              {row.currency && <span className="text-xs">{row.currency}</span>}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {hiddenFromCatalog && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="text-orange-500 border-orange-500/40 text-[11px] cursor-help">
                    <EyeOff className="w-3 h-3 mr-1" /> hidden from catalog
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                  This instrument was drafted entirely by AI and no figure has been confirmed yet, so people browsing the catalog cannot see it. Confirm at least one figure against its source to make it public.
                </TooltipContent>
              </Tooltip>
            )}
            <Link href={`/explore/${encodeURIComponent(row.ref)}`}>
              <Button size="sm" variant="outline">
                Open instrument
              </Button>
            </Link>
          </div>
        </div>
        {hiddenFromCatalog && (
          <p className="text-[11px] text-muted-foreground mt-1">
            This instrument was drafted entirely by AI and is not shown in the public catalog. Confirm at least one
            figure against the source to make it visible.
          </p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Part 8.1 — the original screenshot(s) this row's AI figures were read from, so a
            reviewer can verify each value against the picture without re-opening a file. */}
        {sourceImageUrls.length > 0 && <SourceScreenshots urls={sourceImageUrls} />}
        <p className="text-xs text-muted-foreground">
          {aiFigureCount} figure{aiFigureCount === 1 ? "" : "s"} awaiting confirmation.
        </p>
        <ul className="space-y-3">
          {aiFigures.map(({ key, p }) => (
            <FigureReviewRow key={key} refKey={row.ref} fieldKey={key} prov={p} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * Part 8.1 — the source screenshot strip shown at the top of an image-sourced review card.
 * Each thumbnail opens full-size in a dialog so a reviewer can read the printed figures and
 * confirm the AI's transcription against the original picture. Images only; no figure data.
 */
function SourceScreenshots({ urls }: { urls: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="rounded-lg border border-orange-500/20 bg-orange-500/[0.03] p-2.5 space-y-2">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
        <ImageIcon className="w-3.5 h-3.5" /> Source screenshot{urls.length === 1 ? "" : "s"}
        <InfoHint side="top" iconClassName="normal-case">
          The picture a maintainer uploaded as the source for this AI extraction. Click to enlarge
          and read the printed figures, then confirm each value below against what you see here.
        </InfoHint>
      </span>
      <div className="flex flex-wrap gap-2">
        {urls.map((u, i) => (
          <button
            key={u + i}
            type="button"
            onClick={() => setOpen(u)}
            className="group relative h-20 w-28 overflow-hidden rounded-md border border-border bg-muted/40 transition-transform hover:scale-[1.02] focus:outline-none focus:ring-2 focus:ring-ring"
            aria-label={`Enlarge source screenshot ${i + 1}`}
          >
            <img
              src={u}
              alt={`Source screenshot ${i + 1}`}
              loading="lazy"
              className="h-full w-full object-cover"
            />
            <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-transparent transition-colors group-hover:bg-black/40 group-hover:text-white">
              <Maximize2 className="w-4 h-4" />
            </span>
          </button>
        ))}
      </div>
      <Dialog open={open !== null} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <ImageIcon className="w-4 h-4" /> Source screenshot
            </DialogTitle>
            <DialogDescription>
              Read the figures printed here and compare them with the AI-extracted values below before
              confirming. The AI transcribes only what is visibly printed — it never infers a missing number.
            </DialogDescription>
          </DialogHeader>
          {open && (
            <div className="max-h-[70vh] overflow-auto rounded-md border border-border bg-muted/30">
              <img src={open} alt="Source screenshot, full size" className="w-full h-auto" />
            </div>
          )}
          <DialogFooter className="sm:justify-between gap-2">
            {open && (
              <a
                href={open}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-primary inline-flex items-center gap-1 hover:underline"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Open in a new tab
              </a>
            )}
            <Button variant="outline" size="sm" onClick={() => setOpen(null)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Split a stored AI source string "Label — “quote”" into its label and quote span. */
function splitSourceSpan(source: string | null | undefined): { label: string; quote: string | null } {
  if (!source) return { label: "", quote: null };
  const m = source.match(/^(.*?)\s+—\s+“([\s\S]*)”\s*$/);
  if (m) return { label: m[1], quote: m[2] };
  return { label: source, quote: null };
}

function FigureReviewRow({
  refKey,
  fieldKey,
  prov,
}: {
  refKey: string;
  fieldKey: FieldKey;
  prov: FieldProvenance;
}) {
  const utils = trpc.useUtils();
  const [correctOpen, setCorrectOpen] = useState(false);
  const { label, quote } = splitSourceSpan(prov.source);

  const invalidate = () => {
    utils.opportunities.aiReviewQueue.invalidate();
    utils.opportunities.list.invalidate();
    utils.opportunities.byRef.invalidate();
  };

  const verify = trpc.opportunities.verifyField.useMutation({
    onSuccess: (_r, vars) => {
      toast.success(vars.action.kind === "confirm" ? "Figure confirmed." : "Figure corrected and confirmed.");
      invalidate();
      setCorrectOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const reject = trpc.opportunities.rejectAiField.useMutation({
    onSuccess: (res) => {
      toast.success(res.emptied ? "Figure rejected — the AI-only instrument was retired." : "Figure rejected.");
      invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = verify.isPending || reject.isPending;
  const confirming = verify.isPending && verify.variables?.action.kind === "confirm";

  return (
    <li className="rounded-lg border border-border p-3 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* AI value */}
        <div className="space-y-1">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {FIELD_LABELS[fieldKey] ?? fieldKey}
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg font-semibold tabular-nums">{prov.value ?? "—"}</span>
            <Badge variant="outline" className="text-orange-500 border-orange-500/40 text-[10px]">
              AI-extracted · unverified
            </Badge>
          </div>
          {prov.reviewFlag && (
            <p className="flex items-start gap-1.5 text-[11px] text-red-500">
              <ShieldAlert className="w-3 h-3 mt-0.5 shrink-0" />
              <span>{prov.reviewFlag}</span>
            </p>
          )}
          {prov.aiModel && <p className="text-[10px] text-muted-foreground">read by {prov.aiModel}</p>}
        </div>

        {/* Source span the value was read from */}
        <div className="space-y-1 rounded-md bg-muted/40 p-2.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground inline-flex items-center gap-1">
            Source span
            <InfoHint side="top" iconClassName="normal-case">The exact words from the document that the AI read this figure from. Compare the value on the left against this quote (and the linked source) before confirming.</InfoHint>
          </span>
          {quote ? (
            <p className="flex items-start gap-1.5 text-xs italic text-muted-foreground">
              <Quote className="w-3 h-3 mt-0.5 shrink-0" />
              <span>“{quote}”</span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">No quote captured.</p>
          )}
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {label && <span className="truncate">{label}</span>}
            {prov.sourceUrl && (
              <a
                href={prov.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary inline-flex items-center gap-1 hover:underline shrink-0"
              >
                <ExternalLink className="w-3 h-3" /> open
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => verify.mutate({ ref: refKey, fieldKey, action: { kind: "confirm" } })}
        >
          <Check className="w-3.5 h-3.5 mr-1" /> {confirming ? "…" : "Confirm as read"}
        </Button>
        <InfoHint side="bottom">“Confirm as read” means the AI value matches the source exactly — it becomes a human-verified figure. “Correct” lets you type the right value if the AI misread it. “Reject” removes a figure that is wrong or invented (only AI figures can be removed this way).</InfoHint>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setCorrectOpen(true)}>
          <Pencil className="w-3.5 h-3.5 mr-1" /> Correct
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-500 border-red-500/40 hover:bg-red-500/10"
          disabled={busy}
          onClick={() => reject.mutate({ ref: refKey, fieldKey })}
        >
          <Trash2 className="w-3.5 h-3.5 mr-1" /> Reject
        </Button>
      </div>

      <CorrectDialog
        open={correctOpen}
        onOpenChange={setCorrectOpen}
        fieldLabel={FIELD_LABELS[fieldKey] ?? fieldKey}
        currentValue={prov.value ?? ""}
        pending={verify.isPending}
        defaultSource={label}
        defaultSourceUrl={prov.sourceUrl ?? ""}
        onConfirm={(form) =>
          verify.mutate({
            ref: refKey,
            fieldKey,
            action: { kind: "override", value: form.value, source: form.source, sourceUrl: form.sourceUrl },
          })
        }
      />
    </li>
  );
}

function CorrectDialog({
  open,
  onOpenChange,
  fieldLabel,
  currentValue,
  pending,
  defaultSource,
  defaultSourceUrl,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fieldLabel: string;
  currentValue: string;
  pending: boolean;
  defaultSource: string;
  defaultSourceUrl: string;
  onConfirm: (form: { value: string; source?: string; sourceUrl?: string }) => void;
}) {
  const [value, setValue] = useState(currentValue);
  const [source, setSource] = useState(defaultSource);
  const [sourceUrl, setSourceUrl] = useState(defaultSourceUrl);

  // A correction must actually change the number (a no-op confirm is the Confirm button).
  const canSubmit = value.trim() !== "" && value.trim() !== currentValue.trim() && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Correct {fieldLabel}</DialogTitle>
          <DialogDescription>
            Enter the value you read in the source. This records you as the author of the figure
            (human-entered) — the most-trusted state. To keep the AI value as-is, use Confirm instead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cr-value">Correct value *</Label>
            <Input id="cr-value" value={value} onChange={(e) => setValue(e.target.value)} />
            <p className="text-[11px] text-muted-foreground">AI read: {currentValue || "—"}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-source">Source you confirmed against</Label>
            <Input id="cr-source" value={source} onChange={(e) => setSource(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cr-source-url">Source link (optional)</Label>
            <Input id="cr-source-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Cancel
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() =>
              onConfirm({
                value: value.trim(),
                source: source.trim() === "" ? undefined : source.trim(),
                sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
              })
            }
          >
            {pending ? "Saving…" : "Save correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
