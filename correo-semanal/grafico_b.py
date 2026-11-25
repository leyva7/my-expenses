#!/usr/bin/env python3
"""Gráfico + insights del correo SEMANAL de Mis Gastos (variante B).

Uso:
    python3 -I grafico.py --db RUTA/db --hoy 2026-11-15 --out grafico.png [--json datos.json]

- --hoy es el último día incluido (domingo de la semana resumida). Se ignoran
  los movimientos con fecha posterior (los gastos futuros son intencionados).
- Lee db/months/*.json y db/meta/config.json SOLO como datos.
- Dibuja un SVG (sin matplotlib) y lo rasteriza con Playwright/Chromium a
  1200 px de ancho (lienzo de 400 px CSS x deviceScaleFactor 3).
- Escribe además un JSON con las cifras, los textos de insights y el texto
  alternativo, para que la tarea programada monte el HTML del correo.
"""
import argparse, calendar, collections, datetime as dt, glob, json, os, statistics as st
import subprocess, sys, tempfile

# ---------------------------------------------------------------- estilo v19 (app «Mis Gastos», piel iOS)
C = dict(bg="#ffffff", ink="#0B0B0F", sec="#3C3C43", mut="#6C6C70", grid="#EFEFF4",
         line="#E5E5EA", acc="#4B3FD8", accs="#EDEBFB", grn="#8A8A8F", grns="#E6E6EC",
         red="#C4262E", reds="#FBE9EA", bar="#D6D6DE", track="#F2F2F7", med="#8A8A8F",
         band="#C7C7CC")
W = 400            # ancho CSS del lienzo; x3 = 1200 px
SCALE = 3
FONT = "-apple-system,'SF Pro Text','Inter','Helvetica Neue',Arial,sans-serif"
FNUM = FONT  # la app usa la fuente del sistema también para las cifras (tabular-nums)
MESES = "enero febrero marzo abril mayo junio julio agosto septiembre octubre noviembre diciembre".split()
MES3 = "ene feb mar abr may jun jul ago sep oct nov dic".split()


def eur(x, dec=2):
    s = f"{x:,.{dec}f}".replace(",", "X").replace(".", ",").replace("X", ".")
    return s + " €"


def pct(x):
    return ("+" if x > 0 else "−" if x < 0 else "") + f"{abs(x):.0f} %"


def q(vals, p):
    """Percentil con interpolación lineal (como numpy por defecto)."""
    v = sorted(vals)
    if not v:
        return 0.0
    k = (len(v) - 1) * p
    f = int(k)
    c = min(f + 1, len(v) - 1)
    return v[f] + (v[c] - v[f]) * (k - f)


def core(t):
    """Gasto corriente: fuera Viajes, extraordinarios y movimientos > 150 €."""
    return not (t["c"] == "e-viajes" or t.get("x") or t["a"] > 150)


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

    # ---- semanas (16 visibles, mediana sobre las 12 anteriores a la actual)
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
                    "nota": (t.get("n") or "").strip() or "(sin nota)"} for d, t in wk),
                  key=lambda m: -m["importe"])

    # ---- mes en curso: acumulado diario vs 12 meses anteriores
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

    # ---- categorías del mes a día N vs mismos días de los 12 meses anteriores
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

    # ---- notas que se repiten (≥3 veces en 6 semanas, con alguna esta semana)
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


