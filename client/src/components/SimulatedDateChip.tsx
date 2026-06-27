import { Link } from "wouter";
import { Clock } from "lucide-react";
import { useSimulatedNow } from "@/hooks/useSimulatedNow";
import { cn } from "@/lib/utils";

/**
 * A small "viewing simulated date" chip shown next to page date-headers
 * (Dashboard, Month Ledger) ONLY while a Time Machine session is active. It
 * makes the simulated context obvious from any page and deep-links back to the
 * Time Machine. Renders nothing when the real clock is in effect.
 */
export function SimulatedDateChip({ className }: { className?: string }) {
  const { active, label } = useSimulatedNow();
  if (!active || !label) return null;
  return (
    <Link
      href="/time-machine"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1",
        "text-xs font-medium text-primary transition-colors hover:bg-primary/20",
        className,
      )}
      title="A simulated clock is active — open the Time Machine"
    >
      <Clock className="h-3.5 w-3.5" />
      <span className="tabular-nums">Viewing simulated date · {label}</span>
    </Link>
  );
}
