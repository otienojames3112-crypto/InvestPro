import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { usePortfolio } from "@/contexts/PortfolioContext";
import { formatDateRange, formatKESCompact } from "@/lib/format";
import { PortfolioSelector } from "./PortfolioSelector";
import { ModeSwitcher, SandboxBanner, TimeMachineBanner } from "./ModeSwitcher";
import {
  BarChart3,
  BookOpen,
  GraduationCap,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
  TrendingUp,
  ArrowDownCircle,
  ArrowUpCircle,
  MapPin,
  PiggyBank,
  Briefcase,
  CalendarClock,
  Receipt,
  PieChart,
  Building2,
  ClipboardCheck,
  Scale,
  Compass,
  Layers,
  GitCompareArrows,
  Bot,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";
import { trpc } from "@/lib/trpc";
import { rateStaleness } from "@/lib/rateStaleness";
import { useReconciliationDrift } from "@/hooks/useReconciliationDrift";
import { useMaturingWindow, daysUntilDate, maturingWindowLabel, MATURING_WINDOW_ALL } from "@/hooks/useMaturingWindow";
import { Clock } from "lucide-react";
import { useMemo } from "react";

/**
 * Compact rate-staleness badge for the sidebar, visible on every page. Reads
 * the current portfolio's rate snapshot freshness and links to Rate Settings.
 * Mirrors the Dashboard rate-card thresholds (green / amber / red).
 */
function SidebarRateStaleness({
  portfolioId,
  onNavClick,
}: {
  portfolioId: number | null | undefined;
  onNavClick?: () => void;
}) {
  const { mode } = usePortfolio();
  const { data } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: !!portfolioId }
  );
  if (!portfolioId || !data) return null;

  // R69.5 — In Test/sandbox mode the data is sample data, not a real
  // rate-keeping record, so the red "Rates updated never" alarm is a false
  // nag. Show a neutral, non-actionable "sample rates" badge instead.
  if (mode === "sandbox") {
    return (
      <Link href="/settings" onClick={onNavClick}>
        <div
          className={cn(
            "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer hover:brightness-110",
            "border-border bg-muted/40 text-muted-foreground"
          )}
          title="Sample rates — Test mode uses sample data, so rate freshness is not tracked here."
        >
          <Clock className="w-3.5 h-3.5 shrink-0" />
          <span className="flex-1 min-w-0 truncate">Sample rates (Test mode)</span>
        </div>
      </Link>
    );
  }

  const s = rateStaleness((data as { ratesLastUpdatedAt?: Date | string | null }).ratesLastUpdatedAt ?? null);
  const tone = s.isVeryStale
    ? "border-red-500/40 bg-red-500/10 text-red-400"
    : s.isStale
      ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
      : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
  return (
    <Link href="/settings" onClick={onNavClick}>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border px-3 py-2 text-xs transition-colors cursor-pointer hover:brightness-110",
          tone
        )}
        title={s.isStale ? "Your saved rates may be out of date — update them to keep projections accurate." : "Rates are up to date."}
      >
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span className="flex-1 min-w-0 truncate">
          Rates updated {s.label}
        </span>
        {s.isStale && <span className="font-semibold shrink-0">Update</span>}
      </div>
    </Link>
  );
}

/**
 * Reconciliation-drift badge shown next to the Dashboard nav item. Surfaces a
 * small amber/red pill whenever live actuals diverge from the projection
 * engine's seeded "today" value by more than ~1%, so portfolio drift is
 * visible without opening the Dashboard reconciliation card. Hidden when the
 * numbers match (or there is nothing to reconcile yet).
 */
