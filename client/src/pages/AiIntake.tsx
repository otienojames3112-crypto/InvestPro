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
import { Textarea } from "@/components/ui/textarea";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  FileText,
  Compass,
  ExternalLink,
  ShieldAlert,
  ArrowRight,
  Check,
  X,
  Quote,
  Sparkles,
} from "lucide-react";
import { ASSET_CLASSES, ASSET_PROFILES, type AssetClass } from "@shared/assetModel";
import { InfoHint } from "@/components/InfoHint";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/** Friendly label for a figure key. */
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
 * Part 8 — AI Intake. AI is a LIBRARIAN here, never an oracle. Two on-ramps:
 *   1. Read a source document → extract factual figures at the LOWEST trust tier
 *      (ai_extracted). Each figure carries the verbatim quote it came from so a
 *      human can confirm it against the cited source on the instrument's page.
 *   2. Discover a universe → propose candidate instruments as SUGGESTIONS only.
 *      Nothing enters the catalog until a human approves a candidate (which then
 *      becomes a normal human-authored instrument).
 * Neither path ranks, scores, or recommends; both always end at a human action.
 */
export default function AiIntake({ embedded = false }: { embedded?: boolean } = {}) {
  const { isAuthenticated, user } = useAuth();
  const isMaintainer = user?.role === "admin";

  if (!isMaintainer) {
    return (
      <AppShell embedded={embedded}>
        <div className="container py-10 max-w-3xl">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" /> AI Intake
              </CardTitle>
              <CardDescription>
                {isAuthenticated
                  ? "AI-assisted intake is a maintainer-only task — every AI value still needs a human to confirm it against the source. Ask an administrator for access."
                  : "Sign in as a maintainer to let AI help draft instrument facts and propose candidates for your review."}
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
      <div className="container py-8 max-w-4xl space-y-8">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Bot className="w-6 h-6 text-primary" /> AI Intake
          </h1>
          <p className="text-muted-foreground mt-1 text-sm leading-relaxed">
            AI does the <strong className="text-foreground">librarian</strong> work — it reads messy source
            documents and structures the facts, or proposes instruments that might belong in a universe. It is{" "}
            <strong className="text-foreground">never an oracle</strong>: every value it produces enters at the
            lowest trust tier, reads as provisional everywhere, and only becomes trusted once{" "}
            <strong className="text-foreground">you</strong> confirm it against the cited source.
          </p>
        </div>

        <AiPrincipleBanner />
        <ExtractPanel />
        <DiscoverPanel />
        <CandidateReviewPanel />
      </div>
    </AppShell>
  );
}

export function AiPrincipleBanner() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-orange-500/30 bg-orange-500/5 px-3 py-2.5 text-xs text-muted-foreground">
      <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-orange-500" />
      <span>
        AI drafts are <strong className="text-orange-500">unverified until you approve them</strong>. The assistant
        can extract, compare, sort and summarise the facts it finds — but it does not publish, change any holding, or
        execute anything, and it never tells you what to buy, sell, or hold. Every draft waits in the review queue;
        only your approval promotes it, and <strong className="text-foreground">approved = manager-verified</strong>.
      </span>
    </div>
  );
}

/* ── Panel 1: read a source document → ai_extracted figures ─────────────────── */

type SourceKind = "text" | "url" | "pdf" | "image";

