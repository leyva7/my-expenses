#!/usr/bin/env python3
"""Correo SEMANAL de Mis Gastos, diseño C1 (titular + frases + una sola imagen).

Uso (desde la tarea programada):
    python3 -I correo.py --db RUTA/db --hoy AAAA-MM-DD --outdir RUTA/salida

Escribe en --outdir:
    grafico.png   imagen inline (en el HTML va como src="cid:att0")
    correo.html   cuerpo HTML para Gmail
    correo.txt    cuerpo en texto plano equivalente
    datos.json    todas las cifras calculadas
y saca por stdout un JSON con asunto, rutas, sha256 del PNG y cifras clave.

Si la semana no tiene movimientos, no genera imagen y el correo es una línea.
Diseño legible aunque Gmail quite los fondos: nunca texto blanco; botón con borde.
"""
import argparse, datetime as dt, hashlib, html, json, os, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grafico as G  # noqa: E402
B = G.B
eur, MES3 = B.eur, B.MES3
# Enlace del botón «Abrir Mis Gastos»: pon el de tu copia de la app (variable de entorno MISGASTOS_URL).
APP = os.environ.get("MISGASTOS_URL", "https://github.com/leyva7/my-expenses")
# Estilo v19 de la app (piel iOS): fondos de sistema, celdas blancas, índigo.
# Gmail puede quitar los fondos: nunca texto blanco; el botón lleva borde.
K = dict(bg="#F2F2F7", card="#FFFFFF", ink="#0B0B0F", sec="#3C3C43", mut="#6C6C70",
         line="#E5E5EA", acc="#4B3FD8", accs="#EDEBFB")
COL = {"bueno": "#1A7F3F", "vigilar": "#B45F06", "info": "#4B3FD8", "malo": "#C4262E"}
TINT = {"bueno": "#E5F2E9", "vigilar": "#F7ECE0", "info": "#EDEBFB", "malo": "#FBE9EA"}
F_UI = "-apple-system,BlinkMacSystemFont,'SF Pro Text',Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
F_D = "-apple-system,BlinkMacSystemFont,'SF Pro Display',Inter,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"
F_N = F_UI
TAB = 'role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"'

# Modo oscuro para Apple Mail / iOS Mail (Gmail lo ignora y usa su propia inversión).
CSS = """
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
 .o-bg{background:#000000!important}
 .o-card{background:#1C1C1E!important}
 .o-ink{color:#FFFFFF!important}
 .o-sec{color:#D1D1D6!important}
 .o-mut{color:#A1A1A8!important}
 .o-acc{color:#9C95FF!important}
 .o-line{border-color:#38383A!important}
 .o-btn{background:#26233F!important;border-color:#9C95FF!important;color:#9C95FF!important}
 .o-pill{background:#2C2C2E!important;border-color:#38383A!important}
 .o-tint{background:#2C2C2E!important}
 .o-img{background:#FFFFFF!important}
}
"""


def e(s):
    return html.escape(str(s), quote=True).replace("\u00a0", "&nbsp;")


def icono(i, M, cats):
    """Emoji del cuadradito de cada frase (como las filas de la app)."""
    t = i["titulo"]
    if t.startswith("Solo "):
        return "&#9999;&#65039;"                       # ✏️
    if " va un " in t:
        return "&#128200;" if "encima" in t else "&#128201;"   # 📈 / 📉
    if "sin gastar" in t:
        return "&#127807;"                              # 🌿
    for c in M.get("categorias", []):
        if t.startswith(c["nombre"].split("/")[0]):
            ic = cats.get(c["id"], {}).get("icon")
            if ic:
                return html.escape(ic)
    return "&#127991;&#65039;"                          # 🏷️


def filas_html(ins, M, cats):
    out = []
    for n, i in enumerate(ins):
        tono = i["tono"]
        borde = "" if n == 0 else f"border-top:1px solid {K['line']};"
        out.append(
            f'<tr><td style="padding:0 0 0 16px;"><table {TAB}><tr>'
            f'<td valign="top" width="34" style="width:34px;padding:13px 12px 13px 0;">'
            f'<div class="o-tint" style="width:32px;height:32px;border-radius:9px;background:{TINT.get(tono, K["accs"])};'
            f'text-align:center;font-size:17px;line-height:32px;">{icono(i, M, cats)}</div></td>'
            f'<td valign="top" class="o-line" style="{borde}padding:12px 16px 13px 0;font-family:{F_UI};font-size:14px;line-height:20px;color:{K["sec"]};">'
            f'<span class="o-ink" style="display:block;font-size:15px;line-height:21px;font-weight:600;color:{K["ink"]};padding-bottom:2px;">'
            f'<span style="color:{COL.get(tono, K["acc"])};">&#9679;</span>&nbsp;{e(i["titulo"])}</span>'
            f'<span class="o-sec">{e(i["frase"])}</span></td></tr></table></td></tr>')
    return "".join(out)


