"""Builds public/data/edgar.json from the EDGAR exhibits saved in edgar/raw (fetched with a declared User-Agent per SEC fair-access)."""
import json,shutil,os
META=[
 ("c1","Cerus / Purolite","Amended and Restated Supply Agreement","Cerus Corporation","Purolite Corporation","EX-10.1","2024-03-05","Supply"),
 ("c2","StableX / Kopin","Commercial Supply Agreement","Kopin Corporation","StableX Technologies, Inc.","EX-10.2","2026-04-29","Supply"),
 ("c3","Dragonfly / Keystone RV","Manufacturing Supply Agreement","Dragonfly Energy Holdings Corp.","Keystone RV Company","EX-10.29","2023-04-17","Supply"),
 ("c4","Tradeweb Data Schedule","Amended and Restated Tradeweb Data Schedule 1 (Master Data License Agreement)","Tradeweb Markets Inc.","Subscriber (name not stated in exhibit)","EX-10.7(3)","2026-02-05","Data licence"),
 ("c5","Star Brands / Schwazze","License Agreement","Medicine Man Technologies, Inc. (Schwazze)","Star Brands LLC","EX-10.21","2024-03-27","Licence"),
 ("c6","CFO Portal / Vivos","Master Services Agreement","Vivos Therapeutics, Inc.","The CFO Portal, LLC","EX-10.2","2026-08-03","Services"),
 ("c7","Synacor / Qwest","Third Amended and Restated Master Services Agreement","Synacor, Inc.","Qwest Corporation","EX-10.1","2020-07-29","Cloud services"),
 ("c8","Patheon / Vaxcyte","Master Services Agreement (commercial manufacturing)","Vaxcyte, Inc.","Patheon Manufacturing Services LLC","EX-10.1","2025-11-04","Manufacturing services"),
 ("c12","Reborn / Mighty Oak","Agricultural Import and Supply Agreement","Reborn Coffee, Inc.","The Mighty Oak Inc","EX-10.1","2026-08-12","Supply"),
 ("c13","ARK / Eightco","Master Services Agreement","Eightco Holdings Inc.","ARK Capital Markets LLC","EX-10.103","2026-08-07","Services"),
]
urls=dict(l.split() for l in open('edgar/raw/urls.txt'))
out=[]; os.makedirs('public/data/text',exist_ok=True)
for cid,short,title,filer,cp,ex,filed,kind in META:
  lines=open(f'edgar/raw/{cid}.txt').read().split('\n')
  out.append(dict(id=cid,name=short,title=title,filer=filer,counterparty=cp,exhibit=ex,filed=filed,kind=kind,url=urls[cid],lines=lines))
json.dump(out,open('public/data/edgar.json','w'),ensure_ascii=False)
with open('edgar/SOURCES.md','w') as f:
  f.write('# Real public contracts (SEC EDGAR)\nFetched Oct 19, 2026 with User-Agent "Amy Zhuang amyzhuang111@gmail.com".\n\n')
  for o in out: f.write(f"- {o['id']} {o['title']} ({o['filer']}, {o['exhibit']}, filed {o['filed']}): {o['url']}\n")
print(len(out))
