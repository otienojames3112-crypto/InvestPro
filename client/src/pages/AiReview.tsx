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
} from "lucide-react";
import type { FieldProvenance, FieldProvenanceMap, FieldKey } from "@shared/provenance";

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
export default function AiReview() {
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";

  if (!isMaintainer) {
    return (
      <AppShell>
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
    <AppShell>
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

        <ReviewQueue />
      </div>
    </AppShell>
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
}: {
  row: Row;
  aiFigureCount: number;
  hiddenFromCatalog: boolean;
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
              <Badge variant="outline" className="text-orange-500 border-orange-500/40 text-[11px]">
                <EyeOff className="w-3 h-3 mr-1" /> hidden from catalog
              </Badge>
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
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Source span
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
