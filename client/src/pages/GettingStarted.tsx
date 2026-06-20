import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Circle, ChevronRight, ExternalLink, Smartphone, CreditCard,
  FileText, Shield, Building2, BookOpen, AlertCircle, Phone, Globe, Clock
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

// ─── Types ────────────────────────────────────────────────────────────────────

type AccountStatus = "not_started" | "in_progress" | "opened";

interface AccountDetails {
  accountNumber?: string;
  phoneNumber?: string;
  notes?: string;
  openedDate?: string;
}

interface AccountState {
  status: AccountStatus;
  details: AccountDetails;
}

// Convert DB row to local AccountState
function dbRowToState(row: { isOpened: boolean; accountNumber?: string | null; phoneNumber?: string | null; notes?: string | null; dateOpened?: string | null } | undefined): AccountState {
  if (!row) return { status: "not_started", details: {} };
  return {
    status: row.isOpened ? "opened" : "not_started",
    details: {
      accountNumber: row.accountNumber ?? undefined,
      phoneNumber: row.phoneNumber ?? undefined,
      notes: row.notes ?? undefined,
      openedDate: row.dateOpened ?? undefined,
    },
  };
}

// ─── Step Component ───────────────────────────────────────────────────────────

function Step({
  number, title, description, icon: Icon, detail, link, linkLabel, badge,
}: {
  number: number;
  title: string;
  description: string;
  icon: React.ElementType;
  detail?: string;
  link?: string;
  linkLabel?: string;
  badge?: string;
}) {
  return (
    <div className="flex gap-4 group">
      <div className="flex flex-col items-center">
        <div className="w-8 h-8 rounded-full bg-primary/20 border border-primary/40 flex items-center justify-center shrink-0 text-primary font-bold text-sm">
          {number}
        </div>
        <div className="w-px flex-1 bg-border mt-2 min-h-[24px]" />
      </div>
      <div className="pb-6 flex-1">
        <div className="flex items-start gap-2 flex-wrap">
          <Icon className="w-4 h-4 text-primary mt-0.5 shrink-0" />
          <div className="flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">{title}</span>
              {badge && <Badge variant="secondary" className="text-xs">{badge}</Badge>}
            </div>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
            {detail && (
              <p className="text-xs text-muted-foreground/70 mt-1 leading-relaxed italic">{detail}</p>
            )}
            {link && (
              <a
                href={link}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 mt-2 transition-colors"
              >
                {linkLabel ?? link}
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Account Status Dialog ────────────────────────────────────────────────────

function AccountStatusDialog({
  open, onClose, accountType, state, onSave, isSaving,
}: {
  open: boolean;
  onClose: () => void;
  accountType: "mmf" | "dhow";
  state: AccountState;
  onSave: (newState: AccountState) => void;
  isSaving?: boolean;
}) {
  const isMmf = accountType === "mmf";
  const title = isMmf ? "SanlamAllianz MMF Account" : "CBK DhowCSD Account";

  const [status, setStatus] = useState<AccountStatus>(state.status);
  const [accountNumber, setAccountNumber] = useState(state.details.accountNumber ?? "");
  const [phoneNumber, setPhoneNumber] = useState(state.details.phoneNumber ?? "");
  const [openedDate, setOpenedDate] = useState(state.details.openedDate ?? "");
  const [notes, setNotes] = useState(state.details.notes ?? "");

  useEffect(() => {
    if (open) {
      setStatus(state.status);
      setAccountNumber(state.details.accountNumber ?? "");
      setPhoneNumber(state.details.phoneNumber ?? "");
      setOpenedDate(state.details.openedDate ?? "");
      setNotes(state.details.notes ?? "");
    }
  }, [open, state]);

  function handleSave() {
    onSave({
      status,
      details: {
        accountNumber: accountNumber.trim() || undefined,
        phoneNumber: phoneNumber.trim() || undefined,
        openedDate: openedDate || undefined,
        notes: notes.trim() || undefined,
      },
    });
    onClose();
    toast.success(`${title} status updated`);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base">{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Status selector */}
          <div className="space-y-2">
            <Label className="text-xs font-medium">Account Status</Label>
            <div className="grid grid-cols-3 gap-2">
              {(["not_started", "in_progress", "opened"] as AccountStatus[]).map((s) => (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all ${
                    status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50"
                  }`}
                >
                  {s === "not_started" ? "Not Started" : s === "in_progress" ? "In Progress" : "Opened ✓"}
                </button>
              ))}
            </div>
          </div>

          {status === "opened" && (
            <>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isMmf ? "MMF Account / Reference Number" : "DhowCSD Account Number (CDS-XXXXXXXX)"}
                </Label>
                <Input
                  value={accountNumber}
                  onChange={(e) => setAccountNumber(e.target.value)}
                  placeholder={isMmf ? "e.g. MMF-123456" : "e.g. CDS-00123456"}
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">
                  {isMmf ? "Registered M-Pesa / Phone Number" : "Registered Phone Number"}
                </Label>
                <Input
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  placeholder="e.g. 0712 345 678"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium">Date Account Opened</Label>
                <Input
                  type="date"
                  value={openedDate}
                  onChange={(e) => setOpenedDate(e.target.value)}
                  className="text-sm"
                />
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs font-medium">Notes (optional)</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Pending KYC verification, waiting for activation SMS..."
              className="text-sm min-h-[60px]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>{isSaving ? "Saving..." : "Save Status"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: AccountStatus }) {
  if (status === "opened") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-400 bg-emerald-400/10 border border-emerald-400/30 rounded-full px-2.5 py-0.5">
        <CheckCircle2 className="w-3 h-3" /> Account Opened
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded-full px-2.5 py-0.5">
        <Clock className="w-3 h-3" /> In Progress
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted border border-border rounded-full px-2.5 py-0.5">
      <Circle className="w-3 h-3" /> Not Started
    </span>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GettingStarted() {
  const [openDialog, setOpenDialog] = useState<"mmf" | "dhow" | null>(null);
  const utils = trpc.useUtils();

  // Load account statuses from database
  const { data: dbStatuses = [], isLoading: statusLoading } = trpc.accountStatus.list.useQuery();
  const upsertMutation = trpc.accountStatus.upsert.useMutation({
    onSuccess: () => {
      utils.accountStatus.list.invalidate();
      toast.success("Account status saved.");
      setOpenDialog(null);
    },
    onError: (err) => {
      toast.error(`Failed to save: ${err.message}`);
    },
  });

  const mmfRow = dbStatuses.find((s) => s.accountType === "mmf");
  const dhowRow = dbStatuses.find((s) => s.accountType === "dhowcsd");
  const mmf = dbRowToState(mmfRow);
  const dhow = dbRowToState(dhowRow);

  function updateState(type: "mmf" | "dhow", newState: AccountState) {
    const dbType = type === "dhow" ? "dhowcsd" : "mmf";
    upsertMutation.mutate({
      accountType: dbType,
      isOpened: newState.status === "opened",
      accountNumber: newState.details.accountNumber,
      phoneNumber: newState.details.phoneNumber,
      dateOpened: newState.details.openedDate,
      notes: newState.details.notes,
    });
  }

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-8 max-w-3xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Getting Started
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-by-step guide to opening your SanlamAllianz MMF and CBK DhowCSD accounts — the two pillars of your KES 5M plan.
          </p>
        </div>

        {/* Account Status Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* MMF Card */}
          <Card className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${mmf.status === "opened" ? "bg-emerald-400" : mmf.status === "in_progress" ? "bg-amber-400" : "bg-muted"}`} />
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Money Market Fund</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">SanlamAllianz MMF</p>
                  {mmf.status === "opened" && mmf.details.accountNumber && (
                    <p className="text-xs text-muted-foreground mt-1">Ref: {mmf.details.accountNumber}</p>
                  )}
                  {mmf.details.notes && mmf.status !== "opened" && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-2">{mmf.details.notes}</p>
                  )}
                </div>
                <Building2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              </div>
              <div className="flex items-center justify-between mt-3">
                <StatusBadge status={mmf.status} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setOpenDialog("mmf")}
                >
                  Update <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* DhowCSD Card */}
          <Card className="relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-1 h-full ${dhow.status === "opened" ? "bg-emerald-400" : dhow.status === "in_progress" ? "bg-amber-400" : "bg-muted"}`} />
            <CardContent className="p-4 pl-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">CBK Securities Platform</p>
                  <p className="text-sm font-semibold text-foreground mt-0.5">CBK DhowCSD</p>
                  {dhow.status === "opened" && dhow.details.accountNumber && (
                    <p className="text-xs text-muted-foreground mt-1">CDS: {dhow.details.accountNumber}</p>
                  )}
                  {dhow.details.notes && dhow.status !== "opened" && (
                    <p className="text-xs text-muted-foreground/70 mt-1 italic line-clamp-2">{dhow.details.notes}</p>
                  )}
                </div>
                <Shield className="w-5 h-5 text-primary shrink-0 mt-0.5" />
              </div>
              <div className="flex items-center justify-between mt-3">
                <StatusBadge status={dhow.status} />
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-7 px-2"
                  onClick={() => setOpenDialog("dhow")}
                >
                  Update <ChevronRight className="w-3 h-3 ml-1" />
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Estimated time */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3">
          <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Estimated time to open both accounts:</strong> SanlamAllianz MMF takes 1–3 business days after submitting your application. CBK DhowCSD takes 3–5 business days. You can start both processes simultaneously. Once both are open, you are ready to make your first investment contribution.
          </div>
        </div>

        {/* ── SECTION 1: SanlamAllianz MMF ── */}
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Building2 className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Part 1 — Open Your SanlamAllianz MMF Account
              </h2>
              <p className="text-xs text-muted-foreground">Your monthly contributions land here first before sweeping to DhowCSD</p>
            </div>
          </div>

          <div className="ml-4 border-l border-border pl-4">
            <Step
              number={1}
              icon={Globe}
              title="Visit the SanlamAllianz website"
              description="Go to the SanlamAllianz Kenya website and navigate to the Money Market Fund section. You can also call their customer care line to request an application form."
              link="https://www.sanlamallianz.co.ke"
              linkLabel="sanlamallianz.co.ke"
              badge="Online"
            />
            <Step
              number={2}
              icon={FileText}
              title="Download and complete the MMF application form"
              description="Fill in your personal details: full name, ID/passport number, KRA PIN, physical address, and bank account details (for redemptions). The form is available on the website or at any SanlamAllianz branch."
              detail="Tip: Your KRA PIN is mandatory. If you do not have one, register at itax.kra.go.ke before applying."
            />
            <Step
              number={3}
              icon={CreditCard}
              title="Prepare your KYC documents"
              description="You will need: (1) Copy of your National ID or Passport, (2) Copy of your KRA PIN certificate, (3) One passport-sized photo, (4) Proof of address (utility bill or bank statement not older than 3 months)."
              badge="Required"
            />
            <Step
              number={4}
              icon={FileText}
              title="Submit your application"
              description="Submit the completed form and KYC documents by email, at a SanlamAllianz branch, or through their online portal. You will receive a confirmation email and your account number within 1–3 business days."
              link="https://www.sanlamallianz.co.ke/contact-us"
              linkLabel="Find nearest branch"
            />
            <Step
              number={5}
              icon={Smartphone}
              title="Make your first deposit via M-Pesa or bank transfer"
              description="Once your account is activated, deposit your first KES 2,500 contribution via M-Pesa (Paybill: check your welcome letter) or bank transfer. The minimum initial investment is typically KES 1,000."
              detail="Your MMF starts earning interest from the day your deposit is received and confirmed. Interest accrues daily and is credited monthly."
            />
            <Step
              number={6}
              icon={Phone}
              title="Set up monthly standing order"
              description="Automate your monthly contributions by setting up a standing order from your bank or M-Pesa. This ensures you never miss a contribution and removes the discipline burden."
              detail="Recommended: set the standing order for the 1st of each month to align with your contribution schedule in this tracker."
            />
          </div>
        </div>

        {/* ── SECTION 2: CBK DhowCSD ── */}
        <div>
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <div>
              <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                Part 2 — Open Your CBK DhowCSD Account
              </h2>
              <p className="text-xs text-muted-foreground">The Central Bank of Kenya's platform for buying T-Bills, IFBs, and FXD bonds directly</p>
            </div>
          </div>

          <div className="ml-4 border-l border-border pl-4">
            <Step
              number={1}
              icon={Globe}
              title="Visit the CBK DhowCSD portal"
              description="Go to dhowcsd.centralbank.go.ke — the Central Bank of Kenya's Central Securities Depository platform. This is where you will buy and hold all your government securities (T-Bills, IFBs, and FXD bonds)."
              link="https://dhowcsd.centralbank.go.ke"
              linkLabel="dhowcsd.centralbank.go.ke"
              badge="Online"
            />
            <Step
              number={2}
              icon={FileText}
              title="Register for a DhowCSD account"
              description="Click 'Register' and fill in your personal details: full name, National ID number, KRA PIN, date of birth, phone number, and email address. You will also need to provide your bank account details for settlement."
              detail="Important: Use the exact name as it appears on your National ID. Mismatches will cause your application to be rejected."
            />
            <Step
              number={3}
              icon={CreditCard}
              title="Complete identity verification (KYC)"
              description="Upload clear scans of: (1) Your National ID (front and back), (2) Your KRA PIN certificate, (3) A selfie or passport photo. CBK will verify your identity against IPRS (Integrated Population Registration System)."
              badge="Required"
            />
            <Step
              number={4}
              icon={Building2}
              title="Link your bank account for settlement"
              description="Add your bank account (must be in your name) for receiving coupon payments and maturity proceeds. CBK supports all major Kenyan banks. Ensure your bank account name matches your ID exactly."
              detail="You can link an M-Pesa account as well, but a bank account is recommended for larger settlement amounts."
            />
            <Step
              number={5}
              icon={Shield}
              title="Wait for account activation (3–5 business days)"
              description="CBK will review your application and send you an activation email with your CDS account number (format: CDS-XXXXXXXX). Keep this number safe — you will need it for all future transactions."
              detail="If you do not receive your activation email within 5 business days, call CBK on 0709 081 000 or email dhowcsd@centralbank.go.ke."
            />
            <Step
              number={6}
              icon={Smartphone}
              title="Place your first T-Bill bid"
              description="Once activated, log in to DhowCSD and navigate to 'Primary Market'. Select the T-Bill tenor you want (91-day, 182-day, or 364-day) and enter your bid amount (minimum KES 50,000 face value). Bids are accepted every Monday for Tuesday auctions."
              detail="For your first purchase, use the 91-day T-Bill to get comfortable with the process. The minimum competitive bid is KES 50,000 face value."
              badge="First purchase"
            />
            <Step
              number={7}
              icon={BookOpen}
              title="Log your purchase in the CBK Securities Register"
              description="After your bid is accepted, go to the CBK Securities page in this tracker and log your purchase with the face value, issue date, maturity date, and coupon rate. The tracker will automatically calculate your next coupon date and maturity event."
            />
          </div>
        </div>

        {/* ── Key contacts ── */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Phone className="w-4 h-4 text-primary" />
              Key Contacts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <p className="font-semibold text-foreground">SanlamAllianz Kenya</p>
                <p className="text-muted-foreground">Customer Care: 0800 723 456 (toll-free)</p>
                <p className="text-muted-foreground">Email: info@sanlamallianz.co.ke</p>
                <a href="https://www.sanlamallianz.co.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                  sanlamallianz.co.ke <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="space-y-1">
                <p className="font-semibold text-foreground">CBK DhowCSD Support</p>
                <p className="text-muted-foreground">Phone: 0709 081 000</p>
                <p className="text-muted-foreground">Email: dhowcsd@centralbank.go.ke</p>
                <a href="https://dhowcsd.centralbank.go.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                  dhowcsd.centralbank.go.ke <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Status Dialogs */}
      <AccountStatusDialog
        open={openDialog === "mmf"}
        onClose={() => setOpenDialog(null)}
        accountType="mmf"
        state={mmf}
        onSave={(s) => updateState("mmf", s)}
      />
      <AccountStatusDialog
        open={openDialog === "dhow"}
        onClose={() => setOpenDialog(null)}
        accountType="dhow"
        state={dhow}
        onSave={(s) => updateState("dhow", s)}
      />
    </AppShell>
  );
}
