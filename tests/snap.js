// Style snapshot of every screen: node tests/snap.js <app.html> <out-dir>
// Loads the app in local mode with the seed data, a fixed date (30 oct 2026) and each tab / sub-view / theme / width,
// then records the computed style of every element (after finishing animations) and a screenshot.
// Compare two runs with: node tests/snapdiff.js <dirA> <dirB>
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path');
const [, , appFile, outDir] = process.argv;
const ROOT = path.join(__dirname, '..');
fs.mkdirSync(outDir, { recursive: true });

function seed() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'datos-ejemplo/meta/config.json')));
  const dir = path.join(ROOT, 'datos-ejemplo/months');
  const txs = fs.readdirSync(dir).flatMap(f => JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []);
  return { txs, cats: cfg.cats, lastBackup: '2026-10-20T10:00:00.000Z', fixOff: [], pot: null, goals: [] };
}

const SKIP = new Set(['transition', 'transition-delay', 'transition-duration', 'transition-property', 'transition-timing-function', 'transition-behavior', 'will-change']);
async function snapshot(page) {
  return page.evaluate(skip => {
    document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { a.cancel(); } });
    const out = [], skipS = new Set(skip);
    const walk = (el, p) => {
      const key = p + '>' + el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].sort().join('.') : '');
      const cs = getComputedStyle(el), props = {};
      for (const n of cs) if (!skipS.has(n)) props[n] = cs.getPropertyValue(n);
      for (const ps of ['::before', '::after']) { const c = getComputedStyle(el, ps); if (c.content && c.content !== 'none') for (const n of c) if (!skipS.has(n)) props[ps + n] = c.getPropertyValue(n); }
      const r = el.getBoundingClientRect(); props['@box'] = [r.x, r.y, r.width, r.height].map(v => Math.round(v)).join(',');
      out.push([key, props]);
      [...el.children].forEach((c, i) => walk(c, key + '[' + i + ']'));
    };
    walk(document.body, '');
    return out;
  }, [...SKIP]);
}

(async () => {
  const html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(appFile, 'utf8');
  const tmp = path.join(outDir, '_app.html'); fs.writeFileSync(tmp, html);
  const data = JSON.stringify(seed());
  const b = await chromium.launch();
  const forms = [['m', { ...devices['iPhone 15'] }], ['d', { viewport: { width: 1280, height: 860 } }], ['l', { ...devices['iPhone 15 landscape'] }]];
  const states = [['resumen'], ['movimientos'], ['analisis', 'general'], ['analisis', 'habitos'], ['analisis', 'comparar'], ['analisis', 'fijos'], ['analisis', 'viajes'], ['evolucion'], ['categorias'], ['resumen', null, 'add']];
  const errors = [];
  for (const [fk, dev] of forms) for (const theme of ['light', 'dark']) for (const [tab, sub, act] of states) {
    if (fk === 'l' && (theme === 'dark' || sub && sub !== 'general')) continue;
    const ctx = await b.newContext({ ...dev, locale: 'es-ES', timezoneId: 'Europe/Madrid' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errors.push(`${fk}/${theme}/${tab}/${sub}: ${e.message}`));
    await page.clock.setFixedTime(new Date('2026-10-30T12:00:00+01:00'));
    await page.addInitScript(([d, tab, sub, theme]) => { localStorage.setItem('gastos.local.v1', d); localStorage.setItem('gastos.tab', tab); if (sub) localStorage.setItem('gastos.ansub', sub); localStorage.setItem('gastos.theme', theme); }, [data, tab, sub, theme]);
    await page.goto('file://' + path.resolve(tmp));
    await page.waitForTimeout(900);
    if (act === 'add') { await page.click(fk === 'd' ? '#fab' : '.bnav .bplus'); await page.waitForTimeout(600); }
    const name = `${fk}-${theme}-${tab}${sub ? '-' + sub : ''}${act ? '-' + act : ''}`;
    const snap = await snapshot(page);
    fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(snap));
    await page.screenshot({ path: path.join(outDir, name + '.png'), fullPage: false });
    await ctx.close();
  }
  await b.close();
  fs.writeFileSync(path.join(outDir, '_errors.txt'), errors.join('\n'));
  console.log('done', outDir, errors.length ? errors : 'no page errors');
})();