function SidebarDriftBadge({
  portfolioId,
  onNavClick,
}: {
  portfolioId: number | null | undefined;
  onNavClick?: () => void;
}) {
  const [, setLocation] = useLocation();
  const drift = useReconciliationDrift(portfolioId);
  if (!drift || drift.level === "match") return null;
  const tone =
    drift.level === "major"
      ? "bg-red-500/15 text-red-400 border-red-500/30 hover:bg-red-500/25"
      : "bg-amber-500/15 text-amber-400 border-amber-500/30 hover:bg-amber-500/25";
  const sign = drift.delta >= 0 ? "+" : "−";
  return (
    <button
      type="button"
      onClick={(e) => {
        // The badge lives inside the Dashboard <Link>; intercept so we can add the
        // deep-link param that tells the Dashboard to scroll to the reconciliation card.
        e.preventDefault();
        e.stopPropagation();
        setLocation("/?reconcile=1");
        onNavClick?.();
      }}
      className={cn(
        "shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums transition-colors cursor-pointer",
        tone
      )}
      title={`Live actuals are ${sign}${drift.absPct.toFixed(1)}% vs the projection engine's value for today. Click to open the Dashboard reconciliation card.`}
    >
      {sign}{drift.absPct.toFixed(1)}%
    </button>
  );
}

/**
 * Count badge on the CBK Securities nav item. Shows how many active lots fall
 * inside the user's chosen maturing-soon window (shared with the Securities page),
 * so an upcoming rollover is visible without opening the page. Hidden when none.
 */
function SidebarSecuritiesBadge({ portfolioId }: { portfolioId: number | null | undefined }) {
  const [windowDays] = useMaturingWindow();
  const { data: securities } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId as number },
    { enabled: portfolioId != null }
  );
  const count = useMemo(() => {
    if (!securities) return 0;
    return securities.filter(
      (s) => !s.isMatured && daysUntilDate(s.maturityDate) <= windowDays
    ).length;
  }, [securities, windowDays]);
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-amber-400"
      title={`${count} lot${count === 1 ? "" : "s"} maturing${windowDays === MATURING_WINDOW_ALL ? " ahead" : ` within ${maturingWindowLabel(windowDays)}`}`}
    >
      {count}
    </span>
  );
}

function SidebarConflictsBadge() {
  const { data } = trpc.opportunities.openConflictCount.useQuery(undefined, {
    // Cheap, public count; refresh occasionally so the badge stays current.
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-amber-500/30 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-amber-400"
      title={`${count} scraped figure${count === 1 ? "" : "s"} disagree with a value you checked`}
    >
      {count}
    </span>
  );
}

function SidebarCandidatesBadge() {
  const { data } = trpc.opportunities.pendingCandidateCount.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const count = data?.count ?? 0;
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-orange-400"
      title={`${count} AI-proposed candidate${count === 1 ? "" : "s"} awaiting your review`}
    >
      {count}
    </span>
  );
}

function SidebarReviewBadge() {
  const { data } = trpc.opportunities.aiReviewQueue.useQuery(undefined, {
    refetchInterval: 60_000,
  });
  const count = (data ?? []).reduce((n, x) => n + x.aiFigureCount, 0);
  if (count <= 0) return null;
  return (
    <span
      className="shrink-0 rounded-full border border-orange-500/40 bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none tabular-nums text-orange-400"
      title={`${count} AI-extracted figure${count === 1 ? "" : "s"} awaiting confirmation`}
    >
      {count}
    </span>
  );
}