def tarjeta(contenido, pad="0"):
    return (f'<tr><td style="padding:0 16px 14px;"><table {TAB} class="o-card" bgcolor="{K["card"]}" '
            f'style="background:{K["card"]};border-radius:14px;"><tr><td style="padding:{pad};">'
            f'<table {TAB}>{contenido}</table></td></tr></table></td></tr>')


def pagina(asunto, preheader, cuerpo):
    return f"""<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark">
<meta name="x-apple-disable-message-reformatting"><title>{e(asunto)}</title><style>{CSS}</style></head>
<body class="o-bg" style="margin:0;padding:0;background:{K['bg']};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;color:{K['bg']};">{e(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table {TAB} class="o-bg" bgcolor="{K['bg']}" style="background:{K['bg']};"><tr><td align="center" style="padding:14px 0 8px;">
<table {TAB} style="width:100%;max-width:560px;">
{cuerpo}
<tr><td align="center" style="padding:6px 16px 18px;">
<a href="{APP}" target="_blank" class="o-btn" style="display:block;padding:13px 20px;background:{K['accs']};border:1.5px solid {K['acc']};border-radius:14px;font-family:{F_UI};font-size:17px;font-weight:600;line-height:22px;color:{K['acc']};text-decoration:none;text-align:center;">Abrir Mis Gastos</a>
</td></tr>
<tr><td align="center" class="o-mut" style="padding:0 28px 24px;font-family:{F_UI};font-size:12px;line-height:17px;color:{K['mut']};">Resumen automático · Mis Gastos<br>«Habitual»: semana = mediana de las 12 anteriores; mes = mismos días de los 12 meses anteriores. Sin viajes ni gastos de más de 150&nbsp;€.</td></tr>
</table></td></tr></table></body></html>"""


def cabecera(lun, hoy, titular):
    return (f'<tr><td style="padding:2px 20px 0;"><table {TAB}><tr>'
            f'<td valign="middle" class="o-ink" style="font-family:{F_D};font-size:17px;line-height:22px;font-weight:700;letter-spacing:-0.02em;color:{K["ink"]};">'
            f'<span class="o-acc" style="color:{K["acc"]};">&euro;</span>&nbsp;Mis Gastos</td>'
            f'<td valign="middle" align="right"><span class="o-pill o-ink" style="display:inline-block;padding:6px 12px;border:1px solid #D1D1D6;border-radius:999px;background:{K["card"]};'
            f'font-family:{F_UI};font-size:14px;line-height:18px;font-weight:600;color:{K["ink"]};white-space:nowrap;">'
            f'<span class="o-acc" style="color:{K["acc"]};">&#9679;</span>&nbsp;{lun.day}–{hoy.day} {MES3[hoy.month-1]}</span></td></tr></table></td></tr>'
            f'<tr><td class="o-ink" style="padding:18px 20px 0;font-family:{F_D};font-size:28px;line-height:32px;font-weight:800;letter-spacing:-0.025em;color:{K["ink"]};">{e(titular)}</td></tr>')


