#!/usr/bin/env python3
"""Genera datos de ejemplo INVENTADOS para Mis Gastos (no son movimientos reales de nadie).

Uso:
    python3 datos-ejemplo/generar.py            # escribe datos-ejemplo/months/*.json y meta/config.json

El resultado tiene el mismo formato que la base de datos de la app (ver README, «Modelo de datos»)
y sirve para los tests, la demo y el correo semanal. La semilla aleatoria es fija: dos ejecuciones
dan exactamente los mismos archivos, así que los valores que comprueban los tests no cambian.

Lo que contiene a propósito, para que se vean todas las funciones de la app:
- Sueldo mensual con pagas extra, alquiler y facturas fijas (gimnasio, móvil, streaming…).
- Un fijo nuevo que aparece en los dos últimos meses (aviso «Nuevo fijo»).
- Un hábito que se dispara en los últimos 3 meses (pádel), para el aviso de cambio de hábito.
- Viajes (categoría Viajes, destino en la nota) y compras grandes marcadas como extraordinarias.
"""
import datetime as dt, hashlib, json, os, random

OUT = os.path.dirname(os.path.abspath(__file__))
INICIO, FIN = dt.date(2024, 9, 1), dt.date(2026, 11, 24)
rnd = random.Random(20241001)

CATS = [  # id, nombre, tipo, icono, color, presupuesto mensual
    ("e-supermercado", "Supermercado", "e", "🛒", "#F2A541", 260),
    ("e-restaurantes", "Restaurantes y bares", "e", "🍽️", "#E4572E", 150),
    ("e-casa", "Casa", "e", "🏠", "#5C80BC", None),
    ("e-facturas", "Facturas", "e", "🧾", "#7B6CD9", None),
    ("e-transporte", "Transporte", "e", "🚇", "#3BB273", 60),
    ("e-deportes", "Deportes y hobbies", "e", "🎾", "#2E86AB", None),
    ("e-ocio", "Ocio", "e", "🎬", "#D7263D", 80),
    ("e-compras", "Compras", "e", "🛍️", "#C17C74", None),
    ("e-ropa", "Ropa", "e", "👕", "#B5838D", None),
    ("e-salud", "Salud", "e", "💊", "#1B998B", None),
    ("e-viajes", "Viajes", "e", "✈️", "#4D9DE0", None),
    ("e-regalos", "Regalos", "e", "🎁", "#E07BE0", None),
    ("e-otros", "Otros", "e", "🏷️", "#8C9A2B", None),
    ("i-salario", "Salario", "i", "💼", "#2A9D8F", None),
    ("i-regalos", "Regalos", "i", "🎁", "#E1BC29", None),
    ("i-otros", "Otros", "i", "🏷️", "#6D597A", None),
]
txs = []


def add(d, k, c, a, n="", hm=None, x=False):
    if not (INICIO <= d <= FIN):
        return
    h, m = hm or (rnd.randint(8, 21), rnd.randint(0, 59))
    t = {"d": f"{d.isoformat()}T{h:02d}:{m:02d}", "k": k, "c": c, "a": round(a, 2), "n": n}
    if x:
        t["x"] = True
    txs.append(t)


