#!/usr/bin/env python3
"""Builds docs/index.html: the app with the sample data, ready for GitHub Pages or to open locally.

Usage:
    python3 herramientas/construir-demo.py

The first time someone opens the demo, the data in datos-ejemplo/ is loaded into the browser (localStorage),
shifted in time so the last month of data is the current month. From then on it is a normal app in local mode:
whatever is added is stored only in that browser. To start over, clear the site's data in the browser.
"""
import glob, json, os

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
app = open(os.path.join(RAIZ, "app", "gastos.html"), encoding="utf-8").read()
cats = json.load(open(os.path.join(RAIZ, "datos-ejemplo", "meta", "config.json"), encoding="utf-8"))["cats"]
txs = [t for f in sorted(glob.glob(os.path.join(RAIZ, "datos-ejemplo", "months", "*.json")))
       for t in json.load(open(f, encoding="utf-8"))["txs"]]
datos = json.dumps({"txs": txs, "cats": cats}, ensure_ascii=False, separators=(",", ":"))

carga = """<script>
/* Mis Gastos demo: INVENTED data. Only loaded if this browser has no saved data yet. */
(function () {
  var KEY = "gastos.local.v1";
  try { if (localStorage.getItem(KEY)) return; } catch (e) { return; }
  var D = %s;
  var last = D.txs.reduce(function (m, t) { return t.d > m ? t.d : m; }, "").slice(0, 7);
  var now = new Date(), off = (now.getFullYear() * 12 + now.getMonth()) - (+last.slice(0, 4) * 12 + (+last.slice(5, 7) - 1));
  var p = function (n) { return (n < 10 ? "0" : "") + n; };
  var hoy = now.getFullYear() + "-" + p(now.getMonth() + 1) + "-" + p(now.getDate()) + "T" + p(now.getHours()) + ":" + p(now.getMinutes());
  D.txs = D.txs.map(function (t) {
    var y = +t.d.slice(0, 4), m = +t.d.slice(5, 7) - 1 + off, d = +t.d.slice(8, 10);
    var Y = y + Math.floor(m / 12), M = ((m %% 12) + 12) %% 12, dim = new Date(Y, M + 1, 0).getDate();
    var c = {}; for (var k in t) c[k] = t[k];
    c.d = Y + "-" + p(M + 1) + "-" + p(Math.min(d, dim)) + t.d.slice(10);
    return c;
  }).filter(function (t) { return t.d <= hoy; });
  try { localStorage.setItem(KEY, JSON.stringify(D)); } catch (e) {}
})();
</script>
""" % datos

cabecera = ('<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
            '<meta name="description" content="Mis Gastos: demo with invented data">\n')
os.makedirs(os.path.join(RAIZ, "docs"), exist_ok=True)
open(os.path.join(RAIZ, "docs", "index.html"), "w", encoding="utf-8").write(cabecera + carga + app)
print("docs/index.html:", len(txs), "sample movements")
