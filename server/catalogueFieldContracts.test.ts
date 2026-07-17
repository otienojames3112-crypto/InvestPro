/**
 * Catalogue field contract — Slice 8a (foundation only, 2026-07-16), amended before
 * approval to add the global source-provenance rule (every catalogue row must carry
 * an openable source link + as-of date, even where a per-category desired list
 * happened to omit it — see shared/catalogueFieldContracts.ts's file header).
 *
 * Amended a second time during Slice 8b's pre-approval compatibility check
 * (2026-07-16): MMF gained a 14th field, "Management fee" (key: managementFee).
 * It was missing from the original 13-field product list, but mmf_funds.
 * managementFee is NOT NULL, CATALOGUE_FIELD_RULES.mmf has required
 * figures.managementFee at the approval gate since before this initiative, and
 * buildPromotionPlan writes it straight into the column — Slice 8b's
 * contract-based figures projection would otherwise have silently dropped a
 * genuinely-extracted, gate-required value the first time it wired the MMF
 * contract into the actual draft path.
 *
 * Amended a third time during Slice 8c's pre-approval compatibility check
 * (2026-07-16): Bank gained a 13th field, "Negotiable" (key: isNegotiable) —
 * same class of gap as MMF's managementFee (bank_instruments.isNegotiable is
 * NOT NULL, CATALOGUE_FIELD_RULES.bank requires figures.isNegotiable
 * non-escapably, and the extraction schema's `negotiable` field is required).
 * Also renamed two existing Bank contract KEYS (display labels unchanged):
 * "interestRate" → "indicativeRate" and "minimumDeposit" → "minAmount" —
 * neither original key was recognised by figurePresent's alias table or
 * buildPromotionPlan's bank branch, so submitting figures under them would
 * have silently failed the approval gate even with a real value present.
 *
 * Amended a fourth time during Slice 8d's pre-approval compatibility check
 * (2026-07-16): CBK grew from 10 to 15 fields. Two existing KEYS renamed
 * (display labels unchanged): "indicativeYield" → "yieldPct" (same failure
 * mode as Bank's renames — neither figurePresent's alias table nor
 * buildPromotionPlan's f.yieldPct read recognised the original key), and
 * "taxTreatment" → "whtRule" (the gate's whtRule and taxExempt rules are TWO
 * SEPARATE, independently-checked figures keys — applyCbkRuleFill sets them
 * as genuinely distinct values — so one combined field could never satisfy
 * both; the free-text WHT-rule description now covers "Tax treatment", and
 * the boolean-ish flag is split into its own new field). Five new fields
 * added: "Tax-exempt flag" (taxExempt — the split-out half of the above, ALSO
 * the target of an infrastructure-bond-specific value assertion in the gate),
 * "Issue number" / "Coupon rate" (issueNumber/couponRate — hard-required by
 * CBK_SUBTYPE_FIELD_RULES.fxd/ifb once an FXD/IFB is confidently detected,
 * which is the normal case for a real bond finding, not an edge case), and
 * "Auction date" / "Value / settlement date" (auctionDate/valueDate —
 * hard-required by CBK_SUBTYPE_FIELD_RULES.tbill once a T-bill is detected).
 * All five are genuinely extracted by the LLM schemas and have real homes in
 * extendedFields.CbkSecurityProfile; omitting them would have silently failed
 * the approval gate for essentially every real CBK finding once contract-
 * projected figures replaced raw passthrough.
 *
 * Amended a fifth time during Slice 8e-1's pre-approval compatibility check
 * (2026-07-16): Market asset Equity had three KEYS renamed (display labels
 * unchanged, field count unchanged at 13): "currentPrice" → "lastPrice",
 * "dividendYield" → "yieldPct" (buildPromotionPlan reads f.yieldPct only, even
 * though the gate's own lastPrice-rule alias table tolerated "dividendYield"
 * — a gate pass was not proof of promotion compatibility), and "exchange" →
 * "market" (same gate-tolerates-but-promotion-drops trap).
 *
 * Amended a sixth time during Slice 8e-2's pre-approval compatibility check
 * (2026-07-16): Market asset REIT grew from 12 to 13 fields and introduced a
 * NEW mechanism, `alsoWriteKeys`, on `CatalogueFieldContractEntry` — the first
 * case where one value genuinely needs two DIFFERENT downstream keys at once
 * (MARKET_ASSET_SUBTYPE_FIELD_RULES.reit's own gate rule strictly checks the
 * literal key `distributionYield`, with no fallback, while buildPromotionPlan
 * only reads `yieldPct`/`yield`/`coupon` for the promoted column — no single
 * key could satisfy both). `distributionYield` kept its canonical key and
 * gained `alsoWriteKeys: ["yieldPct"]`, duplicating the same found value onto
 * both, confined entirely to the projector — no researchPipeline.ts change.
 * Also: "currentPrice" renamed to "lastPrice" (same class as Equity's rename),
 * and a genuinely missing field, "Exchange" (key: market), was added — omitted
 * from the original 12-field product list, but CATALOGUE_FIELD_RULES.market_asset
 * hard-requires figures.market for EVERY market-asset subtype, proven directly
 * via a live checkApprovalGate call that still reported "market" missing with
 * every other REIT field supplied.
 *
 * Amended a seventh time during Slice 8e-3's pre-approval compatibility check
 * (2026-07-16): Market asset Offshore fund grew from 12 to 13 fields. Two KEYS
 * renamed (display labels unchanged): "fees" → "expenseRatioPct" (the offshore
 * subtype gate's own rule checks figures.expenseRatioPct specifically —
 * figurePresent's alias table for it is ['expenseRatioPct', 'fee'], 'fees'
 * plural was never in it — and buildPromotionPlan's fallback chain didn't
 * recognise 'fees' either), and "annualizedReturn" → "trailingReturnPct"
 * (buildPromotionPlan has a DEDICATED trailingReturnPct payload field,
 * separate from lastPrice — this one rename happened to ALSO satisfy the base
 * gate's lastPrice OR-requirement via its existing alias tolerance, so no
 * alsoWriteKeys was needed here, unlike REIT's distributionYield). A
 * genuinely missing field, "Market" (key: market — labeled differently from
 * Equity/REIT's "Exchange" since an offshore fund isn't exchange-listed), was
 * added — proven via the same live-gate-call method as REIT's fix.
 *
 * Amended an eighth time during Slice 8e-4's pre-approval compatibility check
 * (2026-07-16): Market asset SACCO — the LAST market-asset subtype — grew from
 * 11 to 12 fields. SACCO uses a full REPLACEMENT gate
 * (SACCO_MARKET_ASSET_FIELD_RULES / SACCO_FIELD_ALIASES), not the baseline
 * CATALOGUE_FIELD_RULES.market_asset (confirmed by reading checkApprovalGate
 * directly: the SACCO branch returns early, never reaching the baseline
 * market/lastPrice loop) — so no "Market" field was needed here, unlike
 * Equity/REIT/Offshore fund. Three KEYS renamed (display labels unchanged),
 * each confirmed via a live checkApprovalGate call that failed exactly as
 * predicted: "lockInWithdrawalRule" → "withdrawalTerms" (only coincidentally
 * masked when the separate liquidity field also had a value),
 * "minContribution" → "minimumMonthlyDeposit", and "riskProtectionNote" →
 * "regulatoryStatus". A genuinely missing field, "Minimum share capital" (key:
 * minimumShareCapital), was added — SACCO_MARKET_ASSET_FIELD_RULES requires it
 * as its OWN distinct figure, separate from minimumMonthlyDeposit (a real
 * SACCO needs both a one-time share-capital buy-in and ongoing monthly
 * deposits). A NEW kind of fix (not a contract field at all):
 * projectFindingToContractFigures now stamps figures.assetType = "sacco" onto
 * every SACCO projection — detectMarketAssetSacco()'s primary detection
 * signal, which raw passthrough always carried but no SACCO product field
 * maps to (it isn't something a manager edits); omitting it would have
 * downgraded detection reliability from "always works" to "depends on
 * fallback heuristics."
 *
 * Pure tests for shared/catalogueFieldContracts.ts. This slice is documentation +
 * data only: nothing here touches the DB, Ask AI, the approval gate, the Review
 * Queue, or any catalogue UI. The guardrail tests at the bottom of this file exist
 * specifically to catch a future slice accidentally wiring this contract in before
 * it's meant to (or this slice quietly changing runtime behavior it shouldn't).
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  CATALOGUE_FIELD_CONTRACTS,
  UNSUPPORTED_MARKET_ASSET_SUBTYPES,
  getCatalogueFieldContract,
  type CatalogueFieldContract,
  type CatalogueFieldContractEntry,
} from "../shared/catalogueFieldContracts";

/** The desired field labels, taken verbatim from the approved product requirement
 *  (the file header's one normalization: "Occupancy rate, if available" → label
 *  "Occupancy rate", optionality captured via `required: false` instead), PLUS the
 *  global source-provenance additions from the pre-approval amendment: every base
 *  CATALOGUE_FIELD_RULES set already requires BOTH `source` and `asOf`, so this
 *  contract adds whichever of "Source link" / "Source as-of date" a catalogue's
 *  original product list omitted — "Source link" for cbk/equity/reit/
 *  offshore_fund/sacco, and "Source as-of date" for cbk AND mmf (mmf's list named
 *  only "Source link"). Bank already had complete source coverage and is
 *  unchanged. */
