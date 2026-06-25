/**
 * Round 39 — shared tenor/maturity/WHT fields for the CBK Securities dialogs and
 * the Record-Deposit government-security flow.
 *
 * Given the selected security type, issue date and (for bonds) a tenor, it shows:
 *   - a structured tenor picker for IFB / FXD (fixed day-count for T-bills)
 *   - a READ-ONLY auto-computed maturity date
 *   - the effective withholding-tax treatment (incl. tiered FXD WHT)
 *
 * It is a controlled, presentational component: the parent owns the form state and
 * passes values + setters. Maturity is always derived here so it can never drift.
 */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { CalendarClock, ShieldCheck, ShieldAlert } from "lucide-react";
import {
  computeMaturityDate,
  whtRateForSecurity,
  isTbill,
  IFB_TENORS,
  FXD_TENORS,
  type SecurityType,
} from "@shared/securityTenor";

interface Props {
  securityType: SecurityType;
  issueDate: string;
  tenorYears: number;
  onTenorChange: (years: number) => void;
}

function formatMaturity(dateStr: string): string {
  if (!dateStr) return "—";
  const d = new Date(`${dateStr}T12:00:00Z`);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-KE", { day: "numeric", month: "short", year: "numeric" });
}

export function SecurityTenorFields({ securityType, issueDate, tenorYears, onTenorChange }: Props) {
  const bond = !isTbill(securityType);
  const options = securityType === "ifb" ? IFB_TENORS : FXD_TENORS;
  const maturity = computeMaturityDate(securityType, issueDate, bond ? tenorYears : null);
  const wht = whtRateForSecurity(securityType, bond ? tenorYears : null);

  // Days/years label for the maturity helper text.
  const tenorLabel = isTbill(securityType)
    ? securityType === "tbill_91"
      ? "91 days"
      : securityType === "tbill_182"
        ? "182 days"
        : "364 days"
    : `${tenorYears} year${tenorYears === 1 ? "" : "s"}`;

  return (
    <div className="space-y-3">
      {bond && (
        <div className="space-y-1.5">
          <Label className="text-xs">Tenor</Label>
          <Select value={String(tenorYears)} onValueChange={(v) => onTenorChange(parseFloat(v))}>
            <SelectTrigger>
              <SelectValue placeholder="Choose tenor" />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o.years} value={String(o.years)}>
                  {o.label}
                  {o.band ? ` · ${o.band}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {securityType === "ifb"
              ? "Infrastructure bonds run 6.5–19 years in Kenya."
              : "Treasury (FXD) bonds run 2–25 years."}
          </p>
        </div>
      )}

      {/* Auto-computed maturity (read-only) */}
      <div className="rounded-lg border border-border bg-muted/30 px-3 py-2.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CalendarClock className="w-3.5 h-3.5" />
          Maturity date (auto)
        </div>
        <div className="mt-0.5 text-sm font-semibold text-foreground">
          {formatMaturity(maturity)}
        </div>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          {tenorLabel} from issue · recalculated automatically
        </p>
      </div>

      {/* Effective WHT treatment */}
      <div className="flex items-center gap-2 text-xs">
        {wht === 0 ? (
          <>
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-muted-foreground">Withholding tax:</span>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
              Tax-exempt (IFB)
            </Badge>
          </>
        ) : (
          <>
            <ShieldAlert className="w-3.5 h-3.5 text-amber-500" />
            <span className="text-muted-foreground">Withholding tax:</span>
            <Badge variant="outline" className="border-amber-500/40 text-amber-400">
              {wht}% WHT
            </Badge>
            {securityType === "fxd" && (
              <span className="text-[11px] text-muted-foreground">
                {tenorYears >= 10 ? "10y+ bond → 10%" : "under 10y → 15%"}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
