#!/usr/bin/env python3
"""Imagen única + textos del correo SEMANAL de Mis Gastos (variante C1, «titular + una sola imagen»).

Uso:
    python3 -I grafico.py --db RUTA/db --hoy 2026-11-15 --out grafico.png [--json datos.json]

Reutiliza las métricas de la variante B (grafico_b.py, copia literal de b/grafico.py):
compute() → semana habitual (mediana 12 semanas), zona del mes (p25–p75 de los 12 meses
anteriores a día N), previsión de cierre y categorías frente a su banda.
Añade: nº de movimientos de la semana frente a la mediana de 12 semanas (aviso «quizá falte
alguno» si < 40 %), el titular y los 3 insights de C1, y una imagen de 2 paneles
(acumulado del mes + categorías) de 1200 px de ancho (400 CSS × 3).
"""
import argparse, datetime as dt, json, os, statistics as st, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grafico_b as B  # noqa: E402

C, eur, pct, T, rrect, esc = B.C, B.eur, B.pct, B.T, B.rrect, B.esc
MESES, MES3 = B.MESES, B.MES3
DIAS = "lunes martes miércoles jueves viernes sábado domingo".split()
W = B.W


def extra(db, hoy, M):
    """Nº de movimientos (todos, incluidos viajes) esta semana vs mediana de las 12 anteriores."""
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
    return f"{x:g}".replace(".", ",")


def textos(M):
    mes, s = M["mes"], M["semana"]
    mname = MESES[int(mes["ym"][5:]) - 1]
    v = M["vs_mediana_pct"]
    # ---- titular (una frase; % redondeado igual que la píldora)
    if v <= -5:
        tit = f"Semana tranquila: {eur(s['corriente'], 0)}, un {abs(v):.0f} % menos de lo habitual"
    elif v >= 15:
        tit = f"Semana cara: {eur(s['corriente'], 0)}, un {v:.0f} % más de lo habitual"
    else:
        tit = f"Semana normal: {eur(s['corriente'], 0)}, en línea con lo habitual"
    ins = []
    # 1. Aviso de datos incompletos
    if M["pocos_movs"]:
        u = dt.date.fromisoformat(M["ultimo_mov"]) if M["ultimo_mov"] else None
        desde = f" y no hay nada desde el {DIAS[u.weekday()]} {u.day}" if u and u < dt.date.fromisoformat(M["hoy"]) else ""
        ins.append(dict(tono="vigilar", titulo=f"Solo {M['movs_semana']} movimientos apuntados",
                        frase=f"Lo normal son {num(M['movs_mediana_12sem'])} por semana{desde}. "
                              f"Quizá falte alguno: si es así, apúntalo para que las cifras sean reales."))
    # 2. El mes
    vm = mes["vs_mediana_pct"]
    tono = "bueno" if vm <= -10 else "vigilar" if vm >= 10 else "info"
    rel = "por debajo de" if vm < 0 else "por encima de"
    ins.append(dict(tono=tono, titulo=f"{mname.capitalize()} va un {abs(vm):.0f} % {rel} lo habitual",
                    frase=f"Llevas {eur(mes['corriente'])} a día {mes['dia']}; lo normal, {eur(mes['mediana_a_hoy'], 0)}. "
                          f"Si sigue como siempre, cierras en ≈{eur(mes['prevision']['p50'], 0)} "
                          f"(un mes típico: {eur(mes['cierre_habitual']['p50'], 0)})."))
    # 3. Categoría que se sale (con la nota repetida si la explica)
    fuera = sorted((c for c in M["categorias"] if c["fuera"]), key=lambda c: -(c["valor"] - c["p75"]))
    if fuera:
        c = fuera[0]
        r = next((r for r in M["repetidos"] if r["cat"] == c["nombre"]), None)
        if r:
            d0 = dt.date.fromisoformat(r["desde"])
            frase = (f"{r['nota']}: {r['veces']} veces desde el {d0.day} {MES3[d0.month-1]} ({eur(r['suma'])}), "
                     f"una cada ~{r['cada_dias']} días; a este ritmo, unos {eur(r['ultimo'] * 30 / r['cada_dias'], 0)} al mes.")
        elif c["p75"] == 0:
            frase = f"Llevas {eur(c['valor'])}; normalmente es 0 € a estas alturas del mes."
        else:
            frase = f"Llevas {eur(c['valor'])}; lo normal a estas alturas es {eur(c['p25'], 0)}–{eur(c['p75'], 0)}."
        ins.append(dict(tono="vigilar", titulo=f"{c['nombre'].split('/')[0]} se sale de lo normal", frase=frase))
    elif s["sin_gasto"] > M["sin_gasto_mediana_12sem"]:
        ins.append(dict(tono="bueno", titulo=f"{s['sin_gasto']} de 7 días sin gastar",
                        frase=f"Lo normal son {num(M['sin_gasto_mediana_12sem'])} por semana."))
    l = dt.date.fromisoformat(M["lunes"]); d = dt.date.fromisoformat(M["hoy"])
    b = mes["banda"][mes["dia"] - 1]
    alt = (f"{mname.capitalize()} acumulado (sin viajes ni gastos de más de 150 €): {eur(mes['corriente'])} a día {mes['dia']}; "
           f"lo habitual a estas alturas, {eur(b['p25'], 0)}–{eur(b['p75'], 0)} (mediana {eur(b['p50'], 0)}); "
           f"previsión de cierre ≈{eur(mes['prevision']['p50'], 0)}. Por categoría frente a lo habitual: "
           + "; ".join(f"{c['nombre']} {eur(c['valor'])} " + (f"(normal {eur(c['p25'],0)}–{eur(c['p75'],0)})" if c['p75'] > 0 else "(normalmente 0 €)")
                       for c in M["categorias"]) + ".")
    asunto = f"Semana del {l.day} al {d.day} {MES3[d.month-1]}: {eur(s['total'], 0 if s['total'] == int(s['total']) else 2)} gastados"
    return dict(titular=tit, insights=ins[:3], alt=alt, asunto=asunto)