def importe_grande(x):
    s = eur(x)                      # «175,59 €»
    ent, dec = s[:-2].rsplit(",", 1)
    return (f'{e(ent)}<span style="font-size:28px;letter-spacing:-0.02em;">,{dec}&nbsp;€</span>')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True); ap.add_argument("--hoy", required=True)
    ap.add_argument("--outdir", required=True)
    a = ap.parse_args()
    hoy = dt.date.fromisoformat(a.hoy)
    os.makedirs(a.outdir, exist_ok=True)
    M = B.compute(a.db, hoy)
    G.extra(a.db, hoy, M)
    lun = dt.date.fromisoformat(M["lunes"])
    out = {"html": os.path.join(a.outdir, "correo.html"), "txt": os.path.join(a.outdir, "correo.txt")}

    if M["movs_semana"] == 0:
        asunto = f"Semana del {lun.day} al {hoy.day} {MES3[hoy.month-1]}: 0 € gastados"
        linea = "Semana sin movimientos apuntados."
        cuerpo = cabecera(lun, hoy, linea)
        open(out["html"], "w", encoding="utf-8").write(pagina(asunto, linea, cuerpo))
        open(out["txt"], "w", encoding="utf-8").write(f"{linea}\n\nAbrir Mis Gastos: {APP}\n\n--\nResumen automático · Mis Gastos\n")
        res = dict(asunto=asunto, vacia=True, **out)
    else:
        M.update(G.textos(M))
        png = os.path.join(a.outdir, "grafico.png")
        B.render(G.svg(M), png)
        s = M["semana"]; v = M["vs_mediana_pct"]
        # mismo criterio que el titular: tranquila ≤ −5 %, cara ≥ +15 %, normal entre medias
        pill_c, pill_bg = (COL["bueno"], TINT["bueno"]) if v <= -5 else (COL["malo"], TINT["malo"]) if v >= 15 else (K["sec"], "#E9E9EF")
        signo = "−" if v < 0 else "+"
        pill = f"{signo}{abs(v):.0f}%"
        ins = M["insights"]
        fuera = round(s["total"] - s["corriente"], 2)
        cats = {c["id"]: c for c in json.load(open(os.path.join(a.db, "meta", "config.json"), encoding="utf-8"))["cats"]}
        cuerpo = cabecera(lun, hoy, M["titular"])
        cuerpo += (f'<tr><td class="o-mut" style="padding:18px 20px 0;font-family:{F_UI};font-size:15px;line-height:20px;font-weight:600;color:{K["mut"]};">Gasto normal esta semana</td></tr>'
                   f'<tr><td class="o-ink" style="padding:2px 20px 0;font-family:{F_D};font-size:44px;line-height:50px;font-weight:800;letter-spacing:-0.03em;color:{K["ink"]};white-space:nowrap;">'
                   f'{importe_grande(s["corriente"])}</td></tr>'
                   f'<tr><td style="padding:6px 20px 18px;font-family:{F_UI};font-size:14px;line-height:22px;color:{K["mut"]};">'
                   f'<span style="display:inline-block;padding:1px 9px;border-radius:999px;background:{pill_bg};color:{pill_c};font-weight:700;border:1px solid {pill_c};">{e(pill)}</span>'
                   f'&nbsp;&nbsp;<span class="o-mut">Habitual</span>&nbsp;<b class="o-ink" style="color:{K["ink"]};font-weight:600;">{e(eur(M["mediana_12sem"]))}</b>'
                   f'&nbsp;&nbsp;·&nbsp;&nbsp;<span class="o-mut">Anterior</span>&nbsp;<b class="o-ink" style="color:{K["ink"]};font-weight:600;">{e(eur(M["semana_ant"]["corriente"]))}</b>'
                   + (f'<br><span class="o-mut">Aparte, en viajes y gastos grandes:</span>&nbsp;<b class="o-ink" style="color:{K["ink"]};font-weight:600;">+{e(eur(fuera))}</b>' if fuera > 0 else '')
                   + '</td></tr>')
        cuerpo += tarjeta(filas_html(ins, M, cats))
        cuerpo += tarjeta(f'<tr><td class="o-img" style="background:#FFFFFF;border-radius:14px;padding:4px 0 2px;"><img src="cid:att0" width="528" alt="{e(M["alt"])}" '
                          f'style="display:block;width:100%;max-width:528px;height:auto;border:0;border-radius:14px;font-family:{F_UI};font-size:13px;line-height:19px;color:{K["sec"]};"></td></tr>')
        pre = " ".join(f'{i["titulo"]}.' for i in ins[:2])
        open(out["html"], "w", encoding="utf-8").write(pagina(M["asunto"], pre, cuerpo))
        txt = [f"MIS GASTOS · SEMANA DEL {lun.day} AL {hoy.day} {MES3[hoy.month-1].upper()}", "",
               M["titular"].replace(" ", " "), "",
               f"Gasto normal: {eur(s['corriente'])} ({pill} frente a la semana habitual de {eur(M['mediana_12sem'])}; anterior {eur(M['semana_ant']['corriente'])})".replace("\u00a0", " ")]
        if s["total"] - s["corriente"] > 0.005:
            txt += [f"Aparte, en viajes y gastos grandes: +{eur(s['total'] - s['corriente'])}".replace("\u00a0", " ")]
        txt += [""]
        txt += [f"- {i['titulo']}. {i['frase']}".replace(" ", " ") for i in ins]
        txt += ["", "Gráfico: " + M["alt"].replace(" ", " "), "", f"Abrir Mis Gastos: {APP}", "", "--", "Resumen automático · Mis Gastos"]
        open(out["txt"], "w", encoding="utf-8").write("\n".join(txt) + "\n")
        sha = hashlib.sha256(open(png, "rb").read()).hexdigest()
        res = dict(asunto=M["asunto"].replace(" ", " "), vacia=False, png=png, png_sha256=sha,
                   attachment_content=f"sha256:{sha}:{png}", titular=M["titular"],
                   semana_total=s["total"], vs_habitual_pct=v, mes_corriente=M["mes"]["corriente"],
                   prevision_cierre=M["mes"]["prevision"]["p50"], insights=ins, **out)
    json.dump(M, open(os.path.join(a.outdir, "datos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1, default=str)
    print(json.dumps(res, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    main()
