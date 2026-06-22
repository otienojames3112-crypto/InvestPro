import { usePortfolio } from "@/contexts/PortfolioContext";
import { useSelectedFund } from "@/hooks/useSelectedFund";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2, Circle, ChevronRight, ChevronDown, ExternalLink, Smartphone, CreditCard,
  FileText, Shield, Building2, BookOpen, AlertCircle, Phone, Globe, Clock, Search,
  TrendingUp, Landmark, Users, Star, Wand2, BookMarked, ArrowRight, LayoutDashboard,
  Wallet, Receipt, SlidersHorizontal
} from "lucide-react";
import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";

// ─── Guided demo: first-steps path + glossary ───────────────────────────────
const FIRST_STEPS: { icon: React.ElementType; title: string; desc: string; href: string; cta: string }[] = [
  { icon: SlidersHorizontal, title: "1. Set your plan & rates", desc: "Confirm your target, horizon, monthly contribution and the current MMF/T-bill/bond rates.", href: "/settings", cta: "Open Settings" },
  { icon: Wallet, title: "2. Record where your money is", desc: "Log deposits into each MMF, bank deposit or government security so the tracker mirrors reality.", href: "/deposits", cta: "Record a deposit" },
  { icon: LayoutDashboard, title: "3. Read your dashboard", desc: "See your live net worth, allocation and the projection toward your goal in one place.", href: "/", cta: "View Dashboard" },
  { icon: TrendingUp, title: "4. Test scenarios", desc: "Find the minimum monthly contribution that reaches your target, and try what-ifs.", href: "/scenarios", cta: "Open Scenarios" },
  { icon: Receipt, title: "5. Check your tax", desc: "Review the 15% withholding tax on each income source and your blended net yield.", href: "/tax-summary", cta: "Open Tax Summary" },
];

const GLOSSARY: { term: string; def: string }[] = [
  { term: "EAR (Effective Annual Rate)", def: "The true annualised yield once compounding is included. MMFs quote a net EAR after the manager's fee; the tracker applies 15% withholding tax on top." },
  { term: "WHT (Withholding Tax)", def: "Tax deducted at source before you receive interest. In Kenya it is 15% on MMF, T-bill and FXD income. IFB (infrastructure bond) interest is tax-exempt." },
  { term: "T-Bill", def: "A short-term government security sold at a discount over 91, 182 or 364 days. You earn the difference between the discounted price and the face value at maturity." },
  { term: "IFB (Infrastructure Bond)", def: "A long-dated government bond funding infrastructure. Its coupon is tax-exempt, making its net yield higher than a comparable taxable bond." },
  { term: "FXD (Fixed-Coupon Treasury Bond)", def: "A government bond paying a fixed semi-annual coupon (around 12.35% gross). The 15% WHT is deducted before the coupon reaches you." },
  { term: "Call deposit", def: "A bank deposit that earns interest while remaining accessible on short notice. Rates are usually negotiable for larger balances." },
  { term: "Fixed deposit", def: "A bank deposit locked for a set term at an agreed rate; interest is typically paid at maturity." },
  { term: "Duration", def: "A measure of how sensitive a bond's price is to interest-rate changes. Longer duration means larger price swings when rates move." },
];

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

type FundCategory = "independent" | "insurance" | "bank" | "sacco";

interface MmfFundInfo {
  id: string;
  rank: number;
  name: string;
  company: string;
  category: FundCategory;
  ear: string;
  netYield: string;
  minInvestment: string;
  mgmtFee: string;
  aum: string;
  website: string;
  portalUrl?: string;
  mpesaPaybill?: string;
  phone?: string;
  email?: string;
  openingSteps: string[];
  documents: string[];
  notes?: string;
}

// ─── All 27 MMF Fund Data ─────────────────────────────────────────────────────

