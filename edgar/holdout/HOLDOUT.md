# Held-out EDGAR test (Oct 19, 2026)
14 real Exhibit 10 commercial agreements from SEC EDGAR that were **not** used to write or tune the rules. Found via EDGAR full-text search, fetched with User-Agent "Amy Zhuang amyzhuang111@gmail.com", normalised with `edgar/holdout/totext.py`. URLs: `raw/urls.txt`. Re-run: `node edgar/holdout/run.mjs` (output: `results.txt`).

Scored on the act-by date (non-renewal notice deadline), as of 2026-10-19, against my own reading of each clause.
- **Right**: the date matches the hand reading.
- **Flagged**: no date shown, marked needs review, and the exhibit genuinely doesn't let you compute one.
- **Missed**: no date shown, but the clause was readable.
- **Wrong**: a date (act-by or term end) that doesn't match the clause.

## First pass, before any change
Batch A (h1–h8) ran on the code at 9c960e7. Batch B (h9–h14) was fetched after the batch A fixes and ran once, untouched.

| | right | flagged | missed | wrong |
|---|---|---|---|---|
| Batch A (8) | 2 (h1, h6) | 3 (h3, h4, h5) | 3 (h2, h7, h8) | 0 (h8's effective date was wrong but marked for review) |
| Batch B (6) | 0 | 2 (h11, h13) | 3 (h9, h10, h14) | 1 (h12: a term end of 2026-09-29 taken from the "Calendar Quarter" definition; this came from a batch A rule) |
| **Total (14)** | **2** | **5** | **6** | **1** |

Honest hit rate on unseen contracts: 2/14 dates right, 7/14 acceptable (right or flagged correctly), 1/14 wrong.

## After the rule fixes (these 14 are now tuning data, not a test)
| id | agreement | act-by shown | hand reading | verdict |
|---|---|---|---|---|
| h1 | Argent/Splash exclusive licence | 2045-07-05 | 20 yrs from 2026-07-06, 12 months notice | right |
| h2 | Flexible Solutions mfg & supply | 2029-07-10 | "five-year term" from 2025-01-07, 180 days | right (fixed: hyphenated term, line-break split) |
| h3 | Elevance/Amwell MSA amendment | blank, review | explicit term to 2029-01-01; notice only by cross-reference to 7.4 (termination for convenience, 365 days) | flagged (term end now extracted) |
| h4 | Wavelo/DISH renewal amendment | blank, review | amended renewal mechanics across several sections | flagged |
| h5 | Arcutis manufacturing supply | blank, review | term and renewal redacted [***] | flagged |
| h6 | SDR Drone MSA | 2030-12-10 | 5 yrs from 2026-06-09, 180 days | right |
| h7 | Pipeline Group order form | 2027-04-06, review | the clause states "by April 6, 2027" | right, shown as stated (fixed: explicit deadline dates) |
| h8 | Blink/Envoy exclusive supply | 2029-08-23 | 5 yrs from 2025-02-20, 180 days, max 3 renewals | right (fixed: "as of this 20th day of", "an initial five (5) years") |
| h9 | Evofem licence & supply | 2027-09-21, review | 3 yrs from 2025-03-20; "180 days' notice" doesn't say before what | right, flagged (fixed) |
| h10 | Splash development & collaboration | 2031-05-01, review | "expire five (5) years from" 2026-07-31, conditional FDA extension, 90 days | right under the stated convention, flagged (could be 05-02; extension may apply) |
| h11 | UroGen agreement | blank, review | 10 yrs after Launch Date (an event) | flagged |
| h12 | RxSight/Alcon licence | blank, review | 10 yrs from regulatory approval (an event) | flagged (fixed: wrong date removed; definitions and survival clauses skipped) |
| h13 | 22nd Century MSA | blank, review | "the later of (i) 60 months ... (ii) ..." | flagged |
| h14 | Lifeward agreement | 2028-10-03 | through the 5th anniversary of 2024-10-03, at least one year prior | right (fixed: "made on", "anniversary", "notifies") |

After: 8 dated (5 clean, 3 still marked for review), 6 left blank and marked, 0 wrong. The 10-contract tuning set and its 21 original unit tests are unchanged.
