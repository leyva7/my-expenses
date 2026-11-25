"""Fold later re-definitions of a selector into its first definition (same @media context), only when no rule in
between touches the same property family, so the cascade result cannot change. Usage: cssmerge.py in.css out.css"""
import re, sys

src = open(sys.argv[1]).read()

def parse_block(s):
    """returns list of items: ('c', text) | ('r', sel, decls) | ('m', query, items) | ('k', raw)"""
    items, i, n = [], 0, len(s)
    while i < n:
        if s[i].isspace(): i += 1; continue
        if s.startswith('/*', i):
            j = s.index('*/', i) + 2; items.append(('c', s[i:j])); i = j; continue
        # read prelude up to { (or ; for statements)
        j = i; depth = 0
        while s[j] not in '{': j += 1
        pre = s[i:j].strip()
        # find matching }
        k = j + 1; depth = 1
        while depth:
            if s.startswith('/*', k): k = s.index('*/', k) + 2; continue
            if s[k] == '{': depth += 1
            elif s[k] == '}': depth -= 1
            k += 1
        body = s[j + 1:k - 1]
        if pre.startswith('@media'): items.append(('m', ' '.join(pre.split()), parse_block(body)))
        elif pre.startswith('@'): items.append(('k', s[i:k]))
        else: items.append(('r', pre, parse_decls(body)))
        i = k
    return items

def parse_decls(body):
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.S)
    out, cur, depth, q = [], '', 0, None
    for ch in body:
        if q:
            cur += ch
            if ch == q: q = None
            continue
        if ch in '"\'': q = ch
        elif ch == '(': depth += 1
        elif ch == ')': depth -= 1
        if ch == ';' and depth == 0:
            if cur.strip(): out.append(cur.strip())
            cur = ''
        else: cur += ch
    if cur.strip(): out.append(cur.strip())
    res = []
    for d in out:
        p, v = d.split(':', 1)
        res.append([p.strip().lower(), v.strip()])
    return res

SIZE = {'width', 'height', 'inline-size', 'block-size'}
def family(p):
    if p.startswith('--'): return p
    p = re.sub(r'^-(webkit|moz|ms)-', '', p)
    if p == 'all': return '*'
    if p in ('top', 'right', 'bottom', 'left') or p.startswith('inset'): return 'inset'
    if p in ('line-height',): return 'font'
    if p.endswith('gap'): return 'gap'
    if p.split('-')[0] in ('place', 'align', 'justify'): return 'align'
    base = p
    for pre in ('min-', 'max-'):
        if base.startswith(pre): base = base[len(pre):]
    if base in SIZE: return 'size'
    if p.startswith('text-wrap') or p == 'white-space': return 'white-space'
    return p.split('-')[0]

def conflicts(f, g): return f == g or f == '*' or g == '*'


def split_top(s, sep=','):
    out, cur, d = [], '', 0
    for ch in s:
        if ch in '([': d += 1
        elif ch in ')]': d -= 1
        if ch == sep and d == 0: out.append(cur); cur = ''
        else: cur += ch
    out.append(cur); return [x.strip() for x in out]

def spec(sel):
    a = b = c = 0; i = 0; s = sel
    while i < len(s):
        ch = s[i]
        if ch == '#': a += 1; i += 1; m = re.match(r'[\w-]+', s[i:]); i += m.end() if m else 0
        elif ch == '.': b += 1; i += 1; m = re.match(r'[\w-]+', s[i:]); i += m.end() if m else 0
        elif ch == '[': b += 1; i = s.index(']', i) + 1
        elif ch == ':':
            if s.startswith('::', i): c += 1; i += 2; m = re.match(r'[\w-]+', s[i:]); i += m.end() if m else 0; continue
            i += 1; m = re.match(r'[\w-]+', s[i:]); name = m.group(0) if m else ''; i += len(name)
            if i < len(s) and s[i] == '(':
                d = 1; k = i + 1
                while d: d += {'(': 1, ')': -1}.get(s[k], 0); k += 1
                arg = s[i + 1:k - 1]; i = k
                if name == 'where': continue
                if name in ('not', 'is', 'has', 'matches'): 
                    sp = max((spec(x) for x in split_top(arg)), default=(0, 0, 0)); a += sp[0]; b += sp[1]; c += sp[2]; continue
            if name in ('before', 'after', 'first-line', 'first-letter', 'placeholder', 'selection', 'backdrop'): c += 1
            else: b += 1
        elif re.match(r'[a-zA-Z]', ch): c += 1; m = re.match(r'[\w-]+', s[i:]); i += m.end()
        else: i += 1
    return (a, b, c)

def subject(sel):
    parts = re.split(r'\s*[>+~ ]\s*(?![^()]*\))', sel.strip())
    last = parts[-1] if parts else sel
    last = re.sub(r'::?[\w-]+(\([^)]*\))?', '', last)
    classes = set(re.findall(r'\.([\w-]+)', last)); ids = set(re.findall(r'#([\w-]+)', last))
    tag = re.match(r'[a-zA-Z][\w-]*', last); return classes, ids, tag.group(0).lower() if tag else None

def may_overlap(s1, s2):
    for x in split_top(s1):
        for y in split_top(s2):
            if spec(x) != spec(y): continue
            (c1, i1, t1), (c2, i2, t2) = subject(x), subject(y)
            if i1 and i2 and i1 != i2: continue
            if t1 and t2 and t1 != t2: continue
            if c1 and c2 and not (c1 & c2): continue
            if (c1 or i1) and (c2 or i2) and not (c1 & c2) and not (i1 & i2) and (i1 or i2) and not (c1 and c2): pass
            return True
    return False

