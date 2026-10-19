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
| h3 | Elevance/Amwell MSA amendment | 2028-01-02, review | explicit term to 2029-01-01; notice only by cross-reference to 7.4 (termination for convenience, 365 days) | right under the cross-reference, flagged (added later: cross-reference resolution quotes Section 7.4) |
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

After: 9 dated (5 clean, 4 still marked for review), 5 left blank and marked, 0 wrong. The 10-contract tuning set and its 21 original unit tests are unchanged.

---
# Blind holdout 2 (Oct 19, 2026, evening): 10 new agreements, run before any rule change
Fresh set: the first 10 commercial Exhibit 10 services, manufacturing, custody, hosting and colocation agreements returned by four new EDGAR full-text searches. A lease was skipped on title alone, before any extraction ran. None of these companies appear in the tuning set or in holdout 1. URLs are in `../holdout2/raw/urls.txt`. The extractor ran once, at commit f81bb99, the same code as the live site; output is in `../holdout2/results-firstpass.txt`. Same scoring as above, on the act-by date as of 2026-10-19.

| id | agreement | first-pass act-by | hand reading | verdict |
|---|---|---|---|---|
| b1 | Power Upp power-as-a-service & colocation (Cuentas) | 2029-05-21 | 36 months from 2026-08-20, 90 days | right |
| b2 | BitGo custodial services (DevvStream) | blank, review | Effective Date = last signature (not in filing) | flagged |
| b3 | Master commercial manufacturing services (Insmed) | blank, review | Effective Date = date of last signature; term to 31 Dec of year 5 | flagged |
| b4 | BitGo custodial services (Upexi) | blank, review | term length left blank in the filed form ("continue for ,") | flagged |
| b5 | Management services (Blockfusion) | blank, review | "until third anniversary of the Effective Date" (2022-06-01), yearly renewal, 30 days → 2027-05-02 | **missed** (no "the" before "third anniversary"; left unfixed: missed, not wrong) |
| b6 | Sphere 3D / Rebel Mining master hosting | blank, review | term = later of 3 years or the last Hosting Order | flagged |
| b7 | Armlogi warehousing & fulfilment | blank, review | month-to-month "unless and until terminated"; no non-renewal notice | flagged |
| b8 | Acadia / Patheon master manufacturing | 2026-12-31 | through 2020-12-31, 2-year renewals, 24 months notice → the decision for the term ending 2028-12-31 is due 2026-12-31 | right on the act-by. **Wrong** secondary date: "current term ends 2028-12-31"; the term running today ends 2026-12-31 |
| b9 | Alimera manufacturing services | 2027-07-16, review | 5 years after 2024-07-17, 24 months notice | right, flagged (renewal length unread) |
| b10 | Evoke / Patheon manufacturing services | blank, review | term ends 31 Dec of the year five years after the Commencement Date (an event) | flagged |

**First pass, honest numbers: 3 right (1 of them flagged), 6 flagged correctly, 1 missed, 0 wrong act-by dates; 1 wrong secondary date (b8 current-term end).**

Fix (wrong dates only): the schedule now shows the term running on the as-of date ("Current term ends") separately from the term the next decision governs ("Following term ends"), and the next auto-renewal date comes from the running term. The same bug was showing Cerus (c1) as "current term ends 2029-04-20"; it now shows 2027-04-20. b5 stays missed by design: only rules that produced wrong dates were changed.
