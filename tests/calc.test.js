// Calculation tests for Mis Gastos: node tests/calc.test.js [app.html]   (default: gastos.html)
// Loads the app in local mode with the sample data in datos-ejemplo/ (897 invented movements, Sep 2024 – Nov 2026)
// on a fixed date (30 oct 2026) and checks the numbers the screens show. Values were pinned on v19 with that data;
// a change in them means the maths changed (or the sample data was regenerated with different rules).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/gastos.html');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'datos-ejemplo/meta/config.json')));
const dir = path.join(ROOT, 'datos-ejemplo/months');
const txs = fs.readdirSync(dir).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []);

const results = [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function check(name, ok, got) { results.push({ name, ok: !!ok, got }); }

(async () => {
  const tmp = path.join(require('os').tmpdir(), 'misgastos-calc.html');
  fs.writeFileSync(tmp, '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' + fs.readFileSync(app, 'utf8'));
  const b = await chromium.launch(), page = await b.newPage(), errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.clock.setFixedTime(new Date('2026-10-30T12:00:00+01:00'));
  await page.addInitScript(d => localStorage.setItem('gastos.local.v1', d), JSON.stringify({ txs, cats: cfg.cats }));
  await page.goto('file://' + tmp);
  await page.waitForTimeout(800);

  const r = await page.evaluate(async () => {
    const F = window.__fc, S = F.state(), sumE = M => S.txs.filter(t => t.k === 'e' && t.d.startsWith(M)).reduce((s, t) => s + t.a, 0);
    // month-end forecast back-test: Jan 2025 – Sep 2026, cut-offs on days 5/10/15/20/25
    const errs = [], inRange = [];
    for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
      const M = `${y}-${String(m).padStart(2, '0')}`; if (M > '2026-09') continue;
      const A = sumE(M);
      for (const c of [5, 10, 15, 20, 25]) { const f = F.forecastAt(M, c); errs.push(Math.abs(f.p - A) / A); }
    }
    const f15 = F.forecastAt('2026-09', 15);
    const mm = F.monthly(), ks = Object.keys(mm).filter(k => k >= '2025-10' && k <= '2026-09');
    const I = ks.reduce((s, k) => s + mm[k].i, 0), E = ks.reduce((s, k) => s + mm[k].e, 0);
    const mf = F.monthForecast(), fx = F.fixedScan(), al = F.allAlerts(), sg = F.suggestCats('Clase pádel', 'e', 13.75);
    // CSV export → import must not duplicate anything
    const n0 = S.txs.length; await F.importText('x.csv', F.toCSV()); const n1 = S.txs.length;
    return {
      n0, n1, mape: errs.reduce((a, b) => a + b, 0) / errs.length,
      f15: { p: f15.p, parts: f15.spent + f15.pend + f15.remVar + f15.remBig, spent: f15.spent, spentReal: S.txs.filter(t => t.k === 'e' && t.d.startsWith('2026-09') && +t.d.slice(8, 10) <= 15).reduce((s, t) => s + t.a, 0) },
      rate12: (I - E) / I, normal: mf.normal, avg6: F.avgMonthly(6), lohi: [mf.lo, mf.p, mf.hi],
      fxActive: fx.active.length, fxNews: fx.news.length, alerts: al.map(a => a.t), sg,
      lump: [F.isLump({ k: 'e', a: 150, c: 'x' }), F.isLump({ k: 'e', a: 149.99, c: 'x' }), F.isLump({ k: 'e', a: 5, c: 'x', x: true }), F.isLump({ k: 'i', a: 2000, c: 'x' })]
    };
  });
  await b.close();

  check('the app loads without JavaScript errors', !errors.length, errors);
  check('897 movements loaded from the sample data', r.n0 === 897, r.n0);
  check('forecast back-test: mean error 16 % (±1 pt)', near(r.mape, 0.1619, 0.01), r.mape);
  check('forecast = spent + pending fixed + day-to-day + unexpected', near(r.f15.p, r.f15.parts, 0.01), r.f15);
  check('forecast "spent" equals the real spend to the cut-off day', near(r.f15.spent, r.f15.spentReal, 0.01), r.f15);
  check('Sep 2026 forecast on day 15 ≈ 1.426,43 €', near(r.f15.p, 1426.43, 0.5), r.f15.p);
  check('savings rate, last 12 complete months ≈ 35,3 %', near(r.rate12, 0.3531, 0.001), r.rate12);
  check('"mes normal" = 6-month average without extraordinary ≈ 1.650,84 €', near(r.normal, 1650.84, 0.01) && near(r.normal, r.avg6.e, 1e-6), r.normal);
  check('forecast range brackets the forecast (lo ≤ p ≤ hi)', r.lohi[0] <= r.lohi[1] && r.lohi[1] <= r.lohi[2], r.lohi);
  check('fixed payments: 6 active, 1 new', r.fxActive === 6 && r.fxNews === 1, [r.fxActive, r.fxNews]);
  check('alerts: electricity went down + new fixed + pádel habit', JSON.stringify(r.alerts) === JSON.stringify(['Luz ha bajado', 'Nuevo fijo: Plataforma de series', 'Pádel: ×9,7 en 3 meses']), r.alerts);
  check('category suggestion for "Clase pádel" is Deportes y hobbies', r.sg && r.sg.ids[0] === 'e-deportes', r.sg);
  check('one-off rule: ≥150 € or extraordinary, expenses only', JSON.stringify(r.lump) === '[true,false,true,false]', r.lump);
  check('CSV export then import adds no duplicates', r.n1 === r.n0, [r.n0, r.n1]);

  let fail = 0;
  for (const x of results) { console.log(`${x.ok ? 'ok  ' : 'FAIL'}  ${x.name}${x.ok ? '' : '  → got ' + JSON.stringify(x.got)}`); if (!x.ok) fail++; }
  console.log(fail ? `\n${fail} of ${results.length} failed` : `\nall ${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
