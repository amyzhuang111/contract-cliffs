# Hand verification (Oct 19, 2026; as-of 2026-10-19)
Each row: clause read in edgar/raw/<id>.txt (normalised from the EDGAR HTML; line numbers match the app), date recomputed by hand and cross-checked with Python datetime.

| id | clause (verbatim excerpt) | effective | term end | notice | act-by shown | verdict |
|---|---|---|---|---|---|---|
| c1 Cerus/Purolite | L58 "Eighty-Four (84) months commencing on the Effective Date"; L59 "successive one (1) year periods ... at least two years prior to the last day" | 2014-04-21 (L9) | 2021-04-20 initial; 2029-04-20 projected | 2 years | 2027-04-20 (projected, medium) | correct under stated convention |
| c2 StableX/Kopin | L352-355 "initial period of four (4) years ... successive periods of one (1) year ... not less than ninety (90) days prior" | 2026-04-27 | 2030-04-26 | 90 days | 2030-01-26 | correct |
| c3 Dragonfly/Keystone | L252 "a period of twelve (12) months"; L256-258 "prior to the end of the first Renewal Term" | 2021-11-19 ("dated as of"; Effective Date never defined) | 2027-11-18 projected | 60 days | 2027-09-19, NEEDS REVIEW (low) | flagged: drafting ambiguous |
| c4 Tradeweb | L25 "November 1, 2025 – October 31, 2028"; L26 "one hundred and eighty (180) days prior to the expiration ... (inclusive of the final day)", up to two 2-yr extensions | explicit period | 2028-10-31 | 180 days | 2028-05-04, NEEDS REVIEW (could be 05-05) | correct, conservative |
| c5 Star Brands/Schwazze | L24-29 "twenty-four (24) consecutive calendar months ... one hundred eighty (180) days prior to the expiration of the then existing term" | 2023-06-15 | 2025-06-14 initial; 2027-06-14 projected | 180 days | 2026-12-16 | correct |
| c6 CFO Portal/Vivos | L86-87 "initial term of twelve (12) months"; L89-90 "at least sixty (60) days prior to the end of the then-current term" | 2026-07-31 | 2027-07-30 | 60 days | 2027-05-31 | correct |
| c7 Synacor/Qwest | L87 "through May 31, 2022 ... up to two periods of one (1) year ... at least ninety (90) days" | 2020-06-01 | 2024-05-31 final | 90 days | 2024-03-02 (past) | correct, shown as past |
| c8 Patheon/Vaxcyte | L142 "until fifteen Years following the Effective Date ... notice of non-renewal [***] before" | 2025-09-24 | 2040-09-24 | redacted | blank, NEEDS REVIEW | correct |
| c12 Reborn/Mighty Oak | L126-128 "two (2) years from the Effective Date ... at least sixty (60) days prior to expiration" | 2026-08-10 | 2028-08-09 | 60 days | 2028-06-10 | correct |
| c13 ARK/Eightco | L181-184 "initial term of [***] from the Effective Date ... at least ninety (90) days prior" | 2026-05-20 | redacted | 90 days | blank, NEEDS REVIEW | correct |

Convention: "N months commencing on / from the Effective Date" ends the day before the anniversary; "until N years following" ends on the anniversary. Projected cycles assume no termination or amendment.
