import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSimulatedNow } from "@/hooks/useSimulatedNow";
import { AppShell } from "@/components/AppShell";
import { trpc } from "@/lib/trpc";
import { invalidatePortfolioMoney } from "@/lib/invalidatePortfolioMoney";
import { formatKES, formatPct, getSecurityLabel, formatSourceProvenance } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, Plus, Trash2, CheckCircle2, Clock, Pencil, Link2, Info, RefreshCw, Wallet, RotateCcw, AlertTriangle, SplitSquareHorizontal, ArrowRightLeft, ArrowUp, ArrowDown, ArrowUpDown, ChevronDown, ChevronRight, Scale } from "lucide-react";
import { Link } from "wouter";
import { dashboardHref } from "@shared/navigation";
import { useState, useMemo, useEffect } from "react";
import { useMaturingWindow, MATURING_WINDOW_OPTIONS, MATURING_WINDOW_ALL, maturingWindowLabel } from "@/hooks/useMaturingWindow";
import { toast } from "sonner";
import { useForm, Controller } from "react-hook-form";
import {
  computeMaturityDate,
  defaultRateForSecurity,
  whtRateForSecurity,
  tenorYearsForSecurity,
  inferBondTenorYears,
  IFB_TENORS,
  FXD_TENORS,
  DEFAULT_IFB_TENOR_YEARS,
  DEFAULT_FXD_TENOR_YEARS,
  DEFAULT_ZERO_COUPON_TENOR_YEARS,
  DEFAULT_FLOATING_TENOR_YEARS,
  isDiscountInstrument,
  type SecurityType,
} from "@shared/securityTenor";
import { discountPriceForSecurity, currentSecurityValue, accretionProgress, concentrationTypeLabel, type CurrentValueSecurity } from "@shared/discount";
import { SecurityTenorFields } from "@/components/SecurityTenorFields";

interface SecurityForm {
  securityType: SecurityType;
  faceValue: number;
  issueDate: string;
  /** Bond tenor in years (IFB/FXD/zero-coupon/floating). Ignored for T-bills. */
  tenorYears: number;
  maturityDate: string;
  couponRate: number;
  isTaxExempt: boolean;
  notes: string;
  /** Round 42 — discount instruments (T-bill / zero-coupon). */
  purchasePrice?: number;
  discountRate?: number;
  /** Round 42 — floating-rate bonds. */
  marginRate?: number;
  resetMonths?: number;
}

/** Tenor is editable for everything except plain T-bills (fixed day count). */
function usesTenor(t: SecurityType): boolean {
  return t === "ifb" || t === "fxd" || t === "zero_coupon" || t === "floating_rate";
}

function daysUntil(dateStr: string | Date, nowMs: number = Date.now()): number {
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - nowMs) / (1000 * 60 * 60 * 24));
}

