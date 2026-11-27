// Calculation tests for My Expenses: node tests/calc.test.js [app.html]   (default: app/my-expenses.html)
// Loads the app in local mode with the sample data in sample-data/ (897 invented movements, Sep 2024 – Nov 2026)
// on a fixed date (30 oct 2026) and checks the numbers the screens show. Values were pinned on v19 with that data;
// a change in them means the maths changed (or the sample data was regenerated with different rules).
// v30 adds the forecast card: "You have X left for day-to-day", the day-to-day pill (not before day 5), one yardstick
// for both (also with budgets), "You will end ≈ X above normal" (X is the end state, also when you are already over),
// the last day, Habits' pace = the pill, "Total forecast" / "Day-to-day forecast", the savings rate "—" and the
// savings jar quota. The sample data rarely runs above normal, so a few checks add day-to-day spending for a moment.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/my-expenses.html');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data/meta/config.json')));
const dir = path.join(ROOT, 'sample-data/months');
const txs = fs.readdirSync(dir).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []);

const results = [];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function check(name, ok, got) { results.push({ name, ok: !!ok, got }); }

(async () => {
  const tmp = path.join(require('os').tmpdir(), 'my-expenses-calc.html');
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
    const mf = F.monthForecast(), fx = F.fixedScan(), al = F.allAlerts(), sg = F.suggestCats('Padel lesson', 'e', 13.75);
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
  // the forecast card on other days of a month the sample data covers in full (September 2026). extra: day-to-day
  // expenses (under 150 € each, so not one-offs) added only while measuring, to get a pill above normal
  const at = async (iso, extra = []) => { await page.clock.setFixedTime(new Date(iso)); return page.evaluate(extra => {
    const F = window.__fc, S = F.state(), n0 = S.txs.length;
    if (extra.length) S.txs = extra.concat(S.txs).sort((a, b) => a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
    const mf = F.monthForecast(), L = mf.left, M = mf.M, isL = F.isLump;
    const E = S.txs.filter(t => t.k === 'e'), six = [1, 2, 3, 4, 5, 6].map(i => { const d = new Date(+M.slice(0, 4), +M.slice(5, 7) - 1 - i, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); });
    const nl = six.reduce((s, k) => s + E.filter(t => t.d.startsWith(k) && !isL(t)).reduce((a, t) => a + t.a, 0), 0) / 6;
    const spentNL = E.filter(t => t.d.startsWith(M) && +t.d.slice(8, 10) <= mf.d && !isL(t)).reduce((a, t) => a + t.a, 0);
    const fixed = F.fixedScan().active.filter(x => !x.tx.some(t => t.d.startsWith(M))).map(x => x.k);
    // Habits as the screen paints it (the same render as tapping "See the pace in Habits")
    const mc = F.monthCurve(mf), go = document.createElement('button'); go.dataset.goto = 'analisis'; go.dataset.ansub = 'habitos'; document.body.appendChild(go); go.click(); go.remove();
    const hab = document.querySelector('#main .card'), hab2 = { pill: hab.querySelector('.delta')?.textContent || null, sub: hab.querySelector('.sub').textContent.replace(/\s/g, ' '), leg: hab.querySelector('.legend').textContent };
    const out = { d: mf.d, dv: mf.dv, pend: mf.pend, pendNL: mf.pendNL, remVar: mf.remVar, ord: mf.ord, lumps: mf.lumps, punt: mf.punt, remBig: mf.remBig, p: mf.p, parts: mf.spent + mf.pend + mf.remVar + mf.remBig, raw: F.forecastAt(M, mf.d).p, L, nl, spentNL, normalNL: mf.normalNL, pendN: mf.pendList.length, fixed: fixed.length, card: F.forecastCard().replace(/\u00a0/g, ' '),
      pill: F.pacePill(mf).replace(/<[^>]+>/g, '') || null, mc: { end: mc.end, ref: mc.ref, nEnd: mc.normal[mc.normal.length - 1], now: mc.cur[mf.d - 1], projEnd: mc.proj[mc.proj.length - 1] }, hab: hab2 };
    if (extra.length) { S.txs = S.txs.filter(t => !String(t.id).startsWith('x-')); out.back = S.txs.length === n0; }
    return out;
  }, extra); };
  const shop = (day, a, i) => ({ id: 'x-' + day + '-' + i, d: `2026-09-${day}T12:00`, k: 'e', c: 'e-groceries', a, n: 'Groceries' });
  const d3 = await at('2026-09-03T12:00:00+02:00'), d15 = await at('2026-09-15T21:00:00+02:00'), d30 = await at('2026-09-30T21:00:00+02:00');
  const pace = []; for (const d of ['05', '10', '20', '25']) pace.push(await at(`2026-09-${d}T21:00:00+02:00`)); pace.push(d15);
  pace.push(await at('2026-08-25T21:00:00+02:00')); // the sample data's own day above normal (already over)
  // above normal but still under: three 125 € shops early in the month, measured on the 10th
  const under = await at('2026-09-10T21:00:00+02:00', [6, 7, 8].map((d, i) => shop('0' + d, 125, i))); pace.push(under);
  // already over on the 25th: four 120 € shops in the day to day (not one-offs)
  const over = await at('2026-09-25T21:00:00+02:00', [0, 1, 2, 3].map(k => shop('1' + k, 120, k)));
  const misc = await page.evaluate(() => { const F = window.__fc, g = { amount: 400, by: '2027-01', created: '2026-11-25' };
    const S = F.state(), c = S.cats.find(x => x.kind === 'e' && !(x.budget > 0)), L0 = F.monthForecast().left; c.budget = 100; const mfb = F.monthForecast(), Lb = mfb.left; delete c.budget;
    return { L0, ordB: mfb.ord, dvB: mfb.dv, nlB: mfb.normalNL, budgets: S.cats.filter(x => x.budget > 0).length, sr: [F.savingsRate(15, 725, .5), F.savingsRate(2000, 1500, 1), F.savingsRate(0, 10, 1)], gp: ['2026-11', '2026-12', '2027-01'].map(c => F.goalPlan(g, c)), Lb }; });
  await b.close();

  const n = v => Math.round(v).toLocaleString('en-GB'); // whole euros as the card writes them, "1,234"
  check('"normal day-to-day" = 6 complete months without one-offs', near(d15.normalNL, d15.nl, 0.01), [d15.normalNL, d15.nl]);
  check('"You have X left" = normal day-to-day − spent without one-offs − fixed still due (not one-offs)', d15.L && near(d15.L.ref, d15.nl, 0.01) && near(d15.L.x, d15.nl - d15.spentNL - d15.pendNL, 0.01) && near(d15.L.perDay, d15.L.x / 16, 0.01), d15.L);
  check('one yardstick: with budgets, "You have X left" and the pill still measure against normal day-to-day', misc.budgets > 0 && misc.Lb && misc.L0 && near(misc.Lb.ref, misc.nlB, 0.01) && near(misc.Lb.x, misc.L0.x, 0.01), [misc.Lb, misc.L0, misc.nlB]);
  check('with budgets the pill and "You have X left" agree (sign of dv = sign of ord − ref; over = ord − ref)', misc.dvB != null && Math.sign(misc.dvB) === Math.sign(misc.ordB - misc.Lb.ref) && near(misc.Lb.over, misc.ordB - misc.Lb.ref, 0.01), [misc.dvB, misc.ordB, misc.Lb]);
  check('"You have X left for day-to-day" appears on the card, per day too', /You (have <b class="num">[^<]+<\/b> left for|are <b class="num"[^>]*>[^<]+<\/b> over on) day-to-day/.test(d15.card) && /\/day/.test(d15.card), d15.card.slice(0, 600));
  const OVER = /You will end <b class="num">≈ €([\d,]+)<\/b> above<span class="dd"> normal<\/span>/;
  check('"You will end ≈ X above normal" = day-to-day forecast − yardstick = what is left to come − "You have X left", only with a red pill',
    pace.every(x => { const red = x.dv != null && x.dv >= .05, m = x.card.match(OVER); return red ? !!m && near(x.L.over, x.ord - x.nl, 0.01) && near(x.L.over, x.remVar - x.L.x, 0.01) && +m[1].replace(/,/g, '') === Math.round(x.L.over) : !m; }) && pace.some(x => x.dv >= .05) && !OVER.test(d3.card) && !OVER.test(d30.card),
    pace.map(x => [x.d, x.dv, x.L && x.L.over, (x.card.match(/You will end <b[^/]*/) || [''])[0]]));
  check('still under: "You have X left" and "You will end ≈ Y above normal" (the end state) together',
    under.back && pace.some(x => x.dv >= .05 && x.L.x >= 0 && /You have <b/.test(x.card) && OVER.test(x.card)),
    pace.map(x => [x.d, x.L && x.L.x, (x.card.match(/You will end <b[^/]*/) || [''])[0]]));
  { const m = over.card.match(OVER), y = over.L && Math.round(-over.L.x);
    check('already over: "You are Y over" and "You will end ≈ X above normal" with X ≥ Y (X is the end total, not more on top)',
      over.back && over.dv >= .05 && over.L.x < 0 && new RegExp(`You are <b[^>]*>€${n(y)}</b> over on day-to-day`).test(over.card) && !!m && +m[1].replace(/,/g, '') === Math.round(over.L.over) && over.L.over >= -over.L.x - 0.01,
      [over.L, (over.card.match(/You are[^/]*/) || [''])[0], m && m[0]]); }
  check('Habits names both forecasts: "Total forecast" in the subtitle, "Day-to-day forecast" for the dashed line', /^Total forecast ≈ /.test(over.hab.sub) && /Day-to-day forecast/.test(over.hab.leg) && !/(?<!Total |Day-to-day )forecast/i.test(over.hab.sub + over.hab.leg), [over.hab.sub, over.hab.leg]);
  check('big figure = day to day + one-offs + allowance (p = ord + punt + remBig)', [d3, d15, d30, ...pace].every(x => near(x.p, x.ord + x.punt + x.remBig, 0.01)), [d15.p, d15.ord, d15.punt, d15.remBig]);
  check('Habits\' pace = the pill: same curve ends (ord, normal), same pill text, same direction every day',
    pace.every(x => near(x.mc.end, x.ord, 0.01) && near(x.mc.projEnd, x.ord, 0.01) && near(x.mc.ref, x.normalNL, 0.01) && near(x.mc.nEnd, x.normalNL, 0.01) && near(x.mc.now, x.spentNL, 0.01) && x.hab.pill === x.pill && (x.dv == null || Math.sign(x.mc.end - x.mc.ref) === Math.sign(x.dv))) && d3.hab.pill === null,
    pace.map(x => [x.d, x.pill, x.hab.pill, x.mc, x.ord, x.normalNL]));
  check('Habits says the same numbers as the card: day-to-day and normal', pace.every(x => x.hab.sub.includes('day-to-day ≈ €' + n(x.ord)) && x.hab.sub.includes('normal €' + n(x.normalNL))), pace.map(x => [x.hab.sub, x.ord, x.normalNL]));
  check('card total unchanged by the new split (= forecastAt, = sum of its parts)', near(d15.p, d15.raw, 0.01) && near(d15.p, d15.parts, 0.01), [d15.p, d15.raw, d15.parts]);
  check('"Fixed still due" are the Fixed screen\'s active payments not logged this month', d15.pendN === d15.fixed, [d15.pendN, d15.fixed]);
  check('the pill compares day to day without one-offs on both sides', d15.dv != null && near(d15.dv, (d15.spentNL + d15.pendNL + d15.remVar - d15.nl) / d15.nl, 1e-9) && /day-to-day/.test(d15.card), [d15.dv, d15.ord, d15.nl]);
  check('no pill before day 5', d3.dv === null && !/class="delta/.test(d3.card), d3.card.slice(0, 200));
  check('last day: no range, no "≈", "You close"', !/Likely/.test(d30.card) && /You close September/.test(d30.card) && !/≈ €[\d,]+<\/span>/.test(d30.card.split('fc-big')[1].slice(0, 40)), d30.card.slice(0, 400));
  check('savings rate "—" when income is tiny', misc.sr[0] === null && near(misc.sr[1], .25, 1e-9) && misc.sr[2] === null, misc.sr);
  check('savings jar: fixed quota from creation (€400 by January = €133/month, month 1, 2, 3 of 3)', misc.gp.every((g, i) => g.n === 3 && near(g.per, 400 / 3, 1e-9) && g.nth === i + 1), misc.gp);

  check('the app loads without JavaScript errors', !errors.length, errors);
  check('897 movements loaded from the sample data', r.n0 === 897, r.n0);
  check('forecast back-test: mean error 16% (±1 pt)', near(r.mape, 0.1619, 0.01), r.mape);
  check('forecast = spent + pending fixed + day-to-day + unexpected', near(r.f15.p, r.f15.parts, 0.01), r.f15);
  check('forecast "spent" equals the real spend to the cut-off day', near(r.f15.spent, r.f15.spentReal, 0.01), r.f15);
  check('Sep 2026 forecast on day 15 ≈ €1,426.43', near(r.f15.p, 1426.43, 0.5), r.f15.p);
  check('savings rate, last 12 complete months ≈ 35.3%', near(r.rate12, 0.3531, 0.001), r.rate12);
  check('"normal month" = 6-month average without extraordinary ≈ €1,650.84', near(r.normal, 1650.84, 0.01) && near(r.normal, r.avg6.e, 1e-6), r.normal);
  check('forecast range brackets the forecast (lo ≤ p ≤ hi)', r.lohi[0] <= r.lohi[1] && r.lohi[1] <= r.lohi[2], r.lohi);
  check('fixed payments: 6 active, 1 new', r.fxActive === 6 && r.fxNews === 1, [r.fxActive, r.fxNews]);
  check('alerts: electricity went down + new fixed + padel habit', JSON.stringify(r.alerts) === JSON.stringify(['Electricity went down', 'New fixed payment: Series streaming', 'Padel: ×9.7 in 3 months']), r.alerts);
  check('category suggestion for "Padel lesson" is Sport and hobbies', r.sg && r.sg.ids[0] === 'e-sport', r.sg);
  check('one-off rule: ≥150 € or extraordinary, expenses only', JSON.stringify(r.lump) === '[true,false,true,false]', r.lump);
  check('CSV export then import adds no duplicates', r.n1 === r.n0, [r.n0, r.n1]);

  let fail = 0;
  for (const x of results) { console.log(`${x.ok ? 'ok  ' : 'FAIL'}  ${x.name}${x.ok ? '' : '  → got ' + JSON.stringify(x.got)}`); if (!x.ok) fail++; }
  console.log(fail ? `\n${fail} of ${results.length} failed` : `\nall ${results.length} passed`);
  process.exit(fail ? 1 : 0);
})();