def meses():
    y, m = INICIO.year, INICIO.month
    while (y, m) <= (FIN.year, FIN.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def dia(y, m, d):
    import calendar
    return dt.date(y, m, min(d, calendar.monthrange(y, m)[1]))


for y, m in meses():
    ym = (y, m)
    # ingresos
    sueldo = 2350 if ym < (2026, 1) else 2450
    add(dia(y, m, 28), "i", "i-salario", sueldo, "Nómina", (9, 5))
    if m in (6, 12):
        add(dia(y, m, 20), "i", "i-salario", sueldo, "Paga extra", (9, 5))
    if m == 12:
        add(dia(y, m, 24), "i", "i-regalos", 150, "Regalo de Navidad")
    if rnd.random() < .12:
        add(dia(y, m, rnd.randint(1, 28)), "i", "i-otros", rnd.choice([25, 40, 60, 120]), rnd.choice(["Venta de segunda mano", "Devolución", "Bizum de un amigo"]))
    # fijos
    add(dia(y, m, 1), "e", "e-casa", 650, "Alquiler", (8, 0))
    add(dia(y, m, 2), "e", "e-deportes", 39.9, "Gimnasio", (7, 30))
    add(dia(y, m, 5), "e", "e-facturas", 15, "Tarifa móvil", (10, 0))
    add(dia(y, m, 8), "e", "e-facturas", rnd.uniform(38, 62), "Luz", (10, 0))
    add(dia(y, m, 12), "e", "e-ocio", 10.99 if ym < (2025, 7) else 11.99, "Música en streaming", (10, 0))
    add(dia(y, m, 3), "e", "e-transporte", 20, "Abono transporte", (8, 15))
    if ym >= (2026, 9):  # fijo nuevo
        add(dia(y, m, 14), "e", "e-ocio", 8.99, "Plataforma de series", (21, 0))
    # día a día
    import calendar
    nd = calendar.monthrange(y, m)[1]
    for d in range(1, nd + 1):
        f = dt.date(y, m, d)
        if f.weekday() in (1, 5) or rnd.random() < .05:
            add(f, "e", "e-supermercado", rnd.uniform(15, 60), rnd.choice(["Compra semanal", "Fruta y verdura", "Compra", "Compra grande"]))
        if rnd.random() < (.28 if f.weekday() >= 4 else .12):
            add(f, "e", "e-restaurantes", rnd.uniform(6, 42), rnd.choice(["Cañas", "Cena con amigos", "Menú del día", "Café", "Brunch", "Pizza"]))
        if rnd.random() < .05:
            add(f, "e", "e-transporte", rnd.uniform(7, 22), rnd.choice(["Taxi", "Gasolina", "Tren"]))
        if rnd.random() < .06:
            add(f, "e", "e-compras", rnd.uniform(8, 80), rnd.choice(["Libro", "Cosas de casa", "Cargador", "Pedido online", "Papelería"]))
        if rnd.random() < .035:
            add(f, "e", "e-ocio", rnd.uniform(8, 35), rnd.choice(["Cine", "Concierto", "Entradas teatro", "Videojuego"]))
        if rnd.random() < .02:
            add(f, "e", "e-salud", rnd.uniform(5, 45), rnd.choice(["Farmacia", "Fisio", "Dentista"]))
        if rnd.random() < .02:
            add(f, "e", "e-otros", rnd.uniform(3, 30), rnd.choice(["Peluquería", "Lotería", "Varios"]))
        # pádel: esporádico y, desde julio de 2026, un hábito nuevo
        p = .25 if ym >= (2026, 7) else .015
        if rnd.random() < p:
            add(f, "e", "e-deportes", rnd.choice([10, 12, 14]), rnd.choice(["Pádel", "Pádel con amigos", "Alquiler pista pádel"]))
    if m in (1, 7) or rnd.random() < .15:
        add(dia(y, m, rnd.randint(5, 25)), "e", "e-ropa", rnd.uniform(25, 110), rnd.choice(["Rebajas", "Zapatillas", "Camisa", "Abrigo"]))
    if m == 12:
        for _ in range(3):
            add(dia(y, m, rnd.randint(10, 23)), "e", "e-regalos", rnd.uniform(20, 60), "Regalo de Navidad")
    elif rnd.random() < .2:
        add(dia(y, m, rnd.randint(1, 28)), "e", "e-regalos", rnd.uniform(15, 50), "Regalo de cumpleaños")

# viajes (destino en la nota) y extraordinarios
VIAJES = [(dt.date(2025, 4, 17), "Lisboa"), (dt.date(2025, 8, 9), "Asturias"), (dt.date(2025, 12, 5), "Granada"),
          (dt.date(2026, 3, 19), "Roma"), (dt.date(2026, 8, 14), "Menorca")]
for ini, dest in VIAJES:
    add(ini - dt.timedelta(days=40), "e", "e-viajes", rnd.uniform(120, 260), f"Vuelos {dest}")
    add(ini - dt.timedelta(days=30), "e", "e-viajes", rnd.uniform(180, 340), f"Alojamiento {dest}")
    for k in range(4):
        add(ini + dt.timedelta(days=k), "e", "e-viajes", rnd.uniform(25, 80), f"{rnd.choice(['Comida', 'Cena', 'Museo', 'Excursión'])} {dest}")
add(dt.date(2025, 6, 7), "e", "e-casa", 449, "Sofá nuevo", x=True)
add(dt.date(2026, 1, 16), "e", "e-compras", 899, "Portátil", x=True)
add(dt.date(2025, 11, 3), "e", "e-salud", 220, "Gafas graduadas")

txs.sort(key=lambda t: t["d"])
for i, t in enumerate(txs):
    t["id"] = "s" + hashlib.sha1(f"{t['d']}|{t['a']}|{i}".encode()).hexdigest()[:10]

os.makedirs(os.path.join(OUT, "months"), exist_ok=True)
os.makedirs(os.path.join(OUT, "meta"), exist_ok=True)
for f in os.listdir(os.path.join(OUT, "months")):
    os.remove(os.path.join(OUT, "months", f))
por_mes = {}
for t in txs:
    por_mes.setdefault(t["d"][:7], []).append({k: t[k] for k in ("id", "d", "k", "c", "a", "n", "x") if k in t})
for k, l in por_mes.items():
    json.dump({"txs": l}, open(os.path.join(OUT, "months", k + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
cats = [{"id": i, "name": n, "kind": k, "icon": ic, "color": col, "budget": b} for i, n, k, ic, col, b in CATS]
json.dump({"cats": cats, "currency": "EUR", "v": 1}, open(os.path.join(OUT, "meta", "config.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(txs)} movimientos en {len(por_mes)} meses → {OUT}")