const DESIRED_LABELS: Record<string, string[]> = {
  mmf: [
    "Fund name",
    "Fund manager",
    "EAR",
    "Management fee",
    "Daily yield",
    "Gross yield",
    "Net yield",
    "WHT",
    "Minimum investment",
    "Withdrawal period",
    "AUM",
    "Risk profile",
    "Source link",
    "Source as-of date",
  ],
  bank: [
    "Bank name",
    "Product name",
    "Product type",
    "Interest rate",
    "Net return after WHT",
    "Negotiable",
    "Minimum deposit",
    "Tenor / lock-in period",
    "Early withdrawal rule",
    "Fees / charges",
    "Access speed",
    "Source",
    "Source as-of date",
  ],
  cbk: [
    "Security type",
    "Issue number",
    "Tenor",
    "Application deadline",
    "Auction date",
    "Value / settlement date",
    "Indicative / previous yield",
    "Coupon rate",
    "Net yield after WHT",
    "Tax treatment",
    "Tax-exempt flag",
    "Minimum investment",
    "Maturity date",
    "Source link",
    "Source as-of date",
  ],
  equity: [
    "Company name",
    "Ticker / symbol",
    "Exchange",
    "Current price",
    "Dividend yield",
    "Recent dividend",
    "Price change",
    "Market sector",
    "Minimum buy amount or board lot",
    "Liquidity / trading activity",
    "Risk level",
    "Source link",
    "Source as-of date",
  ],
  reit: [
    "REIT name",
    "REIT type",
    "Exchange",
    "Current price / unit price",
    "Distribution yield",
    "Recent distribution",
    "Net asset value / NAV",
    "Occupancy rate",
    "Minimum investment",
    "Liquidity / tradability",
    "Risk level",
    "Source link",
    "Source as-of date",
  ],
  offshore_fund: [
    "Fund name",
    "Fund manager / provider",
    "Currency",
    "Market",
    "Fund type",
    "Annualized return / performance",
    "Minimum investment",
    "Fees",
    "Withdrawal period",
    "FX risk note",
    "Risk level",
    "Source link",
    "Source as-of date",
  ],
  sacco: [
    "SACCO name",
    "Product type",
    "Dividend rate / interest rate",
    "Minimum share capital",
    "Minimum contribution",
    "Membership requirement",
    "Lock-in or withdrawal rule",
    "Fees / charges",
    "Liquidity",
    "Risk / protection note",
    "Source link",
    "Source as-of date",
  ],
};

