#!/usr/bin/env python3
"""Metrics and drawing helpers for the My Expenses WEEKLY email (used by chart.py).

- compute(db, today) works out the week, the month to date, the usual ranges and the forecast.
  `today` is the last day included (Sunday of the summarised week); transactions dated
  later are ignored (future expenses are entered on purpose).
- Reads db/months/*.json and db/meta/config.json ONLY as data.
- render() rasterises an SVG (no matplotlib) with Playwright/Chromium at
  1200 px wide (400 CSS px canvas × deviceScaleFactor 3).
"""
import calendar, collections, datetime as dt, glob, json, os, statistics as st
import subprocess, tempfile

# ---------------------------------------------------------------- v19 style (My Expenses app, iOS skin)
C = dict(bg="#ffffff", ink="#0B0B0F", sec="#3C3C43", mut="#6C6C70", grid="#EFEFF4",
         line="#E5E5EA", acc="#4B3FD8", accs="#EDEBFB", grn="#8A8A8F", grns="#E6E6EC",
         red="#C4262E", reds="#FBE9EA", bar="#D6D6DE", track="#F2F2F7", med="#8A8A8F",
         band="#C7C7CC")
W = 400            # canvas CSS width; ×3 = 1200 px
SCALE = 3
FONT = "-apple-system,'SF Pro Text','Inter','Helvetica Neue',Arial,sans-serif"
FNUM = FONT  # the app uses the system font for figures too (tabular-nums)
MESES = "January February March April May June July August September October November December".split()
MES3 = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()


def eur(x, dec=2):
    return ("-" if x < 0 else "") + f"€{abs(x):,.{dec}f}"


def pct(x):
    return ("+" if x > 0 else "−" if x < 0 else "") + f"{abs(x):.0f}%"


def q(vals, p):
    """Percentile with linear interpolation (like numpy's default)."""
    v = sorted(vals)
    if not v:
        return 0.0
    k = (len(v) - 1) * p
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


def core(t):
    """Day-to-day spending: excludes trips (category e-travel), extraordinary items and transactions over €150."""
    return not (t["c"] == "e-travel" or t.get("x") or t["a"] > 150)


def load(db, hoy):
    cfg = json.load(open(os.path.join(db, "meta", "config.json"), encoding="utf-8"))
    cats = {c["id"]: c for c in cfg["cats"]}
    E = []
    for f in sorted(glob.glob(os.path.join(db, "months", "*.json"))):
        for t in json.load(open(f, encoding="utf-8")).get("txs", []):
            if t.get("k") != "e":
                continue
            d = dt.date.fromisoformat(t["d"][:10])
            if d <= hoy:
                E.append((d, t))
    return cats, E


def prev_months(y, m, n):
    out = []
    for _ in range(n):
        m -= 1
        if m == 0:
            m, y = 12, y - 1
        out.append((y, m))
    return out


