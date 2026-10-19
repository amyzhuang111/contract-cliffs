"""Normalise EDGAR exhibit HTML to one line per block (same approach as edgar/raw/*.txt)."""
import sys,re,html
from html.parser import HTMLParser
B={'p','div','br','tr','li','h1','h2','h3','h4','h5','h6','table','td'}
class P(HTMLParser):
  def __init__(s): super().__init__(); s.o=[]; s.skip=0
  def handle_starttag(s,t,a):
    if t in('script','style'): s.skip+=1
    if t in B: s.o.append('\n')
  def handle_endtag(s,t):
    if t in('script','style'): s.skip-=1
    if t in B: s.o.append('\n')
  def handle_data(s,d):
    if not s.skip: s.o.append(d)
p=P(); p.feed(open(sys.argv[1],errors='replace').read())
t=''.join(p.o).replace('\xa0',' ')
L=[re.sub(r'[ \t]+',' ',l).strip() for l in t.split('\n')]
L=[l for l in L if l]
open(sys.argv[2],'w').write('\n'.join(L)+'\n')