const navGroups = [
  {
    title: "Tracking",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
      { href: "/ledger", label: "Month Ledger", icon: BookOpen },
      { href: "/contributions", label: "Contributions", icon: TrendingUp },
      { href: "/securities", label: "CBK Securities", icon: Landmark },
      { href: "/mmf-funds", label: "MMF Funds", icon: PiggyBank },
      { href: "/other-assets", label: "Other Assets", icon: Briefcase },
      { href: "/withdrawals", label: "Withdrawals", icon: ArrowUpCircle },
    ],
  },
  {
    title: "Invest",
    items: [
      { href: "/explore", label: "Explore Opportunities", icon: Compass },
      { href: "/allocation-plan", label: "Allocation Plan", icon: Layers },
      { href: "/ai-intake", label: "AI Intake", icon: Bot },
      { href: "/ai-review", label: "AI Review", icon: ClipboardCheck },
      { href: "/source-conflicts", label: "Source Conflicts", icon: GitCompareArrows },
    ],
  },
  {
    title: "Analysis",
    items: [
      { href: "/scenarios", label: "Scenarios", icon: BarChart3 },
      { href: "/portfolio-review", label: "Portfolio Review", icon: ClipboardCheck },
      { href: "/reconciliation", label: "Reconciliation", icon: Scale },
      { href: "/mmf-accrual", label: "Daily Accrual", icon: CalendarClock },
      { href: "/tax-summary", label: "Tax Summary", icon: Receipt },
      { href: "/time-machine", label: "Time Machine", icon: Clock, sandboxOnly: true },
    ],
  },
  {
    title: "Knowledge",
    items: [
      { href: "/learn", label: "Learn the Basics", icon: GraduationCap },
      { href: "/mmf-strategy", label: "MMF Strategy", icon: PieChart },
      { href: "/bank-instruments", label: "Bank Instruments", icon: Building2 },
      { href: "/getting-started", label: "Getting Started", icon: MapPin },
    ],
  },
  {
    title: "Setup",
    items: [
      { href: "/settings", label: "Rate Settings", icon: Settings },
    ],
  },
];

