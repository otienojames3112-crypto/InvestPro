import * as React from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { glossaryDef } from "@/lib/glossary";
import { cn } from "@/lib/utils";

/**
 * Inline glossary term with a hover/focus card (R41.2, R70.3).
 *
 * Wraps the visible label in a dotted-underline span and shows the shared
 * glossary definition on hover or keyboard focus. The definition is sourced
 * from `client/src/lib/glossary.ts` so wording stays in sync with the
 * Getting Started / Learn glossary list.
 *
 * R70.3 — uses a HoverCard (not a plain tooltip) so the floating content is
 * itself hoverable, letting the "Learn more →" link be clicked reliably. The
 * link deep-links to the full glossary entry on the Learn page
 * (`/learn?term=<id>`), which expands, scrolls to, and briefly highlights it.
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
  learnMore = true,
}: {
  id: string;
  children?: React.ReactNode;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
  /** Set false to suppress the "Learn more →" link (e.g. when already on Learn). */
  learnMore?: boolean;
}) {
  const def = glossaryDef(id);
  if (!def) {
    // Unknown id — render plain text so we never crash on a typo.
    return <span className={className}>{children}</span>;
  }
  return (
    <HoverCard openDelay={150} closeDelay={120}>
      <HoverCardTrigger asChild>
        <span
          tabIndex={0}
          className={cn(
            "underline decoration-dotted decoration-muted-foreground/50 underline-offset-4 cursor-help outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm",
            className
          )}
        >
          {children}
        </span>
      </HoverCardTrigger>
      <HoverCardContent
        side={side}
        className="w-72 p-3 text-xs leading-relaxed"
      >
        <p className="text-popover-foreground">{def}</p>
        {learnMore && (
          <Link
            href={`/learn?term=${encodeURIComponent(id)}`}
            className="mt-2 inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
          >
            Learn more <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </HoverCardContent>
    </HoverCard>
  );
}
