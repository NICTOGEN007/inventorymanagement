import json, re, subprocess, sys
pdf, markers_file, out = sys.argv[1:4]
M = json.load(open(markers_file))
text = subprocess.run(['pdftotext', '-layout', pdf, '-'], capture_output=True, text=True).stdout
pages = text.split('\f')
def norm(s): return re.sub(r'\s+', ' ', s).strip()
labels = []
for t in pages:
    lines = [l for l in t.split('\n') if l.strip()]
    lab = None
    for l in reversed(lines[-3:]):
        m = re.search(r'Dept Of CSE.*?(\d+)\s*$', l)
        if m: lab = ('body', m.group(1)); break
        m = re.fullmatch(r'\s*([IVXLC]+)\s*', l)
        if m: lab = ('front', m.group(1)); break
    labels.append(lab)
res = {}
for mk in M['front']:
    for i, t in enumerate(pages):
        lines = [l.strip() for l in t.split('\n') if l.strip()]
        if labels[i] and labels[i][0] == 'front' and lines and lines[0] == mk['text']:
            res[mk['key']] = labels[i][1]; break
for mk in M['body']:
    for i, t in enumerate(pages):
        if not labels[i] or labels[i][0] != 'body': continue
        lines = [norm(l) for l in t.split('\n')]
        hit = any(l == mk['text'] or l.startswith(mk['text'] + ' ') or (mk['text'].endswith(':') and l.startswith(mk['text'])) for l in lines)
        if hit: res[mk['key']] = labels[i][1]; break
missing = [m['key'] for m in M['front'] + M['body'] if m['key'] not in res]
json.dump(res, open(out, 'w'), indent=1)
print('found', len(res), 'missing', missing)