function nextCouponDate(issueDate: string | Date, maturityDate: string | Date, nowMs: number = Date.now()): string {
  const issue = new Date(issueDate);
  const maturity = new Date(maturityDate);
  const now = new Date(nowMs);
  // Semi-annual coupons: every 6 months from issue
  let next = new Date(issue);
  while (next <= now && next < maturity) {
    next.setMonth(next.getMonth() + 6);
  }
  if (next >= maturity) return "At maturity";
  return next.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export default function Securities({ embedded = false }: { embedded?: boolean } = {}) {
  const { portfolioId } = usePortfolio();
  // R75 — effective "now" (simulated date under the Time Machine, else real),
  // so current value / accretion / days-left match the server reconciliation.
  const { simulatedDate, active: simActive, label: simLabel } = useSimulatedNow();
  const effectiveNowMs = simulatedDate ?? Date.now();
  const utils = trpc.useUtils();
  const { data: securities, isLoading } = trpc.securities.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  // Round 39: pull the portfolio's rate settings so the dialogs can auto-fill the
  // discount/coupon rate for the chosen security type (single source of truth).
  const { data: rateSettings } = trpc.settings.get.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const addMutation = trpc.securities.add.useMutation({
    onSuccess: () => {
      toast.success("Security added to register");
      invalidatePortfolioMoney(utils, portfolioId);
      setOpen(false);
    },
    onError: () => toast.error("Failed to add security"),
  });
  const deleteMutation = trpc.securities.delete.useMutation({
    onSuccess: () => {
      toast.success("Security removed");
      invalidatePortfolioMoney(utils, portfolioId);
    },
    onError: () => toast.error("Failed to remove security"),
  });
  function invalidateAll() {
    void invalidatePortfolioMoney(utils, portfolioId);
  }
  const updateMutation = trpc.securities.update.useMutation({
    onSuccess: (res) => {
      toast.success(
        res?.linkedDepositSynced
          ? "Security updated — linked deposit synced"
          : "Security updated"
      );
      invalidateAll();
      setEditId(null);
    },
    onError: () => toast.error("Failed to update security"),
  });
  const recycleMutation = trpc.securities.recycle.useMutation({
    onSuccess: (res) => {
      const msg =
        res?.mode === "mmf"
          ? `Rolled KES ${Math.round(res.amount).toLocaleString()} into your primary MMF`
          : res?.mode === "rebuy"
            ? `Re-bought KES ${Math.round(res?.amount ?? 0).toLocaleString()} on rollover`
            : `Split rollover: KES ${Math.round(res?.mmfPortion ?? 0).toLocaleString()} to MMF + KES ${Math.round(res?.rebuyPortion ?? 0).toLocaleString()} re-bought`;
      toast.success(msg);
      invalidateAll();
      setRecycleFor(null);
    },
    onError: (err) => toast.error(err?.message ?? "Failed to recycle security"),
  });

  // ── Maturity-recycling prompt state ────────────────────────────────────
  const [recycleFor, setRecycleFor] = useState<NonNullable<typeof securities>[number] | null>(null);
  // R56.2 — per-bucket collapse state for the maturing-soon horizon buckets.
  const [collapsedBuckets, setCollapsedBuckets] = useState<Record<string, boolean>>({});
  const toggleBucket = (key: string) =>
    setCollapsedBuckets((prev) => ({ ...prev, [key]: !prev[key] }));

  // ── R52: register column sort (persisted + seeded from ?sort= deep-link) ──
  type SortKey = "none" | "gain" | "maturity" | "face";
  type SortDir = "asc" | "desc";
  const SORT_STORAGE_KEY = "kes5m.securities.sort";
  const [sortKey, setSortKey] = useState<SortKey>(() => {
    // 1) deep-link wins on first load (e.g. ?sort=gain from the dashboard tile)
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("sort");
      if (param === "gain" || param === "maturity" || param === "face") return param;
      // 2) otherwise restore the last persisted choice
      try {
        const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null");
        if (saved?.key) return saved.key as SortKey;
      } catch { /* ignore malformed storage */ }
    }
    return "none";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("sort");
      // gain/face default to descending (largest first), maturity to ascending (soonest first)
      if (param === "maturity") return "asc";
      if (param === "gain" || param === "face") return "desc";
      try {
        const saved = JSON.parse(localStorage.getItem(SORT_STORAGE_KEY) ?? "null");
        if (saved?.dir) return saved.dir as SortDir;
      } catch { /* ignore */ }
    }
    return "desc";
  });
  useEffect(() => {
    try {
      localStorage.setItem(SORT_STORAGE_KEY, JSON.stringify({ key: sortKey, dir: sortDir }));
    } catch { /* ignore quota / private-mode errors */ }
  }, [sortKey, sortDir]);
  // Click a header: same column toggles direction, a new column sets its default.
  const toggleSort = (key: Exclude<SortKey, "none">) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "maturity" ? "asc" : "desc");
      return key;
    });
  };
  // Reset to the default (grouped, unsorted) order and forget the persisted
  // choice + any ?sort= deep-link so a refresh stays reset.
  const resetSort = () => {
    setSortKey("none");
    setSortDir("desc");
    try { localStorage.removeItem(SORT_STORAGE_KEY); } catch { /* ignore */ }
    if (typeof window !== "undefined" && window.location.search.includes("sort=")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("sort");
      window.history.replaceState({}, "", url.toString());
    }
  };

  // ── R59: instrument-type filter, seeded from the ?type= deep-link (e.g. the
  // Portfolio Review concentration bar -> ?type=fxd). T-bill tenors are grouped
  // under "tbill" to match the concentration grouping. "" means no filter. ──
  const [typeFilter, setTypeFilter] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const param = new URLSearchParams(window.location.search).get("type");
      if (param) return param;
    }
    return "";
  });
  // A lot matches the active filter when its grouped type equals the filter.
  const matchesTypeFilter = (rawType: string): boolean => {
    if (!typeFilter) return true;
    const grouped = rawType.startsWith("tbill") ? "tbill" : rawType;
    return grouped === typeFilter;
  };
  const typeFilterLabel = typeFilter ? concentrationTypeLabel(typeFilter) : "";
  const clearTypeFilter = () => {
    setTypeFilter("");
    if (typeof window !== "undefined" && window.location.search.includes("type=")) {
      const url = new URL(window.location.href);
      url.searchParams.delete("type");
      window.history.replaceState({}, "", url.toString());
    }
  };

  // Deposits list lets us flag which register rows have a linked deposit that
  // will be synced automatically when the security is edited.
  const { data: depositList } = trpc.deposits.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const linkedSecurityIds = useMemo(
    () =>
      new Set(
        (depositList ?? [])
          .map((d) => (d as { securityId?: number | null }).securityId)
          .filter((id): id is number => typeof id === "number")
      ),
    [depositList]
  );

  // ── Edit dialog state ──────────────────────────────────────────────────
  const [editId, setEditId] = useState<number | null>(null);
  const editForm = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      tenorYears: DEFAULT_FXD_TENOR_YEARS,
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });
  const editType = editForm.watch("securityType");
  const editIsBond = usesTenor(editType);
  const editIssue = editForm.watch("issueDate");
  const editTenor = editForm.watch("tenorYears");
  // Keep the (read-only) maturity field in the edit form in sync with the derived
  // value so submit always sends a consistent date.
  useEffect(() => {
    const m = computeMaturityDate(editType, editIssue, editIsBond ? editTenor : null);
    if (m) editForm.setValue("maturityDate", m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editType, editIssue, editTenor, editIsBond]);

  function openEdit(s: NonNullable<typeof securities>[number]) {
    const t = s.securityType as SecurityForm["securityType"];
    const isB = usesTenor(t);
    // Recover the tenor: prefer the stored value, else infer from issue/maturity.
    const storedTenor =
      (s as { tenorYears?: string | number | null }).tenorYears != null
        ? parseFloat(String((s as { tenorYears?: string | number | null }).tenorYears))
        : null;
    const inferred = isB
      ? storedTenor ?? inferBondTenorYears(t, s.issueDate, s.maturityDate) ??
        (t === "ifb" ? DEFAULT_IFB_TENOR_YEARS : DEFAULT_FXD_TENOR_YEARS)
      : DEFAULT_FXD_TENOR_YEARS;
    const sx = s as {
      purchasePrice?: string | number | null;
      discountRate?: string | number | null;
      marginRate?: string | number | null;
      resetMonths?: number | null;
    };
    editForm.reset({
      securityType: t,
      faceValue: parseFloat(String(s.faceValue)) || 50000,
      issueDate: new Date(s.issueDate).toISOString().split("T")[0],
      tenorYears: inferred,
      maturityDate: new Date(s.maturityDate).toISOString().split("T")[0],
      couponRate: parseFloat(String(s.couponRate)) || 0,
      isTaxExempt: !!s.isTaxExempt,
      notes: s.notes ?? "",
      purchasePrice: sx.purchasePrice != null ? parseFloat(String(sx.purchasePrice)) : undefined,
      discountRate: sx.discountRate != null ? parseFloat(String(sx.discountRate)) : undefined,
      marginRate: sx.marginRate != null ? parseFloat(String(sx.marginRate)) : undefined,
      resetMonths: sx.resetMonths ?? undefined,
    });
    setEditId(s.id);
  }

  function onEditSubmit(data: SecurityForm) {
    if (editId == null) return;
    const isB = usesTenor(data.securityType);
    const isDisc = isDiscountInstrument(data.securityType);
    const isFloating = data.securityType === "floating_rate";
    updateMutation.mutate({
      id: editId,
      securityType: data.securityType,
      faceValue: data.faceValue,
      issueDate: data.issueDate,
      // Maturity is derived; omit it so the server recomputes from type+tenor.
      tenorYears: isB ? data.tenorYears : null,
      // Coupon bonds carry a coupon; discount instruments do not.
      couponRate: isDisc ? 0 : isB ? data.couponRate : 0,
      isTaxExempt: data.securityType === "ifb" ? true : data.isTaxExempt,
      notes: data.notes,
      purchasePrice: isDisc ? (data.purchasePrice ?? null) : null,
      discountRate: isDisc ? (data.discountRate ?? null) : null,
      marginRate: isFloating ? (data.marginRate ?? null) : null,
      resetMonths: isFloating ? (data.resetMonths ?? null) : null,
    });
  }

  const [open, setOpen] = useState(false);
  const { register, handleSubmit, reset, control, watch, setValue } = useForm<SecurityForm>({
    defaultValues: {
      securityType: "tbill_364",
      faceValue: 50000,
      issueDate: new Date().toISOString().split("T")[0],
      tenorYears: DEFAULT_FXD_TENOR_YEARS,
      maturityDate: "",
      couponRate: 0,
      isTaxExempt: false,
      notes: "",
    },
  });

  const secType = watch("securityType");
  const isBond = usesTenor(secType);
  const isDiscount = isDiscountInstrument(secType);
  const isFloating = secType === "floating_rate";
  const addIssue = watch("issueDate");
  const addTenor = watch("tenorYears");
  const addFace = watch("faceValue");
  const addDiscountRate = watch("discountRate");

  // When the type switches to a bond, snap the tenor to that type's default so the
  // picker never shows an out-of-range value (e.g. an FXD-only 25y on an IFB).
  useEffect(() => {
    if (secType === "ifb") setValue("tenorYears", DEFAULT_IFB_TENOR_YEARS);
    else if (secType === "fxd") setValue("tenorYears", DEFAULT_FXD_TENOR_YEARS);
    else if (secType === "zero_coupon") setValue("tenorYears", DEFAULT_ZERO_COUPON_TENOR_YEARS);
    else if (secType === "floating_rate") setValue("tenorYears", DEFAULT_FLOATING_TENOR_YEARS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secType]);

  // R60 — one-click "Diversify" deep-link from Portfolio Review. When the URL
  // carries ?add=1, open the add dialog and prefill the instrument type + face
  // value (the suggested shift amount) so the user can book the reallocation in
  // one step. Runs once on mount.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const sp = new URLSearchParams(window.location.search);
    if (sp.get("add") !== "1") return;
    const VALID: SecurityType[] = [
      "tbill_91", "tbill_182", "tbill_364", "ifb", "fxd", "zero_coupon", "floating_rate",
    ];
    const t = sp.get("addType");
    if (t && (VALID as string[]).includes(t)) setValue("securityType", t as SecurityType);
    const face = Number(sp.get("face"));
    if (Number.isFinite(face) && face > 0) setValue("faceValue", Math.round(face));
    setOpen(true);
    // Clean the query so a refresh doesn't re-open the dialog.
    const url = new URL(window.location.href);
    ["add", "addType", "face"].forEach((k) => url.searchParams.delete(k));
    window.history.replaceState({}, "", url.toString());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // For discount instruments, auto-suggest the purchase price from face + discount
  // rate + tenor so the user immediately sees what they would pay.
  useEffect(() => {
    if (!isDiscount) return;
    const rate = addDiscountRate ?? defaultRateForSecurity(secType, rateSettings, addTenor);
    if (!(rate > 0) || !(addFace > 0)) return;
    const price = discountPriceForSecurity({
      isDiscount: true,
      isZeroCoupon: secType === "zero_coupon",
      faceValue: addFace,
      ratePct: rate,
      tenorDays:
        secType === "tbill_91" ? 91 : secType === "tbill_182" ? 182 : secType === "tbill_364" ? 364 : 0,
      tenorYears: addTenor,
    });
    setValue("purchasePrice", Math.round(price * 100) / 100);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secType, addFace, addDiscountRate, addTenor, isDiscount, rateSettings]);

  // Auto-fill the coupon/discount rate from Rate Settings whenever the type
  // changes (the user can still override the bond coupon before submitting).
  useEffect(() => {
    const r = defaultRateForSecurity(secType, rateSettings, addTenor);
    setValue("couponRate", r);
    if (isDiscountInstrument(secType)) setValue("discountRate", r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secType, rateSettings]);

  // Keep the (read-only) maturity in the add form in sync with the derived value.
  useEffect(() => {
    const m = computeMaturityDate(secType, addIssue, isBond ? addTenor : null);
    if (m) setValue("maturityDate", m);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secType, addIssue, addTenor, isBond]);

  function onSubmit(data: SecurityForm) {
    if (!portfolioId) return;
    addMutation.mutate({
      portfolioId: portfolioId!,
      securityType: data.securityType,
      faceValue: data.faceValue,
      issueDate: data.issueDate,
      // Maturity is derived server-side from type + tenor; omit the explicit date.
      tenorYears: isBond ? data.tenorYears : undefined,
      couponRate: isDiscount ? 0 : data.couponRate,
      isTaxExempt: secType === "ifb" ? true : data.isTaxExempt,
      notes: data.notes,
      purchasePrice: isDiscount ? data.purchasePrice : undefined,
      discountRate: isDiscount ? data.discountRate : undefined,
      marginRate: isFloating ? data.marginRate : undefined,
      resetMonths: isFloating ? data.resetMonths : undefined,
    });
  }

  // R51 — deep-link from the Dashboard "Unrealized Gain" tile: ?sort=gain sorts
  // the active register by a chosen column. R52 — the sort is now driven by
  // clickable column headers, persisted to localStorage, and seeded from the
  // ?sort= deep-link (e.g. the Dashboard "Unrealized Gain" tile -> ?sort=gain).
  // Compute a lot's current mark-to-model value and gain-since-cost for sorting.
  const lotGain = (s: NonNullable<typeof securities>[number]): number => {
    const face = parseFloat(String(s.faceValue)) || 0;
    if (face <= 0) return 0;
    const price = s.purchasePrice != null ? parseFloat(String(s.purchasePrice)) : NaN;
    const hasPrice = Number.isFinite(price) && price > 0;
    const cv = currentSecurityValue({
      securityType: s.securityType,
      faceValue: face,
      purchasePrice: hasPrice ? price : null,
      couponRate: s.couponRate != null ? parseFloat(String(s.couponRate)) : 0,
      issueDate: s.issueDate,
      maturityDate: s.maturityDate,
      isMatured: s.isMatured,
      whtRatePct: whtRateForSecurity(
        s.securityType as SecurityType,
        s.tenorYears != null ? parseFloat(String(s.tenorYears)) : null,
      ),
    }, new Date(effectiveNowMs));
    const cost = hasPrice ? price : face;
    return cv - cost;
  };

  // Shared column sorter used by both the active and matured tables. For matured
  // lots a "gain" sort is meaningless (they're realized at face), so it falls
  // back to face value there.
  const applySort = (
    rows: NonNullable<typeof securities>,
    allowGain: boolean,
  ): NonNullable<typeof securities> => {
    if (sortKey === "none") return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    const valueOf = (s: NonNullable<typeof securities>[number]): number => {
      if (sortKey === "gain") return allowGain ? lotGain(s) : (parseFloat(String(s.faceValue)) || 0);
      if (sortKey === "face") return parseFloat(String(s.faceValue)) || 0;
      // maturity
      return new Date(String(s.maturityDate)).getTime();
    };
    return [...rows].sort((a, b) => (valueOf(a) - valueOf(b)) * dir);
  };

  // Group by type, then apply the active column sort. R59: an optional
  // instrument-type filter (from the ?type= deep-link) narrows both lists.
  const activeUnsorted = (securities?.filter((s) => !s.isMatured) ?? []).filter((s) => matchesTypeFilter(s.securityType));
  const active = applySort(activeUnsorted, true);
  const matured = applySort((securities?.filter((s) => s.isMatured) ?? []).filter((s) => matchesTypeFilter(s.securityType)), false);

  const totalFaceValue = active.reduce((sum, s) => sum + parseFloat(String(s.faceValue)), 0);

  // Lots maturing within the chosen window (including any already past due) so a
  // rollover prompt is surfaced before the cash sits idle. Sorted soonest-first.
  // The window (30/60/90 days) is user-configurable and shared with the sidebar badge.
  const [maturingWindow, setMaturingWindow] = useMaturingWindow();
  const maturingSoon = useMemo(
    () =>
      active
        .map((s) => ({ s, days: daysUntil(s.maturityDate) }))
        .filter(({ days }) => days <= maturingWindow)
        .sort((a, b) => a.days - b.days),
    [active, maturingWindow]
  );
  const soonFaceValue = maturingSoon.reduce((sum, { s }) => sum + parseFloat(String(s.faceValue)), 0);

  // R55.1 — when a wide window is chosen and several lots fall in it, split the
  // alert into horizon buckets so short bills and multi-year bonds don't blur
  // into one long list. Buckets stay collapsed into a flat list for narrow
  // windows or when there are only a couple of lots.
  const maturingBuckets = useMemo(() => {
    const defs: { key: string; label: string; max: number }[] = [
      { key: "le90", label: "Within 90 days", max: 90 },
      { key: "le1y", label: "91 days – 1 year", max: 365 },
      { key: "le2y", label: "1 – 2 years", max: 730 },
      { key: "gt2y", label: "Beyond 2 years", max: Infinity },
    ];
    const groups = defs.map((d, idx) => ({
      ...d,
      lots: maturingSoon.filter(
        ({ days }) => days <= d.max && (idx === 0 || days > defs[idx - 1].max)
      ),
    }));
    return groups.filter((g) => g.lots.length > 0);
  }, [maturingSoon]);

  // Only bucket when the window is wide (>= 1yr) AND grouping actually separates
  // lots across more than one horizon — otherwise a flat list reads cleaner.
  const useBuckets =
    maturingWindow >= 365 && maturingSoon.length >= 4 && maturingBuckets.length > 1;

  // Shared row renderer for a single maturing lot (used by both the flat and the
  // horizon-bucketed views) so the markup stays in one place.
  const renderMaturingLot = (s: NonNullable<typeof securities>[number], days: number) => (
    <div
      key={s.id}
      className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-card/60 px-3 py-2"
    >
      <Badge variant="outline" className="text-xs shrink-0">{getSecurityLabel(s.securityType)}</Badge>
      <span className="text-xs font-semibold text-foreground kes-amount shrink-0">
        {formatKES(parseFloat(String(s.faceValue)))}
      </span>
      <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
        {days <= 0
          ? `Due · matured ${new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`
          : `${days} day${days === 1 ? "" : "s"} left · ${new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short" })}`}
      </span>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5 text-xs shrink-0 border-amber-500/40 text-amber-400 hover:bg-amber-500/10"
        onClick={() => setRecycleFor(s)}
      >
        <RefreshCw className="w-3 h-3" /> Recycle
      </Button>
    </div>
  );

  return (
    <AppShell embedded={embedded}>
      <div className="p-6 lg:p-8 space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
              CBK Securities Register
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Track individual T-bill and bond purchases with coupon and maturity schedules.{" "}
              Compare current auction rates and tenors in the{" "}
              <Link href={dashboardHref.cbkSecurities} className="text-primary underline underline-offset-2">
                CBK Securities catalogue
              </Link>{" "}
              under Research.
            </p>
            <Link
              href={dashboardHref.cbkSecurities}
              className="mt-2 inline-flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <Scale className="w-4 h-4" /> Compare the market
            </Link>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2">
                <Plus className="w-3.5 h-3.5" />
                Add Security
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add CBK Security</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 mt-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Security Type</Label>
                  <Controller
                    name="securityType"
                    control={control}
                    render={({ field }) => (
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="tbill_91">91-Day T-Bill — discount</SelectItem>
                          <SelectItem value="tbill_182">182-Day T-Bill — discount</SelectItem>
                          <SelectItem value="tbill_364">364-Day T-Bill — discount</SelectItem>
                          <SelectItem value="zero_coupon">Zero-Coupon Bond — discount</SelectItem>
                          <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                          <SelectItem value="fxd">Fixed Coupon Bond (FXD) — tiered WHT</SelectItem>
                          <SelectItem value="floating_rate">Floating-Rate Bond — coupon resets</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Face Value (KES)</Label>
                    <Input type="number" step="50000" min="50000" {...register("faceValue", { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">
                      {isDiscount ? "Discount Rate (%)" : isFloating ? "Base Rate (%)" : "Coupon Rate (%)"}
                    </Label>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      {...register(isDiscount ? "discountRate" : "couponRate", { valueAsNumber: true })}
                    />
                  </div>
                </div>
                {/* Round 42 — discount instruments: show the purchase price you pay
                    up front. The discount (face − price) is your entire return. */}
                {isDiscount && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Purchase Price (KES you pay today)</Label>
                      <Input type="number" step="0.01" min="0" {...register("purchasePrice", { valueAsNumber: true })} />
                    </div>
                    <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
                      Discount instruments are bought <strong>below face value</strong> and repaid the
                      full face at maturity. You pay{" "}
                      <strong>{formatKES(watch("purchasePrice") || 0)}</strong> now and receive{" "}
                      <strong>{formatKES(addFace || 0)}</strong> at maturity. The gap of{" "}
                      <strong>{formatKES(Math.max(0, (addFace || 0) - (watch("purchasePrice") || 0)))}</strong>{" "}
                      is the discount — your entire return — and WHT applies only to it.
                    </p>
                  </div>
                )}
                {/* Round 42 — floating-rate bonds: base + margin + reset cadence. */}
                {isFloating && (
                  <div className="grid grid-cols-2 gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Margin / Spread (%)</Label>
                      <Input type="number" step="0.01" min="0" {...register("marginRate", { valueAsNumber: true })} />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">Reset Every (months)</Label>
                      <Input type="number" step="1" min="1" max="24" {...register("resetMonths", { valueAsNumber: true })} />
                    </div>
                    <p className="col-span-2 text-[11px] leading-snug text-sky-700 dark:text-sky-400">
                      The coupon = base rate + margin, and re-fixes every reset period, so the
                      income rises and falls with prevailing rates.
                    </p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label className="text-xs">Issue Date</Label>
                  <Input type="date" {...register("issueDate")} />
                </div>
                {/* Round 39: structured tenor + auto-maturity + WHT treatment */}
                <SecurityTenorFields
                  securityType={secType}
                  issueDate={addIssue}
                  tenorYears={addTenor}
                  onTenorChange={(y) => setValue("tenorYears", y)}
                />
                <div className="space-y-1.5">
                  <Label className="text-xs">Notes (optional)</Label>
                  <Input placeholder="e.g. IFB/2026/10Y" {...register("notes")} />
                </div>
                <Button type="submit" className="w-full" disabled={addMutation.isPending}>
                  {addMutation.isPending ? "Adding..." : "Add to Register"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        {/* Summary */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active Holdings", value: active.length, suffix: "securities" },
            { label: "Total Face Value", value: formatKES(totalFaceValue), suffix: "" },
            { label: "T-Bills", value: active.filter((s) => s.securityType.startsWith("tbill")).length, suffix: "active" },
            { label: "Bonds (IFB+FXD)", value: active.filter((s) => !s.securityType.startsWith("tbill")).length, suffix: "active" },
          ].map(({ label, value, suffix }) => (
            <Card key={label}>
              <CardContent className="p-4">
                <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">{label}</p>
                <p className="text-xl font-bold text-foreground kes-amount">{value}</p>
                {suffix && <p className="text-xs text-muted-foreground">{suffix}</p>}
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Maturing-soon window selector (always visible so the user can widen/narrow the lookahead) */}
        {active.length > 0 && (
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Maturing-soon window:</span>
            <div className="inline-flex flex-wrap justify-end rounded-lg bg-muted/40 p-0.5">
              {MATURING_WINDOW_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMaturingWindow(value)}
                  className={
                    "rounded-md px-2.5 py-1 text-xs font-medium tabular-nums transition-colors " +
                    (maturingWindow === value
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Maturing-soon alert */}
        {maturingSoon.length > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-lg bg-amber-500/15 p-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">
                  {maturingSoon.length} {maturingSoon.length === 1 ? "lot" : "lots"} maturing{maturingWindow === MATURING_WINDOW_ALL ? " ahead" : ` within ${maturingWindowLabel(maturingWindow)}`}
                  <span className="text-muted-foreground font-normal"> · {formatKES(soonFaceValue)} face value</span>
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Roll these over so the proceeds keep earning instead of sitting idle.
                </p>
              </div>
            </div>
            {useBuckets ? (
              <div className="space-y-3">
                {maturingBuckets.map((bucket) => {
                  const bucketFace = bucket.lots.reduce(
                    (sum, { s }) => sum + parseFloat(String(s.faceValue)),
                    0
                  );
                  const collapsed = collapsedBuckets[bucket.key] ?? false;
                  return (
                    <div key={bucket.key} className="space-y-1.5">
                      <button
                        type="button"
                        onClick={() => toggleBucket(bucket.key)}
                        aria-expanded={!collapsed}
                        className="flex w-full items-center justify-between gap-2 rounded-md px-0.5 py-1 text-left transition-colors hover:bg-amber-500/5"
                      >
                        <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                          {collapsed ? (
                            <ChevronRight className="w-3 h-3" />
                          ) : (
                            <ChevronDown className="w-3 h-3" />
                          )}
                          {bucket.label}
                        </span>
                        <span className="text-[11px] text-muted-foreground tabular-nums">
                          {bucket.lots.length} {bucket.lots.length === 1 ? "lot" : "lots"} · {formatKES(bucketFace)}
                        </span>
                      </button>
                      {!collapsed && bucket.lots.map(({ s, days }) => renderMaturingLot(s, days))}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                {maturingSoon.map(({ s, days }) => renderMaturingLot(s, days))}
              </div>
            )}
          </div>
        )}

        {/* Active Securities */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Landmark className="w-4 h-4 text-primary" />
              Active Holdings
              {sortKey !== "none" && (
                <>
                  <Badge variant="secondary" className="ml-2 gap-1 font-normal">
                    Sorted by {sortKey === "gain" ? "gain" : sortKey === "face" ? "face value" : "maturity"}
                    {" "}({sortDir === "asc" ? "asc" : "desc"})
                  </Badge>
                  <button
                    type="button"
                    onClick={resetSort}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Reset to default order"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Reset to default sort
                  </button>
                </>
              )}
              {typeFilter && (
                <>
                  <Badge variant="secondary" className="ml-2 gap-1 font-normal">
                    Filtered: {typeFilterLabel}
                  </Badge>
                  <button
                    type="button"
                    onClick={clearTypeFilter}
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear instrument-type filter"
                  >
                    <RotateCcw className="w-3 h-3" />
                    Clear filter
                  </button>
                </>
              )}
              {simActive && simLabel && (
                <Badge
                  variant="outline"
                  className="ml-2 gap-1 font-normal border-primary/30 bg-primary/10 text-primary"
                  title="Current values are computed as of the simulated date, not the real clock."
                >
                  <Clock className="w-3 h-3" />
                  Valued as of {simLabel}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
              </div>
            ) : active.length === 0 ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No active securities. Add your first T-bill or bond purchase above.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                        <button type="button" onClick={() => toggleSort("face")} className="inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors">
                          Face Value
                          {sortKey === "face" ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Purchase Price</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Discount</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                        <button type="button" onClick={() => toggleSort("gain")} className="inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors" title="Sort by unrealized gain">
                          Current Value
                          {sortKey === "gain" ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Issue Date</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                        <button type="button" onClick={() => toggleSort("maturity")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                          Maturity Date
                          {sortKey === "maturity" ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Days Left</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Next Coupon</th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Tax</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {active.map((s) => {
                      const days = daysUntil(s.maturityDate);
                      const isBondType = !s.securityType.startsWith("tbill");
                      const face = parseFloat(String(s.faceValue));
                      const isDisc = isDiscountInstrument(s.securityType as SecurityType);
                      const storedPrice = s.purchasePrice != null ? parseFloat(String(s.purchasePrice)) : NaN;
                      const storedDiscRate = s.discountRate != null ? parseFloat(String(s.discountRate)) : NaN;
                      const rowPrice = isDisc
                        ? Number.isFinite(storedPrice) && storedPrice > 0
                          ? storedPrice
                          : Number.isFinite(storedDiscRate) && storedDiscRate > 0
                            ? discountPriceForSecurity({
                                isDiscount: true,
                                isZeroCoupon: s.securityType === "zero_coupon",
                                faceValue: face,
                                ratePct: storedDiscRate,
                                tenorDays: Math.max(1, daysUntil(s.maturityDate) > 0 ? (new Date(s.maturityDate).getTime() - new Date(s.issueDate).getTime()) / 86400000 : 0),
                                tenorYears: tenorYearsForSecurity(s.securityType as SecurityType, null),
                              })
                            : NaN
                        : NaN;
                      const rowDiscount = Number.isFinite(rowPrice) ? face - rowPrice : NaN;
                      // R49 — mark-to-model current value + accretion progress for this lot.
                      const cvLot: CurrentValueSecurity = {
                        securityType: s.securityType,
                        faceValue: face,
                        purchasePrice: Number.isFinite(rowPrice) ? rowPrice : null,
                        couponRate: s.couponRate != null ? parseFloat(String(s.couponRate)) : 0,
                        issueDate: s.issueDate,
                        maturityDate: s.maturityDate,
                        isMatured: s.isMatured,
                        whtRatePct: whtRateForSecurity(
                          s.securityType as SecurityType,
                          s.tenorYears != null ? parseFloat(String(s.tenorYears)) : null,
                        ),
                      };
                      const currentValue = currentSecurityValue(cvLot, new Date(effectiveNowMs));
                      const progress = accretionProgress(cvLot, new Date(effectiveNowMs));
                      // Stage 6b — source/provenance tooltip, distinct from the header's
                      // simulation "Valued as of" badge (that's a computed-value date, this
                      // is where the FIGURES came from). Prefer dataSource/dataAsOf (live
                      // columns), fall back to the frozen holdingSnapshot, else "manual entry".
                      const snapProv = s.holdingSnapshot as { sourceUrl?: string | null; sourceAsOfDate?: string | null } | null;
                      const provenanceLabel = formatSourceProvenance(
                        s.dataSource ?? snapProv?.sourceUrl,
                        s.dataAsOf ?? snapProv?.sourceAsOfDate,
                        "manual entry",
                      );
                      // For discount lots the meaningful gain is current − purchase price
                      // (it accretes UP toward face); for coupon bonds it's the accrued
                      // coupon above par (current − face).
                      const gainSinceBuy =
                        progress != null && Number.isFinite(rowPrice)
                          ? currentValue - rowPrice
                          : currentValue - face;
                      return (
                        <tr key={s.id} className="border-b border-border/40 hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1.5">
                              <Badge variant="outline" className="text-xs">
                                {getSecurityLabel(s.securityType)}
                              </Badge>
                              {linkedSecurityIds.has(s.id) && (
                                <span title="Linked to a recorded deposit — edits sync automatically">
                                  <Link2 className="w-3 h-3 text-primary/70" />
                                </span>
                              )}
                              <span title={provenanceLabel} aria-label={provenanceLabel}>
                                <Info className="w-3 h-3 text-muted-foreground/60" />
                              </span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-foreground kes-amount">
                            {formatKES(face)}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground kes-amount">
                            {Number.isFinite(rowPrice) ? formatKES(rowPrice) : <span className="text-muted-foreground">par</span>}
                          </td>
                          <td className="px-4 py-3 text-right kes-amount">
                            {Number.isFinite(rowDiscount) ? (
                              <span className="text-emerald-400 font-medium">{formatKES(rowDiscount)}</span>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right kes-amount min-w-[140px]">
                            <div className="flex flex-col items-end gap-1">
                              <span className="font-semibold text-sky-300">{formatKES(currentValue)}</span>
                              {simActive && simLabel && (
                                <span
                                  className="text-[10px] text-primary/80 inline-flex items-center gap-0.5"
                                  title="This value is computed as of the simulated date."
                                >
                                  <Clock className="w-2.5 h-2.5" />
                                  as of {simLabel}
                                </span>
                              )}
                              {Math.abs(gainSinceBuy) >= 1 && (
                                <span className="text-[10px] text-emerald-400/80">
                                  +{formatKES(gainSinceBuy)} {progress != null ? "accreted" : "accrued"}
                                </span>
                              )}
                              {progress != null && (
                                <div
                                  className="w-full h-1.5 rounded-full bg-muted/50 overflow-hidden"
                                  title={`${Math.round(progress * 100)}% of the way from purchase price to face`}
                                >
                                  <div
                                    className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-[width] duration-500"
                                    style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
                                  />
                                </div>
                              )}
                              {progress != null && (
                                <span className="text-[10px] text-muted-foreground tabular-nums">{Math.round(progress * 100)}% to face</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.issueDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                            {s.updatedAt && (
                              <span className="block text-[10px] text-muted-foreground/60 mt-0.5">
                                edited {new Date(s.updatedAt).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {days > 0 ? (
                              <span className={days < 30 ? "text-destructive font-semibold" : days < 90 ? "text-primary font-medium" : "text-muted-foreground"}>
                                {days}d
                              </span>
                            ) : (
                              <Badge variant="outline" className="text-xs border-amber-500/40 text-amber-400 gap-1">
                                <Clock className="w-3 h-3" /> Due
                              </Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right text-foreground">
                            {isBondType ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {isBondType ? nextCouponDate(s.issueDate, s.maturityDate) : "–"}
                          </td>
                          <td className="px-4 py-3">
                            {s.isTaxExempt ? (
                              <Badge variant="outline" className="text-xs phase-growth border">Tax-Exempt</Badge>
                            ) : isBondType ? (
                              <Badge variant="outline" className="text-xs phase-de-risking border">15% WHT</Badge>
                            ) : (
                              <span className="text-muted-foreground">–</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {days <= 0 && (
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="w-7 h-7 text-amber-400 hover:text-amber-300"
                                  title="Recycle proceeds (roll into MMF or re-buy)"
                                  onClick={() => setRecycleFor(s)}
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </Button>
                              )}
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Edit security"
                                onClick={() => openEdit(s)}
                              >
                                <Pencil className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-primary"
                                title="Mark as matured"
                                onClick={() => updateMutation.mutate({ id: s.id, isMatured: true })}
                              >
                                <CheckCircle2 className="w-3.5 h-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-7 h-7 text-muted-foreground hover:text-destructive"
                                onClick={() => deleteMutation.mutate({ id: s.id })}
                              >
                                <Trash2 className="w-3 h-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Matured */}
        {matured.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-muted-foreground" />
                Matured / Closed
                {sortKey !== "none" && sortKey !== "gain" && (
                  <Badge variant="secondary" className="ml-2 gap-1 font-normal">
                    Sorted by {sortKey === "face" ? "face value" : "maturity"} ({sortDir})
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/30">
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">Type</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">
                        <button type="button" onClick={() => toggleSort("face")} className="inline-flex items-center gap-1 ml-auto hover:text-foreground transition-colors">
                          Face Value
                          {sortKey === "face" ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-left px-4 py-3 text-muted-foreground font-medium">
                        <button type="button" onClick={() => toggleSort("maturity")} className="inline-flex items-center gap-1 hover:text-foreground transition-colors">
                          Maturity Date
                          {sortKey === "maturity" ? (sortDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />) : <ArrowUpDown className="w-3 h-3 opacity-40" />}
                        </button>
                      </th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Coupon Rate</th>
                      <th className="text-right px-4 py-3 text-muted-foreground font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matured.map((s) => {
                      const rolledInto = s.rolledIntoId
                        ? securities?.find((x) => x.id === s.rolledIntoId)
                        : undefined;
                      return (
                      <tr key={s.id} className="border-b border-border/40">
                        <td className="px-4 py-2.5">
                          <div className="flex flex-col gap-1">
                            <Badge variant="outline" className="text-xs opacity-60 w-fit">
                              {getSecurityLabel(s.securityType)}
                            </Badge>
                            {s.rolledIntoId && (
                              <span
                                className="flex items-center gap-1 text-[10px] text-primary/80"
                                title={rolledInto ? `Replacement: ${getSecurityLabel(rolledInto.securityType)} #${rolledInto.id}` : undefined}
                              >
                                <ArrowRightLeft className="w-3 h-3 shrink-0" />
                                rolled into #{s.rolledIntoId}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-right kes-amount text-muted-foreground">
                          {formatKES(parseFloat(String(s.faceValue)))}
                        </td>
                        <td className="px-4 py-2.5 text-muted-foreground">
                          {new Date(s.maturityDate).toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" })}
                        </td>
                        <td className="px-4 py-2.5 text-right text-muted-foreground">
                          {!s.securityType.startsWith("tbill") ? formatPct(parseFloat(String(s.couponRate))) : "Discount"}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          {s.rolledIntoId ? (
                            <span className="text-[11px] text-muted-foreground italic">Recycled</span>
                          ) : (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 gap-1.5 text-xs"
                              onClick={() => setRecycleFor(s)}
                            >
                              <RefreshCw className="w-3 h-3" /> Roll over
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Edit Security Dialog ─────────────────────────────────────── */}
        <Dialog open={editId != null} onOpenChange={(o) => !o && setEditId(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Edit CBK Security</DialogTitle>
            </DialogHeader>
            {editId != null && linkedSecurityIds.has(editId) && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                <Info className="w-3.5 h-3.5 text-primary shrink-0 mt-0.5" />
                <span>
                  This entry is linked to a recorded deposit. Changing the face value or
                  issue date will update that deposit automatically so your live actuals,
                  accrual ledger, and tax summary stay in sync.
                </span>
              </div>
            )}
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4 mt-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Security Type</Label>
                <Controller
                  name="securityType"
                  control={editForm.control}
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="tbill_91">91-Day T-Bill — discount</SelectItem>
                        <SelectItem value="tbill_182">182-Day T-Bill — discount</SelectItem>
                        <SelectItem value="tbill_364">364-Day T-Bill — discount</SelectItem>
                        <SelectItem value="zero_coupon">Zero-Coupon Bond — discount</SelectItem>
                        <SelectItem value="ifb">Infrastructure Bond (IFB) — Tax Exempt</SelectItem>
                        <SelectItem value="fxd">Fixed Coupon Bond (FXD) — tiered WHT</SelectItem>
                        <SelectItem value="floating_rate">Floating-Rate Bond — coupon resets</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Face Value (KES)</Label>
                  <Input type="number" step="50000" min="50000" {...editForm.register("faceValue", { valueAsNumber: true })} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">
                    {isDiscountInstrument(editType)
                      ? "Discount Rate (%)"
                      : editType === "floating_rate"
                        ? "Base Rate (%)"
                        : "Coupon Rate (%)"}
                  </Label>
                  <Input
                    type="number"
                    step="0.01"
                    min="0"
                    {...editForm.register(
                      isDiscountInstrument(editType) ? "discountRate" : "couponRate",
                      { valueAsNumber: true },
                    )}
                  />
                </div>
              </div>
              {isDiscountInstrument(editType) && (
                <div className="space-y-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
                  <Label className="text-xs">Purchase Price (KES paid up front)</Label>
                  <Input type="number" step="0.01" min="0" {...editForm.register("purchasePrice", { valueAsNumber: true })} />
                  <p className="text-[11px] text-amber-700 dark:text-amber-400">
                    Face − price = the discount, which is the entire return; WHT applies only to it.
                  </p>
                </div>
              )}
              {editType === "floating_rate" && (
                <div className="grid grid-cols-2 gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Margin / Spread (%)</Label>
                    <Input type="number" step="0.01" min="0" {...editForm.register("marginRate", { valueAsNumber: true })} />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Reset Every (months)</Label>
                    <Input type="number" step="1" min="1" max="24" {...editForm.register("resetMonths", { valueAsNumber: true })} />
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Issue Date</Label>
                <Input type="date" {...editForm.register("issueDate")} />
              </div>
              {/* Round 39: structured tenor + auto-maturity + WHT treatment */}
              <SecurityTenorFields
                securityType={editType}
                issueDate={editIssue}
                tenorYears={editTenor}
                onTenorChange={(y) => editForm.setValue("tenorYears", y)}
              />
              {editType !== "ifb" && editIsBond && (
                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                  <Label className="text-xs">Tax-exempt</Label>
                  <Controller
                    name="isTaxExempt"
                    control={editForm.control}
                    render={({ field }) => (
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    )}
                  />
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-xs">Notes (optional)</Label>
                <Input placeholder="e.g. IFB/2026/10Y" {...editForm.register("notes")} />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditId(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={updateMutation.isPending}>
                  {updateMutation.isPending ? "Saving…" : "Save Changes"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>

        {/* ── Maturity Recycling Dialog ──────────────────────────────── */}
        <RecycleDialog
          security={recycleFor}
          onClose={() => setRecycleFor(null)}
          onConfirm={(payload) =>
            recycleFor && recycleMutation.mutate({ id: recycleFor.id, ...payload })
          }
          isPending={recycleMutation.isPending}
        />
      </div>
    </AppShell>
  );
}

// ── Maturity-recycling prompt ───────────────────────────────────────────────
type RecyclePayload =
  | { mode: "mmf"; amount: number; depositDate: string }
  | { mode: "rebuy"; amount: number; depositDate: string }
  | { mode: "split"; mmfAmount: number; rebuyAmount: number; depositDate: string };

function RecycleDialog({
  security,
  onClose,
  onConfirm,
  isPending,
}: {
  security: { id: number; securityType: string; faceValue: string } | null;
  onClose: () => void;
  onConfirm: (payload: RecyclePayload) => void;
  isPending: boolean;
}) {
  const face = security ? parseFloat(String(security.faceValue)) || 0 : 0;
  const [mode, setMode] = useState<"mmf" | "rebuy" | "split">("mmf");
  const [amount, setAmount] = useState<number>(face);
  const [mmfAmount, setMmfAmount] = useState<number>(Math.round(face / 2));
  const [depositDate, setDepositDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // Reset the form whenever a new security is selected.
  useEffect(() => {
    if (security) {
      const f = parseFloat(String(security.faceValue)) || 0;
      setMode("mmf");
      setAmount(f);
      setMmfAmount(Math.round(f / 2));
      setDepositDate(new Date().toISOString().split("T")[0]);
    }
  }, [security]);

  const typeLabel = security ? getSecurityLabel(security.securityType) : "";
  // For split mode the re-buy side is whatever is left of the total amount.
  const rebuyAmount = Math.max(Math.round((amount - mmfAmount) * 100) / 100, 0);
  const splitValid = mode !== "split" || (mmfAmount > 0 && rebuyAmount > 0 && mmfAmount <= amount);
  const canConfirm = !isPending && amount > 0 && splitValid;

  function confirm() {
    if (!canConfirm) return;
    if (mode === "split") {
      onConfirm({ mode: "split", mmfAmount, rebuyAmount, depositDate });
    } else {
      onConfirm({ mode, amount, depositDate });
    }
  }

  const modes: { key: "mmf" | "rebuy" | "split"; label: string; icon: typeof Wallet }[] = [
    { key: "mmf", label: "To MMF", icon: Wallet },
    { key: "rebuy", label: "Re-buy", icon: RotateCcw },
    { key: "split", label: "Split", icon: SplitSquareHorizontal },
  ];

  return (
    <Dialog open={security != null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="w-4 h-4 text-amber-400" /> Recycle Matured Proceeds
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-1">
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
            Your <span className="font-medium text-foreground">{typeLabel}</span> has reached
            maturity. Choose where the redeemed cash goes — this marks the old lot closed and
            records the redeployment so your live actuals stay accurate.
          </div>

          {/* Mode switch */}
          <div className="grid grid-cols-3 gap-1.5 rounded-lg bg-muted/40 p-1">
            {modes.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setMode(key)}
                className={
                  "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition-colors " +
                  (mode === key
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground")
                }
              >
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">{mode === "split" ? "Total proceeds (KES)" : "Amount (KES)"}</Label>
              <Input
                type="number"
                step="1000"
                min="1"
                value={Number.isFinite(amount) ? amount : 0}
                onChange={(e) => {
                  const v = parseFloat(e.target.value) || 0;
                  setAmount(v);
                  if (mmfAmount > v) setMmfAmount(v);
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Redeploy date</Label>
              <Input type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} />
            </div>
          </div>

          {/* Split allocation */}
          {mode === "split" && (
            <div className="space-y-2 rounded-lg border border-border bg-card/50 px-3 py-3">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Wallet className="w-3.5 h-3.5 text-primary" /> To MMF
                </span>
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  Re-buy <RotateCcw className="w-3.5 h-3.5 text-primary" />
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={amount}
                step={1000}
                value={mmfAmount}
                onChange={(e) => setMmfAmount(parseFloat(e.target.value) || 0)}
                className="w-full accent-primary"
              />
              {/* One-tap laddering presets — set the MMF portion to a common ratio. */}
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-muted-foreground mr-0.5">Ladder:</span>
                {([
                  { label: "25 / 75", mmf: 0.25 },
                  { label: "50 / 50", mmf: 0.5 },
                  { label: "75 / 25", mmf: 0.75 },
                ] as const).map((p) => {
                  const target = Math.round((amount * p.mmf) / 1000) * 1000;
                  const isActivePreset = Math.abs(mmfAmount - target) < 1;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => setMmfAmount(Math.min(target, amount))}
                      className={
                        "flex-1 rounded-md border px-2 py-1 text-[11px] font-medium tabular-nums transition-colors " +
                        (isActivePreset
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/30")
                      }
                      title={`MMF ${Math.round(p.mmf * 100)}% / re-buy ${Math.round((1 - p.mmf) * 100)}%`}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between gap-3">
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-muted-foreground">MMF portion</Label>
                  <Input
                    type="number"
                    step="1000"
                    min="0"
                    max={amount}
                    value={Number.isFinite(mmfAmount) ? mmfAmount : 0}
                    onChange={(e) => setMmfAmount(Math.min(parseFloat(e.target.value) || 0, amount))}
                    className="h-8 text-xs"
                  />
                </div>
                <div className="flex-1 space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Re-buy portion</Label>
                  <Input
                    type="number"
                    value={Number.isFinite(rebuyAmount) ? rebuyAmount : 0}
                    readOnly
                    className="h-8 text-xs bg-muted/40"
                  />
                </div>
              </div>
              {!splitValid && (
                <p className="text-[11px] text-destructive">
                  Both sides must be greater than zero and sum to the total proceeds.
                </p>
              )}
            </div>
          )}

          {mode !== "split" && (
            <p className="text-xs text-muted-foreground">
              {mode === "mmf"
                ? "Parks the full amount in your money-market fund as a liquid deposit."
                : `Creates a fresh ${typeLabel} for the same tenor, issued on the redeploy date.`}
            </p>
          )}

          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" className="flex-1" onClick={confirm} disabled={!canConfirm}>
              {isPending ? "Recycling…" : mode === "split" ? "Split & redeploy" : mode === "mmf" ? "Roll into MMF" : "Re-buy"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
