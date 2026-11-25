#!/usr/bin/env python3
"""Single image + texts of the My Expenses WEEKLY email (variant C1, "headline + a single image").

Usage:
    python3 -I chart.py --db PATH/db --today 2026-11-15 --out chart.png [--json data.json]

Uses the metrics in metrics.py:
compute() -> usual week (median of 12 weeks), month zone (p25–p75 of the 12 previous months
up to day N), month-end forecast and categories against their band.
Adds: number of transactions this week against the 12-week median ("maybe one is missing"
warning if < 40 %), the C1 headline and 3 insights, and a 2-panel image
(month to date + categories) 1200 px wide (400 CSS px × 3).
"""
import argparse, datetime as dt, json, os, statistics as st, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import metrics as B  # noqa: E402

C, eur, pct, T, rrect, esc = B.C, B.eur, B.pct, B.T, B.rrect, B.esc
MESES, MES3 = B.MESES, B.MES3
DIAS = "Monday Tuesday Wednesday Thursday Friday Saturday Sunday".split()
W = B.W


def extra(db, hoy, M):
    """Number of transactions (all, trips included) this week vs the median of the 12 previous weeks."""
    _, E = B.load(db, hoy)
    lun = dt.date.fromisoformat(M["lunes"])
    cnt = []
    for i in range(12, -1, -1):
        a = lun - dt.timedelta(weeks=i)
        cnt.append(sum(1 for d, _ in E if a <= d <= a + dt.timedelta(days=6)))
    ult = max((d for d, _ in E if lun <= d <= hoy), default=None)
    M["movs_semana"] = cnt[-1]
    M["movs_mediana_12sem"] = st.median(cnt[:-1])
    M["ultimo_mov"] = ult.isoformat() if ult else None
    M["pocos_movs"] = cnt[-1] < 0.4 * M["movs_mediana_12sem"]


def num(x):
    return f"{x:g}"


def textos(M):
    mes, s = M["mes"], M["semana"]
    mname = MESES[int(mes["ym"][5:]) - 1]
    v = M["vs_mediana_pct"]
    # ---- headline (one sentence; % rounded like the pill)
    if v <= -5:
        tit = f"Quiet week: {eur(s['corriente'], 0)}, {abs(v):.0f}% less than usual"
    elif v >= 15:
        tit = f"Expensive week: {eur(s['corriente'], 0)}, {v:.0f}% more than usual"
    else:
        tit = f"Normal week: {eur(s['corriente'], 0)}, in line with usual"
    ins = []
    # 1. Incomplete-data warning
    if M["pocos_movs"]:
        u = dt.date.fromisoformat(M["ultimo_mov"]) if M["ultimo_mov"] else None
        desde = f", and nothing since {DIAS[u.weekday()]} {u.day}" if u and u < dt.date.fromisoformat(M["hoy"]) else ""
        ins.append(dict(tono="vigilar", titulo=f"Only {M['movs_semana']} transactions logged",
                        frase=f"Usually there are {num(M['movs_mediana_12sem'])} a week{desde}. "
                              f"Some may be missing: if so, add them so the figures are accurate."))
    # 2. The month
    vm = mes["vs_mediana_pct"]
    tono = "bueno" if vm <= -10 else "vigilar" if vm >= 10 else "info"
    rel = "below" if vm < 0 else "above"
    ins.append(dict(tono=tono, titulo=f"{mname} is {abs(vm):.0f}% {rel} usual",
                    frase=f"{eur(mes['corriente'])} spent by day {mes['dia']}; the usual by now is {eur(mes['mediana_a_hoy'], 0)}. "
                          f"If the rest of the month goes as usual, you will end at ≈{eur(mes['prevision']['p50'], 0)} "
                          f"(a typical month: {eur(mes['cierre_habitual']['p50'], 0)})."))
    # 3. Category above its usual range (with the repeated note if it explains it)
    fuera = sorted((c for c in M["categorias"] if c["fuera"]), key=lambda c: -(c["valor"] - c["p75"]))
    if fuera:
        c = fuera[0]
        r = next((r for r in M["repetidos"] if r["cat"] == c["nombre"]), None)
        if r:
            d0 = dt.date.fromisoformat(r["desde"])
            frase = (f"{r['nota']}: {r['veces']} times since {d0.day} {MES3[d0.month-1]} ({eur(r['suma'])}), "
                     f"one every ~{r['cada_dias']} days; at this pace, about {eur(r['ultimo'] * 30 / r['cada_dias'], 0)} a month.")
        elif c["p75"] == 0:
            frase = f"{eur(c['valor'])} so far; it is usually €0 at this point of the month."
        else:
            frase = f"{eur(c['valor'])} so far; the usual by now is {eur(c['p25'], 0)}–{eur(c['p75'], 0)}."
        ins.append(dict(tono="vigilar", titulo=f"{c['nombre'].split('/')[0]} is higher than usual", frase=frase))
    elif s["sin_gasto"] > M["sin_gasto_mediana_12sem"]:
        ins.append(dict(tono="bueno", titulo=f"{s['sin_gasto']} of 7 days with no spending",
                        frase=f"Usually {num(M['sin_gasto_mediana_12sem'])} a week."))
    l = dt.date.fromisoformat(M["lunes"]); d = dt.date.fromisoformat(M["hoy"])
    b = mes["banda"][mes["dia"] - 1]
    alt = (f"{mname} to date (excluding trips and expenses over €150): {eur(mes['corriente'])} by day {mes['dia']}; "
           f"usual range by now {eur(b['p25'], 0)}–{eur(b['p75'], 0)} (median {eur(b['p50'], 0)}); "
           f"month-end forecast ≈{eur(mes['prevision']['p50'], 0)}. By category, against usual: "
           + "; ".join(f"{c['nombre']} {eur(c['valor'])} " + (f"(usual {eur(c['p25'],0)}–{eur(c['p75'],0)})" if c['p75'] > 0 else "(usually €0)")
                       for c in M["categorias"]) + ".")
    asunto = f"Week {l.day}–{d.day} {MES3[d.month-1]}: {eur(s['total'], 0 if s['total'] == int(s['total']) else 2)} spent"
    return dict(titular=tit, insights=ins[:3], alt=alt, asunto=asunto)


