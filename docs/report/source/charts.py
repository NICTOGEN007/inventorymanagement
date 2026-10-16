import json, datetime as dt, collections, sys
import matplotlib; matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
from matplotlib.ticker import FuncFormatter
D = json.load(open(sys.argv[1] + '/data.json')); OUT = sys.argv[1] + '/charts/'
BLUE, ORANGE, AQUA = '#2a78d6', '#eb6834', '#1baf7a'
INK, INK2, GRID = '#0b0b0b', '#52514e', '#e4e3df'
plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.edgecolor': GRID, 'axes.labelcolor': INK2,
  'xtick.color': INK2, 'ytick.color': INK2, 'axes.titlecolor': INK, 'axes.titlesize': 12, 'axes.titleweight': 'bold',
  'axes.grid': True, 'grid.color': GRID, 'grid.linewidth': 0.8, 'axes.axisbelow': True,
  'axes.spines.top': False, 'axes.spines.right': False, 'savefig.dpi': 200, 'savefig.bbox': 'tight', 'legend.frameon': False})
def lakh(x, _=None): return f'₹{x/1e5:.1f}L' if x >= 1e5 else f'₹{x/1e3:.0f}K'
def rs(p): return p / 100
def save(fig, name): fig.savefig(OUT + name + '.png', facecolor='white'); plt.close(fig); print(name)

daily = [(dt.date.fromisoformat(r['_id']), rs(r['rev']), r['n']) for r in D['daily']]
# 5.1 monthly revenue
m = collections.OrderedDict()
for d, rev, n in daily: m.setdefault(d.strftime('%b %y'), [0, 0]); m[d.strftime('%b %y')][0] += rev; m[d.strftime('%b %y')][1] += n
labels = list(m)[1:-1] if len(m) > 12 else list(m)  # drop partial first/last months
vals = [m[k][0] for k in labels]
fig, ax = plt.subplots(figsize=(8, 3.8))
bars = ax.bar(labels, vals, color=BLUE, width=0.62)
ax.yaxis.set_major_formatter(FuncFormatter(lakh)); ax.grid(axis='x', visible=False)
i = vals.index(max(vals)); ax.annotate(lakh(vals[i]), (i, vals[i]), ha='center', va='bottom', xytext=(0, 3), textcoords='offset points', color=INK, fontsize=9)
ax.set_title('Monthly sales revenue (incl. GST)', loc='left'); ax.set_ylabel('Revenue'); plt.xticks(rotation=0, fontsize=8.5)
save(fig, 'monthly')

# 5.2 daily sales with festivals
fest = [('Diwali', '2025-10-20'), ('Christmas', '2025-12-25'), ('Holi', '2026-03-04'), ('Eid', '2026-03-20'), ('Raksha Bandhan', '2026-08-28'), ('Ganesh Chaturthi', '2026-09-14')]
fig, ax = plt.subplots(figsize=(8.5, 3.8))
xs = [d for d, _, _ in daily]; ys = [r for _, r, _ in daily]
ax.plot(xs, ys, color=BLUE, linewidth=1.2)
ma = [sum(ys[max(0, j-6):j+1]) / len(ys[max(0, j-6):j+1]) for j in range(len(ys))]
ax.plot(xs, ma, color=ORANGE, linewidth=2, label='7-day average')
ax.plot([], [], color=BLUE, linewidth=1.2, label='Daily sales')
top = max(ys)
for name, ds in fest:
    d = dt.date.fromisoformat(ds)
    if xs[0] <= d <= xs[-1]:
        ax.axvline(d, color=INK2, linewidth=0.6, linestyle=(0, (3, 3)))
        ax.text(d, top * 1.04, ' ' + name, rotation=90, va='bottom', ha='right', fontsize=7.5, color=INK2)
ax.yaxis.set_major_formatter(FuncFormatter(lakh)); ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %y'))
ax.set_ylim(0, top * 1.5); ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.1), ncol=2, fontsize=8.5)
ax.set_title('Daily sales over one year, with festival days marked', loc='left')
save(fig, 'daily')

# 5.3 weekday pattern
wd = collections.defaultdict(list)
for d, r, n in daily: wd[d.weekday()].append(r)
names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']; av = [sum(wd[i]) / len(wd[i]) for i in range(7)]
fig, ax = plt.subplots(figsize=(6.5, 3.4))
ax.bar(names, av, color=BLUE, width=0.6); ax.yaxis.set_major_formatter(FuncFormatter(lakh)); ax.grid(axis='x', visible=False)
for i, v in enumerate(av): ax.text(i, v, lakh(v), ha='center', va='bottom', fontsize=8.5, color=INK)
ax.set_title('Average sales by day of the week', loc='left'); ax.set_ylabel('Average daily revenue')
save(fig, 'weekday')