function contractIdOf(c: CatalogueFieldContract): string {
  return c.subtype ?? c.catalogue;
}

describe("Catalogue field contract · every catalogue/subtype has a contract", () => {
  it("exactly 7 active contracts exist: mmf, bank, cbk, and 4 market_asset subtypes", () => {
    expect(CATALOGUE_FIELD_CONTRACTS.length).toBe(7);
    const ids = CATALOGUE_FIELD_CONTRACTS.map(contractIdOf).sort();
    expect(ids).toEqual(["bank", "cbk", "equity", "mmf", "offshore_fund", "reit", "sacco"].sort());
  });

  it("getCatalogueFieldContract resolves mmf/bank/cbk directly (no subtype needed)", () => {
    expect(getCatalogueFieldContract("mmf")?.label).toBe("MMF");
    expect(getCatalogueFieldContract("bank")?.label).toBe("Bank products");
    expect(getCatalogueFieldContract("cbk")?.label).toBe("CBK securities");
  });

  it("getCatalogueFieldContract resolves each market_asset subtype", () => {
    expect(getCatalogueFieldContract("market_asset", "equity")?.label).toBe("Market assets — Equity");
    expect(getCatalogueFieldContract("market_asset", "reit")?.label).toBe("Market assets — REIT");
    expect(getCatalogueFieldContract("market_asset", "offshore_fund")?.label).toBe("Market assets — Offshore fund");
    expect(getCatalogueFieldContract("market_asset", "sacco")?.label).toBe("Market assets — SACCO");
  });

  it("getCatalogueFieldContract returns null for market_asset with no subtype — never guesses", () => {
    expect(getCatalogueFieldContract("market_asset")).toBeNull();
  });
});

