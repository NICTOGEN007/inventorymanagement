import sys, os, math
OUT = sys.argv[1]
CSS = '''
*{box-sizing:border-box} body{margin:0;background:#fff;font-family:"Liberation Sans",Arial,sans-serif;color:#0b0b0b}
#d{display:inline-block;padding:18px;background:#fff}
.layer{border:1.5px solid var(--b);background:var(--bg);border-radius:10px;padding:10px 12px 12px;margin:0}
.lt{font-weight:bold;font-size:18px;margin-bottom:8px;display:flex;justify-content:space-between;gap:20px}
.lt span{font-weight:normal;color:#52514e;font-size:15px}
.row{display:flex;gap:8px}
.box{flex:1;background:#fff;border:1.3px solid var(--b);border-radius:6px;padding:8px 6px;font-size:16px;text-align:center;line-height:1.25;display:flex;align-items:center;justify-content:center;min-height:46px}
.box.plan{border-style:dashed}
.sub{font-size:14px;color:#52514e;margin:6px 0 4px}
.conn{display:flex;align-items:center;justify-content:center;gap:10px;font-size:15px;color:#52514e;height:38px}
.conn b{font-size:22px;color:#52514e;font-weight:normal}
.cyl{flex:1;position:relative;background:#fff;border:1.3px solid var(--b);border-radius:50%/12px;padding:14px 4px 8px;font-size:15px;text-align:center;min-height:52px;display:flex;align-items:center;justify-content:center;line-height:1.25}
.ink{--b:#0b0b0b}.blue{--b:#2a78d6;--bg:#f2f7fd}.orange{--b:#eb6834;--bg:#fdf3ee}.green{--b:#1baf7a;--bg:#eef8f3}.violet{--b:#6250d6;--bg:#f4f2fc}.yellow{--b:#eda100;--bg:#fff8e8}
.legend{font-size:14px;color:#52514e;margin-top:10px;display:flex;gap:22px}
.sw{display:inline-block;width:26px;height:14px;border:1.3px solid #52514e;border-radius:3px;vertical-align:-2px;margin-right:6px;background:#fff}
'''
def page(name, body):
    open(f'{OUT}/{name}.html', 'w').write(f'<html><head><meta charset="utf-8"><style>{CSS}</style></head><body><div id="d">{body}</div></body></html>')

def boxes(items, cls=''):
    return '<div class="row">' + ''.join(f'<div class="box{" plan" if p else ""} {cls}">{t}</div>' for t, p in items) + '</div>'