const MMF_FUNDS: MmfFundInfo[] = [
  {
    id: "nabo",
    rank: 1,
    name: "Nabo Africa Money Market Fund",
    company: "Nabo Capital",
    category: "independent",
    ear: "13.54%",
    netYield: "11.51%",
    minInvestment: "KES 100,000",
    mgmtFee: "2.25%",
    aum: "KES 6.2B",
    website: "https://nabocapital.com",
    portalUrl: "https://nabocapital.com/invest",
    phone: "+254 709 170 000",
    email: "info@nabocapital.com",
    openingSteps: [
      "Visit nabocapital.com and click 'Invest Now' or 'Open Account'.",
      "Complete the online application form with your full name, ID/Passport number, KRA PIN, and bank details.",
      "Upload KYC documents: National ID (front & back), KRA PIN certificate, and a passport photo.",
      "Fund your account with the minimum KES 100,000 via bank transfer or EFT to Nabo Capital's designated account.",
      "Await account activation confirmation by email (typically 1–3 business days).",
      "Log in to your Nabo investor portal to monitor your balance and returns.",
    ],
    documents: ["National ID or Passport (front & back)", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months) for source of funds"],
    notes: "Highest-yielding fund in Kenya (Jun 2026). Minimum KES 100,000 is the highest among all funds — suitable for lump-sum investors.",
  },
  {
    id: "cytonn",
    rank: 2,
    name: "Cytonn Money Market Fund",
    company: "Cytonn Asset Managers",
    category: "independent",
    ear: "12.00%",
    netYield: "10.20%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 2.0B",
    website: "https://cytonnmm.com",
    portalUrl: "https://cytonnmm.com",
    mpesaPaybill: "525900",
    phone: "+254 709 170 000",
    email: "mm@cytonn.com",
    openingSteps: [
      "Visit cytonnmm.com and click 'Open Account'.",
      "Fill in the online registration form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make an initial deposit of at least KES 1,000 via M-Pesa Paybill 525900 (Account: your phone number) or bank transfer.",
      "Receive your account confirmation email within 1–2 business days.",
      "Access the Cytonn investor portal to track your investment and request withdrawals.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Second-highest yield in Kenya. Very low minimum of KES 1,000 makes it accessible. M-Pesa deposits supported.",
  },
  {
    id: "etica",
    rank: 3,
    name: "Etica Money Market Fund",
    company: "Etica Capital",
    category: "independent",
    ear: "10.97%",
    netYield: "9.32%",
    minInvestment: "KES 100",
    mgmtFee: "2.00%",
    aum: "KES 12.5B",
    website: "https://eticacapital.com",
    portalUrl: "https://eticacapital.com/invest",
    phone: "+254 700 000 000",
    email: "info@eticacapital.com",
    openingSteps: [
      "Visit eticacapital.com and navigate to the Money Market Fund section.",
      "Click 'Open Account' and complete the online KYC form.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your first deposit of as little as KES 100 via M-Pesa or bank transfer.",
      "Receive account activation confirmation within 1–2 business days.",
      "Log in to the Etica investor portal to view your balance and transaction history.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Lowest minimum investment in Kenya at KES 100. Excellent for beginners and small savers. Large AUM of KES 12.5B indicates strong investor confidence.",
  },
  {
    id: "lofty-corban",
    rank: 4,
    name: "Lofty Corban Money Market Fund",
    company: "Lofty Corban Investment Group",
    category: "independent",
    ear: "10.64%",
    netYield: "9.04%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 4.4B",
    website: "https://loftycorban.co.ke",
    portalUrl: "https://loftycorban.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@loftycorban.co.ke",
    openingSteps: [
      "Visit loftycorban.co.ke and navigate to the Money Market Fund page.",
      "Complete the online account opening form with your personal and financial details.",
      "Upload KYC documents as prompted.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access your investor dashboard to monitor returns and make additional contributions.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Fourth-highest yield in Kenya. Growing fund with KES 4.4B AUM.",
  },
  {
    id: "avrocap",
    rank: 5,
    name: "Avrocap Money Market Fund",
    company: "Avrocap",
    category: "independent",
    ear: "10.43%",
    netYield: "8.87%",
    minInvestment: "KES 3,000",
    mgmtFee: "2.00%",
    aum: "KES 550M",
    website: "https://avrocap.co.ke",
    portalUrl: "https://avrocap.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@avrocap.co.ke",
    openingSteps: [
      "Visit avrocap.co.ke and click 'Invest' or 'Open Account'.",
      "Complete the online registration form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Deposit the minimum KES 3,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Monitor your investment via the Avrocap investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Fifth-highest yield. Smaller fund (KES 550M AUM) — growing boutique asset manager.",
  },
  {
    id: "madison",
    rank: 6,
    name: "Madison Money Market Fund",
    company: "Madison Asset Management",
    category: "insurance",
    ear: "10.42%",
    netYield: "8.86%",
    minInvestment: "KES 5,000",
    mgmtFee: "0.00%",
    aum: "KES 6.3B",
    website: "https://madisonasset.co.ke",
    portalUrl: "https://madisonasset.co.ke",
    phone: "+254 719 048 000",
    email: "info@madisonasset.co.ke",
    openingSteps: [
      "Visit madisonasset.co.ke and navigate to the Money Market Fund section.",
      "Download the account opening form or apply online.",
      "Complete the form with your personal details, KRA PIN, and bank account information.",
      "Submit KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 5,000 via bank transfer or M-Pesa.",
      "Receive your account confirmation and log in to the Madison investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address (utility bill or bank statement)"],
    notes: "Notable for 0% management fee — one of only two funds with no management fee. Backed by Madison Insurance Group.",
  },
  {
    id: "faulu",
    rank: 7,
    name: "Faulu Money Market Fund",
    company: "Faulu Microfinance Bank",
    category: "bank",
    ear: "10.35%",
    netYield: "8.80%",
    minInvestment: "KES 1,000",
    mgmtFee: "1.50%",
    aum: "KES 305M",
    website: "https://faulukenya.com",
    portalUrl: "https://faulukenya.com/investments",
    phone: "+254 711 085 000",
    email: "info@faulukenya.com",
    openingSteps: [
      "Visit faulukenya.com or walk into any Faulu branch.",
      "Request the Money Market Fund application form from a customer service representative.",
      "Fill in your personal details, KRA PIN, and bank/M-Pesa details.",
      "Submit your KYC documents at the branch or upload them online.",
      "Make your initial deposit of KES 1,000 via Faulu M-Pesa or bank transfer.",
      "Receive your account activation confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Microfinance bank-backed fund. Lowest management fee among bank-backed funds at 1.50%. Good for Faulu existing customers.",
  },
  {
    id: "kuza",
    rank: 8,
    name: "Kuza Money Market Fund",
    company: "Kuza Asset Management",
    category: "independent",
    ear: "10.35%",
    netYield: "8.80%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 2.4B",
    website: "https://kuzaasset.com",
    portalUrl: "https://kuzaasset.com/invest",
    phone: "+254 700 000 000",
    email: "info@kuzaasset.com",
    openingSteps: [
      "Visit kuzaasset.com and click 'Open Account'.",
      "Complete the online application form with your personal and financial details.",
      "Upload your National ID and KRA PIN certificate.",
      "Deposit the minimum KES 5,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access the Kuza investor portal to manage your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Growing independent asset manager with KES 2.4B AUM.",
  },
  {
    id: "old-mutual",
    rank: 9,
    name: "Old Mutual Money Market Fund",
    company: "Old Mutual Investment Group",
    category: "insurance",
    ear: "10.13%",
    netYield: "8.61%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 24.3B",
    website: "https://oldmutual.co.ke",
    portalUrl: "https://oldmutual.co.ke/investments/money-market-fund",
    phone: "+254 722 206 914",
    email: "ke.clientservices@oldmutual.com",
    openingSteps: [
      "Visit oldmutual.co.ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Receive account confirmation within 1–3 business days and access the Old Mutual investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Large, established fund with KES 24.3B AUM. Part of the Old Mutual Group — one of Africa's largest financial services companies.",
  },
  {
    id: "jubilee",
    rank: 10,
    name: "Jubilee Money Market Fund",
    company: "Jubilee Financial Services",
    category: "insurance",
    ear: "10.05%",
    netYield: "8.54%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 11.6B",
    website: "https://jubileefinancialservices.com",
    portalUrl: "https://jubileefinancialservices.com/invest",
    phone: "+254 703 099 000",
    email: "info@jubileefinancialservices.com",
    openingSteps: [
      "Visit jubileefinancialservices.com and navigate to the Money Market Fund section.",
      "Complete the online application form or visit a Jubilee branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 5,000 via bank transfer or M-Pesa.",
      "Receive your account confirmation and access the Jubilee investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Backed by Jubilee Insurance — one of Kenya's largest insurance groups. KES 11.6B AUM reflects strong institutional backing.",
  },
  {
    id: "orient-kasha",
    rank: 11,
    name: "Orient Kasha Money Market Fund",
    company: "Orient Asset Managers",
    category: "independent",
    ear: "10.01%",
    netYield: "8.51%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 497M",
    website: "https://orientasset.co.ke",
    portalUrl: "https://orientasset.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@orientasset.co.ke",
    openingSteps: [
      "Visit orientasset.co.ke and navigate to the Kasha Money Market Fund page.",
      "Complete the online account opening form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access the Orient investor portal to monitor your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Boutique independent asset manager. Low minimum of KES 1,000.",
  },
  {
    id: "britam",
    rank: 12,
    name: "Britam Money Market Fund",
    company: "Britam Asset Managers",
    category: "insurance",
    ear: "9.72%",
    netYield: "8.26%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 14.8B",
    website: "https://britam.com",
    portalUrl: "https://britam.com/ke/investments/money-market-fund",
    mpesaPaybill: "220388",
    phone: "+254 703 094 000",
    email: "customerservice@britam.com",
    openingSteps: [
      "Visit britam.com/ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your full name, ID number, KRA PIN, and bank account details.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 1,000 via M-Pesa Paybill 220388 or bank transfer.",
      "Receive your account confirmation within 1–3 business days and access the Britam investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Large, well-established fund with KES 14.8B AUM. Britam is a leading pan-African financial services group. M-Pesa Paybill: 220388.",
  },
  {
    id: "apa",
    rank: 13,
    name: "Apollo Money Market Fund",
    company: "APA Life Assurance (Apollo)",
    category: "insurance",
    ear: "9.14%",
    netYield: "7.77%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 4.1B",
    website: "https://apalife.co.ke",
    portalUrl: "https://apalife.co.ke/investments",
    phone: "+254 703 095 000",
    email: "info@apalife.co.ke",
    openingSteps: [
      "Visit apalife.co.ke and navigate to the Apollo Money Market Fund section.",
      "Complete the online application form or visit an APA branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Deposit the minimum KES 1,000 via M-Pesa or bank transfer.",
      "Receive your account activation confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Backed by APA Insurance (Apollo Group). KES 4.1B AUM.",
  },
  {
    id: "dry-associates",
    rank: 14,
    name: "Dry Associates Money Market Fund",
    company: "Dry Associates Investment Bank",
    category: "independent",
    ear: "9.10%",
    netYield: "7.74%",
    minInvestment: "KES 1,000,000",
    mgmtFee: "2.00%",
    aum: "KES 4.1B",
    website: "https://dryassociates.com",
    portalUrl: "https://dryassociates.com/invest",
    phone: "+254 722 200 565",
    email: "info@dryassociates.com",
    openingSteps: [
      "Contact Dry Associates directly via phone (+254 722 200 565) or email (info@dryassociates.com) to initiate the account opening process.",
      "You will be assigned a relationship manager who will guide you through the application.",
      "Complete the account opening forms provided by your relationship manager.",
      "Submit certified copies of your National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum investment of KES 1,000,000 to the designated Dry Associates account.",
      "Receive your account confirmation and access your investment statement.",
    ],
    documents: ["National ID or Passport (certified copy)", "KRA PIN certificate", "Passport-size photo", "Bank statement (6 months)", "Source of funds declaration"],
    notes: "Highest minimum investment at KES 1,000,000 — designed for high-net-worth individuals. Boutique investment bank with personalised service.",
  },
  {
    id: "genafrica",
    rank: 15,
    name: "GenAfrica Money Market Fund",
    company: "GenAfrica Asset Managers",
    category: "independent",
    ear: "9.05%",
    netYield: "7.69%",
    minInvestment: "KES 500,000",
    mgmtFee: "2.00%",
    aum: "KES 4.9B",
    website: "https://genafrica.com",
    portalUrl: "https://genafrica.com/invest",
    phone: "+254 709 170 000",
    email: "info@genafrica.com",
    openingSteps: [
      "Visit genafrica.com and navigate to the Money Market Fund section.",
      "Complete the online application form or contact GenAfrica directly.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum KES 500,000 to the GenAfrica designated account.",
      "Receive your account confirmation and access the GenAfrica investor portal.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months)"],
    notes: "High minimum of KES 500,000. Institutional-grade fund manager with KES 4.9B AUM.",
  },
  {
    id: "kcb",
    rank: 16,
    name: "KCB Money Market Fund",
    company: "KCB Bank Kenya",
    category: "bank",
    ear: "9.03%",
    netYield: "7.68%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 17.7B",
    website: "https://kcbgroup.com",
    portalUrl: "https://kcbgroup.com/investments",
    mpesaPaybill: "522522",
    phone: "+254 711 087 000",
    email: "customercare@kcbgroup.com",
    openingSteps: [
      "Log in to the KCB mobile app or internet banking, or visit any KCB branch.",
      "Navigate to Investments → Money Market Fund and click 'Invest'.",
      "If you are an existing KCB customer, your KYC is already on file — simply accept the terms and invest.",
      "If new to KCB, open a KCB account first, then proceed with the MMF application.",
      "Make your initial deposit of KES 5,000 via KCB mobile app, internet banking, or M-Pesa Paybill 522522.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo (if new KCB customer)"],
    notes: "Seamless for existing KCB customers — no additional KYC required. KES 17.7B AUM. M-Pesa Paybill: 522522.",
  },
  {
    id: "genghis",
    rank: 17,
    name: "Hela Imara Money Market Fund",
    company: "Genghis Capital",
    category: "independent",
    ear: "8.92%",
    netYield: "7.58%",
    minInvestment: "KES 500",
    mgmtFee: "2.00%",
    aum: "KES 589M",
    website: "https://genghiscapital.co.ke",
    portalUrl: "https://genghiscapital.co.ke/invest",
    phone: "+254 719 028 000",
    email: "info@genghiscapital.co.ke",
    openingSteps: [
      "Visit genghiscapital.co.ke and navigate to the Hela Imara Money Market Fund.",
      "Click 'Open Account' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 500 via M-Pesa or bank transfer.",
      "Receive your account confirmation within 1–2 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Very low minimum of KES 500. Genghis Capital is a licensed stockbroker and investment bank.",
  },
  {
    id: "sanlam",
    rank: 18,
    name: "Sanlam Allianz Money Market Fund",
    company: "SanlamAllianz Kenya",
    category: "insurance",
    ear: "8.82%",
    netYield: "7.50%",
    minInvestment: "KES 2,500",
    mgmtFee: "2.00%",
    aum: "KES 114.2B",
    website: "https://sanlamallianz.co.ke",
    portalUrl: "https://sanlamallianz.co.ke",
    phone: "0800 723 456",
    email: "info@sanlamallianz.co.ke",
    openingSteps: [
      "Visit sanlamallianz.co.ke or call 0800 723 456 (toll-free) to request an application form.",
      "Complete the MMF application form with your full name, ID/Passport number, KRA PIN, physical address, and bank account details.",
      "Submit KYC documents: National ID (front & back), KRA PIN certificate, passport photo, and proof of address.",
      "Submit the completed form by email, at a SanlamAllianz branch, or via their online portal.",
      "Receive your account number and welcome letter within 1–3 business days.",
      "Make your first deposit of KES 2,500 via M-Pesa (Paybill in welcome letter) or bank transfer.",
      "Set up a monthly standing order to automate your contributions.",
    ],
    documents: ["National ID or Passport (front & back)", "KRA PIN certificate", "Passport-size photo", "Proof of address (utility bill or bank statement, max 3 months old)"],
    notes: "Largest MMF in Kenya by AUM at KES 114.2B. Toll-free customer care: 0800 723 456.",
  },
  {
    id: "cic",
    rank: 19,
    name: "CIC Money Market Fund",
    company: "CIC Asset Management",
    category: "insurance",
    ear: "8.43%",
    netYield: "7.17%",
    minInvestment: "KES 5,000",
    mgmtFee: "2.00%",
    aum: "KES 78.9B",
    website: "https://cic.co.ke",
    portalUrl: "https://cic.co.ke/investments",
    mpesaPaybill: "510400",
    phone: "+254 703 099 120",
    email: "info@cic.co.ke",
    openingSteps: [
      "Visit cic.co.ke and navigate to Investments → Money Market Fund.",
      "Click 'Invest Now' and complete the online application form.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Upload your National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 5,000 via M-Pesa Paybill 510400 or bank transfer.",
      "Receive your account confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Second-largest MMF by AUM at KES 78.9B. Backed by CIC Insurance Group — a cooperative-linked insurer. M-Pesa Paybill: 510400.",
  },
  {
    id: "cpf",
    rank: 20,
    name: "CPF Money Market Fund",
    company: "CPF Financial Services",
    category: "independent",
    ear: "8.11%",
    netYield: "6.89%",
    minInvestment: "KES 1,000",
    mgmtFee: "3.00%",
    aum: "KES 3.3B",
    website: "https://cpffinancialservices.co.ke",
    portalUrl: "https://cpffinancialservices.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@cpffinancialservices.co.ke",
    openingSteps: [
      "Visit cpffinancialservices.co.ke and navigate to the Money Market Fund section.",
      "Complete the online application form with your personal details and KRA PIN.",
      "Upload your National ID and KRA PIN certificate.",
      "Make your initial deposit of KES 1,000 via M-Pesa or bank transfer.",
      "Await account activation (1–3 business days).",
      "Access your investor dashboard to track your investment.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo"],
    notes: "Highest management fee at 3.00% — factor this into your net yield calculations. KES 3.3B AUM.",
  },
  {
    id: "co-op",
    rank: 21,
    name: "Co-op Money Market Fund",
    company: "Co-operative Bank of Kenya",
    category: "bank",
    ear: "7.95%",
    netYield: "6.76%",
    minInvestment: "KES 500",
    mgmtFee: "0.90%",
    aum: "KES 21.6B",
    website: "https://co-opbank.co.ke",
    portalUrl: "https://co-opbank.co.ke/investments",
    mpesaPaybill: "400200",
    phone: "+254 703 027 000",
    email: "customercare@co-opbank.co.ke",
    openingSteps: [
      "Log in to the Co-op Bank mobile app or internet banking, or visit any Co-op Bank branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Co-op customer, your KYC is already on file.",
      "Accept the fund terms and conditions and enter your initial investment amount (minimum KES 500).",
      "Confirm the transaction via M-Pesa, Co-op mobile banking, or bank transfer.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Co-op customer)"],
    notes: "Lowest management fee among bank-backed funds at 0.90%. Very low minimum of KES 500. Seamless for existing Co-op Bank customers. M-Pesa Paybill: 400200.",
  },
  {
    id: "icea-lion",
    rank: 22,
    name: "ICEA Lion Money Market Fund",
    company: "ICEA Lion Asset Management",
    category: "insurance",
    ear: "7.62%",
    netYield: "6.48%",
    minInvestment: "KES 500",
    mgmtFee: "2.00%",
    aum: "KES 20.4B",
    website: "https://icealion.co.ke",
    portalUrl: "https://icealion.co.ke/investments",
    phone: "+254 722 208 450",
    email: "info@icealion.co.ke",
    openingSteps: [
      "Visit icealion.co.ke and navigate to Asset Management → Money Market Fund.",
      "Complete the online application form or visit an ICEA Lion branch.",
      "Provide your personal details, KRA PIN, and bank account information.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Make your initial deposit of KES 500 via M-Pesa or bank transfer.",
      "Receive your account confirmation within 1–3 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Proof of address"],
    notes: "Very low minimum of KES 500. Large fund with KES 20.4B AUM. ICEA Lion is a leading East African insurance and asset management group.",
  },
  {
    id: "safaricom",
    rank: 23,
    name: "Ziidi Money Market Fund",
    company: "Safaricom (M-Pesa)",
    category: "bank",
    ear: "6.85%",
    netYield: "5.82%",
    minInvestment: "KES 100",
    mgmtFee: "2.00%",
    aum: "KES 2.3B",
    website: "https://safaricom.co.ke/ziidi",
    portalUrl: "https://safaricom.co.ke/ziidi",
    mpesaPaybill: "M-Pesa app",
    phone: "*234#",
    email: "ziidi@safaricom.co.ke",
    openingSteps: [
      "Open the M-Pesa app on your Safaricom line and navigate to 'Ziidi' under the Invest section.",
      "Alternatively, dial *234# and select the Ziidi option.",
      "Accept the terms and conditions — your M-Pesa KYC is used automatically (no additional documents required).",
      "Enter the amount you wish to invest (minimum KES 100).",
      "Confirm the transaction with your M-Pesa PIN.",
      "Your investment is activated instantly and you can withdraw at any time via M-Pesa.",
    ],
    documents: ["Safaricom M-Pesa line (KYC already done via Safaricom)"],
    notes: "Easiest and fastest to open — no paperwork, fully in-app via M-Pesa. Lowest minimum at KES 100. Ideal for emergency fund or small savings. Instant withdrawals to M-Pesa.",
  },
  {
    id: "ncba",
    rank: 24,
    name: "NCBA Fixed Income Fund",
    company: "NCBA Bank Kenya",
    category: "bank",
    ear: "6.61%",
    netYield: "5.62%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 10.5B",
    website: "https://ncbagroup.com",
    portalUrl: "https://ncbagroup.com/investments",
    mpesaPaybill: "880100",
    phone: "+254 711 056 000",
    email: "customercare@ncbagroup.com",
    openingSteps: [
      "Log in to the NCBA mobile app or internet banking, or visit any NCBA branch.",
      "Navigate to Investments → Fixed Income Fund.",
      "If you are an existing NCBA customer, your KYC is already on file.",
      "Complete the fund application form and accept the terms.",
      "Make your initial deposit of KES 1,000 via NCBA mobile banking or M-Pesa Paybill 880100.",
      "Your investment is activated within 1 business day.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new NCBA customer)"],
    notes: "Note: This is a Fixed Income Fund, not a pure MMF — it may hold longer-duration bonds. Seamless for existing NCBA/Loop customers. M-Pesa Paybill: 880100.",
  },
  {
    id: "stanbic",
    rank: 25,
    name: "Stanbic Money Market Fund",
    company: "Stanbic Bank Kenya",
    category: "bank",
    ear: "5.20%",
    netYield: "4.42%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 2.3B",
    website: "https://stanbicbank.co.ke",
    portalUrl: "https://stanbicbank.co.ke/investments",
    phone: "+254 711 079 000",
    email: "customercare@stanbicbank.co.ke",
    openingSteps: [
      "Log in to the Stanbic mobile app or internet banking, or visit any Stanbic branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Stanbic customer, your KYC is already on file.",
      "Complete the fund application and accept the terms.",
      "Make your initial deposit of KES 1,000 via Stanbic mobile banking or bank transfer.",
      "Your investment is activated within 1–2 business days.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Stanbic customer)"],
    notes: "Part of Standard Bank Group (South Africa). Lower yield relative to peers — consider higher-yielding alternatives unless you are an existing Stanbic customer.",
  },
  {
    id: "equity",
    rank: 26,
    name: "Equity Money Market Fund",
    company: "Equity Bank Kenya",
    category: "bank",
    ear: "5.14%",
    netYield: "4.37%",
    minInvestment: "KES 1,000",
    mgmtFee: "2.00%",
    aum: "KES 1.5B",
    website: "https://equitybankgroup.com",
    portalUrl: "https://equitybankgroup.com/investments",
    mpesaPaybill: "247247",
    phone: "+254 763 000 000",
    email: "customercare@equitybank.co.ke",
    openingSteps: [
      "Log in to the Equity mobile app (Equity Mobile) or visit any Equity Bank branch.",
      "Navigate to Investments → Money Market Fund.",
      "If you are an existing Equity customer, your KYC is already on file.",
      "Accept the fund terms and enter your initial investment (minimum KES 1,000).",
      "Confirm the transaction via Equity Mobile or M-Pesa Paybill 247247.",
      "Your investment is activated immediately for existing customers.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate (if new Equity customer)"],
    notes: "Seamless for Equity Bank's large customer base. Lower yield — consider higher-yielding alternatives unless you are an existing Equity customer. M-Pesa Paybill: 247247.",
  },
  {
    id: "african-alliance",
    rank: 27,
    name: "African Alliance Money Market Fund",
    company: "African Alliance Kenya",
    category: "independent",
    ear: "3.91%",
    netYield: "3.32%",
    minInvestment: "KES 100,000",
    mgmtFee: "2.00%",
    aum: "—",
    website: "https://africanalliance.co.ke",
    portalUrl: "https://africanalliance.co.ke/invest",
    phone: "+254 700 000 000",
    email: "info@africanalliance.co.ke",
    openingSteps: [
      "Visit africanalliance.co.ke and navigate to the Money Market Fund section.",
      "Contact African Alliance directly to initiate the account opening process.",
      "Complete the application form with your personal details and KRA PIN.",
      "Submit your KYC documents: National ID, KRA PIN certificate, and passport photo.",
      "Transfer the minimum KES 100,000 to the African Alliance designated account.",
      "Receive your account confirmation and access your investment statement.",
    ],
    documents: ["National ID or Passport", "KRA PIN certificate", "Passport-size photo", "Bank statement (3 months)"],
    notes: "Lowest yield in Kenya at 3.91% EAR — significantly below the industry average of 8.98%. High minimum of KES 100,000. Consider higher-yielding alternatives.",
  },
];

const CATEGORY_LABELS: Record<FundCategory, string> = {
  independent: "Independent Asset Managers",
  insurance: "Insurance-Backed Funds",
  bank: "Bank-Backed Funds",
  sacco: "SACCO-Linked Funds",
};

const CATEGORY_ICONS: Record<FundCategory, React.ElementType> = {
  independent: TrendingUp,
  insurance: Shield,
  bank: Landmark,
  sacco: Users,
};

const CATEGORY_COLORS: Record<FundCategory, string> = {
  independent: "text-amber-400",
  insurance: "text-blue-400",
  bank: "text-emerald-400",
  sacco: "text-purple-400",
};

// ─── Convert DB row to local AccountState ────────────────────────────────────

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
  const title = isMmf ? "MMF Account" : "CBK DhowCSD Account";

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

// ─── MMF Fund Card (accordion) ────────────────────────────────────────────────

function MmfFundCard({ fund }: { fund: MmfFundInfo }) {
  const [expanded, setExpanded] = useState(false);
  const CategoryIcon = CATEGORY_ICONS[fund.category];
  const categoryColor = CATEGORY_COLORS[fund.category];
  const isPrimary = fund.id === "sanlam";

  return (
    <div className={`rounded-lg border transition-all duration-200 ${
      expanded ? "border-primary/40 bg-card" : "border-border bg-card/50 hover:border-border/80"
    } ${isPrimary ? "ring-1 ring-primary/30" : ""}`}>
      {/* Header row */}
      <button
        className="w-full text-left p-4 flex items-start gap-3"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {/* Rank badge */}
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold mt-0.5 ${
          fund.rank <= 5 ? "bg-amber-400/20 text-amber-400 border border-amber-400/40" : "bg-muted text-muted-foreground border border-border"
        }`}>
          {fund.rank}
        </div>

        {/* Fund info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground leading-snug">{fund.name}</span>
            {isPrimary && (
              <Badge className="text-[10px] bg-primary/20 text-primary border-primary/30 border px-1.5 py-0">
                Your Plan Fund
              </Badge>
            )}
            {fund.rank <= 5 && !isPrimary && (
              <Badge className="text-[10px] bg-amber-400/10 text-amber-400 border-amber-400/30 border px-1.5 py-0">
                Top 5
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <CategoryIcon className={`w-3 h-3 ${categoryColor}`} />
            <span className="text-xs text-muted-foreground">{fund.company}</span>
          </div>
          {/* Key metrics row */}
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <span className="text-xs font-semibold text-emerald-400">{fund.ear} EAR</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Min {fund.minInvestment}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">Fee {fund.mgmtFee}</span>
            <span className="text-xs text-muted-foreground">·</span>
            <span className="text-xs text-muted-foreground">AUM {fund.aum}</span>
          </div>
        </div>

        {/* Expand chevron */}
        <ChevronDown className={`w-4 h-4 text-muted-foreground shrink-0 mt-1 transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
      </button>

      {/* Expanded content */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-border/50 pt-4 space-y-4">
          {/* Notes callout */}
          {fund.notes && (
            <div className="bg-primary/5 border border-primary/20 rounded-md p-3 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Note: </strong>{fund.notes}
            </div>
          )}

          {/* Two-column layout for steps + documents */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Opening steps */}
            <div>
              <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-primary" />
                Account Opening Steps
              </p>
              <ol className="space-y-2">
                {fund.openingSteps.map((step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground leading-relaxed">
                    <span className="w-4 h-4 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Documents + Contact */}
            <div className="space-y-4">
              <div>
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-primary" />
                  Required Documents
                </p>
                <ul className="space-y-1">
                  {fund.documents.map((doc, i) => (
                    <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{doc}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-primary" />
                  Contact & Links
                </p>
                <div className="space-y-1">
                  {fund.phone && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Phone className="w-3 h-3 shrink-0" /> {fund.phone}
                    </p>
                  )}
                  {fund.email && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Globe className="w-3 h-3 shrink-0" /> {fund.email}
                    </p>
                  )}
                  {fund.mpesaPaybill && fund.mpesaPaybill !== "M-Pesa app" && (
                    <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Smartphone className="w-3 h-3 shrink-0" /> M-Pesa Paybill: {fund.mpesaPaybill}
                    </p>
                  )}
                  <a
                    href={fund.portalUrl ?? fund.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors mt-1"
                  >
                    Open Account Portal <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GettingStarted() {
  const { portfolioId, mode, setMode } = usePortfolio();
  const seedSample = trpc.testMode.seedSample.useMutation({
    onSuccess: () => toast.success("Sample data loaded in Test mode. Explore freely — your live data is untouched."),
    onError: (err) => toast.error(`Could not load sample data: ${err.message}`),
  });
  const { fundName, fundLabel, fundCompany } = useSelectedFund();
  const [openDialog, setOpenDialog] = useState<"mmf" | "dhow" | null>(null);

  // Match the portfolio's selected MMF to the catalog so the walkthrough uses
  // its real website / contacts / minimum, instead of a hardcoded provider.
  const selectedFundRecord = useMemo(() => {
    if (!fundName) return undefined;
    const q = fundName.toLowerCase();
    return (
      MMF_FUNDS.find((f) => f.name.toLowerCase() === q) ??
      MMF_FUNDS.find((f) => f.name.toLowerCase().includes(q) || q.includes(f.company.toLowerCase()))
    );
  }, [fundName]);
  const providerName = fundCompany && fundCompany !== "—" ? fundCompany : (selectedFundRecord?.company ?? fundName ?? "your MMF provider");
  const providerSite = selectedFundRecord?.website;
  const providerPortal = selectedFundRecord?.portalUrl ?? selectedFundRecord?.website;
  const providerPhone = selectedFundRecord?.phone;
  const providerEmail = selectedFundRecord?.email;
  const providerMin = selectedFundRecord?.minInvestment ?? "the fund minimum";

  // Whether the active portfolio actually holds government securities. If not
  // (MMF-only or very short horizon), we hide the CBK DhowCSD walkthrough.
  const { data: projection } = trpc.projection.run.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
  const usesGovSecurities = useMemo(
    () => !!projection?.some((r) => r.tbillEnd > 0 || r.ifbEnd > 0 || r.fxdEnd > 0),
    [projection]
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<FundCategory | "all">("all");
  const [activeTab, setActiveTab] = useState<"primary" | "all-mmfs">("primary");
  const utils = trpc.useUtils();

  // Load account statuses from database
  const { data: dbStatuses = [] } = trpc.accountStatus.list.useQuery(
    { portfolioId: portfolioId! },
    { enabled: !!portfolioId }
  );
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
    if (!portfolioId) return;
    const dbType = type === "dhow" ? "dhowcsd" : "mmf";
    upsertMutation.mutate({
      portfolioId,
      accountType: dbType,
      isOpened: newState.status === "opened",
      accountNumber: newState.details.accountNumber,
      phoneNumber: newState.details.phoneNumber,
      dateOpened: newState.details.openedDate,
      notes: newState.details.notes,
    });
  }

  // Filter funds
  const filteredFunds = useMemo(() => {
    let funds = MMF_FUNDS;
    if (activeCategory !== "all") {
      funds = funds.filter((f) => f.category === activeCategory);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      funds = funds.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.company.toLowerCase().includes(q) ||
          f.category.toLowerCase().includes(q)
      );
    }
    return funds;
  }, [searchQuery, activeCategory]);

  const categories: Array<{ key: FundCategory | "all"; label: string; count: number }> = [
    { key: "all", label: "All Funds", count: MMF_FUNDS.length },
    { key: "independent", label: "Independent", count: MMF_FUNDS.filter((f) => f.category === "independent").length },
    { key: "insurance", label: "Insurance-Backed", count: MMF_FUNDS.filter((f) => f.category === "insurance").length },
    { key: "bank", label: "Bank-Backed", count: MMF_FUNDS.filter((f) => f.category === "bank").length },
  ];

  return (
    <AppShell>
      <div className="p-6 lg:p-8 space-y-8 max-w-4xl">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
            Getting Started
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Step-by-step guide to opening your investment accounts — your primary strategy accounts and all 27 CMA-regulated Kenyan MMFs.
          </p>
        </div>

        {/* Guided demo: sample data + first steps + glossary */}
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-3 border-primary/30 bg-primary/5">
            <CardContent className="p-5 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-2 mt-0.5"><Wand2 className="h-5 w-5 text-primary" /></div>
                <div>
                  <p className="text-sm font-semibold text-foreground">New here? Try it instantly with sample data</p>
                  <p className="text-xs text-muted-foreground mt-0.5 max-w-xl">
                    Load a realistic demo portfolio (two MMFs, a bank fixed deposit and government securities) into an isolated <span className="font-medium text-foreground">Test mode</span>. Your live data is never touched, and you can reset it anytime.
                  </p>
                </div>
              </div>
              <Button
                className="shrink-0"
                disabled={seedSample.isPending}
                onClick={() => {
                  if (mode !== "sandbox") setMode("sandbox");
                  seedSample.mutate();
                }}
              >
                {seedSample.isPending ? "Loading sample…" : (<>Load sample data <ArrowRight className="ml-1 h-4 w-4" /></>)}
              </Button>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" /> Your first 5 steps
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {FIRST_STEPS.map((s) => (
                <Link key={s.title} href={s.href}>
                  <div className="group h-full rounded-lg border border-border/60 bg-background/40 p-3 transition-colors hover:border-primary/50 hover:bg-primary/5 cursor-pointer flex flex-col">
                    <s.icon className="h-4 w-4 text-primary mb-2" />
                    <p className="text-sm font-medium leading-snug">{s.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 flex-1">{s.desc}</p>
                    <span className="mt-2 text-xs font-medium text-primary inline-flex items-center gap-1">
                      {s.cta} <ChevronRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                    </span>
                  </div>
                </Link>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <BookMarked className="h-4 w-4 text-amber-400" /> Terms glossary
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {GLOSSARY.map((g) => (
                <div key={g.term} className="text-xs">
                  <span className="font-semibold text-foreground">{g.term}.</span>{" "}
                  <span className="text-muted-foreground">{g.def}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setActiveTab("primary")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "primary"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Primary Strategy Accounts
          </button>
          <button
            onClick={() => setActiveTab("all-mmfs")}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
              activeTab === "all-mmfs"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            All 27 MMFs Guide
          </button>
        </div>

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB 1: Primary Strategy Accounts                                   */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "primary" && (
          <div className="space-y-8">
            {/* Account Status Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* MMF Card */}
              <Card className="relative overflow-hidden">
                <div className={`absolute top-0 left-0 w-1 h-full ${mmf.status === "opened" ? "bg-emerald-400" : mmf.status === "in_progress" ? "bg-amber-400" : "bg-muted"}`} />
                <CardContent className="p-4 pl-5">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Money Market Fund</p>
                      <p className="text-sm font-semibold text-foreground mt-0.5">{fundName || "Your Money Market Fund"}</p>
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
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setOpenDialog("mmf")}>
                      Update <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* DhowCSD Card — only when the plan uses government securities */}
              {usesGovSecurities && (
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
                    <Button variant="ghost" size="sm" className="text-xs h-7 px-2" onClick={() => setOpenDialog("dhow")}>
                      Update <ChevronRight className="w-3 h-3 ml-1" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
              )}
            </div>

            {/* Estimated time */}
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 flex gap-3">
              <AlertCircle className="w-4 h-4 text-primary shrink-0 mt-0.5" />
              <div className="text-xs text-muted-foreground leading-relaxed">
                {usesGovSecurities ? (
                  <><strong className="text-foreground">Estimated time to open both accounts:</strong> {providerName} typically takes 1–3 business days after you submit your application. CBK DhowCSD takes 3–5 business days. You can start both processes simultaneously. Once both are open, you are ready to make your first investment contribution.</>
                ) : (
                  <><strong className="text-foreground">Estimated time to open your account:</strong> {providerName} typically takes 1–3 business days after you submit your application. Once it is open, you are ready to make your first investment contribution. This plan invests through your Money Market Fund only — no CBK securities account is required.</>
                )}
              </div>
            </div>

            {/* ── SECTION 1: Primary MMF ── */}
            <div>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center shrink-0">
                  <Building2 className="w-4 h-4 text-primary-foreground" />
                </div>
                <div>
                  <h2 className="text-base font-bold text-foreground" style={{ fontFamily: "'Playfair Display', serif" }}>
                    {usesGovSecurities ? "Part 1 — " : ""}Open Your {fundName || "MMF"} Account
                  </h2>
                  <p className="text-xs text-muted-foreground">{usesGovSecurities ? "Your monthly contributions land here first before sweeping to government securities" : "Your monthly contributions are invested here"}</p>
                </div>
              </div>

              <div className="ml-4 border-l border-border pl-4">
                <Step number={1} icon={Globe} title={`Visit the ${providerName} website`} description={`Go to the ${providerName} website and navigate to the Money Market Fund section. You can also call their customer care line to request an application form.`} link={providerSite} linkLabel={providerSite ? providerSite.replace(/^https?:\/\//, "") : undefined} badge={providerSite ? "Online" : undefined} />
                <Step number={2} icon={FileText} title="Download and complete the MMF application form" description={`Fill in your personal details: full name, ID/passport number, KRA PIN, physical address, and bank account details (for redemptions). The form is available on the ${providerName} website or at any branch.`} detail="Tip: Your KRA PIN is mandatory. If you do not have one, register at itax.kra.go.ke before applying." />
                <Step number={3} icon={CreditCard} title="Prepare your KYC documents" description="You will need: (1) Copy of your National ID or Passport, (2) Copy of your KRA PIN certificate, (3) One passport-sized photo, (4) Proof of address (utility bill or bank statement not older than 3 months)." badge="Required" />
                <Step number={4} icon={FileText} title="Submit your application" description={`Submit the completed form and KYC documents by email, at a ${providerName} branch, or through their online portal. You will receive a confirmation email and your account number within 1–3 business days.`} link={providerSite} linkLabel={providerSite ? "Visit provider site" : undefined} />
                <Step number={5} icon={Smartphone} title="Make your first deposit via M-Pesa or bank transfer" description={`Once your account is activated, make your first contribution via M-Pesa (Paybill: check your welcome letter) or bank transfer. The minimum initial investment is ${providerMin}.`} detail="Your MMF starts earning interest from the day your deposit is received and confirmed. Interest accrues daily and is credited monthly." />
                <Step number={6} icon={Phone} title="Set up monthly standing order" description="Automate your monthly contributions by setting up a standing order from your bank or M-Pesa. This ensures you never miss a contribution and removes the discipline burden." detail="Recommended: set the standing order for the 1st of each month to align with your contribution schedule in this tracker." />
              </div>
            </div>

            {/* ── SECTION 2: CBK DhowCSD — only when the plan uses gov securities ── */}
            {usesGovSecurities && (
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
                <Step number={1} icon={Globe} title="Visit the CBK DhowCSD portal" description="Go to dhowcsd.centralbank.go.ke — the Central Bank of Kenya's Central Securities Depository platform. This is where you will buy and hold all your government securities (T-Bills, IFBs, and FXD bonds)." link="https://dhowcsd.centralbank.go.ke" linkLabel="dhowcsd.centralbank.go.ke" badge="Online" />
                <Step number={2} icon={FileText} title="Register for a DhowCSD account" description="Click 'Register' and fill in your personal details: full name, National ID number, KRA PIN, date of birth, phone number, and email address. You will also need to provide your bank account details for settlement." detail="Important: Use the exact name as it appears on your National ID. Mismatches will cause your application to be rejected." />
                <Step number={3} icon={CreditCard} title="Complete identity verification (KYC)" description="Upload clear scans of: (1) Your National ID (front and back), (2) Your KRA PIN certificate, (3) A selfie or passport photo. CBK will verify your identity against IPRS (Integrated Population Registration System)." badge="Required" />
                <Step number={4} icon={Building2} title="Link your bank account for settlement" description="Add your bank account (must be in your name) for receiving coupon payments and maturity proceeds. CBK supports all major Kenyan banks. Ensure your bank account name matches your ID exactly." detail="You can link an M-Pesa account as well, but a bank account is recommended for larger settlement amounts." />
                <Step number={5} icon={Shield} title="Wait for account activation (3–5 business days)" description="CBK will review your application and send you an activation email with your CDS account number (format: CDS-XXXXXXXX). Keep this number safe — you will need it for all future transactions." detail="If you do not receive your activation email within 5 business days, call CBK on 0709 081 000 or email dhowcsd@centralbank.go.ke." />
                <Step number={6} icon={Smartphone} title="Place your first T-Bill bid" description="Once activated, log in to DhowCSD and navigate to 'Primary Market'. Select the T-Bill tenor you want (91-day, 182-day, or 364-day) and enter your bid amount (minimum KES 50,000 face value). Bids are accepted every Monday for Tuesday auctions." detail="For your first purchase, use the 91-day T-Bill to get comfortable with the process. The minimum competitive bid is KES 50,000 face value." badge="First purchase" />
                <Step number={7} icon={BookOpen} title="Log your purchase in the CBK Securities Register" description="After your bid is accepted, go to the CBK Securities page in this tracker and log your purchase with the face value, issue date, maturity date, and coupon rate. The tracker will automatically calculate your next coupon date and maturity event." />
              </div>
            </div>
            )}

            {/* Key contacts */}
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
                    <p className="font-semibold text-foreground">{providerName}</p>
                    {providerPhone && <p className="text-muted-foreground">Phone: {providerPhone}</p>}
                    {providerEmail && <p className="text-muted-foreground">Email: {providerEmail}</p>}
                    {providerSite && (
                      <a href={providerSite} target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                        {providerSite.replace(/^https?:\/\//, "")} <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {!providerPhone && !providerEmail && !providerSite && (
                      <p className="text-muted-foreground">Contact details are available on your fund's welcome letter.</p>
                    )}
                  </div>
                  {usesGovSecurities && (
                  <div className="space-y-1">
                    <p className="font-semibold text-foreground">CBK DhowCSD Support</p>
                    <p className="text-muted-foreground">Phone: 0709 081 000</p>
                    <p className="text-muted-foreground">Email: dhowcsd@centralbank.go.ke</p>
                    <a href="https://dhowcsd.centralbank.go.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 flex items-center gap-1">
                      dhowcsd.centralbank.go.ke <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ═══════════════════════════════════════════════════════════════════ */}
        {/* TAB 2: All 27 MMFs Guide                                           */}
        {/* ═══════════════════════════════════════════════════════════════════ */}
        {activeTab === "all-mmfs" && (
          <div className="space-y-6">
            {/* Intro */}
            <div className="bg-muted/40 border border-border rounded-lg p-4 text-xs text-muted-foreground leading-relaxed space-y-1.5">
              <p>
                <strong className="text-foreground">27 CMA-regulated Money Market Funds</strong> are tracked below, ranked by Effective Annual Rate (EAR) as of June 2026 (source: Serrari Group). Each entry includes account-opening steps, required documents, minimum investment, and contact details.
              </p>
              <p>
                Rates change frequently — always verify the current EAR on{" "}
                <a href="https://serrarigroup.com/ke/mmf/" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5">
                  Serrari Group <ExternalLink className="w-3 h-3" />
                </a>{" "}
                before opening an account. All funds require a KRA PIN — register at{" "}
                <a href="https://itax.kra.go.ke" target="_blank" rel="noopener noreferrer" className="text-primary hover:text-primary/80 inline-flex items-center gap-0.5">
                  itax.kra.go.ke <ExternalLink className="w-3 h-3" />
                </a>{" "}
                if you do not have one.
              </p>
            </div>

            {/* Category summary cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {(["independent", "insurance", "bank"] as FundCategory[]).map((cat) => {
                const Icon = CATEGORY_ICONS[cat];
                const color = CATEGORY_COLORS[cat];
                const count = MMF_FUNDS.filter((f) => f.category === cat).length;
                const topEar = Math.max(...MMF_FUNDS.filter((f) => f.category === cat).map((f) => parseFloat(f.ear)));
                return (
                  <button
                    key={cat}
                    onClick={() => setActiveCategory(activeCategory === cat ? "all" : cat)}
                    className={`rounded-lg border p-3 text-left transition-all ${
                      activeCategory === cat
                        ? "border-primary/50 bg-primary/5"
                        : "border-border bg-card/50 hover:border-border/80"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${color} mb-1.5`} />
                    <p className="text-xs font-semibold text-foreground">{CATEGORY_LABELS[cat]}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{count} funds · up to {topEar.toFixed(2)}%</p>
                  </button>
                );
              })}
              <button
                onClick={() => setActiveCategory("all")}
                className={`rounded-lg border p-3 text-left transition-all ${
                  activeCategory === "all"
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-card/50 hover:border-border/80"
                }`}
              >
                <Star className="w-4 h-4 text-amber-400 mb-1.5" />
                <p className="text-xs font-semibold text-foreground">All Funds</p>
                <p className="text-xs text-muted-foreground mt-0.5">27 funds · avg 8.98%</p>
              </button>
            </div>

            {/* Search + filter bar */}
            <div className="flex gap-3 items-center">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by fund name or company..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-sm"
                />
              </div>
              {(searchQuery || activeCategory !== "all") && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs shrink-0"
                  onClick={() => { setSearchQuery(""); setActiveCategory("all"); }}
                >
                  Clear
                </Button>
              )}
            </div>

            {/* Results count */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {filteredFunds.length === MMF_FUNDS.length
                  ? `Showing all ${MMF_FUNDS.length} funds`
                  : `Showing ${filteredFunds.length} of ${MMF_FUNDS.length} funds`}
                {activeCategory !== "all" && ` · ${CATEGORY_LABELS[activeCategory as FundCategory]}`}
              </p>
              <a
                href="https://serrarigroup.com/ke/mmf/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary hover:text-primary/80 flex items-center gap-1"
              >
                Live rates on Serrari <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {/* Fund accordion list */}
            <div className="space-y-2">
              {filteredFunds.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground text-sm">
                  No funds match your search. Try a different name or company.
                </div>
              ) : (
                filteredFunds.map((fund) => (
                  <MmfFundCard key={fund.id} fund={fund} />
                ))
              )}
            </div>

            {/* Disclaimer */}
            <div className="bg-muted/30 border border-border/50 rounded-lg p-4 text-xs text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Disclaimer:</strong> The account-opening steps, contact details, and minimum investment figures above are based on publicly available information as of June 2026. Fund details change — always verify directly with the fund manager before investing. This is not financial advice. All investments carry risk and past performance does not guarantee future returns. All funds listed are regulated by the Capital Markets Authority (CMA) of Kenya.
            </div>
          </div>
        )}
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