describe("Catalogue field contract · every desired field appears exactly once", () => {
  for (const [id, labels] of Object.entries(DESIRED_LABELS)) {
    it(`${id}: contract field labels match the desired list exactly (same set, no dupes, none missing, none extra)`, () => {
      const contract = CATALOGUE_FIELD_CONTRACTS.find((c) => contractIdOf(c) === id);
      expect(contract).toBeDefined();
      const actualLabels = contract!.fields.map((f) => f.label);
      expect(actualLabels.length).toBe(labels.length);
      expect(new Set(actualLabels).size).toBe(labels.length); // no duplicate labels
      expect([...actualLabels].sort()).toEqual([...labels].sort());
    });
  }
});

describe("Catalogue field contract · market-asset subtypes are distinct contracts", () => {
  it("equity, REIT, offshore fund, and SACCO are four SEPARATE contracts, not one shared list", () => {
    const marketAssetContracts = CATALOGUE_FIELD_CONTRACTS.filter((c) => c.catalogue === "market_asset");
    expect(marketAssetContracts.length).toBe(4);
    const subtypes = marketAssetContracts.map((c) => c.subtype).sort();
    expect(subtypes).toEqual(["equity", "offshore_fund", "reit", "sacco"].sort());
    // Each contract's own field array is a genuinely distinct object, not a shared reference.
    const fieldArrays = new Set(marketAssetContracts.map((c) => c.fields));
    expect(fieldArrays.size).toBe(4);
  });
});

describe("Catalogue field contract · ETF/property/pension/other are NOT active contracts", () => {
  it("UNSUPPORTED_MARKET_ASSET_SUBTYPES lists exactly etf/property/pension/other", () => {
    expect([...UNSUPPORTED_MARKET_ASSET_SUBTYPES].sort()).toEqual(["etf", "other", "pension", "property"].sort());
  });

  it("none of the unsupported subtypes appear as a `subtype` on any active contract", () => {
    const activeSubtypes = new Set(
      CATALOGUE_FIELD_CONTRACTS.map((c) => c.subtype).filter((s): s is string => s !== undefined),
    );
    for (const unsupported of UNSUPPORTED_MARKET_ASSET_SUBTYPES) {
      expect(activeSubtypes.has(unsupported)).toBe(false);
    }
  });

  it("no field label anywhere mentions ETF/property/pension/other-as-an-instrument-type", () => {
    const allLabels = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields.map((f) => f.label));
    expect(allLabels.some((l) => /\bETF\b|\bproperty\b|\bpension\b/i.test(l))).toBe(false);
  });
});