arch = f'''
<div style="display:flex;gap:12px;width:1000px">
 <div style="flex:1">
  <div class="row" style="justify-content:center;gap:14px">
   <div class="box ink" style="flex:none;width:150px">Admin (Owner)</div>
   <div class="box ink" style="flex:none;width:150px">Manager</div>
   <div class="box ink" style="flex:none;width:150px">Cashier</div>
  </div>
  <div class="conn"><b>↓</b> web browser (desktop or mobile)</div>
  <div class="layer blue"><div class="lt">Presentation layer <span>React 19 single-page app · Vite · Tailwind CSS · TanStack Query · React Router</span></div>
   {boxes([('Login &amp;<br>role menu',0),('Products &amp;<br>suppliers',0),('Inventory &amp;<br>stock history',0),('Purchase<br>orders',0)])}<div style="height:8px"></div>
   {boxes([('POS billing &amp;<br>GST invoice',1),('Dashboard &amp;<br>reports',1),('Smart Restock',1),('AI assistant<br>chat',1)])}
  </div>
  <div class="conn"><b>↕</b> HTTPS · JSON · JWT access token (15 min) + httpOnly refresh cookie</div>
  <div class="layer orange"><div class="lt">Application layer <span>REST API · Node.js 22 · Express 5 · TypeScript</span></div>
   <div class="sub">Middleware applied to every request</div>
   {boxes([('Helmet · CORS ·<br>rate limiting',0),('JWT auth +<br>role permissions',0),('Zod request<br>validation',0),('Error handler<br>· audit log',0)])}
   <div class="sub">Services</div>
   {boxes([('Auth &amp; users',0),('Catalogue',0),('Stock ledger',0),('Purchasing',0)])}<div style="height:8px"></div>
   {boxes([('Sales &amp; GST',1),('Reports',1),('Forecasting &amp;<br>restock planner',1),('Assistant<br>gateway',1)])}
  </div>
  <div class="conn"><b>↕</b> Mongoose ODM · multi-document ACID transactions</div>
  <div class="layer green"><div class="lt">Data layer <span>MongoDB 8 · single-node replica set</span></div>
   <div class="row">{''.join(f'<div class="cyl green">{t}</div>' for t in ['users<br>sessions','products<br>categories','suppliers','stock<br>movements'])}</div><div style="height:8px"></div>
   <div class="row">{''.join(f'<div class="cyl green">{t}</div>' for t in ['purchase<br>orders','sales<br>returns','customers','audit logs<br>settings'])}</div>
  </div>
 </div>
 <div style="width:180px;display:flex;flex-direction:column;gap:12px;padding-top:96px">
  <div class="layer violet" style="flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center">
   <div style="font-weight:bold;font-size:17px;margin-bottom:8px">@ims/shared</div>
   <div style="font-size:15px;line-height:1.4">Code shared by the web app and the API:<br><br>GST calculation<br>money in paise<br>IST dates<br>Zod schemas<br>role permissions</div>
  </div>
  <div class="layer yellow" style="text-align:center;padding:14px 8px">
   <div style="font-weight:bold;font-size:17px">Google Gemini API</div>
   <div style="font-size:15px;margin-top:6px;line-height:1.35">external, optional<br>← function calls from the assistant gateway</div>
  </div>
 </div>
</div>
<div class="legend"><span><span class="sw"></span>implemented</span><span><span class="sw" style="border-style:dashed"></span>designed, in development</span></div>
'''
page('architecture', arch)

block = f'''
<div style="display:flex;gap:12px;align-items:stretch;width:980px">
 <div class="layer blue" style="width:180px"><div class="lt">Inputs</div>
  <div style="font-size:15.5px;line-height:1.8">Staff sign-in<br>Product master data<br>Supplier details<br>Purchase orders<br>Supplier deliveries<br>Shelf stock counts<br>Customer purchases<br>Owner's questions</div></div>
 <div class="conn" style="height:auto"><b>→</b></div>
 <div class="layer orange" style="flex:1"><div class="lt">Processing modules</div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
   <div class="box">Authentication &amp;<br>role-based access</div>
   <div class="box">Catalogue<br>(products, categories,<br>suppliers, HSN, GST)</div>
   <div class="box">Purchasing &amp;<br>goods receipt<br>(weighted-average cost)</div>
   <div class="box plan">POS billing &amp;<br>GST engine</div>
   <div class="box" style="border-width:2.5px"><div><b>Stock ledger</b><br>single source of truth<br>for every stock change</div></div>
   <div class="box">Stock adjustments<br>(count, damaged,<br>expired, lost)</div>
   <div class="box plan">Reports &amp;<br>valuation</div>
   <div class="box plan" style="border-color:#eda100">AI demand forecasting<br>&amp; restock planner</div>
   <div class="box plan" style="border-color:#eda100">AI assistant<br>(Google Gemini)</div>
  </div>
  <div style="font-size:15px;color:#52514e;margin-top:10px;line-height:1.45">Purchases, sales, returns and adjustments all change stock only through the stock ledger.
  The forecasting module reads the sales history from the ledger and prepares restock plans; once the owner confirms a plan it becomes purchase orders.</div>
 </div>
 <div class="conn" style="height:auto"><b>→</b></div>
 <div class="layer green" style="width:190px"><div class="lt">Outputs</div>
  <div style="font-size:15.5px;line-height:1.8">GST tax invoices<br>Purchase orders<br>Accurate stock levels<br>Stock history &amp; audit<br>Stock valuation<br>Sales &amp; GST reports<br>Low-stock alerts<br>Restock plans<br>Answers in plain English</div></div>
</div>
<div class="legend"><span><span class="sw"></span>implemented</span><span><span class="sw" style="border-style:dashed"></span>designed, in development</span></div>
'''
page('block', block)

