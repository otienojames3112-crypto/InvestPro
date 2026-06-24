import { useMemo } from "react";
import { CalendarClock, TrendingUp, ShieldCheck, Landmark, Building2 } from "lucide-react";
import { formatKES } from "@/lib/format";

/**
 * Dashboard 90-day maturity / liquidity strip (Round 33).
 *
 * Shows, at a glance, every date in the next 90 days on which capital frees up:
 *   - CBK securities (T-Bills / IFB / FXD) reaching their maturity date, and
 *   - bank TERM deposits (fixed deposit / target savings) reaching maturity.
 *
 * Pure presentational logic over already-fetched rows; no data fetching here so
 * it stays cheap to render and easy to test. All dates are compared in local
 * time against "today at 00:00" to avoid off-by-one drift near midnight.
 */

export interface MaturityRow {
  maturityDate: string | Date | null;
  isMatured?: boolean;
}

export interface SecurityLike extends MaturityRow {
  securityType: string;
  faceValue: number | string;
}

export interface BankHoldingLike extends MaturityRow {
  bankName: string;
  label?: string | null;
  instrumentType: string;
  principal: number | string;
  isActive?: boolean;
}

interface TimelineEvent {
  id: string;
  date: Date;
  days: number;
  amount: number;
  label: string;
  kind: "tbill" | "ifb" | "fxd" | "bank";
}

const WINDOW_DAYS = 90;

const TERM_BANK_KINDS = new Set(["fixed_deposit", "target_savings"]);

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

const KIND_META: Record<TimelineEvent["kind"], { color: string; dot: string; icon: typeof TrendingUp }> = {
  tbill: { color: "text-[#60a5fa]", dot: "bg-[#60a5fa]", icon: TrendingUp },
  ifb: { color: "text-[#a78bfa]", dot: "bg-[#a78bfa]", icon: ShieldCheck },
  fxd: { color: "text-[#fb923c]", dot: "bg-[#fb923c]", icon: Landmark },
  bank: { color: "text-sky-300", dot: "bg-sky-400", icon: Building2 },
};

export function buildMaturityEvents(
  securities: SecurityLike[],
  bankHoldings: BankHoldingLike[],
  windowDays = WINDOW_DAYS,
): TimelineEvent[] {
  const today = startOfToday();
  const events: TimelineEvent[] = [];

  for (const s of securities) {
    if (s.isMatured || !s.maturityDate) continue;
    const date = new Date(s.maturityDate);
    date.setHours(0, 0, 0, 0);
    const days = daysBetween(today, date);
    if (days < 0 || days > windowDays) continue;
    const kind: TimelineEvent["kind"] = s.securityType.startsWith("tbill")
      ? "tbill"
      : s.securityType === "ifb"
        ? "ifb"
        : "fxd";
    const label = kind === "tbill" ? "T-Bill" : kind === "ifb" ? "IFB bond" : "FXD bond";
    events.push({
      id: `sec-${label}-${date.getTime()}-${events.length}`,
      date,
      days,
      amount: Number(s.faceValue) || 0,
      label,
      kind,
    });
  }

  for (const b of bankHoldings) {
    if (b.isActive === false || !b.maturityDate) continue;
    if (!TERM_BANK_KINDS.has(b.instrumentType)) continue;
    const date = new Date(b.maturityDate);
    date.setHours(0, 0, 0, 0);
    const days = daysBetween(today, date);
    if (days < 0 || days > windowDays) continue;
    events.push({
      id: `bank-${b.bankName}-${date.getTime()}-${events.length}`,
      date,
      days,
      amount: Number(b.principal) || 0,
      label: b.label || b.bankName,
      kind: "bank",
    });
  }

  return events.sort((a, b) => a.days - b.days);
}

export function MaturityTimeline({
  securities,
  bankHoldings,
}: {
  securities: SecurityLike[];
  bankHoldings: BankHoldingLike[];
}) {
  const events = useMemo(
    () => buildMaturityEvents(securities, bankHoldings),
    [securities, bankHoldings],
  );

  const totalFreeingUp = events.reduce((s, e) => s + e.amount, 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <CalendarClock className="w-4 h-4 text-[#c9a84c]" />
          <h2 className="text-sm font-semibold text-foreground">Next 90 days — capital freeing up</h2>
        </div>
        {events.length > 0 ? (
          <span className="text-xs text-muted-foreground">
            {formatKES(totalFreeingUp)} across {events.length} event{events.length !== 1 ? "s" : ""}
          </span>
        ) : null}
      </div>

      {events.length === 0 ? (
        <div className="py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No CBK securities or term deposits mature in the next 90 days.
          </p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            On-call balances stay fully liquid and are not shown here.
          </p>
        </div>
      ) : (
        <>
          {/* Axis track with month markers */}
          <div className="relative h-1.5 rounded-full bg-white/10 mb-1">
            {[0, 30, 60, 90].map((d) => (
              <div
                key={d}
                className="absolute top-0 -translate-x-1/2 w-px h-1.5 bg-white/25"
                style={{ left: `${(d / WINDOW_DAYS) * 100}%` }}
              />
            ))}
            {/* Event dots positioned along the track */}
            {events.map((e) => {
              const meta = KIND_META[e.kind];
              return (
                <div
                  key={`dot-${e.id}`}
                  className={`absolute -top-1 -translate-x-1/2 w-3.5 h-3.5 rounded-full ${meta.dot} ring-2 ring-[#0d1117]`}
                  style={{ left: `${(e.days / WINDOW_DAYS) * 100}%` }}
                  title={`${e.label} · ${formatKES(e.amount)} · in ${e.days} day${e.days === 1 ? "" : "s"}`}
                />
              );
            })}
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground/70 mb-4">
            <span>Today</span>
            <span>+30d</span>
            <span>+60d</span>
            <span>+90d</span>
          </div>

          {/* Event list */}
          <div className="space-y-1.5">
            {events.map((e) => {
              const meta = KIND_META[e.kind];
              const Icon = meta.icon;
              return (
                <div
                  key={e.id}
                  className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <Icon className={`w-4 h-4 shrink-0 ${meta.color}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-foreground truncate">{e.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {e.date.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                      {" · "}
                      {e.days === 0 ? "today" : `in ${e.days} day${e.days === 1 ? "" : "s"}`}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-semibold text-foreground shrink-0">
                    {formatKES(e.amount)}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