# ---------------------------------------------------------------- textos
def textos(M):
    mes = M["mes"]
    mname = MESES[int(mes["ym"][5:]) - 1]
    s = M["semana"]
    ins = []
    # 1. Ritmo / previsión del mes
    v = mes["vs_mediana_pct"]
    tono = "bueno" if v <= -10 else "vigilar" if v >= 10 else "info"
    rel = "por debajo de" if v < 0 else "por encima de"
    ins.append(dict(tono=tono, titulo=f"{mname.capitalize()} va un {abs(v):.0f}\u00a0% {rel} lo habitual",
                    frase=f"Llevas {eur(mes['corriente'])} a día {mes['dia']} (lo normal a estas alturas: "
                          f"{eur(mes['mediana_a_hoy'], 0)}). Si la segunda quincena es como siempre, cierras en torno a "
                          f"{eur(mes['prevision']['p50'], 0)}; un mes típico acaba en {eur(mes['cierre_habitual']['p50'], 0)}."))
    # 2. Qué vigilar: categoría por encima de su banda (y nota repetida si la hay)
    fuera = sorted((c for c in M["categorias"] if c["fuera"]), key=lambda c: -(c["valor"] - c["p75"]))
    if fuera:
        c = fuera[0]
        r = next((r for r in M["repetidos"] if r["cat"] == c["nombre"]), None)
        if r:
            d0 = dt.date.fromisoformat(r["desde"])
            frase = (f"{r['nota']}: {r['veces']} sesiones desde el {d0.day} {MES3[d0.month-1]} ({eur(r['suma'])}), "
                     f"una cada ~{r['cada_dias']} días. Normalmente {c['nombre']} es 0 € a mitad de mes; a este ritmo son "
                     f"unos {eur(r['ultimo'] * 30 / r['cada_dias'], 0)} al mes." if c["p75"] == 0 else
                     f"{r['nota']}: {r['veces']} veces desde el {d0.day} {MES3[d0.month-1]} ({eur(r['suma'])}).")
        else:
            frase = f"Llevas {eur(c['valor'])}; lo normal a estas alturas es {eur(c['p25'], 0)}–{eur(c['p75'], 0)}."
        ins.append(dict(tono="vigilar", titulo=f"{c['nombre']} se sale de lo normal", frase=frase))
    # 3. La semana
    if s["sin_gasto"] > M["sin_gasto_mejor_16sem_previas"]:
        t = f"{s['sin_gasto']} días sin gastar: tu mejor semana en 16"
    else:
        t = f"{s['sin_gasto']} de 7 días sin gastar"
    det = ", ".join(f"{m['nota']} {eur(m['importe'])}" for m in M["movimientos"][:3])
    ins.append(dict(tono="bueno" if s["sin_gasto"] > M["sin_gasto_mediana_12sem"] else "info", titulo=t,
                    frase=f"Solo {len(M['movimientos'])} movimientos ({det}). Lo normal son "
                          f"{M['sin_gasto_mediana_12sem']:g} días sin gastar por semana.".replace(".5 ", ",5 ")))
    l = dt.date.fromisoformat(M["lunes"]); d = dt.date.fromisoformat(M["hoy"])
    alt = (f"Gráfico. 1) {mname.capitalize()} acumulado sin viajes ni compras grandes: {eur(mes['corriente'])} a día "
           f"{mes['dia']}, frente a una mediana de {eur(mes['mediana_a_hoy'])} (zona habitual "
           f"{eur(mes['banda'][mes['dia']-1]['p25'], 0)}–{eur(mes['banda'][mes['dia']-1]['p75'], 0)}); previsión de cierre "
           f"{eur(mes['prevision']['p50'], 0)}. 2) Últimas 16 semanas: esta, {eur(s['corriente'])}; mediana de 12 semanas "
           f"{eur(M['mediana_12sem'])}. 3) Por categoría a día {mes['dia']}: "
           + "; ".join(f"{c['nombre']} {eur(c['valor'])} " + (f"(normal {eur(c['p25'],0)}–{eur(c['p75'],0)})" if c['p75'] > 0 else "(normalmente 0 €)") for c in M["categorias"]) + ".")
    asunto = (f"Semana {l.day}–{d.day} {MES3[d.month-1]}: {eur(s['total'])} "
              f"({pct(M['vs_mediana_pct'])} vs tu semana habitual)")
    return dict(insights=ins[:3], alt=alt, asunto=asunto)


# ---------------------------------------------------------------- SVG
def esc(s):
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def T(x, y, s, size=12, fill=None, anchor="start", weight=400, fam=FONT, extra=""):
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill or C["mut"]}" text-anchor="{anchor}" {extra}>{esc(s)}</text>')


def rrect(x, y, w, h, r, fill, extra=""):
    return f'<rect x="{x:.1f}" y="{y:.1f}" width="{max(w,0):.1f}" height="{max(h,0):.1f}" rx="{r}" fill="{fill}" {extra}/>'


def header(y, eyebrow, title):
    return [T(20, y, eyebrow.upper(), 11.5, C["mut"], weight=600, extra='letter-spacing="1.2"'),
            T(20, y + 20, title, 15, C["ink"], weight=600)]


