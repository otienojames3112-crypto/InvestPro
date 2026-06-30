import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { formatKES, formatKESCompact } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Clock, Coins, SlidersHorizontal, ArrowUpRight, ArrowDownRight } from "lucide-react";

type ScenarioBasis = "actual" | "clean";

function DeltaPill({ delta }: { delta: number }) {
  const up = delta >= 0;
  return (
    <span
      className={`inline-flex items-center gap-1 text-xs font-semibold kes-amount ${
        up ? "status-on-track" : "status-behind"
      }`}
    >
      {up ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {up ? "+" : "−"}{formatKES(Math.abs(delta))}
    </span>
  );
}

/**
 * R-Scenarios levers: the effect of MORE TIME, a one-off LUMP SUM, and changing
 * the RISK TIER. Every figure comes from the projection engine under the SAME
 * basis the page is showing — nothing here is hardcoded.
 */
export function ScenarioLevers({
  portfolioId,
  basis,
}: {
  portfolioId: number;
  basis: ScenarioBasis;
}) {
  const [extraMonths, setExtraMonths] = useState(12);
  const [lumpSum, setLumpSum] = useState(100_000);

  const { data, isLoading } = trpc.projection.levers.useQuery(
    { portfolioId, basis, extraMonths, lumpSum },
    { enabled: !!portfolioId, placeholderData: keepPreviousData },
  );

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4 text-primary" />
          Other levers
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          How more time, a one-off lump sum, or a different risk tier change your projected end value — same engine, same{" "}
          <strong>{basis === "actual" ? "actual-portfolio" : "clean-schedule"}</strong> basis as above.
        </p>
      </CardHeader>
      <CardContent className="p-5 pt-0 space-y-4">
        {isLoading && !data ? (
          <Skeleton className="h-40 w-full" />
        ) : data ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              {/* More time */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Clock className="w-4 h-4 text-muted-foreground" />
                  Effect of more time
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="extraMonths" className="text-xs text-muted-foreground">
                      Extra months
                    </Label>
                    <Input
                      id="extraMonths"
                      type="number"
                      min={1}
                      max={120}
                      value={extraMonths}
                      onChange={(e) => setExtraMonths(Math.max(1, Math.min(120, Number(e.target.value) || 1)))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">
                      At {data.moreTime.newHorizonMonths} months
                    </p>
                    <p className="text-sm font-bold text-foreground kes-amount">
                      {formatKES(data.moreTime.projectedEndingValue)}
                    </p>
                  </div>
                  <DeltaPill delta={data.moreTime.delta} />
                </div>
              </div>

              {/* Lump sum */}
              <div className="rounded-lg border border-border p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Coins className="w-4 h-4 text-muted-foreground" />
                  Effect of a lump sum
                </div>
                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <Label htmlFor="lumpSum" className="text-xs text-muted-foreground">
                      One-off amount (KES)
                    </Label>
                    <Input
                      id="lumpSum"
                      type="number"
                      min={0}
                      step={10_000}
                      value={lumpSum}
                      onChange={(e) => setLumpSum(Math.max(0, Number(e.target.value) || 0))}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div>
                    <p className="text-xs text-muted-foreground">Added at month {data.lumpSum.atMonth}</p>
                    <p className="text-sm font-bold text-foreground kes-amount">
                      {formatKES(data.lumpSum.projectedEndingValue)}
                    </p>
                  </div>
                  <DeltaPill delta={data.lumpSum.delta} />
                </div>
              </div>
            </div>

            {/* Risk tier */}
            <div className="rounded-lg border border-border p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground mb-3">
                <SlidersHorizontal className="w-4 h-4 text-muted-foreground" />
                Effect of changing risk tier
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="text-left py-2 font-medium">Tier</th>
                      <th className="text-right py-2 font-medium">Projected end value</th>
                      <th className="text-right py-2 font-medium">vs your tier</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tiers.map((t) => (
                      <tr key={t.tier} className="border-b border-border/40">
                        <td className="py-2">
                          <span className="text-foreground">{t.label}</span>
                          {t.isCurrent && (
                            <Badge variant="outline" className="ml-2 text-xs text-muted-foreground">
                              Your tier
                            </Badge>
                          )}
                        </td>
                        <td className="py-2 text-right font-medium kes-amount text-foreground">
                          {formatKES(t.projectedEndingValue)}
                        </td>
                        <td className="py-2 text-right kes-amount">
                          {t.isCurrent ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <DeltaPill delta={t.delta} />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                Changing your tier changes the asset mix and sweep path, so the projected value moves. To make a tier
                your live policy, commit it on the{" "}
                <a href="/plan?tab=allocation" className="text-primary hover:underline">
                  Allocation Plan
                </a>
                .
              </p>
            </div>

            <p className="text-xs text-muted-foreground/80">
              Target {formatKESCompact(data.target)}. Each lever is re-projected from the same engine and basis as the
              scenario table above.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