describe("Catalogue field contract · every field has required metadata", () => {
  const allFields: CatalogueFieldContractEntry[] = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields);

  it("every field has a non-empty key and label", () => {
    for (const f of allFields) {
      expect(typeof f.key).toBe("string");
      expect(f.key.trim().length).toBeGreaterThan(0);
      expect(typeof f.label).toBe("string");
      expect(f.label.trim().length).toBeGreaterThan(0);
    }
  });

  it("every field has a boolean `required` flag", () => {
    for (const f of allFields) expect(typeof f.required).toBe("boolean");
  });

  it("every field has a valid storageStatus", () => {
    const valid = new Set(["column", "extendedFields", "computed", "sourceOnly", "missingRequiresMigration"]);
    for (const f of allFields) expect(valid.has(f.storageStatus)).toBe(true);
  });

  it("every field has a boolean managerEditable flag", () => {
    for (const f of allFields) expect(typeof f.managerEditable).toBe("boolean");
  });

  it("every field has a boolean showInTable (display) flag", () => {
    for (const f of allFields) expect(typeof f.showInTable).toBe("boolean");
  });

  it("every field has a boolean promoteToCatalogueRow flag", () => {
    for (const f of allFields) expect(typeof f.promoteToCatalogueRow).toBe("boolean");
  });

  it("every field has an aliases array (possibly empty, never undefined)", () => {
    for (const f of allFields) expect(Array.isArray(f.aliases)).toBe(true);
  });

  it("every field's catalogue/subtype matches the contract it lives in", () => {
    for (const c of CATALOGUE_FIELD_CONTRACTS) {
      for (const f of c.fields) {
        expect(f.catalogue).toBe(c.catalogue);
        expect(f.subtype).toBe(c.subtype);
      }
    }
  });
});

describe("Catalogue field contract · no duplicate canonical keys within one contract", () => {
  for (const c of CATALOGUE_FIELD_CONTRACTS) {
    it(`${contractIdOf(c)}: field keys are unique`, () => {
      const keys = c.fields.map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
    });
  }
});

