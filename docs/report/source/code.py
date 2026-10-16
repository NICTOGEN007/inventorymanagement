import sys, os
from pygments import highlight
from pygments.lexers import TypeScriptLexer
from pygments.formatters import HtmlFormatter
R = '/home/user/inventorymanagement/'
OUT = sys.argv[1]
SNIPS = {
 'app-setup': ('apps/api/src/app.ts', 1, 28),
 'product-model': ('apps/api/src/models/product.ts', 5, 46),
 'gst': ('packages/shared/src/gst.ts', 24, 47),
 'ledger': ('apps/api/src/modules/inventory/ledger.ts', 34, 55),
 'weighted-cost': ('apps/api/src/modules/purchase-orders/service.ts', 254, 281),
 'auth': ('apps/api/src/middleware/auth.ts', 9, 35),
 'permissions': ('packages/shared/src/permissions.ts', 30, 52),
}
fmt = HtmlFormatter(style='one-dark', nowrap=True)
css = fmt.get_style_defs('.hl')
for name, (path, a, b) in SNIPS.items():
    lines = open(R + path).read().split('\n')[a-1:b]
    code = '\n'.join(lines)
    body = highlight(code, TypeScriptLexer(), fmt)
    hl = body.rstrip('\n').split('\n')
    rows = ''.join(f'<div class="ln"><span class="lnum">{a+i}</span><span class="tx">{l or " "}</span></div>' for i, l in enumerate(hl))
    html = f'''<html><head><meta charset="utf-8"><style>{css}
body{{margin:0;background:#fff}} #d{{display:inline-block;padding:0;background:#fff}}
.win{{background:#1f2329;border-radius:10px;padding:14px 18px 16px;min-width:900px;font-family:"DejaVu Sans Mono",monospace;font-size:14.5px;line-height:1.5}}
.bar{{display:flex;align-items:center;gap:8px;margin-bottom:10px}} .dot{{width:13px;height:13px;border-radius:50%}}
.path{{color:#9da5b4;font-family:"Liberation Sans",Arial,sans-serif;font-size:13px;margin-left:12px}}
.ln{{display:flex;white-space:pre;color:#abb2bf}} .lnum{{color:#5c6370;width:3.2em;text-align:right;padding-right:1.2em;flex:none;user-select:none}}
.hl{{background:transparent}}</style></head><body><div id="d"><div class="win"><div class="bar"><span class="dot" style="background:#ff5f56"></span><span class="dot" style="background:#ffbd2e"></span><span class="dot" style="background:#27c93f"></span><span class="path">{path}</span></div><div class="hl">{rows}</div></div></div></body></html>'''
    open(f'{OUT}/{name}.html', 'w').write(html)
print('ok')
