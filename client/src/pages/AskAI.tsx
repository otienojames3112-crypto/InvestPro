import { useState } from "react";
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
} from "lucide-react";
import { InfoHint } from "@/components/InfoHint";
import { catalogueLabel, type ReferenceCatalogue } from "@shared/researchPipeline";
import { formatRelativeTime } from "@/lib/format";
import { AiPrincipleBanner } from "@/pages/AiIntake";

/* ── Small shared bits ─────────────────────────────────────────────────────── */

const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: "any", label: "Anything" },
  { value: "mmf", label: "MMF market" },
  { value: "bank", label: "Bank products" },
  { value: "cbk", label: "CBK securities" },
  { value: "market_asset", label: "Market assets" },
  { value: "macro", label: "Macro / context" },
];

type Scope = "any" | "mmf" | "bank" | "cbk" | "market_asset" | "macro";

const CONFIDENCE_META: Record<string, { label: string; className: string }> = {
  low: { label: "low confidence", className: "bg-rose-500/10 text-rose-600 border-rose-500/20" },
  medium: { label: "medium confidence", className: "bg-amber-500/10 text-amber-600 border-amber-500/20" },
  high: { label: "high confidence", className: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20" },
};

function fmtFields(fields: Record<string, unknown> | null | undefined): { key: string; value: string }[] {
  if (!fields) return [];
  return Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "")
    .map(([k, v]) => ({ key: k, value: String(v) }));
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
  sourceAsOf: number | null;
  confidence: string;
  missingFields: string[] | null;
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
};

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
  const fields = fmtFields(finding.extractedFields);
  const [field, setField] = useState<string>(fields[0]?.key ?? "");
  const [newValue, setNewValue] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const correct = trpc.research.correctFinding.useMutation({
    onSuccess: () => {
      toast.success("Correction recorded and drafted into the review queue — approve it there to update the catalogue.");
      onOpenChange(false);
      setNewValue("");
      setReason("");
      onDone();
    },
    onError: (err) => toast.error(err.message),
  });

  const oldValue = fields.find((f) => f.key === field)?.value ?? "—";
  const canSubmit =
    field.trim() !== "" && newValue.trim() !== "" && reason.trim().length >= 3 && !correct.isPending;

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
                      {f.key} (currently {f.value})
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
        </div>

        <DialogFooter>
          <Button variant="outline" className="bg-background" onClick={() => onOpenChange(false)} disabled={correct.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() =>
              correct.mutate({ findingId: finding.id, field: field.trim(), newValue: newValue.trim(), reason: reason.trim() })
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

export function FindingCard({ finding, onChanged }: { finding: Finding; onChanged: () => void }) {
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
              <Badge variant="outline" className={`font-normal text-[11px] ${conf.className}`}>
                {conf.label}
              </Badge>
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
        {fields.length > 0 ? (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {fields.map((f) => (
              <div key={f.key} className="text-sm">
                <span className="text-muted-foreground">{f.key}: </span>
                <span className="font-medium tabular-nums">{f.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground italic">No figures extracted — identity only.</p>
        )}

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
          <div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-700">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>
              Missing for a complete {finding.targetCatalogue ? catalogueLabel(finding.targetCatalogue as ReferenceCatalogue) : "catalogue"} entry:{" "}
              {missing.join(", ")}. You can still draft it and vouch a value at approval.
            </span>
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
          {finding.sourceAsOf && <span>· as of {new Date(finding.sourceAsOf).toLocaleDateString()}</span>}
        </div>

        {!isDrafted && !isDismissed && !isSuperseded && (
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button size="sm" onClick={() => draft.mutate({ findingId: finding.id })} disabled={busy}>
              {draft.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <ArrowRight className="w-3.5 h-3.5 mr-1.5" />
              )}
              Draft into review queue
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
export function useSourceAttachment(opts?: { followUp?: boolean }) {
  const followUp = opts?.followUp ?? false;
  const upload = trpc.opportunities.aiUploadDocument.useMutation();
  const [show, setShow] = useState(false);
  const [mode, setMode] = useState<SourceMode>("url");
  const [url, setUrl] = useState("");
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

function SOURCE_KIND_ICON(kind: string | null) {
  if (kind === "url") return <Link2 className="w-3 h-3" />;
  if (kind === "pdf") return <FileText className="w-3 h-3" />;
  if (kind === "image") return <ImageIcon className="w-3 h-3" />;
  if (kind === "text") return <TypeIcon className="w-3 h-3" />;
  return null;
}

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

function Transcript({ messages }: { messages: Message[] }) {
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
                  {SOURCE_KIND_ICON(m.sourceKind)}
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
  const src = useSourceAttachment({ followUp: true });

  const ask = trpc.research.ask.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.findings.length > 0
          ? `Answered — ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"} added below.`
          : "Answered — no structured findings this time.",
      );
      setQuestion("");
      src.reset();
      utils.research.getThread.invalidate({ id: threadId });
      utils.research.listThreads.invalidate();
      utils.research.newFindingsCount.invalidate();
      utils.researchPipeline.digest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = ask.isPending || src.uploading;
  const canAsk = question.trim().length >= 4 && !busy;

  async function submitFollowUp() {
    if (!canAsk) return;
    try {
      const { source, label } = await src.resolve();
      ask.mutate({
        question: question.trim(),
        scope: (data?.thread?.scope ?? "any") as Scope,
        threadId,
        source: source ?? undefined,
        sourceLabel: label ?? undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
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
          <Transcript messages={messages} />
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
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {src.node}
            <div className="flex-1" />
            <Button onClick={() => void submitFollowUp()} disabled={!canAsk}>
              {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
              {src.uploading ? "Uploading…" : ask.isPending ? "Asking…" : "Send follow-up"}
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
              <FindingCard key={f.id} finding={f} onChanged={refetch} />
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
  const src = useSourceAttachment();

  const ask = trpc.research.ask.useMutation({
    onSuccess: (res) => {
      toast.success(
        res.findings.length > 0
          ? `Briefing ready — ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"} to triage.`
          : "Briefing ready — no structured findings this time.",
      );
      utils.research.listThreads.invalidate();
      utils.research.newFindingsCount.invalidate();
      utils.researchPipeline.digest.invalidate();
      if (res.threadId != null) onStarted(res.threadId);
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = ask.isPending || src.uploading;
  const canAsk = question.trim().length >= 4 && !busy;

  async function submit() {
    if (!canAsk) return;
    try {
      const { source, label } = await src.resolve();
      ask.mutate({
        question: question.trim(),
        scope,
        source: source ?? undefined,
        sourceLabel: label ?? undefined,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
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
        <div className="flex items-end gap-3 flex-wrap">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Focus</Label>
            <Select value={scope} onValueChange={(v) => setScope(v as Scope)}>
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
          <div className="flex-1" />
          <Button onClick={() => void submit()} disabled={!canAsk}>
            {busy ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <Send className="w-4 h-4 mr-1.5" />}
            {src.uploading ? "Uploading…" : ask.isPending ? "Asking…" : "Ask"}
          </Button>
        </div>
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