describe("Catalogue field contract · global source-provenance rule — every active contract has an openable source link + as-of date", () => {
  it("every one of the 7 active contracts has a required 'sourceLink' field with storageStatus 'column'", () => {
    for (const c of CATALOGUE_FIELD_CONTRACTS) {
      const sourceLink = c.fields.find((f) => f.key === "sourceLink");
      expect(sourceLink, `${contractIdOf(c)} is missing a sourceLink field`).toBeDefined();
      expect(sourceLink!.required).toBe(true);
      expect(sourceLink!.storageStatus).toBe("column");
      expect(sourceLink!.promoteToCatalogueRow).toBe(true);
    }
  });

  it("every one of the 7 active contracts has a required 'sourceAsOf' field with storageStatus 'column'", () => {
    for (const c of CATALOGUE_FIELD_CONTRACTS) {
      const sourceAsOf = c.fields.find((f) => f.key === "sourceAsOf");
      expect(sourceAsOf, `${contractIdOf(c)} is missing a sourceAsOf field`).toBeDefined();
      expect(sourceAsOf!.required).toBe(true);
      expect(sourceAsOf!.storageStatus).toBe("column");
      expect(sourceAsOf!.promoteToCatalogueRow).toBe(true);
    }
  });

  it("mmf's sourceLink is labeled 'Source link' (unchanged from the original product list)", () => {
    const mmf = getCatalogueFieldContract("mmf")!;
    expect(mmf.fields.find((f) => f.key === "sourceLink")!.label).toBe("Source link");
  });

  it("bank's sourceLink is labeled 'Source' (unchanged display label; only the canonical KEY was unified to sourceLink for consistency)", () => {
    const bank = getCatalogueFieldContract("bank")!;
    const field = bank.fields.find((f) => f.key === "sourceLink")!;
    expect(field.label).toBe("Source");
    expect(field.aliases).toContain("source"); // real bank_instruments.source column name preserved as an alias
  });

  it("CBK now carries BOTH source fields — the pre-approval amendment added them because CATALOGUE_FIELD_RULES.cbk already requires 'source' and 'asOf' today; leaving them out would have made this contract weaker than the existing approval gate", () => {
    const cbk = getCatalogueFieldContract("cbk")!;
    const sourceLink = cbk.fields.find((f) => f.key === "sourceLink");
    const sourceAsOf = cbk.fields.find((f) => f.key === "sourceAsOf");
    expect(sourceLink).toBeDefined();
    expect(sourceLink!.label).toBe("Source link");
    expect(sourceLink!.required).toBe(true);
    expect(sourceAsOf).toBeDefined();
    expect(sourceAsOf!.label).toBe("Source as-of date");
    expect(sourceAsOf!.required).toBe(true);
    // 8a: the original 8 product-list fields + 2 provenance fields = 10.
    // 8d added 5 more (issueNumber, auctionDate, valueDate, couponRate,
    // taxExempt) during its own pre-approval compatibility check — see this
    // file's header for why.
    expect(cbk.fields.length).toBe(15);
  });

  it("no test or contract treats CBK's source absence as intentional — the field IS present (regression guard for the pre-approval amendment)", () => {
    const cbk = getCatalogueFieldContract("cbk")!;
    expect(cbk.fields.some((f) => f.key === "sourceLink")).toBe(true);
    expect(cbk.fields.some((f) => f.key === "sourceAsOf")).toBe(true);
  });

  it("every market_asset subtype has BOTH a required 'Source link' and a required 'Source as-of date' field", () => {
    for (const subtype of ["equity", "reit", "offshore_fund", "sacco"] as const) {
      const contract = getCatalogueFieldContract("market_asset", subtype)!;
      const sourceLink = contract.fields.find((f) => f.key === "sourceLink");
      const sourceAsOf = contract.fields.find((f) => f.key === "sourceAsOf");
      expect(sourceLink, `${subtype} is missing sourceLink`).toBeDefined();
      expect(sourceLink!.label).toBe("Source link");
      expect(sourceLink!.required).toBe(true);
      expect(sourceLink!.storageStatus).toBe("column"); // opportunities.dataSource already exists
      expect(sourceAsOf, `${subtype} is missing sourceAsOf`).toBeDefined();
      expect(sourceAsOf!.label).toBe("Source as-of date");
      expect(sourceAsOf!.required).toBe(true);
      expect(sourceAsOf!.storageStatus).toBe("column"); // opportunities.dataAsOf already exists
    }
  });

  it("sourceLink aliases include the real underlying column/field names per catalogue (source / dataSource / sourceUrl / sourceLabel)", () => {
    for (const c of CATALOGUE_FIELD_CONTRACTS) {
      const sourceLink = c.fields.find((f) => f.key === "sourceLink")!;
      expect(sourceLink.aliases.length).toBeGreaterThan(0);
      expect(sourceLink.aliases).toContain("source");
    }
  });
});

describe("Catalogue field contract · computed fields are marked computed, not column", () => {
  it("mmf netYield is computed, not a stored column", () => {
    const field = getCatalogueFieldContract("mmf")!.fields.find((f) => f.key === "netYield")!;
    expect(field.storageStatus).toBe("computed");
    expect(field.promoteToCatalogueRow).toBe(false);
  });

  it("bank netReturnAfterWht is computed, not a stored column", () => {
    const field = getCatalogueFieldContract("bank")!.fields.find((f) => f.key === "netReturnAfterWht")!;
    expect(field.storageStatus).toBe("computed");
    expect(field.promoteToCatalogueRow).toBe(false);
  });

  it("cbk netYieldAfterWht is computed, not a stored column", () => {
    const field = getCatalogueFieldContract("cbk")!.fields.find((f) => f.key === "netYieldAfterWht")!;
    expect(field.storageStatus).toBe("computed");
    expect(field.promoteToCatalogueRow).toBe(false);
  });

  it("no field anywhere is BOTH storageStatus:'computed' AND promoteToCatalogueRow:true — a computed value is never itself written to a row", () => {
    const allFields = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields);
    const violators = allFields.filter((f) => f.storageStatus === "computed" && f.promoteToCatalogueRow);
    expect(violators).toEqual([]);
  });
});