def svg(M):
    mes = M["mes"]; o = []; L, R = 20, W - 20
    mname = MESES[int(mes["ym"][5:]) - 1]
    # ===== Panel 1: acumulado del mes
    y0 = 26
    o += header(y0, f"{mname} · acumulado día a día", f"Llevas {eur(mes['corriente'])}; lo normal, {eur(mes['mediana_a_hoy'], 0)}")
    top, h = y0 + 44, 150
    nd, dia = mes["dias_mes"], mes["dia"]
    ymax = max(max(b["p75"] for b in mes["banda"]), mes["prevision"]["p75"]) * 1.08
    step = 100 if ymax <= 600 else 200
    px = lambda d: L + 4 + (R - 78 - L - 4) * (d - 1) / (nd - 1)
    py = lambda v: top + h - h * v / ymax
    for g in range(0, int(ymax) + 1, step):
        o.append(f'<line x1="{L}" x2="{R-74}" y1="{py(g):.1f}" y2="{py(g):.1f}" stroke="{C["grid"]}" stroke-width="1"/>')
        if g: o.append(T(L, py(g) - 4, eur(g, 0), 11, C["mut"], fam=FNUM))
    B = mes["banda"]
    poly = " ".join(f"{px(b['dia']):.1f},{py(b['p75']):.1f}" for b in B) + " " + \
           " ".join(f"{px(b['dia']):.1f},{py(b['p25']):.1f}" for b in reversed(B))
    o.append(f'<polygon points="{poly}" fill="{C["grns"]}"/>')
    o.append(f'<polyline points="{" ".join(f"{px(b["dia"]):.1f},{py(b["p50"]):.1f}" for b in B)}" fill="none" '
             f'stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3" opacity=".75"/>')
    # etiqueta banda
    bx = px(nd - 7)
    o.append(T(bx, py(B[nd - 8]["p75"]) - 6, "zona habitual", 11, C["grn"], "middle", 600))
    # previsión
    P = mes["prevision"]
    o.append(f'<line x1="{px(dia):.1f}" y1="{py(mes["corriente"]):.1f}" x2="{px(nd):.1f}" y2="{py(P["p50"]):.1f}" '
             f'stroke="{C["acc"]}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>')
    o.append(f'<line x1="{px(nd):.1f}" x2="{px(nd):.1f}" y1="{py(P["p25"]):.1f}" y2="{py(P["p75"]):.1f}" stroke="{C["acc"]}" stroke-width="2" opacity=".35" stroke-linecap="round"/>')
    o.append(f'<circle cx="{px(nd):.1f}" cy="{py(P["p50"]):.1f}" r="4" fill="#fff" stroke="{C["acc"]}" stroke-width="2"/>')
    o.append(T(px(nd) + 8, py(P["p50"]) - 2, f"≈{eur(P['p50'], 0)}", 12, C["ink"], weight=600, fam=FNUM))
    o.append(T(px(nd) + 8, py(P["p50"]) + 12, "previsión", 11.5, C["mut"]))
    # línea real
    pts = " ".join(f"{px(k+1):.1f},{py(v):.1f}" for k, v in enumerate(mes["acumulado"]))
    o.append(f'<polyline points="{pts}" fill="none" stroke="{C["acc"]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>')
    cx, cy = px(dia), py(mes["corriente"])
    o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="{C["acc"]}" stroke="#fff" stroke-width="2"/>')
    o.append(T(cx + 4, cy + 22, eur(mes["corriente"]), 12.5, C["acc"], "middle", 700, FNUM))
    o.append(T(cx + 4, cy + 36, "hoy", 11, C["acc"], "middle"))
    # eje x
    for d in (1, 8, 15, 22, nd):
        o.append(T(L if d == 1 else px(d), top + h + 16, f"{d} {MES3[int(mes['ym'][5:])-1]}" if d == 1 else str(d), 11.5, C["mut"], "start" if d == 1 else "middle", fam=FNUM))
    y = top + h + 30
    o.append(T(L, y, "– – mediana · sin viajes ni gastos > 150 € · 12 meses previos", 11.5, C["mut"]))

    # ===== Panel 2: 16 semanas
    y0 = y + 34
    o.append(f'<line x1="{L}" x2="{R}" y1="{y0-22}" y2="{y0-22}" stroke="{C["line"]}"/>')
    s = M["semana"]
    o += header(y0, "últimas 16 semanas", f"Esta semana: {eur(s['corriente'])} ({pct(M['vs_mediana_pct'])} vs habitual)")
    top, h = y0 + 44, 104
    W16 = M["semanas"]
    cap = max(w["corriente"] for w in W16) * 1.2
    cap = (int(cap / 50) + 1) * 50
    pyw = lambda v: top + h - h * min(v, cap) / cap
    slot = (R - L) / 16
    for g in range(0, int(cap) + 1, 50 if cap <= 250 else 100):
        o.append(f'<line x1="{L}" x2="{R}" y1="{pyw(g):.1f}" y2="{pyw(g):.1f}" stroke="{C["grid"]}"/>')
    for i, w in enumerate(W16):
        x = L + i * slot + slot * .18; bw = slot * .64
        last = i == 15
        col = C["acc"] if last else C["bar"]
        if w["total"] > w["corriente"] + .005:  # parte puntual (viajes / >150 €), recortada al tope
            ytop = pyw(w["total"])
            o.append(rrect(x, ytop, bw, pyw(w["corriente"]) - ytop, 2, "none",
                           f'stroke="{C["med"]}" stroke-width="1" stroke-dasharray="2 2"'))
            if w["total"] > cap:
                o.append(T(x + bw / 2, ytop - 3, "▲", 7, C["med"], "middle"))
        yb = pyw(w["corriente"])
        o.append(rrect(x, yb, bw, top + h - yb, 2.5, col))
        if last:
            o.append(rrect(x + bw / 2 - 22, yb - 21, 44, 16, 4, "#fff"))
            o.append(T(x + bw / 2, yb - 8, eur(w["corriente"], 0), 12.5, C["acc"], "middle", 700, FNUM))
    ym = pyw(M["mediana_12sem"])
    o.insert(len(o) - 2, f'<line x1="{L}" x2="{R}" y1="{ym:.1f}" y2="{ym:.1f}" stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    for i in (0, 4, 8, 12):
        d = dt.date.fromisoformat(W16[i]["lun"])
        o.append(T(L + i * slot + slot / 2, top + h + 16, f"{d.day} {MES3[d.month-1]}", 11.5, C["mut"], "middle", fam=FNUM))
    o.append(T(L + 15 * slot + slot / 2, top + h + 16, "esta", 11.5, C["acc"], "middle", 600))
    y = top + h + 32
    o.append(f'<line x1="{L}" x2="{L+14}" y1="{y-4}" y2="{y-4}" stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    o.append(T(L + 19, y, f"semana habitual (mediana 12 sem.): {eur(M['mediana_12sem'])}", 11.5, C["sec"]))
    y += 17
    o.append(rrect(L + 2, y - 9, 10, 9, 1.5, "none", f'stroke="{C["med"]}" stroke-dasharray="2 2"'))
    o.append(T(L + 19, y, "viajes y gastos > 150 € (fuera de la comparación)", 11.5, C["mut"]))

    # ===== Panel 3: categorías vs banda
    y0 = y + 34
    o.append(f'<line x1="{L}" x2="{R}" y1="{y0-22}" y2="{y0-22}" stroke="{C["line"]}"/>')
    o += header(y0, f"por categoría · 1–{mes['dia']} {MES3[int(mes['ym'][5:])-1]}", "Lo que llevas frente a lo normal")
    top = y0 + 38
    cats = M["categorias"]
    vmax = max(max(c["valor"], c["p75"]) for c in cats) * 1.05
    tx0, tx1 = L + 104, R - 64
    pc = lambda v: tx0 + (tx1 - tx0) * v / vmax
    for i, c in enumerate(cats):
        yy = top + i * 30
        o.append(T(L, yy + 12, c["nombre"].split("/")[0], 13, C["ink"], weight=500))
        o.append(rrect(tx0, yy + 2, tx1 - tx0, 12, 6, C["track"]))
        if c["p75"] > 0:
            o.append(rrect(pc(c["p25"]), yy, max(pc(c["p75"]) - pc(c["p25"]), 3), 16, 4, C["grns"],
                           f'stroke="{C["grn"]}" stroke-width="1"'))
        else:
            o.append(rrect(tx0 - 2, yy, 3, 16, 1.5, C["grn"]))
        col = C["red"] if c["fuera"] else C["acc"]
        if c["valor"] > 0:
            o.append(rrect(tx0, yy + 5, max(pc(c["valor"]) - tx0, 4), 6, 3, col))
        o.append(T(R, yy + 13, eur(c["valor"]), 13, C["red"] if c["fuera"] else C["ink"], "end", 600, FNUM))
    y = top + len(cats) * 30 + 6
    o.append(rrect(L, y - 8, 14, 9, 2.5, C["grns"], f'stroke="{C["grn"]}"'))
    o.append(T(L + 19, y, "normal (50 % central)", 11.5, C["mut"]))
    o.append(rrect(L + 168, y - 6, 14, 5, 2.5, C["red"]))
    o.append(T(L + 187, y, "por encima de lo normal", 11.5, C["mut"]))
    H = y + 16
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H:.0f}" viewBox="0 0 {W} {H:.0f}" '
            f'style="font-variant-numeric:tabular-nums">'
            f'<rect width="{W}" height="{H:.0f}" fill="{C["bg"]}"/>' + "".join(o) + "</svg>")


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True); ap.add_argument("--hoy", required=True)
    ap.add_argument("--out", default="grafico.png"); ap.add_argument("--json")
    a = ap.parse_args()
    M = compute(a.db, dt.date.fromisoformat(a.hoy))
    M.update(textos(M))
    render(svg(M), a.out)
    if a.json:
        json.dump(M, open(a.json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print(json.dumps({k: M[k] for k in ("asunto", "insights", "alt")}, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
