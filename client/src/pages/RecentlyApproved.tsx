import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  History,
  ShieldCheck,
  ExternalLink,
  ArrowRight,
  PlusCircle,
  PencilLine,
} from "lucide-react";
import { catalogueLabel, type ReferenceCatalogue } from "@shared/researchPipeline";
import { formatRelativeTime } from "@/lib/format";
import { Link } from "wouter";

/** Map an audit catalogue value to its Reference Catalogues sub-tab id. */
const CATALOGUE_TAB_ID: Record<string, string> = {
  mmf: "mmf-market",
  bank: "bank-catalogue",
  cbk: "cbk-securities",
  market_asset: "market-assets",
};

function catalogueHref(catalogue: string, targetRef: string | null): string {
  const cat = CATALOGUE_TAB_ID[catalogue] ?? "mmf-market";
  const params = new URLSearchParams({ tab: "reference-catalogues", cat });
  if (targetRef) params.set("ref", targetRef);
  return `/research?${params.toString()}`;
}

const CATALOGUE_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All catalogues" },
  { value: "mmf", label: "MMF market" },
  { value: "bank", label: "Bank products" },
  { value: "cbk", label: "CBK securities" },
  { value: "market_asset", label: "Market assets" },
];

export default function RecentlyApproved({ embedded = false }: { embedded?: boolean } = {}) {
  void embedded;
  const [filter, setFilter] = useState("all");
  const { data, isLoading } = trpc.researchPipeline.recentlyApproved.useQuery(
    filter === "all" ? { limit: 100 } : { catalogue: filter as ReferenceCatalogue, limit: 100 },
    { refetchOnWindowFocus: false },
  );

  const entries = data?.entries ?? [];

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground leading-relaxed">
        An immutable record of every change promoted into a live reference catalogue — what changed, from which source,
        and who approved it. This is the audit trail that makes each catalogue figure defensible. It never shows
        pending proposals, only decisions already made.
      </p>

      <Tabs value={filter} onValueChange={setFilter}>
        <TabsList className="flex-wrap h-auto">
          {CATALOGUE_FILTERS.map((f) => (
            <TabsTrigger key={f.value} value={f.value}>
              {f.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </div>
      ) : entries.length === 0 ? (
        <Empty className="py-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <History className="w-9 h-9 text-muted-foreground/60" />
            <p className="font-medium">Nothing approved yet.</p>
            <p className="text-sm text-muted-foreground max-w-sm">
              When you approve a proposed change on the review queue, it is promoted into the matching catalogue and
              recorded here with its source and your name.
            </p>
          </div>
        </Empty>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => (
            <Card key={e.id} className="overflow-hidden">
              <CardContent className="py-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap text-sm font-medium">
                      {e.changeKind === "create" ? (
                        <PlusCircle className="w-4 h-4 text-emerald-500 shrink-0" />
                      ) : (
                        <PencilLine className="w-4 h-4 text-sky-500 shrink-0" />
                      )}
                      {e.instrumentName ?? e.targetRef ?? "Catalogue entry"}
                      <Badge variant="outline" className="font-normal text-[11px]">
                        {catalogueLabel(e.catalogue as ReferenceCatalogue)}
                      </Badge>
                      <Badge variant="secondary" className="font-normal text-[11px]">
                        {e.changeKind === "create" ? "added" : "edited"}
                      </Badge>
                    </div>

                    {e.changeKind === "edit" && e.field && (
                      <div className="text-xs text-muted-foreground flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-foreground">{e.field}</span>
                        <span className="tabular-nums">{e.oldValue ?? "—"}</span>
                        <ArrowRight className="w-3 h-3" />
                        <span className="tabular-nums font-medium text-foreground">{e.newValue ?? "—"}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                      <span>
                        Source: <span className="text-foreground">{e.source ?? "—"}</span>
                      </span>
                      {e.sourceUrl && (
                        <a
                          href={e.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-primary hover:underline"
                        >
                          open <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <span className="text-border">·</span>
                      <Link
                        href={catalogueHref(e.catalogue, e.targetRef ?? null)}
                        className="inline-flex items-center gap-1 text-primary hover:underline"
                      >
                        Open in {catalogueLabel(e.catalogue as ReferenceCatalogue)} <ArrowRight className="w-3 h-3" />
                      </Link>
                    </div>
                  </div>

                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div className="font-medium text-foreground">{e.approvedBy}</div>
                    <div>{formatRelativeTime(e.approvedAt)}</div>
                  </div>
                </div>
                {e.note && <p className="text-xs text-muted-foreground italic mt-2 border-l-2 border-border pl-2.5">{e.note}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
