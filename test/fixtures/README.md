# Upload fixtures (generated conversions of real EDGAR filings)
These files are **generated**, not original filings. The text is unchanged from the SEC exhibits; only the container format was converted on Oct 19, 2026 so the PDF and DOCX upload paths can be tested.

| file | source filing (verbatim text) | how it was generated |
|---|---|---|
| c6-vivos-msa.generated.pdf (30 pages) | Vivos Therapeutics, Inc. EX-10.2, filed 2026-08-03: https://www.sec.gov/Archives/edgar/data/1716166/000149315226035867/ex10-2.htm | `google-chrome --headless --print-to-pdf edgar/contracts/c6.htm` |
| c12-reborn-supply.generated.docx | Reborn Coffee, Inc. EX-10.1, filed 2026-08-12: https://www.sec.gov/Archives/edgar/data/1707910/000121390026087943/ea030165101ex10-1.htm | HTML body of edgar/contracts/c12.htm, `soffice --headless --writer --convert-to docx` |

Expected values (hand-checked against the same clauses as edgar/VERIFICATION.md): c6 act-by 2027-05-31, cited "p. 2, lines 25–26" (PDF page 2, 3.2 Renewal); c12 act-by 2028-06-10, cited by paragraph (¶). Copies are served from public/samples/ for the "try a sample" links.
