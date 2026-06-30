import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShieldCheck, UserCheck, Clock, Info, Bot, type LucideIcon } from "lucide-react";
import {
  statusDescriptor,
  type StatusIconKey,
  type StatusTone,
} from "@shared/statusLabels";
import type { VerificationState } from "@shared/provenance";

/**
 * Phase 8c — the ONE badge every surface uses to show a verification state.
 *
 * It reads its label, tone, icon and description from the shared `statusDescriptor`
 * so Explore, the opportunity detail, Holdings, AI Review and Source Conflicts can
 * never drift in colour or wording again. Pass the already-resolved effective state
 * (use `effectiveState`/`effectiveStateForClass` at the call site so staleness is
 * accounted for) — this component never re-derives it.
 */

const ICONS: Record<StatusIconKey, LucideIcon> = {
  "shield-check": ShieldCheck,
  "user-check": UserCheck,
  clock: Clock,
  info: Info,
  bot: Bot,
};

/** Outline (thin) tone classes for the ordinary, non-emphatic states. */
const TONE_OUTLINE: Record<StatusTone, string> = {
  positive: "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
  info: "border-sky-500/40 text-sky-600 dark:text-sky-400",
  caution: "border-amber-500/40 text-amber-600 dark:text-amber-400",
  danger: "border-red-500/40 text-red-600 dark:text-red-400",
  ai: "border-orange-500/60 bg-orange-500/15 text-orange-700 dark:text-orange-300 font-medium",
};

export function StatusBadge({
  state,
  withTooltip = true,
  className = "",
}: {
  state: VerificationState;
  withTooltip?: boolean;
  className?: string;
}) {
  const d = statusDescriptor(state);
  const Icon = ICONS[d.iconKey];
  const badge = (
    <Badge variant="outline" className={`text-[10px] gap-1 ${TONE_OUTLINE[d.tone]} ${className}`}>
      <Icon className="w-2.5 h-2.5" />
      {d.label}
    </Badge>
  );
  if (!withTooltip) return badge;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help">{badge}</span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[260px] text-xs leading-relaxed">
        {d.description}
      </TooltipContent>
    </Tooltip>
  );
}
