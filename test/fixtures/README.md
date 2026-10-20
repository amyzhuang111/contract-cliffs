# Upload fixtures (generated conversions of real EDGAR filings)
These files are **generated**, not original filings. The text is unchanged from the SEC exhibits; only the container format was converted on Oct 19, 2026 so the PDF and DOCX upload paths can be tested.

| file | source filing (verbatim text) | how it was generated |
|---|---|---|
| c6-vivos-msa.generated.pdf (30 pages) | Vivos Therapeutics, Inc. EX-10.2, filed 2026-08-03: https://www.sec.gov/Archives/edgar/data/1716166/000149315226035867/ex10-2.htm | `google-chrome --headless --print-to-pdf edgar/raw/c6.htm` |
| c12-reborn-supply.generated.docx | Reborn Coffee, Inc. EX-10.1, filed 2026-08-12: https://www.sec.gov/Archives/edgar/data/1707910/000121390026087943/ea030165101ex10-1.htm | HTML body of edgar/raw/c12.htm, `soffice --headless --writer --convert-to docx` |

Expected values (hand-checked against the same clauses as edgar/VERIFICATION.md): c6 act-by 2027-05-31, cited "p. 2, lines 25–26" (PDF page 2, 3.2 Renewal); c12 act-by 2028-06-10, cited by paragraph (¶). Copies are served from public/samples/ for the "try a sample" links.

Own-contract e2e fixtures (Dragonfly Energy / THOR Industries supply agreement, EX-10.29: https://www.sec.gov/Archives/edgar/data/1847986/000149315223012533/ex10-29.htm):

| file | how it was made |
|---|---|
| c3-dragonfly.edgar.txt | verbatim copy of edgar/raw/c3.txt (the exhibit's text, one line per block) — not generated |
| c3-dragonfly.generated.pdf | **generated**: `google-chrome --headless --print-to-pdf edgar/raw/c3.htm` |

Expected (edgar/VERIFICATION.md): send-notice deadline 19 Sep 2026 missed; renews 19 Nov 2026; next deadline 19 Sep 2027 (a Sunday, so send by Fri 17 Sep 2027).

Reviewer's unseen EDGAR exhibits (verbatim HTML as served by sec.gov, fetched Oct 19, 2026 with a declared User-Agent; not generated):

| file | source |
|---|---|
| repositrak-cfo-ex10-1.edgar.htm | ReposiTrak, Inc. 8-K (0001437749-26-028419), Executive Employment Agreement: https://www.sec.gov/Archives/edgar/data/50471/000143774926028419/ex_1006529.htm |
| alphega-ceo-ex10-1.edgar.htm | Alphega Innovations Corp. 8-K (0002038564-26-000012), EX-10.1 Executive Employment Agreement: https://www.sec.gov/Archives/edgar/data/2038564/000203856426000012/alpga_ex10-1.htm |

Expected (reviewer's hand calculation, checked against the clauses): ReposiTrak term "three (3) years commencing on the Effective Date" (18 Aug 2026) ends 2029-08-17; 60 days' notice gives 2029-06-18. Alphega "continue through December 31, 2028" (explicit, high confidence), "one (1)-year" renewals, ≥90 days' notice gives 2028-10-02.
More unseen exhibits from the independent review of a882e8b (verbatim, fetched Oct 19, 2026):

| file | source |
|---|---|
| nanochem-supply-ex10-3.edgar.htm | Flexible Solutions International 8-K (0001493152-25-003527), EX-10.3 supply agreement (counterparty "(Omitted)" in the filing): https://www.sec.gov/Archives/edgar/data/1069394/000149315225003527/ex10-3.htm |
| argent-splash-ex10-1.edgar.htm | Splash Beverage Group 8-K (0001731122-26-000917), EX-10.1 licence agreement ("by and between:" with a colon): https://www.sec.gov/Archives/edgar/data/1553788/000173112226000917/e7760_ex10-1.htm |

Expected (independent reviewer's hand calculation): Nanochem 6 Jan 2030 minus 180 days = 2029-07-10; Argent 5 Jul 2046 minus 12 months = 2045-07-05. Names: "Nanochem / party withheld in filing", "Argent Biopharma / Splash Beverage Group".

Reviewer ab9a38e blind batch (verbatim sec.gov HTML, fetched Oct 19, 2026; URLs in SOURCES.txt) and the reviewer's derived copies:

| file | what it is |
|---|---|
| simwon-mstech-ex10-14.edgar.htm / altech-ex10-6.edgar.htm / industrious-ex10-1.edgar.htm | verbatim filings (Simwon/MS Autotech EX-10.14, Altech EX-10.6, Industrious/Gelteq EX-10.24) |
| simwon-mstech-ex10-14.generated.docx | **generated** by the reviewer from the same HTML (DOCX upload path) |
| altech-ex10-6.generated.pdf | **generated** by the reviewer (Chrome print-to-PDF of the same HTML) |
| *.pdftotext.txt | the reviewer's plain-text copy of each filing (PDF-style line breaks), used for the paste path and the line-split test |

Expected (hand-worked, as of 2026-10-19): Altech 18 Dec 2026; Simwon missed 30 Sep 2026, renews 1 Jan 2027, next 30 Sep 2027 (Check, template brackets); Industrious 30 Nov 2026 (Check, dates from the table); VerifyMe "Send-notice date passed 1 Apr 2025 · now renews every 3 months".
