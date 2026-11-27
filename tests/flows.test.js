// User-flow tests for My Expenses against a fake cloud db: node tests/flows.test.js [app.html]   (default: app/my-expenses.html)
// Drives the app like a person (iPhone 15, fixed date 25 nov 2026, sample data) and checks what reaches the "cloud":
// add, edit to another month, delete + undo, offline outbox, fatal error, draft restore, typo/date guards,
// "Start over", search outside the period and bulk delete + undo.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/my-expenses.html');

// fake window.claude: db docs persisted in localStorage 'fakedb'; window.__fail = error code to throw on every call
const FAKE = `window.__fakeInit = function () {
  const K = 'fakedb', load = () => JSON.parse(localStorage.getItem(K) || '{}'), save = o => localStorage.setItem(K, JSON.stringify(o));
  const subs = { months: [], cfg: [] }; window.__fail = null;
  const chk = () => { if (window.__fail) { const e = new Error('fake ' + window.__fail); e.code = window.__fail; throw e; } };
  const delay = () => new Promise(r => setTimeout(r, 30));
  const emitM = () => { const o = load(); const docs = Object.keys(o).filter(k => k.startsWith('months/')).map(k => ({ id: k.slice(7), data: () => o[k] })); subs.months.forEach(f => f({ docs })); };
  const emitC = () => { const o = load(); const d = o['meta/config']; subs.cfg.forEach(f => f({ exists: !!d, data: () => d })); };
  const doc = p => ({
    acquire: async () => { await delay(); chk(); return { acquired: true }; },
    get: async () => { await delay(); chk(); const o = load(); return { exists: !!o[p], data: () => o[p] }; },
    set: async v => { await delay(); chk(); const o = load(); o[p] = JSON.parse(JSON.stringify(v)); save(o); p.startsWith('months/') ? emitM() : emitC(); },
    delete: async () => { await delay(); chk(); const o = load(); delete o[p]; save(o); emitM(); },
    onSnapshot: f => { subs.cfg.push(f); setTimeout(emitC, 10); return () => {}; }
  });
  const db = { doc, collection: () => ({ onSnapshot: f => { subs.months.push(f); setTimeout(emitM, 10); return () => {}; } }) };
  window.claude = { use: async n => n === 'db' ? db : { save: async () => {} } };
};`;

function sampleDocs() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data/meta/config.json')));
  const dir = path.join(ROOT, 'sample-data/months'), out = {};
  for (const f of fs.readdirSync(dir)) for (const t of JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []) (out['months/' + t.d.slice(0, 7)] ||= { txs: [] }).txs.push(t);
  out['meta/config'] = { cats: cfg.cats, currency: 'EUR', v: 1, lastBackup: '2026-11-20T10:00:00.000Z' };
  return out;
}

let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) { pass++; console.log('ok    ' + msg); } else { fail++; console.log('FAIL  ' + msg); } };

