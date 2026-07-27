import { useMemo } from "react";
import { useSearchParams } from "wouter";
import { Inbox, Library } from "lucide-react";
import { cn } from "@/lib/utils";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import ResearchDesk from "./ResearchDesk";
import { CATALOGUE_TABS } from "./referenceCatalogueTabs";

/**
 * Research — the consolidated "find, reference and govern" area.
 *
 * Round 85 structure (two top-level tabs):
 *   1. Research Desk       — the governed workbench (Ask AI, Review Queue, Source
 *                            Conflicts, Source Registry, Recently Approved).
 *   2. Reference Catalogues — the four published catalogues (MMF, Bank, CBK,
 *                            Market Assets) PLUS "All Approved Instruments" — the
 *                            approved reference universe over the approved federated
 *                            universe. All are nested via `?cat=`.
 *
 * The approved reference universe is no longer a top-level tab; it lives inside Reference
 * Catalogues as "All Approved Instruments" so the top level stays about the raw
 * pipeline (Desk) vs the published reference data (Catalogues).
 *
 * Nothing an AI or a source proposes reaches a live catalogue until a manager
 * approves it on the Research Desk; approval publishes straight into the correct
 * catalogue (verified server-side) and is recorded in Recently Approved.
 */

/**
 * ReferenceCatalogues — a nested tab strip for the four published catalogues.
 * The active catalogue lives in the `?cat=` query param so it is deep-linkable
 * (and Recently Approved's "Open in …" links can target it directly).
 */
function ReferenceCatalogues() {
  const [params, setParams] = useSearchParams();
  const requested = params.get("cat");
  const activeId = useMemo(() => {
    if (requested && CATALOGUE_TABS.some((t) => t.id === requested)) return requested;
    return CATALOGUE_TABS[0].id;
  }, [requested]);
  const active = CATALOGUE_TABS.find((t) => t.id === activeId) ?? CATALOGUE_TABS[0];

  const select = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("cat", id);
    // Round 86: a `?ref=` (or `?class=`) deep link belongs to ONE catalogue. When the
    // manager switches to a different catalogue tab we must drop it, otherwise the
    // new catalogue would prefill its search with a foreign reference (e.g. an
    // NSE:EABL ref leaking onto the MMF Market tab).
    next.delete("ref");
    next.delete("class");
    setParams(next, { replace: false });
  };

  return (
    <div className="flex flex-col h-full">
      <div className="border-b border-border bg-muted/10 px-4 md:px-8 pt-3">
        <div
          role="tablist"
          aria-label="Reference catalogues"
          className="flex items-center gap-1 overflow-x-auto -mb-px"
        >
          {CATALOGUE_TABS.map((tab) => {
            const isActive = tab.id === active.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => select(tab.id)}
                className={cn(
                  "relative flex items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 py-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                )}
                title={tab.hint}
              >
                {Icon && <Icon className="w-4 h-4 shrink-0" />}
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "pointer-events-none absolute inset-x-1 -bottom-px h-0.5 rounded-full transition-opacity duration-150",
                    isActive ? "bg-primary opacity-100" : "opacity-0",
                  )}
                />
              </button>
            );
          })}
        </div>
      </div>
      {active.hint && (
        <div className="px-4 md:px-8 py-2 text-xs text-muted-foreground border-b border-border/60 bg-muted/20">
          {active.hint}
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto">{active.render()}</div>
    </div>
  );
}

const TABS: AreaTab[] = [
  {
    id: "research-desk",
    label: "Research Desk",
    icon: Inbox,
    hint: "Create and review proposed catalogue updates. AI findings remain drafts until approved.",
    render: () => <ResearchDesk embedded />,
  },
  {
    id: "reference-catalogues",
    label: "Reference Catalogues",
    icon: Library,
    hint: "Browse approved reference facts. Approved reference data does not change holdings or portfolio calculations by itself.",
    render: () => <ReferenceCatalogues />,
  },
];

export default function ResearchArea() {
  return (
    <TabbedArea
      title="Research"
      subtitle="Research approved market reference data and manage proposed catalogue updates."
      tabs={TABS}
      defaultTab="research-desk"
    />
  );
}
