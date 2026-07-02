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
import { toast } from "sonner";
import { Streamdown } from "streamdown";
import {
  Sparkles,
  Send,
  Bot,
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

/* ── A single finding card (drafts into the pending queue, or dismisses) ─────── */

type Finding = {
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
};

function FindingCard({ finding, onChanged }: { finding: Finding; onChanged: () => void }) {
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
  const busy = draft.isPending || dismiss.isPending;

  return (
    <Card className={`overflow-hidden ${isDismissed ? "opacity-60" : ""}`}>
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

        {!isDrafted && !isDismissed && (
          <div className="flex items-center gap-2 pt-1">
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
              onClick={() => dismiss.mutate({ findingId: finding.id })}
              disabled={busy}
            >
              <XCircle className="w-3.5 h-3.5 mr-1.5" /> Dismiss
            </Button>
          </div>
        )}
      </CardContent>
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

/* ── The enquiry box + latest result ───────────────────────────────────────── */

function EnquiryPanel() {
  const utils = trpc.useUtils();
  const [question, setQuestion] = useState("");
  const [scope, setScope] = useState("any");
  const [showSource, setShowSource] = useState(false);
  const [sourceMode, setSourceMode] = useState<SourceMode>("url");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [uploading, setUploading] = useState(false);
  const [activeTaskId, setActiveTaskId] = useState<number | null>(null);

  const upload = trpc.opportunities.aiUploadDocument.useMutation();
  const ask = trpc.research.ask.useMutation({
    onSuccess: (res) => {
      setActiveTaskId(res.taskId);
      toast.success(
        res.findings.length > 0
          ? `Briefing ready — ${res.findings.length} finding${res.findings.length === 1 ? "" : "s"} to triage below.`
          : "Briefing ready — no structured findings this time.",
      );
      utils.research.listTasks.invalidate();
      utils.research.newFindingsCount.invalidate();
      utils.researchPipeline.digest.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  // Whether the chosen source mode has enough input to attach (source is always OPTIONAL).
  const sourceProvided =
    showSource &&
    (sourceMode === "url"
      ? /^https?:\/\//.test(sourceUrl.trim())
      : sourceMode === "text"
        ? sourceText.trim().length >= 20
        : sourceMode === "pdf"
          ? !!pdfFile
          : !!imageFile);

  const busy = ask.isPending || uploading;
  const canAsk = question.trim().length >= 4 && !busy;
  const result = ask.data;

  async function submit() {
    if (!canAsk) return;
    const base = {
      question: question.trim(),
      scope: scope as "any" | "mmf" | "bank" | "cbk" | "market_asset" | "macro",
      sourceLabel: sourceLabel.trim() === "" ? undefined : sourceLabel.trim(),
    };
    try {
      // No source attached → plain question.
      if (!sourceProvided) {
        ask.mutate(base);
        return;
      }
      if (sourceMode === "url") {
        ask.mutate({ ...base, source: { kind: "url", url: sourceUrl.trim() } });
      } else if (sourceMode === "text") {
        ask.mutate({ ...base, source: { kind: "text", text: sourceText.trim() } });
      } else if (sourceMode === "pdf" && pdfFile) {
        setUploading(true);
        const base64 = await fileToBase64(pdfFile);
        const { fileKey } = await upload.mutateAsync({ base64, fileName: pdfFile.name, mimeType: "application/pdf" });
        setUploading(false);
        ask.mutate({ ...base, source: { kind: "pdf", fileKey } });
      } else if (sourceMode === "image" && imageFile) {
        setUploading(true);
        const base64 = await fileToBase64(imageFile);
        const { fileKey } = await upload.mutateAsync({ base64, fileName: imageFile.name, mimeType: imageMimeFor(imageFile) });
        setUploading(false);
        ask.mutate({ ...base, source: { kind: "image", fileKey } });
      }
    } catch (err) {
      setUploading(false);
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  const MODE_TABS: { value: SourceMode; label: string; icon: React.ReactNode }[] = [
    { value: "url", label: "URL", icon: <Link2 className="w-3.5 h-3.5" /> },
    { value: "text", label: "Paste text", icon: <TypeIcon className="w-3.5 h-3.5" /> },
    { value: "pdf", label: "Upload PDF", icon: <FileText className="w-3.5 h-3.5" /> },
    { value: "image", label: "Upload image", icon: <ImageIcon className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="space-y-5">
      <Card className="border-primary/15 bg-gradient-to-br from-primary/[0.04] to-transparent">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary" /> Ask AI a question — optionally give it a source
            <InfoHint side="bottom" iconClassName="ml-0.5">
              Ask in plain English. Optionally attach one source — a URL, pasted text, a PDF, or a screenshot — and the
              assistant grounds its briefing in it. Either way you get the same output: a briefing plus structured
              findings you can triage into the review queue. It never writes to a catalogue and never recommends
              anything.
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
              <Select value={scope} onValueChange={setScope}>
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
              {uploading ? "Uploading…" : ask.isPending ? "Asking…" : "Ask"}
            </Button>
          </div>

          {/* Unified "Add a specific source" — url / text / pdf / image, all optional */}
          <Collapsible open={showSource} onOpenChange={setShowSource}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-xs text-muted-foreground -ml-2">
                <Paperclip className="w-3.5 h-3.5 mr-1.5" />
                {showSource ? "Hide source" : "Add a specific source (optional)"}
                <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${showSource ? "rotate-180" : ""}`} />
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="space-y-3 rounded-lg border border-dashed p-3 mt-2">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Attach one source and the assistant grounds its briefing in it. A URL is fetched and stripped to text; a
                PDF or screenshot is read directly. Whatever the source, nothing is written to a catalogue — findings
                land in the review queue for you to approve.
              </p>

              {/* Source mode picker */}
              <div className="flex flex-wrap gap-1 rounded-lg border border-border p-1 w-fit">
                {MODE_TABS.map((m) => (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setSourceMode(m.value)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors ${
                      sourceMode === m.value
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
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
                  value={sourceLabel}
                  onChange={(e) => setSourceLabel(e.target.value)}
                  className="bg-background"
                />
              </div>

              {sourceMode === "url" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Source URL (the assistant will read it)</Label>
                  <Input
                    placeholder="https://…"
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                    className="bg-background"
                  />
                </div>
              )}
              {sourceMode === "text" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Paste source text</Label>
                  <Textarea
                    placeholder="Paste a fact-sheet, auction result, or price table…"
                    value={sourceText}
                    onChange={(e) => setSourceText(e.target.value)}
                    rows={5}
                    className="font-mono text-xs"
                  />
                  <p className="text-[11px] text-muted-foreground">{sourceText.trim().length} characters</p>
                </div>
              )}
              {sourceMode === "pdf" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Upload a PDF (the assistant reads it directly)</Label>
                  <Input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
                    className="bg-background"
                  />
                  {pdfFile && (
                    <p className="text-[11px] text-muted-foreground">
                      {pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  )}
                </div>
              )}
              {sourceMode === "image" && (
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
                  <p className="text-[11px] text-muted-foreground">
                    If the current AI model can&rsquo;t read images, you&rsquo;ll get a clear message asking you to paste
                    the text instead.
                  </p>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      {busy && (
        <div className="space-y-3">
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </div>
      )}

      {result && !busy && (
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Bot className="w-4 h-4 text-violet-500" /> Briefing
                <Badge variant="outline" className="font-normal text-[11px]">
                  unverified — verify before acting
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
                <Streamdown>{result.answer}</Streamdown>
              </div>
            </CardContent>
          </Card>

          <div>
            <h3 className="text-sm font-semibold flex items-center gap-2 mb-3">
              <Inbox className="w-4 h-4 text-primary" /> Findings to triage
              <span className="text-xs font-normal text-muted-foreground">({result.findings.length})</span>
            </h3>
            {result.findings.length === 0 ? (
              <Empty className="py-8">
                <p className="text-sm text-muted-foreground text-center max-w-sm">
                  The briefing produced no structured findings to triage. Refine the question or add a specific source.
                </p>
              </Empty>
            ) : (
              <div className="space-y-3">
                {(result.findings as Finding[]).map((f) => (
                  <FindingCard
                    key={f.id}
                    finding={f}
                    onChanged={() => {
                      if (activeTaskId != null) utils.research.getTask.invalidate({ id: activeTaskId });
                      utils.research.listFindings.invalidate();
                      utils.research.newFindingsCount.invalidate();
                      utils.researchPipeline.digest.invalidate();
                      utils.researchPipeline.listUpdates.invalidate();
                      utils.researchPipeline.pendingCount.invalidate();
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Enquiry history (secondary, collapsed by default) ──────────────────────── */

function HistoryPanel() {
  const { data, isLoading } = trpc.research.listTasks.useQuery({ limit: 30 });
  const [openId, setOpenId] = useState<number | null>(null);

  if (isLoading) return <Skeleton className="h-40 w-full rounded-lg" />;
  const tasks = data?.tasks ?? [];

  if (tasks.length === 0) {
    return (
      <Empty className="py-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <History className="w-8 h-8 text-muted-foreground/60" />
          <p className="font-medium text-sm">No enquiries yet.</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Ask a research question and it will be logged here with its findings, so you can revisit what you looked
            into and when.
          </p>
        </div>
      </Empty>
    );
  }

  return (
    <div className="space-y-2.5">
      {tasks.map((t) => (
        <Card key={t.id}>
          <CardHeader className="pb-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm">{t.prompt}</CardTitle>
                <CardDescription className="mt-0.5 flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className="font-normal text-[11px]">
                    {t.scope}
                  </Badge>
                  <span>{t.status}</span>
                  {t.findingCount != null && <span>· {t.findingCount} findings</span>}
                  {t.createdAt && <span>· {formatRelativeTime(new Date(t.createdAt).getTime())}</span>}
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="bg-background shrink-0"
                onClick={() => setOpenId(openId === t.id ? null : t.id)}
              >
                {openId === t.id ? "Hide" : "View"}
              </Button>
            </div>
          </CardHeader>
          {openId === t.id && (
            <CardContent>
              <TaskDetail taskId={t.id} />
            </CardContent>
          )}
        </Card>
      ))}
    </div>
  );
}

function TaskDetail({ taskId }: { taskId: number }) {
  const utils = trpc.useUtils();
  const { data, isLoading } = trpc.research.getTask.useQuery({ id: taskId });
  if (isLoading) return <Skeleton className="h-24 w-full rounded-lg" />;
  const task = data?.task;
  const findings = (data?.findings ?? []) as Finding[];
  return (
    <div className="space-y-3">
      {task?.answerSummary && (
        <div className="prose prose-sm dark:prose-invert max-w-none text-sm">
          <Streamdown>{task.answerSummary}</Streamdown>
        </div>
      )}
      {task?.error && (
        <p className="text-xs text-rose-600 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {task.error}
        </p>
      )}
      {findings.length > 0 && (
        <div className="space-y-3">
          {findings.map((f) => (
            <FindingCard
              key={f.id}
              finding={f}
              onChanged={() => {
                utils.research.getTask.invalidate({ id: taskId });
                utils.research.newFindingsCount.invalidate();
                utils.researchPipeline.digest.invalidate();
                utils.researchPipeline.listUpdates.invalidate();
                utils.researchPipeline.pendingCount.invalidate();
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Page ──────────────────────────────────────────────────────────────────── */

export default function AskAI({ embedded = false }: { embedded?: boolean } = {}) {
  void embedded;
  const [showHistory, setShowHistory] = useState(false);
  return (
    <div className="space-y-6">
      <AiPrincipleBanner />
      <EnquiryPanel />

      {/* Enquiry history — kept, but secondary: collapsed by default so it does not
          compete with Ask. Item 2/3. */}
      <Collapsible open={showHistory} onOpenChange={setShowHistory}>
        <div className="flex items-center gap-2 border-t pt-4">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground -ml-2">
              <History className="w-3.5 h-3.5 mr-1.5" />
              {showHistory ? "Hide enquiry history" : "Show enquiry history"}
              <ChevronDown className={`w-3.5 h-3.5 ml-1 transition-transform ${showHistory ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <span className="text-[11px] text-muted-foreground">A log of past questions and their findings.</span>
        </div>
        <CollapsibleContent className="mt-3">
          <HistoryPanel />
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
