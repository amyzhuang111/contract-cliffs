# Contract Cliffs

Deterministic extraction of effective dates, terms, auto-renewals, non-renewal notice windows and payment deadlines from contracts (PDF, DOCX, TXT, paste). Every date shows the verbatim clause and its line/page; ambiguous or redacted values stay blank and are marked "needs review". No LLM, no API key; uploads never leave the browser.

## Use it on your own contracts
Open the site and drop PDF, Word (.docx), .txt or .htm files (several at once), paste text, or fetch an SEC EDGAR link. Files and pasted text are parsed in the browser (pdf.js, mammoth) and never uploaded or stored; "Remember my contracts" saves to this browser only when ticked. EDGAR links go through `api/edgar.js`, which only fetches https://www.sec.gov with a declared User-Agent and keeps nothing. One contract gives one answer card (the send-notice date, the clause, the source); two or more build a queue. `?demo=1` jumps to the one-click demo; a service worker keeps it working offline once loaded. The 10 SEC contracts load only on request (`?set=sec` or "Try with 10 real SEC contracts").

Dev: `npm run serve` (static site + /api/edgar on :4173), `npm test`, `npm run e2e`.


- Real set: 10 Exhibit 10 agreements from SEC EDGAR (edgar/SOURCES.md; hand checks in edgar/VERIFICATION.md).
- Held-out test: 14 more Exhibit 10 agreements never used for tuning. First pass 2/14 send-notice deadline dates right, 5 flagged correctly, 6 missed, 1 wrong; after fixes 8 dated, 6 flagged, 0 wrong (edgar/holdout/HOLDOUT.md; those 14 are now tuning data).
- Blind holdout 2: 10 new agreements, run once before any change: 3 right, 6 flagged, 1 missed, 0 wrong send-notice deadline dates (1 wrong secondary 'current term' date, fixed).
- Blind test 3 (Oct 2026, 13 more unseen agreements, real PDF and DOCX through the browser): 3 right, 3 correctly blank, 3 right next date without the passed-deadline warning, 3 missed (flagged), 1 wrong (shown as expired).
- Blind test 2 (Oct 2026, 13 unseen SEC agreements, answers worked out by hand first, no code changes after): 3 dates right, 5 correctly left blank, 3 missed (flagged), 1 debatable (at Check), 1 wrong at Clear (it read an older agreement's term from the recitals). It is not error-free: when it can't tell it says so and flags the row for a person.
- Notice periods given by cross-reference ("pursuant to Section 7.4") are read from that section and flagged, with both clauses quoted. The queue can be grouped by counterparty or by party (filer).
- Upload fixtures: a PDF and a DOCX generated from real EDGAR filings, labelled as generated (test/fixtures/README.md). PDF citations carry page and in-page line; DOCX cites paragraphs (¶).
- Exports: obligations CSV, send-notice deadline .ics, audit pack (single HTML).
- `npm test` (unit tests, expected values from the clauses) and `BASE_URL=... npm run e2e` (puppeteer against the live site).
- Fonts: Geist and Geist Mono (SIL OFL 1.1, licences in public/fonts). pdf.js (Apache-2.0) and mammoth (BSD-2-Clause), self-hosted in public/vendor.

Not legal advice.

## Priority rule

The send-notice deadline queue is ordered deterministically: missed first (deadline passed), then resolve first (needs review, no date), then upcoming by window (next 30 days, 31–90, 91–365, over a year). Inside a window, a notice period longer than the renewal ranks first, then the longer auto-renewal lock-in, then the earlier date; ties go A–Z by name. Every row has a one-line "Why it’s here". Unit and e2e tests check the order.
