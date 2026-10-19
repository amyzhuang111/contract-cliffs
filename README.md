# Contract Cliffs
Deterministic extraction of effective dates, terms, auto-renewals, non-renewal notice windows and payment deadlines from contracts (PDF, DOCX, TXT, paste). Every date shows the verbatim clause and its line/page; ambiguous or redacted values stay blank and are marked "needs review". No LLM, no API key; uploads never leave the browser.

- Real set: 10 Exhibit 10 agreements from SEC EDGAR (edgar/SOURCES.md; hand checks in edgar/VERIFICATION.md).
- Exports: obligations CSV, act-by .ics, diligence packet (single HTML).
- `npm test` (unit tests, expected values from the clauses) and `BASE_URL=... npm run e2e` (puppeteer against the live site).
- Fonts: Bodoni Moda and Geist (SIL OFL 1.1). pdf.js (Apache-2.0), JSZip (MIT).

Not legal advice.
