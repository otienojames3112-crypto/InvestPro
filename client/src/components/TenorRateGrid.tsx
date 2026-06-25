import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { IFB_TENORS, FXD_TENORS, type TenorOption } from "@shared/securityTenor";

export type TenorRateMap = Record<string, number>;

/**
 * Round 40 #3 — editable per-tenor bond rate grid.
 *
 * Lets the user set a distinct gross coupon for each standard IFB / FXD tenor
 * band. Empty cells mean "use the flat coupon rate" — they are omitted from the
 * saved map, so a portfolio that never touches this grid behaves exactly as
 * before (flat coupon everywhere).
 */
export function TenorRateGrid({
  kind,
  value,
  onChange,
}: {
  kind: "ifb" | "fxd";
  value: TenorRateMap;
  onChange: (next: TenorRateMap) => void;
}) {
  const options: TenorOption[] = kind === "ifb" ? IFB_TENORS : FXD_TENORS;

  function setCell(years: number, raw: string) {
    const key = String(years);
    const next = { ...value };
    const n = parseFloat(raw);
    if (raw.trim() === "" || !Number.isFinite(n) || n <= 0) {
      delete next[key];
    } else {
      next[key] = n;
    }
    onChange(next);
  }

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {options.map((o) => {
          const key = String(o.years);
          const cell = value[key];
          return (
            <div key={key} className="space-y-1.5">
              <Label className="text-xs font-medium text-foreground flex items-center justify-between">
                <span>{o.label}</span>
                {o.band && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{o.band}</span>
                )}
              </Label>
              <div className="relative">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  inputMode="decimal"
                  placeholder="flat"
                  className="pr-7 text-sm"
                  value={cell === undefined ? "" : cell}
                  onChange={(e) => setCell(o.years, e.target.value)}
                />
                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">%</span>
              </div>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground mt-3">
        Leave a cell blank to use the flat {kind.toUpperCase()} coupon above for that tenor. Filled
        cells override the flat rate for securities at the matching tenor (auto-applied when you pick
        the tenor on the Securities or Record Deposit forms).
      </p>
    </div>
  );
}
