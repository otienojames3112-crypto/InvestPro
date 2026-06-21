import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import { PortfolioSelector } from "./PortfolioSelector";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Menu,
  Settings,
  TrendingUp,
  ArrowDownCircle,
  MapPin,
  PiggyBank,
  Briefcase,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { Skeleton } from "./ui/skeleton";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ledger", label: "Month Ledger", icon: BookOpen },
  { href: "/contributions", label: "Contributions", icon: TrendingUp },
  { href: "/securities", label: "CBK Securities", icon: Landmark },
  { href: "/scenarios", label: "Scenarios", icon: BarChart3 },
  { href: "/mmf-funds", label: "MMF Funds", icon: PiggyBank },
  { href: "/other-assets", label: "Other Assets", icon: Briefcase },
  { href: "/settings", label: "Rate Settings", icon: Settings },
  { href: "/getting-started", label: "Getting Started", icon: MapPin },
];

function SidebarContent({
  location,
  openDrawer,
  user,
  logout,
  onNavClick,
}: {
  location: string;
  openDrawer: () => void;
  user: { name?: string | null; email?: string | null } | null;
  logout: () => void;
  onNavClick?: () => void;
}) {
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
              className="text-sm font-bold text-sidebar-foreground leading-tight"
              style={{ fontFamily: "'Playfair Display', serif" }}
            >
              KES 5M Tracker
            </p>
            <p className="text-xs text-muted-foreground">2026 – 2036</p>
          </div>
        </div>
      </div>

      {/* Portfolio Selector */}
      <div className="px-3 py-3 border-b border-sidebar-border">
        <PortfolioSelector />
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto">
        <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Navigation
        </p>
        <ul className="space-y-0.5">
          {/* Record Deposits — opens drawer, not a page */}
          <li>
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
          </li>

          {/* Regular nav items */}
          {navItems.map(({ href, label, icon: Icon }) => {
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
                    {isActive && <ChevronRight className="w-3 h-3 text-primary" />}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
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
  const [mobileOpen, setMobileOpen] = useState(false);

  // Current page label for the mobile top bar
  const currentPage = navItems.find((n) => n.href === location)?.label ?? "KES 5M Tracker";

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
              KES 5M Tracker
            </h1>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your personal 10-year investment journey to KES 5,000,000 using a
              Money Market Fund + CBK DhowCSD velocity loop strategy.
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

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