# ---------------------------------------------------------------- SVG (2 panels, compact)
def eyebrow(y, s):
    return T(20, y, s, 16, C["ink"], weight=600, extra='letter-spacing="-0.2"')


def svg(M):
    mes = M["mes"]; o = []; L, R = 20, W - 20
    mi = int(mes["ym"][5:]) - 1
    # ===== Panel 1: month to date vs usual zone + forecast
    o.append(eyebrow(24, f"{MESES[mi]}, day by day"))
    top, h = 40, 118
    nd, dia = mes["dias_mes"], mes["dia"]
    ymax = max(max(b["p75"] for b in mes["banda"]), mes["prevision"]["p75"]) * 1.08
    step = 100 if ymax <= 600 else 200
    px = lambda d: L + 4 + (R - 78 - L - 4) * (d - 1) / (nd - 1)
    py = lambda v: top + h - h * v / ymax
    for g in range(0, int(ymax) + 1, step):
        o.append(f'<line x1="{L}" x2="{R-74}" y1="{py(g):.1f}" y2="{py(g):.1f}" stroke="{C["grid"]}" stroke-width="1"/>')
        if g: o.append(T(L, py(g) - 4, eur(g, 0), 11.5, C["mut"], fam=B.FNUM))
    Bd = mes["banda"]
    poly = " ".join(f"{px(b['dia']):.1f},{py(b['p75']):.1f}" for b in Bd) + " " + \
           " ".join(f"{px(b['dia']):.1f},{py(b['p25']):.1f}" for b in reversed(Bd))
    o.append(f'<polygon points="{poly}" fill="{C["grns"]}"/>')
    o.append(f'<polyline points="{" ".join(f"{px(b["dia"]):.1f},{py(b["p50"]):.1f}" for b in Bd)}" fill="none" '
             f'stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".75"/>')
    P = mes["prevision"]
    o.append(f'<line x1="{px(dia):.1f}" y1="{py(mes["corriente"]):.1f}" x2="{px(nd):.1f}" y2="{py(P["p50"]):.1f}" '
             f'stroke="{C["acc"]}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>')
    o.append(f'<line x1="{px(nd):.1f}" x2="{px(nd):.1f}" y1="{py(P["p25"]):.1f}" y2="{py(P["p75"]):.1f}" stroke="{C["acc"]}" stroke-width="2" opacity=".35" stroke-linecap="round"/>')
    o.append(f'<circle cx="{px(nd):.1f}" cy="{py(P["p50"]):.1f}" r="4" fill="#fff" stroke="{C["acc"]}" stroke-width="2"/>')
    o.append(T(px(nd) + 8, py(P["p50"]) + 2, f"≈{eur(P['p50'], 0)}", 13, C["ink"], weight=600, fam=B.FNUM))
    o.append(T(px(nd) + 8, py(P["p50"]) + 17, "forecast", 12, C["mut"]))
    pts = " ".join(f"{px(k+1):.1f},{py(v):.1f}" for k, v in enumerate(mes["acumulado"]))
    o.append(f'<polyline points="{pts}" fill="none" stroke="{C["acc"]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>')
    cx, cy = px(dia), py(mes["corriente"])
    o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="{C["acc"]}" stroke="#fff" stroke-width="2"/>')
    o.append(rrect(cx - 44, cy + 9, 88, 17, 4, "#fff"))
    o.append(T(cx, cy + 22, eur(mes["corriente"]) + " today", 13, C["acc"], "middle", 700, B.FNUM))
    for d in (1, 8, 15, 22, nd):
        o.append(T(L if d == 1 else px(d), top + h + 16, f"{MES3[mi]} {d}" if d == 1 else str(d), 12,
                   C["mut"], "start" if d == 1 else "middle", fam=B.FNUM))
    y = top + h + 34
    o.append(rrect(L, y - 9, 14, 10, 2.5, C["grns"]))
    o.append(T(L + 19, y, "usual range", 12, C["mut"]))
    o.append(f'<line x1="{L+108}" x2="{L+122}" y1="{y-4}" y2="{y-4}" stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    o.append(T(L + 127, y, "median", 12, C["mut"]))
    o.append(f'<line x1="{L+192}" x2="{L+208}" y1="{y-4}" y2="{y-4}" stroke="{C["acc"]}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>')
    o.append(T(L + 213, y, "forecast", 12, C["mut"]))

    # ===== Panel 2: the month's categories vs their band
    y0 = y + 16
    o.append(f'<line x1="{L}" x2="{R}" y1="{y0}" y2="{y0}" stroke="{C["line"]}"/>')
    o.append(eyebrow(y0 + 24, "By category, against usual"))
    o.append(T(R, y0 + 24, f"{MES3[mi]} 1–{mes['dia']}", 12, C["mut"], "end", fam=B.FNUM))
    top = y0 + 40
    cats = M["categorias"]
    vmax = max(max(c["valor"], c["p75"]) for c in cats) * 1.05
    tx0, tx1 = L + 104, R - 64
    pc = lambda v: tx0 + (tx1 - tx0) * v / vmax
    for i, c in enumerate(cats):
        yy = top + i * 25
        nm = c["nombre"].split("/")[0]
        nm = nm if len(nm) <= 13 else nm[:12].rstrip() + "…"   # keep clear of the bar
        o.append(T(L, yy + 12, nm, 13, C["ink"]))
        o.append(rrect(tx0, yy + 2, tx1 - tx0, 12, 6, C["track"]))
        if c["p75"] > 0:
            o.append(rrect(pc(c["p25"]), yy, max(pc(c["p75"]) - pc(c["p25"]), 3), 16, 4, C["grns"],
                           f'stroke="{C["band"]}" stroke-width="1"'))
        else:
            o.append(rrect(tx0 - 2, yy, 3, 16, 1.5, C["band"]))
        col = C["red"] if c["fuera"] else C["acc"]
        if c["valor"] > 0:
            o.append(rrect(tx0, yy + 5, max(pc(c["valor"]) - tx0, 4), 6, 3, col))
        o.append(T(R, yy + 13, eur(c["valor"]), 13, C["red"] if c["fuera"] else C["ink"], "end", 600, B.FNUM))
    y = top + len(cats) * 25 + 10
    o.append(rrect(L, y - 8, 14, 9, 2.5, C["grns"], f'stroke="{C["band"]}"'))
    o.append(T(L + 19, y, "usual (middle 50%)", 12, C["mut"]))
    o.append(rrect(L + 190, y - 6, 14, 5, 2.5, C["red"]))
    o.append(T(L + 209, y, "above usual", 12, C["mut"]))
    H = y + 14
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H:.0f}" viewBox="0 0 {W} {H:.0f}" '
            f'style="font-variant-numeric:tabular-nums">'
            f'<rect width="{W}" height="{H:.0f}" fill="{C["bg"]}"/>' + "".join(o) + "</svg>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True); ap.add_argument("--today", "--hoy", dest="hoy", required=True, help="last day included, YYYY-MM-DD")
    ap.add_argument("--out", default="chart.png"); ap.add_argument("--json")
    a = ap.parse_args()
    hoy = dt.date.fromisoformat(a.hoy)
    M = B.compute(a.db, hoy)
    extra(a.db, hoy, M)
    M.update(textos(M))
    B.render(svg(M), a.out)
    if a.json:
        json.dump(M, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: M[k] for k in ("asunto", "titular", "insights", "alt")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
