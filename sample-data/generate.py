#!/usr/bin/env python3
"""Generates INVENTED sample data for My Expenses (these are nobody's real transactions).

Usage:
    python3 sample-data/generate.py            # writes sample-data/months/*.json and meta/config.json

The output has the same format as the app's database (see README, "Data model") and feeds the tests,
the demo and the weekly email. The random seed is fixed: two runs produce exactly the same files, so the
values the tests check do not change.

It deliberately contains, so every feature of the app has something to show:
- Monthly salary with extra payments, rent and fixed bills (gym, phone, streaming...).
- A new fixed payment that appears in the last two months ("New fixed payment" alert).
- A habit that takes off in the last 3 months (padel), for the habit-change alert.
- Trips (Travel category, destination in the note) and big purchases marked as extraordinary.
"""
import datetime as dt, hashlib, json, os, random

OUT = os.path.dirname(os.path.abspath(__file__))
INICIO, FIN = dt.date(2024, 9, 1), dt.date(2026, 11, 24)
rnd = random.Random(20241001)

CATS = [  # id, name, kind, icon, colour, monthly budget
    ("e-groceries", "Groceries", "e", "🛒", "#F2A541", 260),
    ("e-eating-out", "Eating out", "e", "🍽️", "#E4572E", 150),
    ("e-home", "Home", "e", "🏠", "#5C80BC", None),
    ("e-bills", "Bills", "e", "🧾", "#7B6CD9", None),
    ("e-transport", "Transport", "e", "🚇", "#3BB273", 60),
    ("e-sport", "Sport and hobbies", "e", "🎾", "#2E86AB", None),
    ("e-leisure", "Leisure", "e", "🎬", "#D7263D", 80),
    ("e-shopping", "Shopping", "e", "🛍️", "#C17C74", None),
    ("e-clothes", "Clothes", "e", "👕", "#B5838D", None),
    ("e-health", "Health", "e", "💊", "#1B998B", None),
    ("e-travel", "Travel", "e", "✈️", "#4D9DE0", None),
    ("e-gifts", "Gifts", "e", "🎁", "#E07BE0", None),
    ("e-other", "Other", "e", "🏷️", "#8C9A2B", None),
    ("i-salary", "Salary", "i", "💼", "#2A9D8F", None),
    ("i-gifts", "Gifts", "i", "🎁", "#E1BC29", None),
    ("i-other", "Other", "i", "🏷️", "#6D597A", None),
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


def months():
    y, m = INICIO.year, INICIO.month
    while (y, m) <= (FIN.year, FIN.month):
        yield y, m
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def day_of(y, m, d):
    import calendar
    return dt.date(y, m, min(d, calendar.monthrange(y, m)[1]))


for y, m in months():
    ym = (y, m)
    # income
    salary = 2350 if ym < (2026, 1) else 2450
    add(day_of(y, m, 28), "i", "i-salary", salary, "Salary", (9, 5))
    if m in (6, 12):
        add(day_of(y, m, 20), "i", "i-salary", salary, "Extra month pay", (9, 5))
    if m == 12:
        add(day_of(y, m, 24), "i", "i-gifts", 150, "Christmas gift")
    if rnd.random() < .12:
        add(day_of(y, m, rnd.randint(1, 28)), "i", "i-other", rnd.choice([25, 40, 60, 120]), rnd.choice(["Second-hand sale", "Refund", "Friend paid me back"]))
    # fixed payments
    add(day_of(y, m, 1), "e", "e-home", 650, "Rent", (8, 0))
    add(day_of(y, m, 2), "e", "e-sport", 39.9, "Gym", (7, 30))
    add(day_of(y, m, 5), "e", "e-bills", 15, "Mobile plan", (10, 0))
    add(day_of(y, m, 8), "e", "e-bills", rnd.uniform(38, 62), "Electricity", (10, 0))
    add(day_of(y, m, 12), "e", "e-leisure", 10.99 if ym < (2025, 7) else 11.99, "Music streaming", (10, 0))
    add(day_of(y, m, 3), "e", "e-transport", 20, "Transport pass", (8, 15))
    if ym >= (2026, 9):  # new fixed payment
        add(day_of(y, m, 14), "e", "e-leisure", 8.99, "Series streaming", (21, 0))
    # day to day
    import calendar
    nd = calendar.monthrange(y, m)[1]
    for d in range(1, nd + 1):
        f = dt.date(y, m, d)
        if f.weekday() in (1, 5) or rnd.random() < .05:
            add(f, "e", "e-groceries", rnd.uniform(15, 60), rnd.choice(["Weekly shop", "Fruit and veg", "Groceries", "Big shop"]))
        if rnd.random() < (.28 if f.weekday() >= 4 else .12):
            add(f, "e", "e-eating-out", rnd.uniform(6, 42), rnd.choice(["Drinks", "Dinner with friends", "Set lunch", "Coffee", "Brunch", "Pizza"]))
        if rnd.random() < .05:
            add(f, "e", "e-transport", rnd.uniform(7, 22), rnd.choice(["Taxi", "Fuel", "Train"]))
        if rnd.random() < .06:
            add(f, "e", "e-shopping", rnd.uniform(8, 80), rnd.choice(["Book", "Household items", "Charger", "Online order", "Stationery"]))
        if rnd.random() < .035:
            add(f, "e", "e-leisure", rnd.uniform(8, 35), rnd.choice(["Cinema", "Concert", "Theatre tickets", "Video game"]))
        if rnd.random() < .02:
            add(f, "e", "e-health", rnd.uniform(5, 45), rnd.choice(["Pharmacy", "Physio", "Dentist"]))
        if rnd.random() < .02:
            add(f, "e", "e-other", rnd.uniform(3, 30), rnd.choice(["Haircut", "Lottery", "Misc"]))
        # padel: occasional, and from July 2026 a new habit
        p = .25 if ym >= (2026, 7) else .015
        if rnd.random() < p:
            add(f, "e", "e-sport", rnd.choice([10, 12, 14]), rnd.choice(["Padel", "Padel match", "Padel court hire"]))
    if m in (1, 7) or rnd.random() < .15:
        add(day_of(y, m, rnd.randint(5, 25)), "e", "e-clothes", rnd.uniform(25, 110), rnd.choice(["Sales", "Trainers", "Shirt", "Coat"]))
    if m == 12:
        for _ in range(3):
            add(day_of(y, m, rnd.randint(10, 23)), "e", "e-gifts", rnd.uniform(20, 60), "Christmas present")
    elif rnd.random() < .2:
        add(day_of(y, m, rnd.randint(1, 28)), "e", "e-gifts", rnd.uniform(15, 50), "Birthday present")

# trips (destination in the note) and extraordinary items
VIAJES = [(dt.date(2025, 4, 17), "Lisbon"), (dt.date(2025, 8, 9), "Asturias"), (dt.date(2025, 12, 5), "Granada"),
          (dt.date(2026, 3, 19), "Rome"), (dt.date(2026, 8, 14), "Menorca")]
for ini, dest in VIAJES:
    add(ini - dt.timedelta(days=40), "e", "e-travel", rnd.uniform(120, 260), f"Flights {dest}")
    add(ini - dt.timedelta(days=30), "e", "e-travel", rnd.uniform(180, 340), f"Hotel {dest}")
    for k in range(4):
        add(ini + dt.timedelta(days=k), "e", "e-travel", rnd.uniform(25, 80), f"{rnd.choice(['Lunch', 'Dinner', 'Museum', 'Tour'])} {dest}")
add(dt.date(2025, 6, 7), "e", "e-home", 449, "New sofa", x=True)
add(dt.date(2026, 1, 16), "e", "e-shopping", 899, "Laptop", x=True)
add(dt.date(2025, 11, 3), "e", "e-health", 220, "Glasses")

txs.sort(key=lambda t: t["d"])
for i, t in enumerate(txs):
    t["id"] = "s" + hashlib.sha1(f"{t['d']}|{t['a']}|{i}".encode()).hexdigest()[:10]

os.makedirs(os.path.join(OUT, "months"), exist_ok=True)
os.makedirs(os.path.join(OUT, "meta"), exist_ok=True)
for f in os.listdir(os.path.join(OUT, "months")):
    os.remove(os.path.join(OUT, "months", f))
by_month = {}
for t in txs:
    by_month.setdefault(t["d"][:7], []).append({k: t[k] for k in ("id", "d", "k", "c", "a", "n", "x") if k in t})
for k, l in by_month.items():
    json.dump({"txs": l}, open(os.path.join(OUT, "months", k + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
cats = [{"id": i, "name": n, "kind": k, "icon": ic, "color": col, "budget": b} for i, n, k, ic, col, b in CATS]
json.dump({"cats": cats, "currency": "EUR", "v": 1}, open(os.path.join(OUT, "meta", "config.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(f"{len(txs)} movements in {len(by_month)} months -> {OUT}")
