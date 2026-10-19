# Contract Cliffs
Deterministic extraction of effective dates, terms, auto-renewals, non-renewal notice windows and payment deadlines from contracts (PDF, DOCX, TXT, paste). Every date shows the verbatim clause and its line/page; ambiguous or redacted values stay blank and are marked "needs review". No LLM, no API key; uploads never leave the browser.

- Real set: 10 Exhibit 10 agreements from SEC EDGAR (edgar/SOURCES.md; hand checks in edgar/VERIFICATION.md).
- Held-out test: 14 more Exhibit 10 agreements never used for tuning. First pass 2/14 act-by dates right, 5 flagged correctly, 6 missed, 1 wrong; after fixes 8 dated, 6 flagged, 0 wrong (edgar/holdout/HOLDOUT.md; those 14 are now tuning data).
- Upload fixtures: a PDF and a DOCX generated from real EDGAR filings, labelled as generated (test/fixtures/README.md). PDF citations carry page and in-page line; DOCX cites paragraphs (¶).
- Exports: obligations CSV, act-by .ics, diligence packet (single HTML).
- `npm test` (unit tests, expected values from the clauses) and `BASE_URL=... npm run e2e` (puppeteer against the live site).
- Fonts: Bodoni Moda, Source Serif 4 and Geist (SIL OFL 1.1, licences in public/fonts). pdf.js (Apache-2.0), JSZip (MIT).

Not legal advice.