function SidebarContent({
  location,
  openDrawer,
  user,
  logout,
  onNavClick,
  appTitle,
  appSubtitle,
  portfolioId,
}: {
  location: string;
  openDrawer: () => void;
  user: { name?: string | null; email?: string | null } | null;
  logout: () => void;
  onNavClick?: () => void;
  appTitle: string;
  appSubtitle: string;
  portfolioId: number | null | undefined;
}) {
  const { mode } = usePortfolio();
  return (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shrink-0">
            <LineChart className="w-4 h-4 text-primary-foreground" />
          </div>
          <div className="min-w-0">
            <p
              className="text-sm font-bold text-sidebar-foreground leading-tight truncate"
              style={{ fontFamily: "'Playfair Display', serif" }}
              title={appTitle}
            >
              {appTitle}
            </p>
            <p className="text-xs text-muted-foreground truncate" title={appSubtitle}>{appSubtitle}</p>
          </div>
        </div>
      </div>

      {/* Mode toggle + Portfolio Selector */}
      <div className="px-3 py-3 border-b border-sidebar-border space-y-3">
        <ModeSwitcher />
        <PortfolioSelector />
        <SidebarRateStaleness portfolioId={portfolioId} onNavClick={onNavClick} />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-4">
        {/* Record Deposits — opens drawer, not a page */}
        <button
          onClick={() => { openDrawer(); onNavClick?.(); }}
          className={cn(
            "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group",
            "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          )}
        >
          <ArrowDownCircle className="w-4 h-4 shrink-0 transition-colors text-muted-foreground group-hover:text-sidebar-accent-foreground" />
          <span className="flex-1 text-left">Record Deposits</span>
          <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">Live</span>
        </button>

        {navGroups.map((group) => {
          const visibleItems = group.items.filter(
            (it) => !(it as { sandboxOnly?: boolean }).sandboxOnly || mode === "sandbox",
          );
          if (visibleItems.length === 0) return null;
          return (
          <div key={group.title}>
            <p className="px-3 mb-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              {group.title}
            </p>
            <ul className="space-y-0.5">
              {visibleItems.map(({ href, label, icon: Icon }) => {
                const isActive = location === href;
                return (
                  <li key={href}>
                    <Link href={href} onClick={onNavClick}>
                      <div
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group",
                          isActive
                            ? "bg-sidebar-accent text-primary"
                            : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                        )}
                      >
                        <Icon
                          className={cn(
                            "w-4 h-4 shrink-0 transition-colors",
                            isActive ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-accent-foreground"
                          )}
                        />
                        <span className="flex-1">{label}</span>
                        {href === "/" && <SidebarDriftBadge portfolioId={portfolioId} onNavClick={onNavClick} />}
                        {href === "/securities" && <SidebarSecuritiesBadge portfolioId={portfolioId} />}
                        {href === "/ai-intake" && <SidebarCandidatesBadge />}
                        {href === "/ai-review" && <SidebarReviewBadge />}
                        {href === "/source-conflicts" && <SidebarConflictsBadge />}
                        {isActive && <ChevronRight className="w-3 h-3 text-primary" />}
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
          );
        })}
      </nav>

      {/* User profile */}
      <div className="px-3 py-4 border-t border-sidebar-border">
        <div className="flex items-center gap-3 px-3 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-primary">
              {user?.name?.charAt(0)?.toUpperCase() ?? "U"}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-sidebar-foreground truncate">{user?.name ?? "Investor"}</p>
            <p className="text-xs text-muted-foreground truncate">{user?.email ?? ""}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
            onClick={() => logout()}
          >
            <LogOut className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const { openDrawer } = useDepositDrawer();
  const { portfolio, portfolioId } = usePortfolio();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Portfolio-driven app identity. Falls back to a neutral label before a
  // portfolio is loaded so we never show another portfolio's hardcoded name.
  const appTitle = portfolio?.name?.trim() || "Investment Tracker";
  const dateRange = portfolio
    ? formatDateRange(portfolio.startDate, portfolio.horizonMonths)
    : "";
  const targetLabel = portfolio
    ? `Target ${formatKESCompact(Number(portfolio.targetAmount) || 0)}`
    : "";
  // Prefer the portfolio's own description; otherwise derive a date-range + target subtitle.
  const appSubtitle =
    portfolio?.description?.trim() ||
    [dateRange, targetLabel].filter(Boolean).join(" · ") ||
    "Personal investment plan";

  // Current page label for the mobile top bar
  const currentPage =
    navGroups
      .flatMap((g) => g.items)
      .find((n) => n.href === location)?.label ?? appTitle;

  if (loading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="hidden md:flex w-64 border-r border-border p-6 flex-col gap-4">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-32" />
          <div className="mt-6 flex flex-col gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-8">
          <Skeleton className="h-full w-full" />
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md px-6">
          <div className="mb-6">
            <LineChart className="w-16 h-16 mx-auto text-primary mb-4" />
            <h1
              className="text-3xl font-bold mb-2 gradient-text"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              Investment Tracker
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Plan and track your fixed-income investment journey across Money
              Market Funds and CBK securities — one or many portfolios, each with
              its own target, horizon, and strategy.
            </p>
          </div>
          <Button
            size="lg"
            className="w-full bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
            onClick={() => (window.location.href = getLoginUrl())}
          >
            Sign in to get started
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      {/* ── Desktop sidebar (always visible ≥ md) ── */}
      <aside className="hidden md:flex w-64 shrink-0 border-r border-border bg-sidebar flex-col">
        <SidebarContent
          location={location}
          openDrawer={openDrawer}
          user={user}
          logout={logout}
          appTitle={appTitle}
          appSubtitle={appSubtitle}
          portfolioId={portfolioId}
        />
      </aside>

      {/* ── Mobile slide-over backdrop ── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile slide-over sidebar ── */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-sidebar border-r border-sidebar-border flex flex-col transition-transform duration-300 ease-out md:hidden",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Close button */}
        <button
          className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-sidebar-accent transition-colors"
          onClick={() => setMobileOpen(false)}
          aria-label="Close menu"
        >
          <X className="w-5 h-5" />
        </button>
        <SidebarContent
          location={location}
          openDrawer={openDrawer}
          user={user}
          logout={logout}
          onNavClick={() => setMobileOpen(false)}
          appTitle={appTitle}
          appSubtitle={appSubtitle}
          portfolioId={portfolioId}
        />
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile top bar */}
        <header className="md:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-background shrink-0">
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileOpen(true)}
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-6 h-6 rounded bg-primary flex items-center justify-center shrink-0">
              <LineChart className="w-3 h-3 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold text-foreground truncate">{currentPage}</span>
          </div>
          {/* Quick deposit button on mobile */}
          <button
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-accent transition-colors"
            onClick={openDrawer}
            aria-label="Record deposit"
          >
            <ArrowDownCircle className="w-5 h-5" />
          </button>
        </header>

        {/* Sandbox banner */}
        <SandboxBanner />
        <TimeMachineBanner />

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