(async () => {
  const tmp = path.join(os.tmpdir(), 'my-expenses-flows.html');
  fs.writeFileSync(tmp, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(app, 'utf8'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 15'], locale: 'en-GB', timezoneId: 'Europe/Madrid' });
  const page = await ctx.newPage(); const errs = [];
  page.on('pageerror', e => errs.push(e.message));
  await page.clock.install({ time: new Date('2026-11-25T20:00:00+01:00') });
  await page.addInitScript(FAKE);
  await page.addInitScript(f => { if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.clear(); localStorage.setItem('fakedb', f); localStorage.setItem('gastos.tab', 'resumen'); } window.__fakeInit(); }, JSON.stringify(sampleDocs()));
  await page.goto('file://' + tmp);
  const T = async (ms = 500) => { await page.clock.runFor(ms); await page.waitForTimeout(120); };
  await T(1500);
  const cloud = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakedb')));
  const inCloud = async (m, f) => ((await cloud())['months/' + m] || { txs: [] }).txs.filter(f);
  const errText = () => page.$eval('#f-err', e => e.hidden ? '' : e.textContent).catch(() => '');
  const openAdd = async () => { await page.click('#bnav .bplus'); await T(400); };
  const fill = async (a, n, cat) => { await page.fill('#f-amt', a); await page.fill('#f-note', n); await T(200); if (cat) await page.locator('#f-cats .ctile', { hasText: cat }).first().click(); };
  const save = async () => { await page.click('#f-save'); await T(700); };

  ok(await page.evaluate(() => __fc.state().mode) === 'cloud', 'app runs in cloud mode on the fake db');

  // add
  await openAdd(); await fill('3.20', 'Coffee test', 'Eating out'); await save();
  ok((await inCloud('2026-11', t => t.n === 'Coffee test' && t.a === 3.2)).length === 1, 'add: a 3.20 € coffee reaches months/2026-11');

  // edit to another month
  await page.click('[data-bt="movimientos"]'); await T(600);
  await page.fill('#search-movs', 'Coffee test'); await T(400);
  await page.locator('.txlist [data-edit]').first().click(); await T();
  await page.fill('#f-date', '2026-10-31'); await save();
  ok((await inCloud('2026-11', t => t.n === 'Coffee test')).length === 0 && (await inCloud('2026-10', t => t.n === 'Coffee test')).length === 1, 'edit: moving it to October leaves it only in months/2026-10');

  // delete + undo
  await page.locator('.txlist [data-edit]').first().click(); await T();
  await page.click('#f-del'); await page.click('#f-del'); await T(700);
  ok((await inCloud('2026-10', t => t.n === 'Coffee test')).length === 0, 'delete: gone from the cloud');
  await page.click('#toast button'); await T(700);
  ok((await inCloud('2026-10', t => t.n === 'Coffee test')).length === 1, 'undo: back in the cloud');
  await page.fill('#search-movs', ''); await T(400);

  // offline: pending, then flushed
  await page.evaluate(() => { window.__fail = 'unavailable'; });
  await openAdd(); await fill('7', 'Offline test', 'Transport'); await save();
  ok(/pending/.test(await page.innerText('#main')) && (await inCloud('2026-11', t => t.n === 'Offline test')).length === 0, 'offline: shows a pending change and the cloud does not have it yet');
  await page.evaluate(() => { window.__fail = null; window.dispatchEvent(new Event('online')); }); await T(1500);
  ok((await inCloud('2026-11', t => t.n === 'Offline test')).length === 1, 'back online: the pending change is uploaded');

  // fatal: undone on screen, kept as a draft
  await page.evaluate(() => { window.__fail = 'quota_exceeded'; });
  await openAdd(); await fill('9', 'Fatal test', 'Transport'); await save();
  const onScreen = await page.evaluate(() => __fc.state().txs.some(t => t.n === 'Fatal test'));
  await page.evaluate(() => { window.__fail = null; });
  await openAdd();
  ok(!onScreen && await page.inputValue('#f-note') === 'Fatal test', 'fatal error: undone on screen and what you typed comes back in "+"');
  await page.keyboard.press('Escape'); await T(500);

  // draft restore: typing replaces the restored amount
  await openAdd(); await page.fill('#f-amt', '4.5'); await page.keyboard.press('Escape'); await T(500);
  await openAdd(); await page.keyboard.type('12');
  ok(await page.inputValue('#f-amt') === '12', 'draft: the restored amount is selected, so typing replaces it');
  if (await page.$('#f-drx')) await page.click('#f-drx'); await T(200); await page.keyboard.press('Escape'); await T(500);

  // typo guard on the amount
  await openAdd(); await fill('4550', 'Typo test', 'Other'); await save();
  const e1 = await errText(); await save();
  ok(/Save again/.test(e1) && (await inCloud('2026-11', t => t.n === 'Typo test')).length === 1, 'typo guard: 4550 € asks once, the second Save saves');

  // date guard
  await openAdd(); await fill('5', 'Date test', 'Other'); await page.fill('#f-date', '2062-11-15'); await save();
  const e2 = await errText();
  ok(/Save again/.test(e2) && !(await page.evaluate(() => __fc.state().txs.some(t => t.n === 'Date test'))), 'date guard: a date in 2062 asks before saving');
  await page.keyboard.press('Escape'); await T(500);
  const fresh = async () => { await openAdd(); if (await page.$('#f-drx')) { await page.click('#f-drx'); await T(200); } };

  // old-date guard
  await fresh(); await fill('5', 'Old date test', 'Other'); await page.fill('#f-date', '2016-11-20'); await save();
  const e3 = await errText();
  ok(/before your first transaction/.test(e3) && !(await page.evaluate(() => __fc.state().txs.some(t => t.n === 'Old date test'))), 'date guard: a date before your first transaction (2016) asks before saving');
  await page.keyboard.press('Escape'); await T(500);

  // a fatal error keeps "extraordinary" and the split days in the draft
  await fresh(); await fill('900', 'Extra test', 'Other');
  await page.click('.sheet details.opts summary'); await page.check('#f-x'); await page.fill('#f-split', '3');
  await page.evaluate(() => { window.__fail = 'quota_exceeded'; }); await save(); await page.evaluate(() => { window.__fail = null; });
  await openAdd();
  ok(await page.isChecked('#f-x') && await page.inputValue('#f-split') === '3' && await page.inputValue('#f-note') === 'Extra test', 'fatal error on a split extraordinary: the draft keeps both');
  // "Start over" also clears the hidden extraordinary + split fields
  await page.click('#f-drx'); await T(200); await fill('3.20', 'Zero test', 'Eating out'); await save();
  const z = await inCloud('2026-11', t => t.n === 'Zero test');
  ok(z.length === 1 && !z[0].x, '"Start over" after a split extraordinary draft: a coffee saves once and not as extraordinary');

  // search outside the period
  await page.click('[data-bt="movimientos"]'); await T(600);
  await page.fill('#search-movs', 'sofa'); await T(400);
  ok(!!(await page.$('[data-act="q-all"]')), 'search: a match older than the period is offered, not a silent zero');
  await page.fill('#search-movs', ''); await T(400);

  // bulk delete + undo
  const n0 = await page.evaluate(() => __fc.state().txs.length);
  await page.click('[data-act="sel-start"]'); await T();
  for (let i = 1; i < 3; i++) { await page.locator('[data-pick]').nth(i).click(); await T(200); }
  await page.click('[data-act="sel-del"]'); await T(200); await page.click('[data-act="sel-del"]'); await T(700);
  const n1 = await page.evaluate(() => __fc.state().txs.length);
  await page.click('#toast button'); await T(700);
  ok(n0 - n1 === 2 && await page.evaluate(() => __fc.state().txs.length) === n0, 'bulk delete: two taps delete 2, one Undo restores them');

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.join(' | ') : ''));
  await b.close();
  console.log(`\n${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
  process.exit(fail ? 1 : 0);
})();