def compute(db, hoy):
    cats, E = load(db, hoy)
    cname = lambda c: cats.get(c, {}).get("name", c)
    lun = hoy - dt.timedelta(days=hoy.weekday())
    sem = lambda a: [(d, t) for d, t in E if a <= d <= a + dt.timedelta(days=6)]

    # ---- weeks (16 shown, median over the 12 before the current one)
    weeks = []
    for i in range(15, -1, -1):
        a = lun - dt.timedelta(weeks=i)
        w = sem(a)
        weeks.append(dict(lun=a.isoformat(),
                          total=round(sum(t["a"] for _, t in w), 2),
                          corriente=round(sum(t["a"] for _, t in w if core(t)), 2),
                          sin_gasto=7 - len({d for d, _ in w})))
    prev12 = weeks[-13:-1]
    med_sem = st.median(w["corriente"] for w in prev12)
    cur = weeks[-1]
    sg_med = st.median(w["sin_gasto"] for w in prev12)
    sg_best16 = max(w["sin_gasto"] for w in weeks[:-1])
    wk = sem(lun)
    dias = [round(sum(t["a"] for d, t in wk if d == lun + dt.timedelta(days=i)), 2) for i in range(7)]
    movs = sorted(({"fecha": d.isoformat(), "importe": t["a"], "cat": cname(t["c"]),
                    "nota": (t.get("n") or "").strip() or "(no note)"} for d, t in wk),
                  key=lambda m: -m["importe"])

    # ---- current month: daily running total vs the 12 previous months
    y, m, dia = hoy.year, hoy.month, hoy.day
    ndays = calendar.monthrange(y, m)[1]
    mes_tx = [(d, t) for d, t in E if d.year == y and d.month == m]
    mes_total = sum(t["a"] for _, t in mes_tx)
    mes_core = sum(t["a"] for _, t in mes_tx if core(t))
    cur_cum = [round(sum(t["a"] for d, t in mes_tx if core(t) and d.day <= k), 2) for k in range(1, dia + 1)]
    hist = []
    for yy, mm in prev_months(y, m, 12):
        tx = [(d, t) for d, t in E if d.year == yy and d.month == mm and core(t)]
        cum = [sum(t["a"] for d, t in tx if d.day <= k) for k in range(1, 32)]
        hist.append(dict(ym=f"{yy}-{mm:02d}", cum=cum, total=cum[-1],
                         bycat={c: sum(t["a"] for d, t in tx if t["c"] == c and d.day <= dia)
                                for c in {t["c"] for _, t in tx}}))
    band = [dict(dia=k, p25=round(q([h["cum"][k - 1] for h in hist], .25), 2),
                 p50=round(q([h["cum"][k - 1] for h in hist], .5), 2),
                 p75=round(q([h["cum"][k - 1] for h in hist], .75), 2)) for k in range(1, ndays + 1)]
    resto = [h["total"] - h["cum"][dia - 1] for h in hist]
    proj = dict(p25=round(mes_core + q(resto, .25), 2), p50=round(mes_core + q(resto, .5), 2),
                p75=round(mes_core + q(resto, .75), 2))
    cierre_hab = dict(p25=round(q([h["total"] for h in hist], .25), 2),
                      p50=round(q([h["total"] for h in hist], .5), 2),
                      p75=round(q([h["total"] for h in hist], .75), 2))
    med_hoy = band[dia - 1]["p50"]

    # ---- the month's categories up to day N vs the same days of the 12 previous months
    act = collections.Counter()
    for _, t in mes_tx:
        if core(t):
            act[t["c"]] += t["a"]
    ids = set(act) | {c for h in hist for c in h["bycat"]}
    catrows = []
    for c in ids:
        vals = [h["bycat"].get(c, 0.0) for h in hist]
        r = dict(id=c, nombre=cname(c), valor=round(act.get(c, 0.0), 2),
                 p25=round(q(vals, .25), 2), p50=round(q(vals, .5), 2), p75=round(q(vals, .75), 2),
                 presupuesto=cats.get(c, {}).get("budget"))
        r["fuera"] = r["valor"] > r["p75"] + 0.005
        catrows.append(r)
    catrows.sort(key=lambda r: -max(r["valor"], r["p50"]))
    catrows = catrows[:5]

    # ---- repeated notes (≥3 times in 6 weeks, at least one this week)
    rep = []
    for n in {(t.get("n") or "").strip().lower() for _, t in wk} - {""}:
        xs = sorted(((d, t) for d, t in E if (t.get("n") or "").strip().lower() == n
                     and d > hoy - dt.timedelta(days=42)), key=lambda p: p[0])
        if len(xs) >= 3:
            gaps = [(b[0] - a[0]).days for a, b in zip(xs, xs[1:])]
            rep.append(dict(nota=xs[-1][1]["n"], cat=cname(xs[-1][1]["c"]), veces=len(xs),
                            desde=xs[0][0].isoformat(), suma=round(sum(t["a"] for _, t in xs), 2),
                            cada_dias=round(st.mean(gaps)), ultimo=xs[-1][1]["a"]))

    return dict(hoy=hoy.isoformat(), lunes=lun.isoformat(), semana=cur, semana_ant=weeks[-2],
                mediana_12sem=round(med_sem, 2), vs_mediana_pct=round((cur["corriente"] / med_sem - 1) * 100, 1),
                sin_gasto_mediana_12sem=sg_med, sin_gasto_mejor_16sem_previas=sg_best16,
                dias_semana=dias, movimientos=movs, semanas=weeks,
                mes=dict(ym=f"{y}-{m:02d}", dia=dia, dias_mes=ndays, total=round(mes_total, 2),
                         corriente=round(mes_core, 2), acumulado=cur_cum, banda=band,
                         mediana_a_hoy=med_hoy, vs_mediana_pct=round((mes_core / med_hoy - 1) * 100, 1),
                         prevision=proj, cierre_habitual=cierre_hab,
                         meses_ref=[h["ym"] for h in hist]),
                categorias=catrows, repetidos=rep)


# ---------------------------------------------------------------- SVG helpers (used by chart.py)
def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def T(x, y, s, size=12, fill=None, anchor="start", weight=400, fam=FONT, extra=""):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill or C["mut"]}" text-anchor="{anchor}" {extra}>{esc(s)}</text>')


def rrect(x, y, w, h, r, fill, extra=""):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(w,0):.1f}" height="{max(h,0):.1f}" rx="{r}" fill="{fill}" {extra}/>'


RENDER_JS = r"""
const {chromium}=require('playwright');
(async()=>{const [,,html,png,scale]=process.argv;
const b=await chromium.launch();
const p=await b.newPage({viewport:{width:400,height:400},deviceScaleFactor:+scale});
await p.goto('file://'+html); await p.locator('svg').screenshot({path:png}); await b.close();})();
"""


def render(svgtxt, out):
    with tempfile.TemporaryDirectory() as td:
        h = os.path.join(td, "g.html"); j = os.path.join(td, "r.js")
        open(h, "w", encoding="utf-8").write(
            '<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:#fff}svg{display:block}</style>' + svgtxt)
        open(j, "w").write(RENDER_JS)
        subprocess.run(["node", j, h, os.path.abspath(out), str(SCALE)], check=True)
