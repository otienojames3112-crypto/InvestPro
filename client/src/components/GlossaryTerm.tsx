import * as React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { glossaryDef } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Inline glossary term with a hover/focus tooltip (R41.2).
 *
 * Wraps the visible label in a dotted-underline span and shows the shared
 * glossary definition on hover or keyboard focus. The definition is sourced
 * from `client/src/lib/glossary.ts` so wording stays in sync with the
 * Getting Started glossary list.
 *
 * Usage:
 *   <GlossaryTerm id="wht">Withholding Tax</GlossaryTerm>
 *   <GlossaryTerm id="accrued-interest" />   // falls back to glossary term label
 */
export function GlossaryTerm({
  id,
  children,
  className,
  side = "top",
}: {
  id: string;
  children?: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  const def = glossaryDef(id);
  if (!def) {
    // Unknown id — render plain text so we never crash on a typo.
    return <span className={className}>{children}</span>;
  }
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            tabIndex={0}
            className={cn(
              "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
              className
            )}
          >
            {children}
          </span>
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-xs text-xs leading-relaxed"
        >
          {def}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