# ---------- SVG snake pipeline ----------
def svg_text(x, y, lines, size=14, weight='normal', anchor='middle'):
    h = size * 1.25; y0 = y - (len(lines) - 1) * h / 2
    return ''.join(f'<text x="{x}" y="{y0 + i*h + size*0.35}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}" fill="#0b0b0b">{l}</text>' for i, l in enumerate(lines))
cols = [
 ('A. Forecast demand', '#2a78d6', '#f2f7fd', [
   (['Sales history', '(sales collection)'], 'box'),
   (['Daily units sold per product', '(moving average if short history)'], 'box'),
   (['Holt-Winters smoothing:', 'level + trend + weekly', 'seasonality'], 'box'),
   (['Festival uplift learned', 'from past festivals'], 'box'),
   (['Forecast demand over the', "supplier's lead time"], 'box')]),
 ('B. Decide what to reorder', '#eb6834', '#fdf3ee', [
   (['Safety stock = z × σ × √L', '(z = 1.65: 95% service level)'], 'box'),
   (['Reorder point = lead-time', 'demand + safety stock'], 'box'),
   (['Stock on hand + on order', '≤ reorder point?'], 'dec'),
   (['Quantity = demand over lead', 'time + review + safety stock', '− on hand − on order'], 'box'),
   (['Draft restock plan grouped', 'by supplier + dashboard alert'], 'box')]),
 ('C. Owner decides', '#eda100', '#fff8e8', [
   (['Owner reviews the list: items,', 'quantities, cost and reason'], 'box'),
   (['Edit quantities or remove', 'items (or ask the AI to)'], 'box'),
   (['Owner presses', '“Confirm & place orders”?'], 'dec'),
   (['One purchase order per', 'supplier, in one transaction'], 'box'),
   (['Goods received: stock ledger', 'and weighted cost updated'], 'box')]),
]
W, colw, gap, top, bh, vg = 1250, 350, 56, 108, 104, 34
xs = [30 + i * (colw + gap) for i in range(3)]
H = top + 5 * bh + 4 * vg + 110
parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" font-family="Liberation Sans, Arial, sans-serif"><defs><marker id="ar" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#52514e"/></marker></defs>']
centers = []
for ci, (title, stroke, bg, items) in enumerate(cols):
    x = xs[ci]
    parts.append(f'<rect x="{x-14}" y="{top-48}" width="{colw+28}" height="{5*bh+4*vg+70}" rx="12" fill="{bg}" stroke="{stroke}" stroke-width="1.5"/>')
    parts.append(f'<text x="{x+colw/2}" y="{top-20}" font-size="21" font-weight="bold" text-anchor="middle" fill="#0b0b0b">{title}</text>')
    col = []
    for i, (lines, kind) in enumerate(items):
        y = top + i * (bh + vg); cx, cy = x + colw / 2, y + bh / 2
        if kind == 'dec':
            parts.append(f'<polygon points="{cx},{y-6} {x+colw},{cy} {cx},{y+bh+6} {x},{cy}" fill="#fff" stroke="{stroke}" stroke-width="1.6"/>')
        else:
            parts.append(f'<rect x="{x}" y="{y}" width="{colw}" height="{bh}" rx="7" fill="#fff" stroke="{stroke}" stroke-width="1.4"/>')
        parts.append(svg_text(cx, cy, lines, 19))
        col.append((cx, y, y + bh))
    for i in range(4):
        a, b = col[i], col[i + 1]
        parts.append(f'<line x1="{a[0]}" y1="{a[2] + (6 if items[i][1]=="dec" else 0)}" x2="{b[0]}" y2="{b[1] - (6 if items[i+1][1]=="dec" else 0) - 1}" stroke="#52514e" stroke-width="1.5" marker-end="url(#ar)"/>')
        if items[i][1] == 'dec':
            parts.append(f'<text x="{a[0]+8}" y="{(a[2]+b[1])/2+10}" font-size="17" fill="#52514e">yes</text>')
    centers.append(col)