# 5.4 category revenue (horizontal, sorted)
cat = sorted(D['cat'], key=lambda c: c['rev'])
fig, ax = plt.subplots(figsize=(7.5, 3.8))
ax.barh([c['_id'] for c in cat], [rs(c['rev']) for c in cat], color=BLUE, height=0.6)
tot = sum(c['rev'] for c in cat)
for i, c in enumerate(cat): ax.text(rs(c['rev']), i, f"  {lakh(rs(c['rev']))} ({100*c['rev']/tot:.0f}%)", va='center', fontsize=8.5, color=INK)
ax.xaxis.set_major_formatter(FuncFormatter(lakh)); ax.grid(axis='y', visible=False); ax.set_xlim(0, rs(cat[-1]['rev']) * 1.3)
ax.set_title('Sales revenue by category', loc='left')
save(fig, 'category')

# 5.5 top products
topp = sorted(D['top'], key=lambda t: t['rev'])
fig, ax = plt.subplots(figsize=(7.5, 3.9))
ax.barh([t['_id'] for t in topp], [rs(t['rev']) for t in topp], color=BLUE, height=0.6)
for i, t in enumerate(topp): ax.text(rs(t['rev']), i, f"  {lakh(rs(t['rev']))}", va='center', fontsize=8.5, color=INK)
ax.xaxis.set_major_formatter(FuncFormatter(lakh)); ax.grid(axis='y', visible=False); ax.set_xlim(0, rs(topp[-1]['rev']) * 1.18)
ax.set_title('Top 10 products by revenue', loc='left')
save(fig, 'top-products')

# 5.6 weekly demand of three products (seasonal / festival / steady)
ser = collections.defaultdict(dict)
for r in D['weekly']: ser[r['_id']['n']][r['_id']['w']] = r['q']
weeks = sorted({w for s in ser.values() for w in s})[1:-1]
fig, axes = plt.subplots(4, 1, figsize=(8.5, 7), sharex=True)
for ax, (name, note) in zip(axes, [('Toned Milk 1 L', 'steady everyday demand'), ('Packaged Drinking Water 1 L', 'peaks in summer (Mar–May)'), ('Mosquito Repellent Refill', 'peaks in the monsoon (Jun–Sep)'), ('Ruled Notebook 172 pages', 'peaks when schools reopen (June)')]):
    xs = [dt.date.fromisoformat(w) for w in weeks]; ys = [ser[name].get(w, 0) for w in weeks]
    ax.plot(xs, ys, color=BLUE, linewidth=1.8); ax.set_ylim(0, max(ys) * 1.25)
    ax.set_title(f'{name}  ·  {note}', loc='left', fontsize=10, fontweight='bold'); ax.set_ylabel('Units / week', fontsize=8.5)
axes[-1].xaxis.set_major_formatter(mdates.DateFormatter('%b %y'))
fig.suptitle('Weekly demand patterns the forecasting module must learn', x=0.02, ha='left', fontsize=12, fontweight='bold', color=INK)
fig.tight_layout()
save(fig, 'weekly-demand')

# 5.7 payment methods
pay = D['pay']; tot = sum(p['amt'] for p in pay)
lbl = {'upi': 'UPI', 'cash': 'Cash', 'card': 'Card'}
fig, ax = plt.subplots(figsize=(6.5, 2.4))
ps = sorted(pay, key=lambda p: p['amt'])
ax.barh([lbl[p['_id']] for p in ps], [100 * p['amt'] / tot for p in ps], color=BLUE, height=0.55)
for i, p in enumerate(ps): ax.text(100 * p['amt'] / tot, i, f"  {100*p['amt']/tot:.0f}%  ({p['n']:,} payments)", va='center', fontsize=8.5, color=INK)
ax.set_xlim(0, 75); ax.xaxis.set_major_formatter(FuncFormatter(lambda x, _: f'{x:.0f}%')); ax.grid(axis='y', visible=False)
ax.set_title('Share of sales value by payment method', loc='left')
save(fig, 'payments')

# 5.8 stock status
st = collections.Counter()
for p in D['prods']:
    if not p.get('isActive', True): continue
    st['Out of stock' if p['stock'] <= 0 else 'Low stock' if p['stock'] <= p['reorderLevel'] else 'In stock'] += 1
order = ['In stock', 'Low stock', 'Out of stock']
fig, ax = plt.subplots(figsize=(6.5, 2.4))
ax.barh(order[::-1], [st[o] for o in order[::-1]], color=BLUE, height=0.55)
for i, o in enumerate(order[::-1]): ax.text(st[o], i, f'  {st[o]} products', va='center', fontsize=8.5, color=INK)
ax.set_xlim(0, max(st.values()) * 1.3); ax.grid(axis='y', visible=False)
ax.set_title('Current stock status of active products', loc='left')
save(fig, 'stock-status')
print(dict(st), labels[0], labels[-1], len(labels))
