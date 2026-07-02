import { useCallback, useMemo } from "react";
import { useSearchParams } from "wouter";
import { cn } from "@/lib/utils";
import { AppShell } from "./AppShell";
import type { LucideIcon } from "lucide-react";

/**
 * A single tab inside a consolidated parent area.
 * - `id` is the value written to the `?tab=` query param (deep-linkable).
 * - `render` returns the embedded page body (the migrated page rendered with
 *   `embedded`, so it skips its own AppShell).
 */
export type AreaTab = {
  id: string;
  label: string;
  icon?: LucideIcon;
  /** Optional one-line helper shown under the title for layman context. */
  hint?: string;
  render: () => React.ReactNode;
};

/**
 * TabbedArea — the shared chrome for the 7 consolidated manager-grade areas.
 *
 * It owns the single AppShell + a horizontal tab strip, and renders exactly one
 * embedded page body at a time. The active tab is stored in the URL (`?tab=`),
 * so every old route can redirect to `/<area>?tab=<id>` and deep-links survive
 * reloads and sharing. Only the active tab's body is mounted, so we never run
 * 4 pages' worth of queries at once.
 */
export function TabbedArea({
  title,
  subtitle,
  tabs,
  defaultTab,
  /** Optional content rendered at the right of the header (e.g. a primary action). */
  headerAction,
}: {
  title: string;
  subtitle?: string;
  tabs: AreaTab[];
  defaultTab?: string;
  headerAction?: React.ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const fallback = defaultTab ?? tabs[0]?.id;

  // Resolve the active tab: honour ?tab= when it matches a real tab, else fall back.
  const activeId = useMemo(() => {
    if (requested && tabs.some((t) => t.id === requested)) return requested;
    return fallback;
  }, [requested, tabs, fallback]);

  const active = tabs.find((t) => t.id === activeId) ?? tabs[0];

  const selectTab = useCallback(
    (id: string) => {
      // Preserve unrelated params, but drop nested deep-link params that belong to a
      // specific sub-view (a catalogue row `?ref=`, a nested catalogue `?cat=`, or an
      // allocation handoff `?class=`). Carrying them across a top-level tab switch is
      // what let a stale row ref leak onto the wrong catalogue (Round 86).
      const next = new URLSearchParams(params);
      next.set("tab", id);
      next.delete("ref");
      next.delete("cat");
      next.delete("class");
      setParams(next, { replace: false });
    },
    [params, setParams],
  );

  return (
    <AppShell>
      <div className="flex flex-col h-full">
        {/* Area header */}
        <div className="border-b border-border bg-background/60 px-4 md:px-8 pt-5 pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1
                className="text-2xl font-bold text-foreground leading-tight"
                style={{ fontFamily: "'Playfair Display', serif" }}
              >
                {title}
              </h1>
              {subtitle && (
                <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
              )}
            </div>
            {headerAction && <div className="shrink-0">{headerAction}</div>}
          </div>

          {/* Tab strip */}
          <div
            role="tablist"
            aria-label={title}
            className="mt-4 -mb-px flex items-center gap-1 overflow-x-auto"
          >
            {tabs.map((tab) => {
              const isActive = tab.id === active?.id;
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => selectTab(tab.id)}
                  className={cn(
                    "relative flex items-center gap-2 whitespace-nowrap rounded-t-lg px-3.5 py-2.5 text-sm font-medium transition-colors duration-150 cursor-pointer",
                    isActive
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
                  )}
                  title={tab.hint}
                >
                  {Icon && <Icon className="w-4 h-4 shrink-0" />}
                  <span>{tab.label}</span>
                  {/* Active underline */}
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

        {/* Active tab hint */}
        {active?.hint && (
          <div className="px-4 md:px-8 py-2 text-xs text-muted-foreground border-b border-border/60 bg-muted/20">
            {active.hint}
          </div>
        )}

        {/* Active panel — only this page body is mounted */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {active?.render()}
        </div>
      </div>
    </AppShell>
  );
}