# column connectors (bottom of col A -> top of col B, bottom of B -> top of C)
for ci in range(2):
    a = centers[ci][4]; b = centers[ci + 1][0]
    x1, y1 = xs[ci] + colw / 2, a[2]; x2 = xs[ci + 1] + colw / 2
    midx = xs[ci] + colw + gap / 2
    parts.append(f'<path d="M{x1},{y1} L{x1},{y1+40} L{midx},{y1+40} L{midx},{top-64} L{x2},{top-64} L{x2},{top-48}" fill="none" stroke="#52514e" stroke-width="1.5" marker-end="url(#ar)"/>')
# "no" exits from the decisions
for ci, label in [(1, 'no → no action'), (2, 'no → plan cancelled or expires')]:
    cx, y, yb = centers[ci][2]; x = xs[ci] + colw
    parts.append(f'<text x="{x+6}" y="{(y+yb)/2-6}" font-size="17" fill="#52514e">no</text>')
# edit loop in C: from decision back up to "Edit"
d = centers[2][2]; e = centers[2][1]; xr = xs[2] + colw + 18
parts.append(f'<path d="M{xs[2]},{(d[1]+d[2])/2} L{xs[2]-18},{(d[1]+d[2])/2} L{xs[2]-18},{(e[1]+e[2])/2} L{xs[2]-1},{(e[1]+e[2])/2}" fill="none" stroke="#52514e" stroke-width="1.3" stroke-dasharray="5 4" marker-end="url(#ar)"/>')
parts.append(f'<text x="{xs[2]-22}" y="{(d[1]+e[2])/2+18}" font-size="16" fill="#52514e" text-anchor="end">edit</text>')
parts.append(f'<text x="{W/2}" y="{H-30}" font-size="16" fill="#52514e" text-anchor="middle">“no” at a decision ends the flow: no reorder needed (B), or the plan is cancelled or expires after 24 hours (C).</text>'); parts.append(f'<text x="{W/2}" y="{H-8}" font-size="16" font-weight="bold" fill="#0b0b0b" text-anchor="middle">Nothing is ordered without the owner’s confirmation.</text>')
parts.append('</svg>')
page('restock-pipeline', ''.join(parts))

# ---------- SVG use case ----------
ucs = ['Sign in / sign out', 'Manage users &amp; roles', 'Manage products &amp; suppliers', 'Adjust stock (count, write-off)',
       'Create &amp; place purchase orders', 'Receive goods from suppliers', 'Bill at POS, print GST invoice', 'Process customer returns',
       'View dashboard &amp; reports', 'Review &amp; confirm AI restock plan', 'Ask the AI assistant']
actors = {'Admin (Owner)': (0, [0, 1, 2, 8, 9, 10]), 'Manager': (1, [0, 2, 3, 4, 5, 8, 9, 10]), 'Cashier': (2, [0, 6, 7])}
W2, H2 = 1000, 50 + len(ucs) * 64 + 60
bx, bw = 255, 490
p2 = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{W2}" height="{H2}" font-family="Liberation Sans, Arial, sans-serif">']
p2.append(f'<rect x="{bx}" y="14" width="{bw}" height="{H2-28}" rx="10" fill="#fafaf8" stroke="#b9b8b2" stroke-width="1.5"/>')
p2.append(f'<text x="{bx+bw/2}" y="44" font-size="19" font-weight="bold" text-anchor="middle">Digital Inventory &amp; Sales Management System</text>')
ucpos = []
for i, u in enumerate(ucs):
    cy = 92 + i * 64; cx = bx + bw / 2
    ucpos.append((cx, cy))