norm_sel = lambda s: re.sub(r'\s*,\s*', ',', ' '.join(s.split()))
LAYER = re.compile(r'^/\*\s*(=+\s*v1[01]|-{3,}\s*(v10|motion)|v10: theme, charts)', re.I)

# flatten to entries
items = parse_block(src)
E = []  # dict(ctx, sel, decls, comments, kind)
def add(items, ctx):
    pend = []
    for it in items:
        if it[0] == 'c':
            if not LAYER.match(it[1]): pend.append(it[1])
        elif it[0] == 'r': E.append(dict(ctx=ctx, sel=norm_sel(it[1]), raw_sel=it[1], decls=it[2], com=pend, alive=True)); pend = []
        elif it[0] == 'k': E.append(dict(ctx=ctx, sel=None, raw=it[1], decls=[], com=pend, alive=True)); pend = []
        elif it[0] == 'm':
            if ctx: raise SystemExit('nested media')
            if pend: E.append(dict(ctx=ctx, sel=None, raw='', decls=[], com=pend, alive=True)); pend = []
            add(it[2], it[1])
    if pend: E.append(dict(ctx=ctx, sel=None, raw='', decls=[], com=pend, alive=True))
add(items, None)


# phase 0: a declaration that a later rule with the same selector, @media and importance sets again is dead
dead = 0
for i, e in enumerate(E):
    if e['sel'] is None: continue
    later = [x for x in E[i + 1:] if x['sel'] == e['sel'] and x['ctx'] == e['ctx']]
    if not later: continue
    lp = {(p, '!important' in v) for x in later for p, v in x['decls']}
    keepd = []
    for p, v in e['decls']:
        if (p, '!important' in v) in lp and sum(1 for q, _ in e['decls'] if q == p) == 1: dead += 1; continue
        keepd.append([p, v])
    e['decls'] = keepd
print('dead declarations removed', dead)

moved = 0
for j, e in enumerate(E):
    if e['sel'] is None or not e['alive']: continue
    if not e['decls']: e['alive'] = False; continue
    i = next((k for k in range(j) if E[k]['alive'] and E[k]['sel'] == e['sel'] and E[k]['ctx'] == e['ctx']), None)
    if i is None: continue
    tgt = E[i]
    between = [E[k] for k in range(i + 1, j) if E[k]['alive']]
    keep = []
    jprops = [p for p, _ in e['decls']]
    for p, v in e['decls']:
        f = family(p)
        blocked = any(conflicts(f, family(q)) and may_overlap(e['sel'], b['sel'] or '') for b in between if b['sel'] for q, _ in b['decls'])
        tcount = sum(1 for q, _ in tgt['decls'] if q == p)
        if blocked or (tcount > 1 and jprops.count(p) == 1): keep.append([p, v]); continue
        keep.append(None)
    movable = [d for d, k in zip(e['decls'], keep) if k is None]
    if not movable: continue
    # dependent order inside e: a kept decl that conflicts with a moved later one would flip; keep it simple:
    # only move when every kept decl's family differs from every moved decl's family
    kf = {family(d[0]) for d in keep if d}
    if any(family(p) in kf for p, _ in movable): continue
    for p, v in movable:
        tgt['decls'] = [d for d in tgt['decls'] if d[0] != p]
    # a moved decl must stay after any target decl of the same family (e.g. padding then padding-bottom)
    tgt['decls'] += [[p, v] for p, v in movable]
    moved += len(movable)
    e['decls'] = [d for d in keep if d]
    if e['com']: tgt['com'] = tgt['com'] + [c for c in e['com'] if c not in tgt['com']]; e['com'] = [] if not e['decls'] else e['com']
    if not e['decls']: e['alive'] = False


# phase 2: gather rules of the same @media query into one block, moving a rule up next to the previous rule of that
# query when nothing in between could compete with it
E = [e for e in E if e['alive']]
grouped = 0
changed = True
while changed:
    changed = False
    for j in range(len(E)):
        e = E[j]
        if not e['ctx'] or e['sel'] is None: continue
        if j and E[j - 1]['ctx'] == e['ctx']: continue
        t = next((k for k in range(j - 1, -1, -1) if E[k]['ctx'] == e['ctx']), None)
        if t is None: continue
        between = E[t + 1:j]
        if any(b['sel'] is None and b.get('raw', '').startswith('@') is False and b['ctx'] for b in between): pass
        ok = not any(conflicts(family(p), family(q)) and may_overlap(e['sel'], b['sel'] or '') for p, _ in e['decls'] for b in between if b['sel'] for q, _ in b['decls'])
        if ok:
            E.pop(j); E.insert(t + 1, e); grouped += 1; changed = True; break
print('rules regrouped', grouped)

# output
out, cur = [], None
def close():
    if cur is not None: out.append('}')
for e in E:
    if not e['alive']: continue
    if e['ctx'] != cur:
        close(); cur = e['ctx']
        if cur: out.append(cur + '{')
    ind = '  ' if cur else ''
    for c in e['com']: out.append(ind + c)
    if e['sel'] is None:
        if e.get('raw'): out.append(ind + e['raw'].strip())
        continue
    out.append(ind + e['raw_sel'].strip() + '{' + ';'.join(p + ':' + v for p, v in e['decls']) + '}')
close()
open(sys.argv[2], 'w').write('\n'.join(out) + '\n')
print('decls moved', moved, 'rules before', sum(1 for x in E if x['sel']), 'after', sum(1 for x in E if x['sel'] and x['alive']))