# ---------------------------------------------------------------- SVG (2 paneles, compacto)
def eyebrow(y, s):
    return T(20, y, s, 16, C["ink"], weight=600, extra='letter-spacing="-0.2"')


def svg(M):
    mes = M["mes"]; o = []; L, R = 20, W - 20
    mi = int(mes["ym"][5:]) - 1
    # ===== Panel 1: acumulado del mes vs zona habitual + previsión
    o.append(eyebrow(24, f"{MESES[mi].capitalize()}, día a día"))
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
    o.append(T(px(nd) + 8, py(P["p50"]) + 17, "previsión", 12, C["mut"]))
    pts = " ".join(f"{px(k+1):.1f},{py(v):.1f}" for k, v in enumerate(mes["acumulado"]))
    o.append(f'<polyline points="{pts}" fill="none" stroke="{C["acc"]}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>')
    cx, cy = px(dia), py(mes["corriente"])
    o.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="5" fill="{C["acc"]}" stroke="#fff" stroke-width="2"/>')
    o.append(rrect(cx - 44, cy + 9, 88, 17, 4, "#fff"))
    o.append(T(cx, cy + 22, eur(mes["corriente"]) + " hoy", 13, C["acc"], "middle", 700, B.FNUM))
    for d in (1, 8, 15, 22, nd):
        o.append(T(L if d == 1 else px(d), top + h + 16, f"{d} {MES3[mi]}" if d == 1 else str(d), 12,
                   C["mut"], "start" if d == 1 else "middle", fam=B.FNUM))
    y = top + h + 34
    o.append(rrect(L, y - 9, 14, 10, 2.5, C["grns"]))
    o.append(T(L + 19, y, "zona habitual", 12, C["mut"]))
    o.append(f'<line x1="{L+108}" x2="{L+122}" y1="{y-4}" y2="{y-4}" stroke="{C["grn"]}" stroke-width="1.5" stroke-dasharray="4 3"/>')
    o.append(T(L + 127, y, "mediana", 12, C["mut"]))
    o.append(f'<line x1="{L+192}" x2="{L+208}" y1="{y-4}" y2="{y-4}" stroke="{C["acc"]}" stroke-width="2" stroke-dasharray="2 4" stroke-linecap="round"/>')
    o.append(T(L + 213, y, "previsión", 12, C["mut"]))

    # ===== Panel 2: categorías del mes vs su banda
    y0 = y + 16
    o.append(f'<line x1="{L}" x2="{R}" y1="{y0}" y2="{y0}" stroke="{C["line"]}"/>')
    o.append(eyebrow(y0 + 24, "Por categoría, frente a lo habitual"))
    o.append(T(R, y0 + 24, f"1–{mes['dia']} {MES3[mi]}", 12, C["mut"], "end", fam=B.FNUM))
    top = y0 + 40
    cats = M["categorias"]
    vmax = max(max(c["valor"], c["p75"]) for c in cats) * 1.05
    tx0, tx1 = L + 104, R - 64
    pc = lambda v: tx0 + (tx1 - tx0) * v / vmax
    for i, c in enumerate(cats):
        yy = top + i * 25
        o.append(T(L, yy + 12, c["nombre"].split("/")[0], 13, C["ink"]))
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
    o.append(T(L + 19, y, "lo habitual (50 % central)", 12, C["mut"]))
    o.append(rrect(L + 190, y - 6, 14, 5, 2.5, C["red"]))
    o.append(T(L + 209, y, "por encima", 12, C["mut"]))
    H = y + 14
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H:.0f}" viewBox="0 0 {W} {H:.0f}" '
            f'style="font-variant-numeric:tabular-nums">'
            f'<rect width="{W}" height="{H:.0f}" fill="{C["bg"]}"/>' + "".join(o) + "</svg>")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True); ap.add_argument("--hoy", required=True)
    ap.add_argument("--out", default="grafico.png"); ap.add_argument("--json")
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