apos = {'Admin (Owner)': (95, H2 * 0.28), 'Manager': (905, H2 * 0.40), 'Cashier': (95, H2 * 0.74)}
for name, (ai, idx) in actors.items():
    ax, ay = apos[name]
    for j in idx:
        cx, cy = ucpos[j]; ex = cx - 215 if ax < cx else cx + 215
        p2.append(f'<line x1="{ax + (28 if ax < cx else -28)}" y1="{ay}" x2="{ex}" y2="{cy}" stroke="#8a8984" stroke-width="1.1"/>')
for i, u in enumerate(ucs):
    cx, cy = ucpos[i]
    p2.append(f'<ellipse cx="{cx}" cy="{cy}" rx="215" ry="26" fill="#f2f7fd" stroke="#2a78d6" stroke-width="1.4"/>')
    p2.append(f'<text x="{cx}" y="{cy+6}" font-size="18" text-anchor="middle">{u}</text>')
for name, (ax, ay) in apos.items():
    s = '#0b0b0b'
    p2.append(f'<circle cx="{ax}" cy="{ay-46}" r="12" fill="#fff" stroke="{s}" stroke-width="1.8"/><line x1="{ax}" y1="{ay-34}" x2="{ax}" y2="{ay+4}" stroke="{s}" stroke-width="1.8"/><line x1="{ax-20}" y1="{ay-22}" x2="{ax+20}" y2="{ay-22}" stroke="{s}" stroke-width="1.8"/><line x1="{ax}" y1="{ay+4}" x2="{ax-16}" y2="{ay+30}" stroke="{s}" stroke-width="1.8"/><line x1="{ax}" y1="{ay+4}" x2="{ax+16}" y2="{ay+30}" stroke="{s}" stroke-width="1.8"/>')
    p2.append(f'<text x="{ax}" y="{ay+56}" font-size="18" font-weight="bold" text-anchor="middle">{name}</text>')
p2.append(f'<text x="{W2/2}" y="{H2-2}" font-size="12.5" fill="#52514e" text-anchor="middle">The Admin can also do everything a Manager can.</text></svg>')
page('usecase', ''.join(p2))

meth = '''<div style="display:flex;align-items:center;gap:8px;width:1000px">
 <div class="box blue" style="flex:none;width:120px;min-height:70px">1. Requirement<br>analysis</div><div class="conn" style="height:auto"><b>→</b></div>
 <div class="box blue" style="flex:none;width:140px;min-height:70px">2. Planning &amp; design<br>(modules, ER<br>model, API)</div><div class="conn" style="height:auto"><b>→</b></div>
 <div class="layer orange" style="flex:1"><div class="lt" style="font-size:16px">3. Iterative development, one module per step</div>
  <div style="display:grid;grid-template-columns:1fr 24px 1fr;gap:6px;align-items:center">
   <div class="box">Build module<br>(API + UI)</div><div class="conn" style="height:auto"><b>→</b></div><div class="box">Automated tests<br>(unit, API, UI)</div>
   <div class="conn" style="height:24px"><b>↑</b></div><div></div><div class="conn" style="height:24px"><b>↓</b></div>
   <div class="box">CI: lint, types,<br>tests, build, Docker</div><div class="conn" style="height:auto"><b>←</b></div><div class="box">Browser check on<br>realistic seed data</div>
  </div><div class="sub" style="text-align:center;margin-top:8px">repeat for the next module</div></div>
 <div class="conn" style="height:auto"><b>→</b></div>
 <div class="box blue" style="flex:none;width:130px;min-height:70px">4. Integration &amp;<br>end-to-end<br>testing</div><div class="conn" style="height:auto"><b>→</b></div>
 <div class="box blue" style="flex:none;width:130px;min-height:70px">5. Deployment &amp;<br>documentation</div>
</div>'''
page('methodology', meth)
print('ok')