describe("Catalogue field contract · missing fields are marked missingRequiresMigration, never silently treated as existing", () => {
  const knownMissing: Array<{ catalogue: "mmf" | "bank"; subtype?: undefined; key: string }> = [
    { catalogue: "mmf", key: "riskProfile" },
    { catalogue: "mmf", key: "dailyYield" },
    { catalogue: "bank", key: "fees" },
    { catalogue: "bank", key: "accessSpeed" },
  ];

  for (const { catalogue, key } of knownMissing) {
    it(`${catalogue}.${key} is marked missingRequiresMigration`, () => {
      const field = getCatalogueFieldContract(catalogue)!.fields.find((f) => f.key === key)!;
      expect(field.storageStatus).toBe("missingRequiresMigration");
      expect(field.showInTable).toBe(false);
      expect(field.promoteToCatalogueRow).toBe(false);
    });
  }

  const knownMissingMarketAsset: Array<{ subtype: "equity" | "reit" | "offshore_fund" | "sacco"; key: string }> = [
    { subtype: "equity", key: "recentDividend" },
    { subtype: "equity", key: "priceChange" },
    { subtype: "equity", key: "marketSector" },
    { subtype: "equity", key: "minBuyAmount" },
    { subtype: "equity", key: "riskLevel" },
    { subtype: "reit", key: "reitType" },
    { subtype: "reit", key: "recentDistribution" },
    { subtype: "reit", key: "occupancyRate" },
    { subtype: "reit", key: "minInvestment" },
    { subtype: "reit", key: "riskLevel" },
    { subtype: "offshore_fund", key: "fundType" },
    { subtype: "offshore_fund", key: "minInvestment" },
    { subtype: "offshore_fund", key: "withdrawalPeriod" },
    { subtype: "offshore_fund", key: "riskLevel" },
    { subtype: "sacco", key: "membershipRequirement" },
    { subtype: "sacco", key: "fees" },
  ];

  for (const { subtype, key } of knownMissingMarketAsset) {
    it(`market_asset/${subtype}.${key} is marked missingRequiresMigration`, () => {
      const field = getCatalogueFieldContract("market_asset", subtype)!.fields.find((f) => f.key === key)!;
      expect(field.storageStatus).toBe("missingRequiresMigration");
      expect(field.showInTable).toBe(false);
      expect(field.promoteToCatalogueRow).toBe(false);
    });
  }

  it("no field marked missingRequiresMigration is also marked promoteToCatalogueRow:true — nothing missing gets silently promoted", () => {
    const allFields = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields);
    const violators = allFields.filter(
      (f) => f.storageStatus === "missingRequiresMigration" && f.promoteToCatalogueRow,
    );
    expect(violators).toEqual([]);
  });

  it("every missingRequiresMigration field carries a `note` explaining the gap (never silent)", () => {
    const allFields = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields);
    const missing = allFields.filter((f) => f.storageStatus === "missingRequiresMigration");
    expect(missing.length).toBeGreaterThan(0);
    for (const f of missing) {
      expect(typeof f.note).toBe("string");
      expect(f.note!.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Catalogue field contract · gate-required fields not yet promoted are flagged, not silently marked column", () => {
  it("REIT distributionYield is gate-required, storageStatus is extendedFields (not column), and its promotion gap was fixed in Slice 8e-2 via alsoWriteKeys", () => {
    const field = getCatalogueFieldContract("market_asset", "reit")!.fields.find((f) => f.key === "distributionYield")!;
    expect(field.required).toBe(true);
    expect(field.storageStatus).toBe("extendedFields");
    // Slice 8e-2: the REIT subtype gate strictly checks the literal key
    // 'distributionYield' (figurePresent has no fallback for it), but
    // buildPromotionPlan only reads yieldPct/yield/coupon for the promoted
    // column — no single key could satisfy both, so the same value is
    // duplicated onto 'yieldPct' too via alsoWriteKeys.
    expect(field.alsoWriteKeys).toEqual(["yieldPct"]);
    expect(field.note).toMatch(/alsoWriteKeys/i);
  });

  it("SACCO's four gate-required fields (dividendRate, minimumShareCapital, minimumMonthlyDeposit, withdrawalTerms) are extendedFields, not column", () => {
    // Keys renamed/added during Slice 8e-4's pre-approval compatibility check
    // (2026-07-16): minContribution -> minimumMonthlyDeposit,
    // lockInWithdrawalRule -> withdrawalTerms, plus a new minimumShareCapital
    // field (SACCO_MARKET_ASSET_FIELD_RULES requires it as its own distinct
    // figure, separate from minimumMonthlyDeposit).
    const sacco = getCatalogueFieldContract("market_asset", "sacco")!;
    for (const key of ["dividendRate", "minimumShareCapital", "minimumMonthlyDeposit", "withdrawalTerms"]) {
      const field = sacco.fields.find((f) => f.key === key)!;
      expect(field.required).toBe(true);
      expect(field.storageStatus).toBe("extendedFields");
      expect(field.promoteToCatalogueRow).toBe(false);
    }
  });
});

describe("Catalogue field contract · foundation-only guardrails (no behavior change yet)", () => {
  it("only the Slice 8b/8c/8d/8e-1/8e-2/8e-3/8e-4-approved consumers import shared/catalogueFieldContracts — MMF, Bank, CBK, Equity, REIT, Offshore fund and SACCO (all market-asset subtypes are now wired)", () => {
    const root = join(__dirname, "..");
    const searchDirs = ["server", "shared", join("client", "src")];
    const offenders: string[] = [];
    const walk = (dir: string) => {
      let entries: string[];
      try {
        entries = readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry === "node_modules" || entry === ".git") continue;
        const full = join(dir, entry);
        const stat = require("node:fs").statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (/\.(ts|tsx)$/.test(entry) && full !== join(root, "shared", "catalogueFieldContracts.ts")) {
          const content = readFileSync(full, "utf8");
          if (content.includes("catalogueFieldContracts")) offenders.push(full);
        }
      }
    };
    for (const d of searchDirs) walk(join(root, d));
    // This test file imports it directly (8a's own suite), Slice 8b wires
    // MMF-only support into AskAI.tsx plus its own test file, Slice 8c adds Bank
    // support to the SAME AskAI.tsx file plus its own test file, Slice 8d adds
    // CBK support the same way, Slice 8e-1 adds Equity support the same way,
    // Slice 8e-2 adds REIT support the same way, Slice 8e-3 adds Offshore fund
    // support the same way, and Slice 8e-4 adds SACCO support the same way —
    // the LAST market-asset subtype. Any OTHER consumer must still fail this
    // guardrail.
    const allowed = new Set([
      join(root, "server", "catalogueFieldContracts.test.ts"),
      join(root, "server", "mmfContractMapping.test.ts"),
      join(root, "server", "bankContractMapping.test.ts"),
      join(root, "server", "cbkContractMapping.test.ts"),
      join(root, "server", "equityContractMapping.test.ts"),
      join(root, "server", "reitContractMapping.test.ts"),
      join(root, "server", "offshoreFundContractMapping.test.ts"),
      join(root, "server", "saccoContractMapping.test.ts"),
      join(root, "client", "src", "pages", "AskAI.tsx"),
    ]);
    const unexpectedOffenders = offenders.filter((f) => !allowed.has(f));
    expect(unexpectedOffenders).toEqual([]);
  });

  it("no field is both required:true and storageStatus:'missingRequiresMigration' AND promoteToCatalogueRow:true at once (a required-but-missing field must never claim it's already promotable)", () => {
    const allFields = CATALOGUE_FIELD_CONTRACTS.flatMap((c) => c.fields);
    const violators = allFields.filter(
      (f) => f.required && f.storageStatus === "missingRequiresMigration" && f.promoteToCatalogueRow,
    );
    expect(violators).toEqual([]);
  });
});
