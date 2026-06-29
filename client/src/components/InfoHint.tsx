import { HelpCircle, type LucideIcon } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * InfoHint — a small, accessible, reusable "explain this in plain words" affordance.
 *
 * Used across the maintainer pages (Explore, AI Intake, AI Review, Source Conflicts)
 * to explain workflow / trust concepts that are not finance-glossary terms (for finance
 * terms we reuse <GlossaryTerm>). The tooltip text should avoid jargon.
 *
 * Two presentations, same mechanics:
 *  - icon only (default): a subtle "?" icon. Best for table headers, badges, tight spaces.
 *  - with `label`: wraps inline text with a dotted underline + the "?" icon.
 *
 * Keyboard-reachable (button trigger) and screen-reader friendly via aria-label.
 */
export function InfoHint({
  children,
  label,
  side = "top",
  className,
  iconClassName,
  contentClassName,
  icon: Icon = HelpCircle,
}: {
  /** The plain-language explanation shown in the tooltip. */
  children: React.ReactNode;
  /** Optional inline text to wrap; when omitted, only the icon renders. */
  label?: React.ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
  iconClassName?: string;
  contentClassName?: string;
  /** Optional icon override (defaults to a "?" help circle). */
  icon?: LucideIcon;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={typeof label === "string" ? `What does "${label}" mean?` : "More information"}
          className={cn(
            "inline-flex items-center gap-1 text-left align-middle cursor-help rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
            className,
          )}
        >
          {label != null && (
            <span className="underline decoration-dotted underline-offset-2">{label}</span>
          )}
          <Icon
            className={cn(
              "shrink-0 text-muted-foreground/70 hover:text-muted-foreground transition-colors",
              label ? "w-3 h-3" : "w-3.5 h-3.5",
              iconClassName,
            )}
          />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className={cn("max-w-xs text-xs leading-relaxed", contentClassName)}>
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
