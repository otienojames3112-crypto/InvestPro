import { Compass, Scale, Landmark, Sparkles, ClipboardCheck, GitCompareArrows } from "lucide-react";
import { TabbedArea, type AreaTab } from "@/components/TabbedArea";
import Explore from "./Explore";
import MmfStrategy from "./MmfStrategy";
import BankInstruments from "./BankInstruments";
import AiIntake from "./AiIntake";
import AiReview from "./AiReview";
import SourceConflicts from "./SourceConflicts";

/**
 * Research — the consolidated "find and import opportunities" area.
 *
 * Groups the surfaces a user uses to discover instruments (explore, compare
 * MMFs, browse bank products) and to bring outside data in (AI import, AI
 * review, and the source-conflict resolver). Each tab reuses its existing page
 * verbatim (rendered embedded), so there is no duplicated logic.
 */
const tabs: AreaTab[] = [
  {
    id: "explore",
    label: "Explore",
    icon: Compass,
    hint: "Browse and filter investment opportunities across all asset types. A screener — it never picks anything for you.",
    render: () => <Explore embedded />,
  },
  {
    id: "mmf-comparison",
    label: "MMF Comparison",
    icon: Scale,
    hint: "Compare money-market funds side by side — yields, fees and effective annual rate — so you can see how your fund ranks.",
    render: () => <MmfStrategy embedded />,
  },
  {
    id: "bank-catalogue",
    label: "Bank Catalogue",
    icon: Landmark,
    hint: "A reference list of Kenyan bank call and fixed-deposit products: rates, minimum amounts and tenors.",
    render: () => <BankInstruments embedded />,
  },
  {
    id: "ai-import",
    label: "AI Import",
    icon: Sparkles,
    hint: "Paste a statement or document and let the assistant extract holdings and figures for you to review before anything is saved.",
    render: () => <AiIntake embedded />,
  },
  {
    id: "ai-review",
    label: "AI Review",
    icon: ClipboardCheck,
    hint: "Check, edit and approve what the assistant extracted before it becomes part of your portfolio.",
    render: () => <AiReview embedded />,
  },
  {
    id: "source-conflicts",
    label: "Source Conflicts",
    icon: GitCompareArrows,
    hint: "When two sources disagree on a figure (a rate or balance), resolve which one your plan should trust.",
    render: () => <SourceConflicts embedded />,
  },
];

export default function ResearchArea() {
  return (
    <TabbedArea
      title="Research"
      subtitle="Discover instruments, compare options, and import outside data — then decide for yourself."
      tabs={tabs}
      defaultTab="explore"
    />
  );
}