export function ExtractPanel() {
  const utils = trpc.useUtils();
  const [kind, setKind] = useState<SourceKind>("text");
  const [documentText, setDocumentText] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [sourceLabel, setSourceLabel] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [hintName, setHintName] = useState("");
  const [uploading, setUploading] = useState(false);

  const upload = trpc.opportunities.aiUploadDocument.useMutation();
  const extract = trpc.opportunities.aiExtract.useMutation({
    onSuccess: (res) => {
      // The procedure returns one of two shapes: an honest thin-fetch SIGNAL (a JS-rendered
      // page the server could not read), or a real extraction result. Narrow before toasting.
      if ("thinFetch" in res) {
        toast.warning("That page returned almost no readable text — see the nudge below.");
        return;
      }
      const figCount = Object.keys(res.extraction.figures ?? {}).length;
      toast.success(
        res.created
          ? `Drafted “${res.extraction.name}” (${figCount} figure${figCount === 1 ? "" : "s"}) — queued for review. Nothing changes until you approve it.`
          : `Proposed an edit to “${res.extraction.name}” — queued for review. Nothing changes until you approve it.`,
      );
      utils.opportunities.list.invalidate();
      utils.opportunities.byRef.invalidate();
      utils.opportunities.aiReviewQueue.invalidate();
      utils.researchPipeline.listUpdates.invalidate();
      utils.researchPipeline.pendingCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  const busy = extract.isPending || uploading;
  const sourceReady =
    kind === "text"
      ? documentText.trim().length >= 20
      : kind === "url"
        ? /^https?:\/\//.test(docUrl.trim())
        : kind === "pdf"
          ? !!pdfFile
          : !!imageFile;
  const canSubmit = sourceReady && sourceLabel.trim().length > 0 && !busy;
  const data = extract.data;
  // The thin-fetch nudge and the success block are mutually exclusive views of `data`.
  const thinFetch = data && "thinFetch" in data ? data : null;
  const result = data && !("thinFetch" in data) ? data : null;

  // When the user accepts the thin-fetch nudge, copy the URL into the paste box and switch
  // to the Paste-text mode so they can paste what they can see.
  function acceptThinFetchNudge(url: string) {
    setKind("text");
    setDocumentText((prev) => (prev.trim().length > 0 ? prev : `Source: ${url}\n\n`));
    extract.reset();
  }

  const imageMimeFor = (file: File): "image/png" | "image/jpeg" | "image/webp" => {
    const t = file.type.toLowerCase();
    if (t.includes("webp")) return "image/webp";
    if (t.includes("jpeg") || t.includes("jpg")) return "image/jpeg";
    return "image/png";
  };

  async function fileToBase64(file: File): Promise<string> {
    const buf = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buf);
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }

  async function handleSubmit() {
    const common = {
      sourceLabel: sourceLabel.trim(),
      sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
      hintName: hintName.trim() === "" ? undefined : hintName.trim(),
    };
    try {
      if (kind === "text") {
        extract.mutate({ source: { kind: "text", text: documentText.trim() }, ...common });
      } else if (kind === "url") {
        extract.mutate({ source: { kind: "url", url: docUrl.trim() }, ...common });
      } else if (kind === "pdf" && pdfFile) {
        setUploading(true);
        const base64 = await fileToBase64(pdfFile);
        const { fileKey } = await upload.mutateAsync({
          base64,
          fileName: pdfFile.name,
          mimeType: "application/pdf",
        });
        setUploading(false);
        extract.mutate({ source: { kind: "pdf", fileKey }, ...common });
      } else if (kind === "image" && imageFile) {
        setUploading(true);
        const base64 = await fileToBase64(imageFile);
        const { fileKey } = await upload.mutateAsync({
          base64,
          fileName: imageFile.name,
          mimeType: imageMimeFor(imageFile),
        });
        setUploading(false);
        extract.mutate({ source: { kind: "image", fileKey }, ...common });
      }
    } catch (err) {
      setUploading(false);
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="w-4 h-4 text-primary" /> Read a source document
        </CardTitle>
        <CardDescription>
          Give the librarian a fact sheet, auction notice, or prospectus — as pasted text, a URL it fetches, or an
          uploaded PDF. It extracts the factual figures it can find and saves them as <em>AI-extracted ·
          unverified</em>, each with the verbatim quote it read, into the review queue.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="src-label" className="inline-flex items-center gap-1">Cited source *<InfoHint>A short name for the document these facts came from (e.g. “CIC MMF fact sheet, May 2026”). It is stored with every extracted figure so anyone can trace a number back to its origin.</InfoHint></Label>
            <Input
              id="src-label"
              placeholder="e.g. CIC MMF fact sheet, May 2026"
              value={sourceLabel}
              onChange={(e) => setSourceLabel(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="src-url" className="inline-flex items-center gap-1">Source link (optional)<InfoHint>A web link a person can open to check the figures for themselves — ideally the exact page or PDF the document came from.</InfoHint></Label>
            <Input
              id="src-url"
              placeholder="https://… (link a human can open to confirm)"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="hint" className="inline-flex items-center gap-1">Instrument name hint (optional)<InfoHint>If the document covers one specific instrument, type its name here so the AI focuses on it instead of guessing which one you mean.</InfoHint></Label>
          <Input
            id="hint"
            placeholder="Helps the librarian focus on one instrument"
            value={hintName}
            onChange={(e) => setHintName(e.target.value)}
          />
        </div>

        {/* Source kind picker */}
        <div className="flex gap-1 rounded-lg border border-border p-1 w-fit">
          {(["text", "url", "pdf", "image"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                kind === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {k === "text"
                ? "Paste text"
                : k === "url"
                  ? "Fetch a URL"
                  : k === "pdf"
                    ? "Upload a PDF"
                    : "Upload an image"}
            </button>
          ))}
        </div>

        {kind === "text" && (
          <div className="space-y-1.5">
            <Label htmlFor="doc">Source document text *</Label>
            <Textarea
              id="doc"
              rows={8}
              placeholder="Paste the raw text from the fact sheet / notice here…"
              value={documentText}
              onChange={(e) => setDocumentText(e.target.value)}
              className="font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">{documentText.trim().length} characters</p>
          </div>
        )}
        {kind === "url" && (
          <div className="space-y-1.5">
            <Label htmlFor="doc-url">Document URL *</Label>
            <Input
              id="doc-url"
              placeholder="https://manager.example/fund-factsheet"
              value={docUrl}
              onChange={(e) => setDocUrl(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              The page is fetched and stripped to text on the server; the librarian reads only that text.
            </p>
          </div>
        )}
        {kind === "pdf" && (
          <div className="space-y-1.5">
            <Label htmlFor="doc-pdf">PDF file *</Label>
            <Input
              id="doc-pdf"
              type="file"
              accept="application/pdf"
              onChange={(e) => setPdfFile(e.target.files?.[0] ?? null)}
            />
            {pdfFile && (
              <p className="text-[11px] text-muted-foreground">
                {pdfFile.name} · {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
          </div>
        )}
        {kind === "image" && (
          <div className="space-y-1.5">
            <Label htmlFor="doc-image" className="inline-flex items-center gap-1">
              Screenshot / photo *
              <InfoHint>
                A picture of a quote board, fact-sheet table, or notice (PNG, JPG, or WEBP). A
                vision-capable AI reads the figures printed in the image. Useful when a page is hard to
                copy from. If the current AI model can’t read images, you’ll get a clear message asking
                you to paste the text instead.
              </InfoHint>
            </Label>
            <Input
              id="doc-image"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
            />
            {imageFile && (
              <p className="text-[11px] text-muted-foreground">
                {imageFile.name} · {(imageFile.size / 1024 / 1024).toFixed(2)} MB
              </p>
            )}
            <p className="text-[11px] text-muted-foreground">
              The AI transcribes only what is visibly printed in the image — it never infers a missing
              number. Each figure is saved as <em>AI-extracted · unverified</em>, noted as read from an
              uploaded screenshot, for you to confirm against the original.
            </p>
          </div>
        )}

        {/* Honest thin-fetch nudge: the page returned almost no text (likely JS-rendered). */}
        {thinFetch && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/[0.06] px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" />
            <div className="space-y-1.5">
              <p className="leading-relaxed">
                This page appears to be built with JavaScript — the server only saw{" "}
                <strong>{thinFetch.fetchedChars} characters</strong> of text, far too little to extract
                from reliably. Rather than guess, the AI did nothing. Try{" "}
                <strong>pasting the text</strong> you can see on the page, or{" "}
                <strong>uploading a screenshot</strong> of it instead.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={() => acceptThinFetchNudge(thinFetch.url ?? "")}>
                  Switch to Paste text
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setKind("image");
                    extract.reset();
                  }}
                >
                  Switch to Upload an image
                </Button>
              </div>
            </div>
          </div>
        )}

        <Button onClick={handleSubmit} disabled={!canSubmit}>
          <Sparkles className="w-4 h-4 mr-1.5" />
          {uploading ? "Uploading…" : extract.isPending ? "Reading the document…" : "Extract facts for review"}
        </Button>

        {result && (
          <div className="rounded-lg border border-orange-500/30 bg-orange-500/[0.04] p-4 space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <Bot className="w-4 h-4 text-orange-500" />
                <span className="font-medium">{result.extraction.name}</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-orange-500 border-orange-500/40 cursor-help">
                      AI-extracted · queued for review
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs text-xs leading-relaxed">
                    The lowest trust level in the app. These numbers were read off a document by AI and have <strong>not</strong> been checked by a person or a parser. Nothing is written to any catalogue — this proposal waits in the Research Desk review queue until you approve it against the source.
                  </TooltipContent>
                </Tooltip>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/research">
                  <Button size="sm" variant="outline" title="Open the Research Desk review queue to approve or reject this proposal against the source.">
                    Review in Research Desk <ArrowRight className="w-3.5 h-3.5 ml-1" />
                  </Button>
                </Link>
              </div>
            </div>
            {result.flagged && result.flagged.length > 0 && (
              <div className="flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/[0.06] px-3 py-2 text-xs text-red-500">
                <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
                <span>
                  {result.flagged.length} figure{result.flagged.length === 1 ? "" : "s"} tripped a sanity check
                  (a value outside the plausible range — likely a misread). {""}
                  {result.flagged.map((fl) => FIELD_LABELS[fl.key] ?? fl.key).join(", ")}. These are kept
                  provisional and marked for extra scrutiny — check them especially carefully against the source.
                </span>
              </div>
            )}
            {result.extraction.figures.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No confirmable figures were found. {result.extraction.notes ?? ""}
              </p>
            ) : (
              <ul className="space-y-2">
                {result.extraction.figures.map((f) => {
                  const flag = result.flagged?.find((fl) => fl.key === f.field);
                  return (
                    <li
                      key={f.field}
                      className={`rounded-md border bg-background/60 p-2.5 ${
                        flag ? "border-red-500/40" : "border-border"
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {FIELD_LABELS[f.field] ?? f.field}
                        </span>
                        <span className="font-semibold tabular-nums">{f.value}</span>
                        {flag && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Badge variant="outline" className="text-red-500 border-red-500/40 text-[10px] cursor-help">
                                sanity check · {flag.reason}
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                              This value falls outside the normal range for this kind of figure, so it is probably a misread (for example a 925% yield where 9.25% was meant). It is kept provisional — check it especially carefully against the source.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground italic">
                        <InfoHint icon={Quote} side="right">The exact words the AI read this figure from in the document. Compare it against the original source to confirm the number is right.</InfoHint>
                        <span>“{f.quote}”</span>
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="text-[11px] text-muted-foreground">
              This is a <strong>proposal only</strong> — nothing has been written to any catalogue. It waits in the
              Research Desk review queue until you approve it (confirming or correcting each figure against the cited
              source). Only an approval promotes it into the live catalogue.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Panel 2: discover a universe → propose candidates ──────────────────────── */

function DiscoverPanel() {
  const utils = trpc.useUtils();
  const [universe, setUniverse] = useState("");

  const discover = trpc.opportunities.aiDiscover.useMutation({
    onSuccess: (res) => {
      if (res.proposed === 0) {
        toast.info("The AI did not propose any candidates for that universe.");
      } else {
        toast.success(
          `Proposed ${res.proposed} candidate${res.proposed === 1 ? "" : "s"}${
            res.inserted < res.proposed ? ` (${res.proposed - res.inserted} already on the list)` : ""
          } — review them below.`,
        );
      }
      utils.opportunities.listCandidates.invalidate();
      utils.opportunities.pendingCandidateCount.invalidate();
    },
    onError: (err) => toast.error(err.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Compass className="w-4 h-4 text-primary" /> Discover a universe
        </CardTitle>
        <CardDescription>
          Describe a tracking universe (asset class, market, currency). AI proposes instruments that might fit —
          as <em>suggestions only</em>. Nothing is added to the catalog until you approve a candidate below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="universe" className="inline-flex items-center gap-1">Universe description<InfoHint>A “universe” is the set of instruments you want to track — e.g. “all money-market funds regulated in Kenya”. Describe it and the AI suggests names that might belong; it never adds anything itself.</InfoHint></Label>
          <Input
            id="universe"
            placeholder="e.g. KES-denominated money-market funds regulated in Kenya"
            value={universe}
            onChange={(e) => setUniverse(e.target.value)}
          />
        </div>
        <Button
          onClick={() => discover.mutate({ universe: universe.trim() })}
          disabled={universe.trim().length < 4 || discover.isPending}
        >
          <Sparkles className="w-4 h-4 mr-1.5" />
          {discover.isPending ? "Compiling candidates…" : "Propose candidates"}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ── Panel 3: review proposed candidates ────────────────────────────────────── */

function CandidateReviewPanel() {
  const { data, isLoading } = trpc.opportunities.listCandidates.useQuery({ status: "pending" });
  const candidates = data?.candidates ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Bot className="w-4 h-4 text-orange-500" /> Candidates awaiting review
        </CardTitle>
        <CardDescription>
          AI-proposed instruments. Each is a suggestion only and is never tracked until you approve it — approving
          creates a normal instrument that <strong className="text-foreground">you</strong> author and own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : candidates.length === 0 ? (
          <Empty className="border rounded-xl py-12">
            <div className="flex flex-col items-center gap-2 text-center">
              <Compass className="w-8 h-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                No pending candidates. Run a discovery above to propose some.
              </p>
            </div>
          </Empty>
        ) : (
          <ul className="space-y-3">
            {candidates.map((c) => (
              <CandidateRow key={c.id} candidate={c} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

type Candidate = {
  id: number;
  name: string;
  issuer: string | null;
  assetClass: string | null;
  currency: string | null;
  scopeReason: string | null;
  sourceUrl: string | null;
  universe: string | null;
};

function CandidateRow({ candidate }: { candidate: Candidate }) {
  const utils = trpc.useUtils();
  const [approveOpen, setApproveOpen] = useState(false);

  const review = trpc.opportunities.reviewCandidate.useMutation({
    onSuccess: (_res, vars) => {
      toast.success(
        vars.action === "approve"
          ? "Instrument created — you are its author. Add its figures on the instrument page."
          : "Candidate dismissed.",
      );
      utils.opportunities.listCandidates.invalidate();
      utils.opportunities.pendingCandidateCount.invalidate();
      utils.opportunities.list.invalidate();
      setApproveOpen(false);
    },
    onError: (err) => toast.error(err.message),
  });

  const dismissing = review.isPending && review.variables?.action === "dismiss";

  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">{candidate.name}</span>
            {candidate.assetClass && (
              <Badge variant="secondary" className="text-[11px]">
                {candidate.assetClass}
              </Badge>
            )}
            {candidate.currency && (
              <span className="text-xs text-muted-foreground">{candidate.currency}</span>
            )}
          </div>
          {candidate.issuer && (
            <p className="text-xs text-muted-foreground mt-0.5">{candidate.issuer}</p>
          )}
          {candidate.scopeReason && (
            <p className="text-xs text-muted-foreground mt-1">{candidate.scopeReason}</p>
          )}
          {candidate.sourceUrl && (
            <a
              href={candidate.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary inline-flex items-center gap-1 mt-1 hover:underline"
            >
              <ExternalLink className="w-3 h-3" /> source
            </a>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            size="sm"
            variant="outline"
            disabled={review.isPending}
            onClick={() => review.mutate({ action: "dismiss", id: candidate.id })}
          >
            <X className="w-3.5 h-3.5 mr-1" /> {dismissing ? "…" : "Dismiss"}
          </Button>
          <Button size="sm" disabled={review.isPending} onClick={() => setApproveOpen(true)}>
            <Check className="w-3.5 h-3.5 mr-1" /> Approve
          </Button>
        </div>
      </div>

      <ApproveDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        candidate={candidate}
        pending={review.isPending}
        onConfirm={(form) => review.mutate({ action: "approve", id: candidate.id, ...form })}
      />
    </li>
  );
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
}

function ApproveDialog({
  open,
  onOpenChange,
  candidate,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  candidate: Candidate;
  pending: boolean;
  onConfirm: (form: {
    ref: string;
    name: string;
    assetClass: string;
    issuer?: string;
    currency: string;
    source: string;
    sourceUrl?: string;
  }) => void;
}) {
  const [ref, setRef] = useState(() => slugify(candidate.name));
  const [name, setName] = useState(candidate.name);
  const [assetClass, setAssetClass] = useState<AssetClass>(
    (ASSET_CLASSES as readonly string[]).includes(candidate.assetClass ?? "")
      ? (candidate.assetClass as AssetClass)
      : "cash_mmf",
  );
  const [issuer, setIssuer] = useState(candidate.issuer ?? "");
  const [currency, setCurrency] = useState(candidate.currency ?? "KES");
  const [source, setSource] = useState("");
  const [sourceUrl, setSourceUrl] = useState(candidate.sourceUrl ?? "");

  const canSubmit = ref.trim() && name.trim() && source.trim() && !pending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Approve as a tracked instrument</DialogTitle>
          <DialogDescription>
            You are authoring this instrument — confirm its identity against a real source. No figures are copied
            from the AI suggestion; you add and verify those on the instrument page afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="ap-ref">Reference (unique) *</Label>
              <Input id="ap-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ap-currency">Currency *</Label>
              <Input id="ap-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-name">Name *</Label>
            <Input id="ap-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-issuer">Issuer / manager</Label>
            <Input id="ap-issuer" value={issuer} onChange={(e) => setIssuer(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Asset class *</Label>
            <Select value={assetClass} onValueChange={(v) => setAssetClass(v as AssetClass)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ASSET_CLASSES.map((ac) => (
                  <SelectItem key={ac} value={ac}>
                    {ASSET_PROFILES[ac].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-source">Source you confirmed against *</Label>
            <Input
              id="ap-source"
              placeholder="e.g. CMA licensed funds register"
              value={source}
              onChange={(e) => setSource(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ap-source-url">Source link (optional)</Label>
            <Input id="ap-source-url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
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
                ref: ref.trim(),
                name: name.trim(),
                assetClass,
                issuer: issuer.trim() === "" ? undefined : issuer.trim(),
                currency: currency.trim() || "KES",
                source: source.trim(),
                sourceUrl: sourceUrl.trim() === "" ? undefined : sourceUrl.trim(),
              })
            }
          >
            {pending ? "Creating…" : "Create instrument"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
