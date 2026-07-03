# Round 97 Test Context

## Test Harness Pattern (from round91)
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthedUser = NonNullable<TrpcContext["user"]>;
function ctxFor(role: "admin" | "user"): TrpcContext {
  const user: AuthedUser = {
    id: role === "admin" ? 1 : 2,
    openId: `sample-${role}`,
    email: `${role}@example.com`,
    name: role === "admin" ? "Admin Person" : "Plain User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function modelReply(answer: string, findings: unknown[] = []) {
  return {
    model: "test-model",
    choices: [{ message: { content: JSON.stringify({ answer, findings }) } }],
  } as never;
}
function figure(key: string, value: string) {
  return { key, value };
}
```

## Key Assertions Needed for Round 97

### A. Structured extraction produces per-instrument findings (CBK bond prospectus → 3 findings)
- Mock invokeLLM to return the classification response (cbk_bond_prospectus)
- Mock invokeLLM to return structured extraction with 3 instruments
- Assert findings.length === 3
- Assert each finding has extractedFields._extendedFields with sourceClass === "cbk_bond_prospectus"
- Assert each finding has issueNumber in extractedFields

### B. NEVER_INVENT_FIELDS enforcement
- If model returns a NEVER_INVENT field as empty/null, it should become "missing_from_source"
- Import NEVER_INVENT_FIELDS from shared/instrumentProfile
- Assert that any NEVER_INVENT field not in the model response is "missing_from_source" in the finding

### C. Holding snapshot immutability
- Create a holding with holdingSnapshot
- Update the catalogue row's extendedFields
- Re-read the holding — holdingSnapshot must be unchanged

### D. Prompt discipline guards (static)
- Read aiResearchService.ts
- Assert RESEARCH_SYSTEM_PROMPT contains "must not recommend buying"
- Assert structured extraction prompts contain "do not recommend" / "do not suggest"
- Assert no "buy" / "sell" / "hold" recommendation language in prompts

### E. Schema integrity
- Assert extendedFields column exists on mmf_funds, bank_instruments, opportunities
- Assert holdingSnapshot column exists on securities, bank_instrument_holdings, portfolio_secondary_mmfs

### F. Source class detection
- classifySource is exported from aiResearchService
- Test that it calls invokeLLM with first 6000 chars
- Mock response and assert it returns the correct SourceClass

## Key File Locations
- shared/instrumentProfile.ts — types, NEVER_INVENT_FIELDS, CBK_BOND_REQUIRED_FIELDS, SOURCE_CLASSES
- server/aiResearchService.ts — classifySource, runStructuredExtraction, structuredInstrumentToDraft, tryInstrumentAwareExtraction
- server/routers.ts — bankHoldings.list (line 6320-6350, now returns holdingSnapshot)
- server/db.ts — reviewResearchUpdate publish path persists _extendedFields
- drizzle/schema.ts — extendedFields on catalogue tables, holdingSnapshot on holding tables

## Structured Extraction Mock Shape
The classifySource mock should return:
```json
{ "choices": [{ "message": { "content": "{\"sourceClass\": \"cbk_bond_prospectus\", \"confidence\": 0.95, \"reasoning\": \"Contains FXD issue numbers and auction details\"}" } }] }
```

The runStructuredExtraction mock should return:
```json
{ "choices": [{ "message": { "content": "{\"instruments\": [{\"issueNumber\": \"FXD1/2022/010\", \"securityType\": \"fxd\", \"couponRate\": 13.4, ...}, ...]}" } }] }
```
