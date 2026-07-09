/**
 * Stage 4, Step 4.2b-i — fetchDocumentText() PDF-URL handling (aiIntakeService.ts).
 *
 * Previously fetchDocumentText only special-cased `content-type: html`; anything else
 * (including a PDF) had its raw bytes decoded as text via `res.text()` — for a real PDF
 * this produces unreadable binary "gibberish", a variant of the exact bug already fixed
 * once for the UPLOAD path (Stage 1b). This suite locks the fix: a fetched response that
 * IS (or looks like) a PDF is routed through the same deterministic `extractPdfText`
 * (unpdf) already used for uploads, instead of being decoded as text.
 *
 * `unpdf` is mocked (matching round91SourceReadGating.test.ts's existing house style) so
 * extraction is deterministic without needing to construct real PDF bytes. `global.fetch`
 * is mocked per-test so no network call ever occurs.
 *
 * Scoped to fetchDocumentText/extractPdfText/looksLikePdfResponse only: nothing here
 * wires searchAuthoritativeSource into runResearchQuestion, adds allowSearch, or touches
 * source classification, extraction schemas, the approval gate, promotion, holdings, tax,
 * Stage 5, or Stage 6.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("unpdf", () => ({
  getDocumentProxy: vi.fn(async () => ({})),
  extractText: vi.fn(async () => ({
    totalPages: 1,
    text: "91-Day Treasury Bill weighted average rate 8.8347% as of 2026-07-02.",
  })),
}));

const { fetchDocumentText, looksLikePdfResponse, extractPdfText } = await import("./aiIntakeService");

function mockFetchOnce(response: {
  ok: boolean;
  status?: number;
  statusText?: string;
  contentType?: string;
  bodyText?: string;
  bodyBytes?: ArrayBuffer;
}) {
  const impl = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    statusText: response.statusText ?? (response.ok ? "OK" : "Error"),
    headers: { get: (name: string) => (name.toLowerCase() === "content-type" ? response.contentType ?? "" : null) },
    text: async () => response.bodyText ?? "",
    arrayBuffer: async () => response.bodyBytes ?? new ArrayBuffer(8),
  } as unknown as Response);
  vi.stubGlobal("fetch", impl);
  return impl;
}

describe("Stage 4.2b-i · looksLikePdfResponse (pure)", () => {
  it("trusts an explicit application/pdf content-type", () => {
    expect(looksLikePdfResponse("application/pdf", "https://example.com/anything")).toBe(true);
    expect(looksLikePdfResponse("application/pdf; charset=binary", "https://example.com/x")).toBe(true);
  });

  it("4. trusts a .pdf URL extension when content-type is missing/unclear", () => {
    expect(looksLikePdfResponse("", "https://centralbank.go.ke/uploads/bulletin.pdf")).toBe(true);
    expect(looksLikePdfResponse("application/octet-stream", "https://example.com/report.pdf")).toBe(true);
    // A .pdf URL with a query string trailing it (exactly the smoke-test shape).
    expect(looksLikePdfResponse("", "https://centralbank.go.ke/bulletin.pdf?utm_source=openai")).toBe(true);
  });

  it("never overrides an EXPLICIT html content-type, even if the URL mentions .pdf", () => {
    expect(looksLikePdfResponse("text/html; charset=utf-8", "https://example.com/about-our.pdf-policy.html")).toBe(
      false,
    );
  });

  it("a plain HTML URL with no .pdf anywhere is never mistaken for a PDF", () => {
    expect(looksLikePdfResponse("text/html", "https://www.nse.co.ke/prices")).toBe(false);
    expect(looksLikePdfResponse("", "https://www.nse.co.ke/prices")).toBe(false);
  });
});

describe("Stage 4.2b-i · fetchDocumentText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("1. a normal HTML URL still works exactly as before", async () => {
    mockFetchOnce({
      ok: true,
      contentType: "text/html; charset=utf-8",
      bodyText: "<html><body><h1>91-Day T-Bill</h1><p>Rate: 8.8347%</p></body></html>",
    });
    const text = await fetchDocumentText("https://www.centralbank.go.ke/results");
    expect(text).toContain("91-Day T-Bill");
    expect(text).toContain("8.8347%");
    expect(text).not.toMatch(/<html>|<body>/);
  });

  it("2. a thin (short) HTML fetch still returns successfully — isThinFetch is the caller's job, unchanged", async () => {
    mockFetchOnce({ ok: true, contentType: "text/html", bodyText: "<html><body>Loading…</body></html>" });
    const text = await fetchDocumentText("https://www.example.com/js-rendered");
    expect(text.trim().length).toBeGreaterThan(0);
    expect(text.trim().length).toBeLessThan(600); // below THIN_FETCH_MIN_CHARS — caller flags it, this function doesn't
  });

  it("3. a direct PDF URL with content-type: application/pdf extracts readable text, not binary gibberish", async () => {
    mockFetchOnce({
      ok: true,
      contentType: "application/pdf",
      bodyBytes: new TextEncoder().encode("%PDF-1.4 fake bytes for the test").buffer,
    });
    const text = await fetchDocumentText("https://www.centralbank.go.ke/uploads/weekly_bulletin/bulletin.pdf");
    expect(text).toContain("8.8347%");
    expect(text).not.toMatch(/^%PDF/); // never the raw PDF bytes/binary
    expect(text).not.toMatch(/^data:/); // never a raw data: URI leaking through
  });

  it("4. a .pdf URL with missing/unclear content-type is handled safely via the same PDF path", async () => {
    mockFetchOnce({
      ok: true,
      contentType: "application/octet-stream",
      bodyBytes: new TextEncoder().encode("%PDF-1.4 fake bytes for the test").buffer,
    });
    const text = await fetchDocumentText("https://example.bank.co.ke/rates/fixed-deposit-rates.pdf");
    expect(text).toContain("8.8347%");
  });

  it("5. a network/fetch failure behaves exactly as before (throws a friendly error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    );
    await expect(fetchDocumentText("https://www.centralbank.go.ke/down")).rejects.toThrow(/could not fetch/i);
  });

  it("a non-2xx HTTP response behaves exactly as before (throws with the status)", async () => {
    mockFetchOnce({ ok: false, status: 404, statusText: "Not Found" });
    await expect(fetchDocumentText("https://www.centralbank.go.ke/missing")).rejects.toThrow(/404/);
  });

  it("a PDF that extracts to no readable text throws a clear, distinct error (never silently returns garbage)", async () => {
    const unpdf = await import("unpdf");
    vi.mocked(unpdf.extractText).mockResolvedValueOnce({ totalPages: 1, text: "" } as never);
    mockFetchOnce({
      ok: true,
      contentType: "application/pdf",
      bodyBytes: new TextEncoder().encode("%PDF-1.4 empty").buffer,
    });
    await expect(fetchDocumentText("https://example.com/scanned.pdf")).rejects.toThrow(/no readable text/i);
  });
});

describe("Stage 4.2b-i · existing uploaded-PDF behaviour (extractPdfText) is unaffected", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("6. extractPdfText still works from a base64 data: URI exactly as before (the upload path, no fetch involved)", async () => {
    const dataUri = `data:application/pdf;base64,${Buffer.from("fake pdf bytes").toString("base64")}`;
    const text = await extractPdfText(dataUri);
    expect(text).toContain("8.8347%");
  });

  it("extractPdfText still refuses a raw https:// reference (a legacy signed-URL guard, unrelated to fetchDocumentText's new PDF path)", async () => {
    const text = await extractPdfText("https://legacy-signed-url.example/file.bin");
    expect(text).toBe("");
  });
});
