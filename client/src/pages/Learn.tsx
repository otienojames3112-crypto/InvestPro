import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { GraduationCap, ArrowLeft, BookOpen, Coins, Landmark, TrendingUp, Percent, Layers, Search } from "lucide-react";
import { GLOSSARY } from "@/lib/glossary";
import {
  tbillPrice,
  zeroCouponPrice,
  grossDiscount,
  whtOnDiscount,
  maturityProceeds,
  netDiscountGain,
  DISCOUNT_WHT_PCT,
} from "@shared/discount";

/** Local KES formatter so the page is self-contained and deterministic. */
function kes(n: number): string {
  return "KES " + Math.round(n).toLocaleString("en-KE");
}
function kes2(n: number): string {
  return "KES " + n.toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A single labelled figure in a worked-example breakdown. */
function Figure({ label, value, accent }: { label: string; value: string; accent?: "good" | "tax" | "muted" }) {
  const tone =
    accent === "good"
      ? "text-emerald-400"
      : accent === "tax"
        ? "text-amber-400"
        : accent === "muted"
          ? "text-muted-foreground"
          : "text-foreground";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-border/30 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

/** Card wrapper for one worked story. */
function Story({
  icon: Icon,
  name,
  kind,
  taxNote,
  children,
}: {
  icon: React.ElementType;
  name: string;
  kind: string;
  taxNote: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <Icon className="w-4.5 h-4.5 text-primary" />
            </div>
            <div>
              <CardTitle className="text-base">{name}</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">{kind}</p>
            </div>
          </div>
          <Badge variant="outline" className="text-[10px] shrink-0">{taxNote}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  );
}

export default function Learn() {
  const [glossaryQuery, setGlossaryQuery] = useState("");

  // ── Worked examples — all numbers computed live from the shared engines, so
  // they can never drift from the unit tests that lock the same figures.

  // 1) Wanjiku — 91-day T-bill, 100,000 face, 15% discount rate.
  const w = useMemo(() => {
    const face = 100_000, rate = 15, days = 91;
    const price = tbillPrice(face, rate, days);
    return {
      face, rate, days, price,
      discount: grossDiscount(face, price),
      wht: whtOnDiscount(face, price, DISCOUNT_WHT_PCT),
      proceeds: maturityProceeds(face, price, DISCOUNT_WHT_PCT),
      net: netDiscountGain(face, price, DISCOUNT_WHT_PCT),
    };
  }, []);

  // 2) Juma — FXD coupon bond, 100,000 face, 13.2% gross coupon, semi-annual, 15% WHT.
  const j = useMemo(() => {
    const face = 100_000, coupon = 13.2, wht = 15;
    const annualGross = face * (coupon / 100);
    const annualNet = annualGross * (1 - wht / 100);
    return {
      face, coupon, wht,
      semiGross: annualGross / 2,
      semiNet: annualNet / 2,
      annualGross, annualNet,
    };
  }, []);

  // 3) Otieno — IFB coupon bond, 100,000 face, 12.5% gross coupon, tax-exempt.
  const o = useMemo(() => {
    const face = 100_000, coupon = 12.5;
    const annualGross = face * (coupon / 100);
    return { face, coupon, annualGross, annualNet: annualGross, semi: annualGross / 2 };
  }, []);

  // 4) Amina — 5-year zero-coupon bond, 100,000 face, ~11.84% so price ≈ 57,000.
  const a = useMemo(() => {
    const face = 100_000, rate = 11.84, years = 5;
    const price = zeroCouponPrice(face, rate, years);
    return {
      face, rate, years, price,
      discount: grossDiscount(face, price),
      wht: whtOnDiscount(face, price, DISCOUNT_WHT_PCT),
      proceeds: maturityProceeds(face, price, DISCOUNT_WHT_PCT),
      net: netDiscountGain(face, price, DISCOUNT_WHT_PCT),
    };
  }, []);

  // 5) Chalo — floating-rate bond, 100,000 face, benchmark 91-day T-bill + 1.5% margin.
  const c = useMemo(() => {
    const face = 100_000, benchmark = 9.5, margin = 1.5, wht = 15;
    const r1 = benchmark + margin; // first reset
    const benchmark2 = 11.0, r2 = benchmark2 + margin; // after a reset upward
    const coupon1Gross = face * (r1 / 100);
    const coupon2Gross = face * (r2 / 100);
    return {
      face, benchmark, margin, wht, r1, r2, benchmark2,
      coupon1Gross, coupon1Net: coupon1Gross * (1 - wht / 100),
      coupon2Gross, coupon2Net: coupon2Gross * (1 - wht / 100),
    };
  }, []);

  const filteredGlossary = useMemo(() => {
    const q = glossaryQuery.trim().toLowerCase();
    if (!q) return GLOSSARY;
    return GLOSSARY.filter(
      (g) => g.term.toLowerCase().includes(q) || g.def.toLowerCase().includes(q)
    );
  }, [glossaryQuery]);

  return (
    <AppShell>
      <div className="max-w-5xl space-y-8 px-4 py-8 md:px-8">
        {/* Back link */}
        <Link href="/getting-started">
          <div className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground cursor-pointer transition-colors">
            <ArrowLeft className="w-4 h-4" /> Back to Getting Started
          </div>
        </Link>

        {/* Header */}
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <GraduationCap className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold" style={{ fontFamily: "'Playfair Display', serif" }}>
              Learn the Basics
            </h1>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm leading-relaxed">
              How Kenyan fixed-income instruments actually pay you — told as five short stories,
              with every figure calculated by the same engine the tracker uses. The big idea:
              some instruments pay you a <strong className="text-foreground">coupon</strong> along
              the way, while others give you their whole return as a{" "}
              <strong className="text-foreground">discount</strong> (you pay less than face value
              and are repaid the full face at maturity).
            </p>
          </div>
        </div>

        {/* Two big families explainer */}
        <div className="grid gap-4 md:grid-cols-2">
          <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Coins className="w-4 h-4 text-emerald-400" /> Discount instruments
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">T-bills</strong> and{" "}
              <strong className="text-foreground">zero-coupon bonds</strong>. You pay{" "}
              <em>below</em> face value, receive nothing in between, and are repaid the full face
              at maturity. The gap — the <strong className="text-foreground">discount</strong> — is
              your entire return. Withholding tax (15%) is charged on the discount only, never on
              the full face value.
            </CardContent>
          </Card>
          <Card className="border-sky-500/20 bg-sky-500/[0.03]">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Landmark className="w-4 h-4 text-sky-400" /> Coupon bonds
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground leading-relaxed">
              <strong className="text-foreground">FXD</strong>,{" "}
              <strong className="text-foreground">IFB</strong> and{" "}
              <strong className="text-foreground">floating-rate</strong> bonds. You pay (roughly)
              face value and the bond pays you a <strong className="text-foreground">coupon</strong>{" "}
              twice a year, returning the principal at maturity. FXD coupons are taxed; IFB coupons
              are tax-exempt; a floating coupon resets to a benchmark rate plus a margin.
            </CardContent>
          </Card>
        </div>

        {/* Worked stories */}
        <div>
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> Five worked stories
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Each uses a KES 100,000 face value so you can compare them directly.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            {/* 1 — Wanjiku T-bill */}
            <Story icon={Coins} name="Wanjiku buys a 91-day T-bill" kind="Discount instrument · 91 days · 15%" taxNote="15% WHT on discount">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Wanjiku wants a safe home for cash she needs in three months. She buys a 91-day
                T-bill with a <strong className="text-foreground">{kes(w.face)}</strong> face value
                at a {w.rate}% discount rate. She does <em>not</em> pay {kes(w.face)} — she pays the
                discounted price now and receives the full {kes(w.face)} in 91 days.
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <Figure label="Face value (repaid at maturity)" value={kes(w.face)} />
                <Figure label="Purchase price (paid up front)" value={kes2(w.price)} accent="muted" />
                <Figure label="Discount = her gross return" value={kes2(w.discount)} accent="good" />
                <Figure label="WHT (15% of the discount only)" value={kes2(w.wht)} accent="tax" />
                <Figure label="Cash received at maturity" value={kes2(w.proceeds)} />
                <Figure label="Net gain after tax" value={kes2(w.net)} accent="good" />
              </div>
              <p className="text-xs text-muted-foreground">
                Note the tax is {kes2(w.wht)} — 15% of the {kes2(w.discount)} discount, <em>not</em>{" "}
                15% of the {kes(w.face)} face value. That distinction is the whole point.
              </p>
            </Story>

            {/* 2 — Juma FXD */}
            <Story icon={Landmark} name="Juma buys an FXD bond" kind="Coupon bond · fixed · semi-annual" taxNote="15% WHT on coupon">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Juma wants a steady income. He buys a Fixed-Coupon Treasury Bond (FXD) with a{" "}
                <strong className="text-foreground">{kes(j.face)}</strong> face value paying a{" "}
                {j.coupon}% gross coupon. Unlike Wanjiku, he pays about face value and the bond{" "}
                <em>pays him</em> twice a year.
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <Figure label="Face value (paid at par)" value={kes(j.face)} />
                <Figure label="Gross coupon per year" value={kes(j.annualGross)} />
                <Figure label="Each semi-annual coupon (gross)" value={kes(j.semiGross)} accent="muted" />
                <Figure label="WHT on each coupon (15%)" value={kes(j.semiGross * 0.15)} accent="tax" />
                <Figure label="Each semi-annual coupon (net)" value={kes(j.semiNet)} accent="good" />
                <Figure label="Net coupon income per year" value={kes(j.annualNet)} accent="good" />
              </div>
              <p className="text-xs text-muted-foreground">
                The coupon is the return here — there is no discount. WHT is taken from each coupon
                as it is paid.
              </p>
            </Story>

            {/* 3 — Otieno IFB */}
            <Story icon={TrendingUp} name="Otieno buys an IFB bond" kind="Coupon bond · infrastructure · tax-exempt" taxNote="Tax-exempt">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Otieno notices that an Infrastructure Bond (IFB) pays a {o.coupon}% coupon that is{" "}
                <strong className="text-foreground">completely tax-exempt</strong>. Even at a slightly
                lower headline rate than an FXD, he keeps every shilling of the coupon.
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <Figure label="Face value (paid at par)" value={kes(o.face)} />
                <Figure label="Gross coupon per year" value={kes(o.annualGross)} />
                <Figure label="Each semi-annual coupon" value={kes(o.semi)} accent="muted" />
                <Figure label="WHT" value="KES 0 (exempt)" accent="good" />
                <Figure label="Net coupon income per year" value={kes(o.annualNet)} accent="good" />
              </div>
              <p className="text-xs text-muted-foreground">
                Because there is no tax drag, an IFB's net yield can beat a higher-coupon FXD. This is
                why the tracker compares instruments on net-of-tax yield, not the headline rate.
              </p>
            </Story>

            {/* 4 — Amina zero-coupon */}
            <Story icon={Layers} name="Amina buys a 5-year zero-coupon bond" kind="Discount instrument · 5 years · compounded" taxNote="15% WHT on discount">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Amina is saving for a goal five years away and does not need income now. A zero-coupon
                bond pays no coupons at all — like a long T-bill, she buys it well below face value and
                is repaid the full <strong className="text-foreground">{kes(a.face)}</strong> in five
                years. Because the gap is large over years, the price uses compounding.
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <Figure label="Face value (repaid in 5 years)" value={kes(a.face)} />
                <Figure label={`Purchase price now (~${a.rate}%, compounded)`} value={kes(a.price)} accent="muted" />
                <Figure label="Discount = her gross return" value={kes(a.discount)} accent="good" />
                <Figure label="WHT (15% of the discount)" value={kes(a.wht)} accent="tax" />
                <Figure label="Cash received at maturity" value={kes(a.proceeds)} />
                <Figure label="Net gain after tax" value={kes(a.net)} accent="good" />
              </div>
              <p className="text-xs text-muted-foreground">
                Same discount idea as a T-bill, but priced with compound interest over five years
                instead of simple interest over a few months.
              </p>
            </Story>

            {/* 5 — Chalo floating-rate */}
            <Story icon={Percent} name="Chalo buys a floating-rate bond" kind="Coupon bond · resets to benchmark + margin" taxNote="15% WHT on coupon">
              <p className="text-sm text-muted-foreground leading-relaxed">
                Chalo expects interest rates to rise and does not want to be locked into a fixed
                coupon. A floating-rate bond's coupon <strong className="text-foreground">resets</strong>{" "}
                periodically to a benchmark (the 91-day T-bill rate) plus a fixed{" "}
                <strong className="text-foreground">{c.margin}%</strong> margin. When the benchmark
                rises, his next coupon rises with it.
              </p>
              <div className="rounded-lg bg-muted/30 p-3">
                <Figure label="Face value" value={kes(c.face)} />
                <Figure label={`First period: benchmark ${c.benchmark}% + ${c.margin}% margin`} value={`${c.r1.toFixed(1)}%`} accent="muted" />
                <Figure label="First coupon (gross / net)" value={`${kes(c.coupon1Gross)} / ${kes(c.coupon1Net)}`} />
                <Figure label={`After reset: benchmark ${c.benchmark2}% + ${c.margin}% margin`} value={`${c.r2.toFixed(1)}%`} accent="muted" />
                <Figure label="Next coupon (gross / net)" value={`${kes(c.coupon2Gross)} / ${kes(c.coupon2Net)}`} accent="good" />
              </div>
              <p className="text-xs text-muted-foreground">
                The margin stays fixed; only the benchmark moves at each reset. Coupons are taxed like
                an FXD (15% WHT).
              </p>
            </Story>
          </div>
        </div>

        {/* Glossary */}
        <div>
          <h2 className="text-lg font-bold mb-1 flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-primary" /> Full glossary
          </h2>
          <p className="text-sm text-muted-foreground mb-3">
            Every term the tracker uses, in plain language. The same definitions power the hover
            tooltips across the app.
          </p>
          <div className="relative mb-4 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search terms…"
              value={glossaryQuery}
              onChange={(e) => setGlossaryQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          {filteredGlossary.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No terms match “{glossaryQuery}”.
            </p>
          ) : (
            <Accordion type="multiple" className="w-full">
              {filteredGlossary.map((g) => (
                <AccordionItem key={g.id} value={g.id}>
                  <AccordionTrigger className="text-sm font-semibold text-left">{g.term}</AccordionTrigger>
                  <AccordionContent className="text-sm text-muted-foreground leading-relaxed">
                    {g.def}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </div>
    </AppShell>
  );
}
