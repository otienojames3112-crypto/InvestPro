import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { cn } from "@/lib/utils";
import { useDepositDrawer } from "@/contexts/DepositDrawerContext";
import {
  BarChart3,
  BookOpen,
  ChevronRight,
  Landmark,
  LayoutDashboard,
  LineChart,
  LogOut,
  Settings,
  TrendingUp,
  ArrowDownCircle,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import { Button } from "./ui/button";
import { Separator } from "./ui/separator";
import { Skeleton } from "./ui/skeleton";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/ledger", label: "Month Ledger", icon: BookOpen },
  { href: "/contributions", label: "Contributions", icon: TrendingUp },
  { href: "/securities", label: "CBK Securities", icon: Landmark },
  { href: "/scenarios", label: "Scenarios", icon: BarChart3 },
  { href: "/settings", label: "Rate Settings", icon: Settings },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, isAuthenticated, logout } = useAuth();
  const [location] = useLocation();
  const { openDrawer } = useDepositDrawer();

  if (loading) {
    return (
      <div className="flex h-screen bg-background">
        <div className="w-64 border-r border-border p-6 flex flex-col gap-4">
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
              Your personal 10-year investment journey to KES 5,000,000 using the
              SanlamAllianz MMF + CBK DhowCSD velocity loop strategy.
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
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-sidebar flex flex-col">
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="px-3 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Navigation
          </p>
          <ul className="space-y-0.5">
            {/* Record Deposits — opens drawer, not a page */}
            <li>
              <button
                onClick={openDrawer}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 cursor-pointer group",
                  "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                )}
              >
                <ArrowDownCircle
                  className="w-4 h-4 shrink-0 transition-colors text-muted-foreground group-hover:text-sidebar-accent-foreground"
                />
                <span className="flex-1 text-left">Record Deposits</span>
                <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded font-medium">Live</span>
              </button>
            </li>

            {/* Regular nav items */}
            {navItems.map(({ href, label, icon: Icon }) => {
              const isActive = location === href;
              return (
                <li key={href}>
                  <Link href={href}>
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
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">
        {children}
      </main>
    </div>
  );
}
