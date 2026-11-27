// Fine robustness tests for My Expenses (failures G1–G8 and H2–H4 found in the fifth and sixth review rounds):
//   node tests/sync2.test.js [app.html]   (default: app/my-expenses.html; about 5 minutes)
// Same shared fake cloud as sync.test.js, plus: a write that stalls and lands late (after the app stopped waiting),
// a device clock set ahead, two tabs of one browser sharing localStorage, storage that refuses the outbox, and a tab
// of the previous release (v20, taken from the git history) with pending changes. Uses the sample data. Checks:
// G1 a late write never undoes a later one (one device, two devices, settings) and a delete is not brought back ·
// G2 settings decided by what the device saw, not by its clock · G3 one outbox per browser · G4 storage full: honest
// message · G5 "Undo" of suggested budgets keeps a category made meanwhile · G6 old duplicates without `u` ·
// G7 pending v20 budget and category delete · G8 imported colours only #rrggbb, nothing from the cloud or a file runs,
// typed import fields · N7 opening over data in the exact sample-data/ shape writes nothing.
// v30: H2 a write the cloud never answers: the line says it waits for the cloud, not the connection, and "Retry"
// says so · H3 after a reload the tab still knows its own slow settings write (not "another device", its last value
// stays) · H4 malformed transactions in the cloud: every screen paints, "7" counts as 7, nothing is written back, a
// failing paint shows "Cannot show this screen · Download backup", the amount is escaped in the sheet.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/my-expenses.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'my-expenses-sync2-'));
const wrap = (f, x) => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(f, 'utf8').replace('window.__fc = {', 'window.__x = { ' + x + ' };\nwindow.__fc = {');
const APP = wrap(app, 'txSheet, catSheet, goalSheet, potSheet, dataSheet, backupNow, render, commit, get outbox() { return outbox; }');
// G7 opens the previous release (v20) from the git history, if there is one
let V20 = null;
try {
  const { execSync } = require('child_process'), h = execSync("git log --format=%H --grep='^v20:' -1", { cwd: ROOT }).toString().trim();
  if (h) { V20 = path.join(TMP, 'v20.html'); fs.writeFileSync(V20, execSync(`git show ${h}:app/my-expenses.html`, { cwd: ROOT, maxBuffer: 1e8 })); }
} catch (e) { V20 = null; }
let served = APP; // what the server sends (a test can serve an older version for a while)
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(served); });
let URL0 = '';

function sampleDocs() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data/meta/config.json')));
  const dir = path.join(ROOT, 'sample-data/months'), out = {};
  for (const f of fs.readdirSync(dir)) for (const t of JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []) (out['months/' + t.d.slice(0, 7)] ||= { txs: [] }).txs.push(t);
  out['months/2026-11'] = { txs: [
    { id: 'n1', d: '2026-11-03T12:00', k: 'e', c: 'e-groceries', a: 45.6, n: 'Supermarket' },
    { id: 'n2', d: '2026-11-10T12:00', k: 'e', c: 'e-eating-out', a: 3.2, n: 'Coffee' },
    { id: 'n3', d: '2026-11-20T12:00', k: 'e', c: 'e-eating-out', a: 24, n: 'Dinner' } ] };
  out['meta/config'] = { cats: cfg.cats, currency: 'EUR', v: 1, lastBackup: '2026-11-20T10:00:00.000Z' };
  return out;
}
// the exact sample-data/ structure, nothing added
function rawSample() {
  const out = {}, dir = path.join(ROOT, 'sample-data/months');
  for (const f of fs.readdirSync(dir)) out['months/' + f.replace('.json', '')] = JSON.parse(fs.readFileSync(path.join(dir, f)));
  out['meta/config'] = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data/meta/config.json')));
  return out;
}

const PAGE_FAKE = `(() => {
  window.__fail = null; window.__failOn = null; window.__subs = { months: [], cfg: [] }; window.__saved = [];
  const chk = (op, p) => {
    if (window.__fail) { const e = new Error('fake ' + window.__fail); e.code = window.__fail; throw e; }
    const f = window.__failOn; if (f && (!f.op || f.op === op) && (!f.path || p.startsWith(f.path)) && (f.times == null || f.times > 0)) { if (f.times != null) f.times--; const e = new Error('fake ' + f.code); e.code = f.code; throw e; }
  };
  const call = async (op, p, v) => { chk(op, p); const r = await window.__cloud(op, p, v === undefined ? null : JSON.parse(JSON.stringify(v))); if (r && r.err) { const e = new Error('cloud ' + r.err); e.code = r.err; throw e; } return r; };
  window.__emit = (months, cfg) => {
    const docs = Object.keys(months).map(id => ({ id, data: () => months[id] }));
    window.__subs.months.forEach(f => f({ docs }));
    window.__subs.cfg.forEach(f => f({ exists: !!cfg, data: () => cfg }));
  };
  const doc = p => ({
    acquire: async o => call('acquire', p, o),
    get: async () => { const r = await call('get', p); return { exists: !!r.data, data: () => r.data }; },
    set: async v => { await call('set', p, v); },
    delete: async () => { await call('delete', p); },
    onSnapshot: f => { window.__subs.cfg.push(f); window.__cloud('hello', '', null); return () => {}; }
  });
  const db = { doc, collection: () => ({ onSnapshot: f => { window.__subs.months.push(f); window.__cloud('hello', '', null); return () => {}; } }) };
  const dl = { save: async ({ filename, data }) => { window.__saved.push({ filename, data }); } };
  window.claude = { use: async n => n === 'db' ? db : dl };
})();`;

const BASE = new Date('2026-11-25T20:00:00+01:00').getTime();
class World {
  constructor(docs) { this.docs = docs || sampleDocs(); this.leases = {}; this.devs = []; this.latency = 25; this.t0 = Date.now(); this.writes = []; }
  months() { const o = {}; for (const k in this.docs) if (k.startsWith('months/')) o[k.slice(7)] = this.docs[k]; return o; }
  async push(dev) { if (dev.offline || dev.page.isClosed()) return; try { await dev.page.evaluate(([m, c]) => window.__emit && window.__emit(m, c), [this.months(), this.docs['meta/config'] || null]); } catch (e) {} }
  pushAll() { for (const d of this.devs) setTimeout(() => this.push(d), 15); }
  async handle(dev, op, p, v) {
    if (op === 'hello') { setTimeout(() => this.push(dev), 10); return {}; }
    await new Promise(r => setTimeout(r, this.latency));
    if (dev.offline) return { err: 'unavailable' };
    // a write that stalls once: the cloud gets it now, applies it `ms` later (the app stopped waiting at 8 s)
    if (op === 'set' && dev.stallSet) { const ms = dev.stallSet; dev.stallSet = 0; await new Promise(r => setTimeout(r, ms)); }
    const now = Date.now();
    if (op === 'acquire') { const l = this.leases[p]; if (!l || l.exp < now || l.holder === v.holder) { this.leases[p] = { holder: v.holder, exp: now + (v.ttlMs || 5000) }; return { acquired: true }; } return { acquired: false }; }
    if (op === 'get') { const d = this.docs[p]; return { data: d ? JSON.parse(JSON.stringify(d)) : null }; }
    if (op === 'set') { this.writes.push({ dev: dev.name, p }); this.docs[p] = v; this.pushAll(); return {}; }
    if (op === 'delete') { this.writes.push({ dev: dev.name, p, del: 1 }); delete this.docs[p]; this.pushAll(); return {}; }
    return { err: 'invalid_argument' };
  }
  // ctx: open as another tab of that device's browser (same localStorage); skewMs: the device clock is that far ahead
  async device(name, { dev = 'iPhone 15', pre = null, skewMs = 0, ctx = null } = {}) {
    const browser = this.browser || (this.browser = await chromium.launch());
    const D = dev === 'desktop' ? { viewport: { width: 1280, height: 860 } } : { ...devices[dev] };
    const d = { name, offline: false, errs: [] };
    if (!ctx) {
      ctx = await browser.newContext({ ...D, locale: 'en-GB', timezoneId: 'Europe/Madrid' });
      await ctx.exposeBinding('__cloud', (src, op, p, v) => this.handle(src.page.__dev || d, op, p, v));
      await ctx.addInitScript(() => { if (!localStorage.getItem('__init')) { localStorage.setItem('__init', '1'); localStorage.setItem('gastos.tab', 'resumen'); } });
      if (pre) await ctx.addInitScript(pre);
      await ctx.addInitScript(PAGE_FAKE);
    }
    d.ctx = ctx;
    const page = await ctx.newPage(); d.page = page; page.__dev = d;
    page.on('pageerror', e => d.errs.push(e.message));
    await page.clock.install({ time: new Date(BASE + Date.now() - this.t0 + skewMs) }); await page.clock.resume();
    await page.goto(URL0); await page.waitForTimeout(900);
    this.devs.push(d); this.helpers(d); return d;
  }
  async reload(d, ms = 900) { await d.page.reload(); await d.page.waitForTimeout(ms); }
  helpers(d) {
    const page = d.page;
    d.T = (ms = 400) => page.waitForTimeout(ms);
    d.box = () => page.evaluate(() => JSON.parse(localStorage.getItem('gastos.outbox.v1') || '[]').flatMap(o => o.up.map(t => t.n)));
    d.has = f => page.evaluate(src => __fc.state().txs.filter(eval(src)).map(t => ({ ...t })), f.toString());
    d.cats = () => page.evaluate(() => __fc.state().cats.map(c => ({ ...c })));
    d.openAdd = async () => { if (await page.isVisible('#bnav .bplus')) await page.click('#bnav .bplus'); else await page.click('#fab'); await d.T(350); if (await page.$('#f-drx')) { await page.click('#f-drx'); await d.T(150); } };
    d.fill = async (a, n, cat) => { await page.fill('#f-amt', a); await page.fill('#f-note', n); await d.T(150); if (cat) await page.locator('#f-cats .ctile', { hasText: cat }).first().click(); };
    d.save = async () => { await page.click('#f-save'); await d.T(500); };
    d.add = async (a, n, cat = 'Eating out') => { await d.openAdd(); await d.fill(a, n, cat); await d.save(); };
    d.noToast = () => page.evaluate(() => { document.getElementById('toast').hidden = true; });
    d.toast = () => page.$eval('#toast', e => e.hidden ? '' : e.innerText).catch(() => '');
    d.sync = () => page.$eval('.sync-line', e => e.innerText).catch(() => '');
    d.edit = async id => { await page.evaluate(id => __x.txSheet(id), id); await d.T(350); };
    d.cat = async (id, fill) => { await page.evaluate(id => __x.catSheet(id), id); await d.T(300); for (const k in fill) await page.fill(k, fill[k]); await page.click('#c-save'); await d.T(400); };
    d.newCat = async name => { await page.evaluate(() => __x.catSheet(null)); await d.T(300); await page.fill('#c-name', name); await page.click('#c-save'); await d.T(400); };
    d.delCat = async id => { await page.evaluate(id => __x.catSheet(id), id); await d.T(300); await page.click('#c-del'); await d.T(150); await page.click('#c-del'); await d.T(400); };
    d.imp = async (name, text) => { const f = path.join(TMP, name); fs.writeFileSync(f, text); await d.noToast(); await page.setInputFiles('#fileIn', f); return until(() => d.toast(), 15000); };
  }
  inCloud(m, f = () => true) { return ((this.docs['months/' + m] || { txs: [] }).txs).filter(f); }
  allCloud() { return Object.keys(this.docs).filter(k => k.startsWith('months/')).flatMap(k => this.docs[k].txs.map(t => ({ ...t, _doc: k.slice(7) }))); }
  cfg() { return this.docs['meta/config'] || { cats: [] }; }
  async close() { if (this.browser) await this.browser.close(); }
}
async function until(fn, ms = 10000) { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 200)); return v; }

let pass = 0, fail = 0; const errs = [];
const ok = (c, msg, got) => { if (c) { pass++; console.log('ok    ' + msg); } else { fail++; console.log('FAIL  ' + msg + (got !== undefined ? '  → ' + JSON.stringify(got) : '')); } };
const run = async (name, fn, docs) => { const w = new World(docs); try { await fn(w); } catch (e) { fail++; console.log('FAIL  ' + name + ': ' + e.message.split('\n')[0]); } finally { served = APP; w.devs.forEach(d => errs.push(...d.errs.map(e => d.name + ': ' + e))); await w.close(); } };
const names = (w, m, re) => w.inCloud(m, t => re.test(t.n)).map(t => t.n).sort();

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); URL0 = `http://127.0.0.1:${server.address().port}/app.html`;

  // G1 a) one iPhone: its first write stalls 40 s and lands late (after the 30 s the queue of v26 waited)
  await run('G1a', async w => {
    const A = await w.device('iphone');
    A.stallSet = 40000; await A.add('3.20', 'Coffee 1 (slow)'); const t0 = Date.now();
    await A.T(19000); await A.add('2.10', 'Coffee 2');
    await until(async () => Date.now() - t0 > 46000 && names(w, '2026-11', /^Coffee [12]/).length === 2 && !(await A.box()).length, 52000);
    ok(names(w, '2026-11', /^Coffee [12]/).length === 2, 'G1 late write, one device: the cloud keeps both coffees', names(w, '2026-11', /^Coffee [12]/));
    ok((await A.has(t => /^Coffee [12]/.test(t.n))).length === 2, 'G1 late write, one device: both coffees on screen');
  });
  // G1 b) two devices: the iPhone's write lands 12 s late; the Mac noted bread meanwhile; the Mac deleted the coffee n2
  await run('G1b', async w => {
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    A.stallSet = 12000; await A.add('4.50', 'Coffee iPhone');
    await B.add('1.20', 'Bread Mac');
    await B.edit('n2'); await B.page.click('#f-del'); await B.page.click('#f-del');
    await until(() => names(w, '2026-11', /Bread Mac/).length === 1 && !w.inCloud('2026-11', t => t.id === 'n2').length, 9000);
    ok(names(w, '2026-11', /Bread Mac/).length === 1 && !w.inCloud('2026-11', t => t.id === 'n2').length, 'G1 two devices: before the late write the Mac has saved its bread and deleted n2');
    await until(() => names(w, '2026-11', /Coffee iPhone|Bread Mac/).length === 2 && !w.inCloud('2026-11', t => t.id === 'n2').length, 22000); await A.T(1500);
    ok(names(w, '2026-11', /Coffee iPhone|Bread Mac/).length === 2, 'G1 two devices: after the late write the cloud has the iPhone coffee and the Mac bread', names(w, '2026-11', /Coffee iPhone|Bread Mac/));
    ok(!w.inCloud('2026-11', t => t.id === 'n2').length, 'G1 two devices: the coffee deleted on the Mac is not brought back by the late write', w.inCloud('2026-11', t => t.id === 'n2'));
    ok((await B.has(t => t.n === 'Bread Mac')).length === 1 && !(await B.has(t => t.id === 'n2')).length, 'G1 two devices: the Mac shows its bread and not the deleted coffee');
  });
  // G1 c) settings: the iPhone's budget write lands 12 s late; the Mac created "Pet" meanwhile
  await run('G1c', async w => {
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    A.stallSet = 12000; await A.cat('e-groceries', { '#c-budget': '250' });
    await B.T(500); await B.newCat('Pet'); await B.T(2000);
    const both = () => { const c = w.cfg(); return !!c.cats.find(x => x.name === 'Pet') && c.cats.find(x => x.id === 'e-groceries').budget === 250; };
    await A.T(10000); await until(both, 15000); await A.T(1500);
    const c = w.cfg();
    ok(both(), 'G1 late settings write: the Mac\'s new category survives and the iPhone budget is there', { m: !!c.cats.find(x => x.name === 'Pet'), b: c.cats.find(x => x.id === 'e-groceries').budget });
    ok((await B.cats()).some(x => x.name === 'Pet') && (await A.cats()).some(x => x.name === 'Pet'), 'G1 late settings write: both devices show "Pet"');
  });

  // G2: the iPhone clock is 10 minutes ahead
  await run('G2', async w => {
    const A = await w.device('iphone', { skewMs: 10 * 60000 }), B = await w.device('mac', { dev: 'desktop' });
    const bud = () => w.cfg().cats.find(c => c.id === 'e-groceries').budget;
    await A.cat('e-groceries', { '#c-budget': '250' }); await A.T(1500);
    await B.noToast(); await B.cat('e-groceries', { '#c-budget': '300' }); const t = await until(B.toast, 4000); await B.T(1500);
    ok(bud() === 300, 'G2 clock ahead: the later change (Mac, 300) wins over the iPhone with its clock 10 min ahead', bud());
    ok(((await B.cats()).find(c => c.id === 'e-groceries') || {}).budget === 300 && /updated/.test(t), 'G2 clock ahead: the Mac shows 300 and says "Category updated"', t);
    await A.newCat('Birthday party'); await A.T(1500);
    const rid = (w.cfg().cats.find(c => c.name === 'Birthday party') || {}).id;
    await B.T(800); await B.delCat(rid); await B.T(1500);
    ok(rid && !w.cfg().cats.find(c => c.id === rid) && !(await B.cats()).some(c => c.id === rid), 'G2 clock ahead: deleting on the Mac a category made on the iPhone deletes it');
    // a change made from an old view (the device did not see the newer one) still loses, and says so
    A.offline = true;
    await A.cat('e-transport', { '#c-budget': '90' });
    await B.cat('e-transport', { '#c-budget': '70' }); await B.T(800);
    await A.noToast(); A.offline = false; await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    const t2 = await until(A.toast, 6000); await A.T(1500);
    ok(w.cfg().cats.find(c => c.id === 'e-transport').budget === 70 && /Another device/.test(t2), 'G2 stale change: the newer value from the other device stays, and the device says so', { b: w.cfg().cats.find(c => c.id === 'e-transport').budget, t2 });
  });

  // G3: two tabs of one browser, offline; tab 1 is closed before the connection is back
  await run('G3', async w => {
    const A = await w.device('tab 1', { dev: 'desktop' }), A2 = await w.device('tab 2', { dev: 'desktop', ctx: A.ctx });
    A.offline = true; A2.offline = true;
    await A.add('3.20', 'Coffee tab 1'); await A2.add('2.00', 'Water tab 2'); await A.T(500);
    ok((await A2.box()).length === 2, 'G3 two tabs offline: the outbox saved in the browser has both', await A2.box());
    ok(await until(async () => (await A.has(t => / tab [12]$/.test(t.n))).length === 2, 3000), 'G3 two tabs offline: each tab shows what the other noted');
    await A.page.close();
    A2.offline = false; await A2.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(() => names(w, '2026-11', / tab [12]$/).length === 2, 8000);
    ok(names(w, '2026-11', / tab [12]$/).length === 2, 'G3 two tabs: what both noted reaches the cloud', names(w, '2026-11', / tab [12]$/));
  });

  // G4: the browser refuses to keep the outbox (full or blocked storage), offline
  await run('G4', async w => {
    const A = await w.device('iphone', { pre: () => { const o = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (/outbox/.test(k)) throw new DOMException('full', 'QuotaExceededError'); return o.call(this, k, v); }; } });
    A.offline = true; await A.noToast();
    await A.add('3.20', 'Coffee no space'); await A.T(2000);
    const t = await A.toast(), l = await A.sync();
    ok(!/saved automatically/.test(t) && /do not reload/.test(t), 'G4 storage full: the toast does not promise "saved automatically" and says not to reload', t);
    ok(/do not reload/.test(l), 'G4 storage full: the pending line says so too', l);
    A.offline = false; await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    ok(await until(() => names(w, '2026-11', /Coffee no space/).length === 1, 8000), 'G4 storage full: once back online the coffee still reaches the cloud');
  });

  // G5: "Undo" of the suggested budgets, after the Mac created a category
  await run('G5', async w => {
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    const before = w.cfg().cats.map(c => [c.id, c.budget]);
    await A.page.evaluate(() => { const b = document.createElement('button'); b.dataset.act = 'review-budgets'; document.querySelector('#main').appendChild(b); b.click(); }); await A.T(500);
    await A.page.click('#rb-ok'); await A.T(1200);
    await B.newCat('Pet'); await B.T(1500);
    const btn = await A.page.$('#toast button'); if (btn) await btn.click(); await A.T(2500);
    ok(!!btn && !!w.cfg().cats.find(c => c.name === 'Pet'), 'G5 "Undo" suggested budgets: the Mac\'s new category stays in the cloud', !!btn);
    const now = new Map(w.cfg().cats.map(c => [c.id, c.budget]));
    ok(before.every(([id, b]) => (now.get(id) ?? null) === (b ?? null)), 'G5 "Undo" suggested budgets: the budgets are back as they were');
  });

  // G6: the same movement in October and November without `u` (left by an older version)
  const d6 = sampleDocs(); d6['months/2026-10'].txs.push({ id: 'n3', d: '2026-10-31T21:00', k: 'e', c: 'e-eating-out', a: 24, n: 'Dinner' });
  await run('G6', async w => {
    const A = await w.device('iphone'); await A.T(4000);
    ok((await A.has(t => t.id === 'n3')).length === 1 && !w.writes.length, 'G6 old duplicate without u: shown once, and opening writes nothing', (await A.has(t => t.id === 'n3')).map(t => t.d));
    await A.edit('n3'); await A.page.click('#f-del'); await A.page.click('#f-del'); await A.T(1500);
    const left = w.allCloud().filter(t => t.id === 'n3').map(t => t._doc);
    ok(left.length === 1, 'G6 deleting the copy you see deletes only that copy', left);
  }, d6);

  // G7: a tab of the previous release (v20) left changes pending offline (budget, category deleted, category created);
  // then this version opens online. v20 is taken from the git history; without it the case is skipped
  await run('G7', async w => {
    const B = await w.device('mac', { dev: 'desktop' });
    if (!V20) { console.log('skip  G7: v20 not found in the git history'); return; }
    served = wrap(V20, 'txSheet, catSheet');
    const A = await w.device('iphone-v20'); A.errs.length = 0; A.offline = true;
    await A.add('3.20', 'Coffee v20 offline');
    await A.cat('e-groceries', { '#c-budget': '250' });
    await A.delCat('e-bills'); await A.T(400);
    await A.newCat('Birthday party'); await A.T(400);
    await B.cat('e-eating-out', { '#c-budget': '120' }); await B.T(800);
    A.errs.length = 0; served = APP; A.offline = false; await w.reload(A, 1500); await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await until(async () => !(await A.sync()) && w.cfg().cats.some(x => x.name === 'Birthday party'), 20000); await A.T(1000);
    const c = w.cfg(), cat = id => c.cats.find(x => x.id === id);
    ok(w.inCloud('2026-11', t => t.n === 'Coffee v20 offline').length === 1 && !!c.cats.find(x => x.name === 'Birthday party'), 'G7 v20 pending: the coffee arrives once and the new category arrives');
    ok(cat('e-groceries').budget === 250, 'G7 v20 pending: the budget set offline arrives', cat('e-groceries').budget);
    ok(!cat('e-bills') && !w.allCloud().some(t => t.c === 'e-bills'), 'G7 v20 pending: the category deleted offline stays deleted, and its transactions moved', !!cat('e-bills'));
    ok(cat('e-eating-out').budget === 120, 'G7 v20 pending: the old copy does not overwrite the budget set on the Mac', cat('e-eating-out').budget);
  });

  // G8: imports with odd types, and HTML in what comes from the cloud
  await run('G8', async w => {
    const A = await w.device('iphone');
    const b = { app: 'my-expenses', v: 2 };
    const t1 = await A.imp('color.json', JSON.stringify({ ...b, cats: [{ id: 'e-x', name: 'Odd', kind: 'e', color: '"><img src=x onerror="window.__xss=1">' }], txs: [{ id: 'z5', d: '2026-11-24T10:00', k: 'e', c: 'e-x', a: 9, n: 'odd colour' }] }));
    await A.T(1000); await w.reload(A, 1500);
    const col = (w.cfg().cats.find(c => c.name === 'Odd') || {}).color;
    ok(/^#[0-9a-f]{6}$/i.test(col || '') && !(await A.page.evaluate(() => window.__xss)), 'G8 imported colour with HTML: saved as a valid #rrggbb and nothing runs', { col, t1 });
    await A.imp('types.json', JSON.stringify({ ...b, pot: '3000', cats: [{ id: 'e-y', name: 'Odd budget', kind: 'e', color: '#123456', budget: 'a lot' }, { id: 'e-n', name: 42, kind: 'e', color: '#123457' }], goals: [{ id: 'gx', name: 'Broken jar' }, { name: null, amount: 'x' }, { name: 'Bike', amount: '450', by: '2027-05' }], txs: [{ id: 'z6', d: '2026-11-24T10:00', k: 'e', c: 'e-y', a: 10, n: 12345, l: ['a', 'b'] }, { id: 'z7', d: '2026-11-24T11:00', k: 'e', c: 'e-n', a: 11, n: 'numeric cat', l: 7 }] }));
    await A.T(1500);
    const c = w.cfg(), z6 = w.allCloud().find(t => t.a === 10 && t.n === '12345'), z7 = w.allCloud().find(t => t.n === 'numeric cat');
    ok(c.pot === 3000 && (c.cats.find(x => x.name === 'Odd budget') || {}).budget == null && c.cats.some(x => x.name === '42'), 'G8 typed import: pot as a number, no text budget, a numeric category name as text', { pot: c.pot, cats: c.cats.filter(x => /Odd budget|42/.test(x.name)) });
    ok(JSON.stringify((c.goals || []).map(g => [g.name, g.amount, g.by])) === '[["Bike",450,"2027-05"]]', 'G8 typed import: only the complete savings jar is kept', c.goals);
    ok(z6 && z6.l === 'a, b' && z7 && z7.l === '7', 'G8 typed import: numeric note and labels become text', { z6, z7 });
    const t3 = await A.imp('broken.json', '{ "app": "my-expenses", "txs": [ { "d": ');
    ok(/^Could not import: the file is not valid JSON/.test(t3), 'G8 broken JSON: a plain-language message', t3);
    // HTML in names, icons, colors, notes, labels and ids already in the cloud: shown as text on every screen
    const P = f => `"'><img src=x class=xss data-f=${f} onerror="(window.__xss2=window.__xss2||[]).push(this.dataset.f)">`;
    const cfg = JSON.parse(JSON.stringify(w.cfg())), sup = cfg.cats.find(x => x.id === 'e-groceries');
    sup.name = 'Super ' + P('name'); sup.icon = P('icon'); sup.budget = 300; cfg.cats.find(x => x.id === 'e-eating-out').color = P('color');
    cfg.cats.push({ id: 'e-bad' + P('catid'), name: 'Bad', kind: 'e', color: '#123456', budget: P('budget') });
    cfg.goals = [{ id: 'g' + P('goalid'), name: P('goal'), amount: 500, by: '2027-03', created: '2026-11-01' }];
    w.docs['meta/config'] = cfg;
    w.docs['months/2026-11'].txs.push({ id: 'x' + P('txid'), d: '2026-11-22T10:00', k: P('k'), c: 'e-bad' + P('catid'), a: 7, n: P('note'), l: P('label') });
    await w.reload(A, 1500);
    const seen = [];
    for (const t of ['resumen', 'movimientos', 'analisis', 'evolucion', 'categorias']) {
      await A.page.evaluate(t => { const S = __fc.state(); S.tab = t; __x.render(); }, t); await A.T(300);
      if (t === 'analisis') for (const s of ['habitos', 'comparar', 'fijos', 'viajes', 'general']) { await A.page.evaluate(s => { __fc.state().anSub = s; __x.render(); }, s); await A.T(200); }
      seen.push(...await A.page.evaluate(() => [...document.querySelectorAll('.xss')].map(e => e.dataset.f)));
    }
    for (const f of [() => __x.txSheet(__fc.state().txs.find(t => t.id.startsWith('x"')).id), () => __x.catSheet(__fc.state().cats.find(c => c.id.startsWith('e-bad')).id), () => __x.catSheet('e-groceries'), () => __x.goalSheet(__fc.state().goals[0].id)]) {
      await A.page.evaluate(f); await A.T(400); seen.push(...await A.page.evaluate(() => [...document.querySelectorAll('.xss')].map(e => e.dataset.f))); await A.page.keyboard.press('Escape'); await A.T(300);
    }
    seen.push(...await A.page.evaluate(() => window.__xss2 || []));
    ok(!seen.length, 'G8 HTML from the cloud (names, icons, colors, notes, labels, ids, budgets, savings jars): nothing is injected or runs', [...new Set(seen)]);
  });

  // H2: November's write hangs (the cloud answers 25 s later); the network is fine: October saves at once
  await run('H2', async w => {
    const A = await w.device('iphone');
    A.stallSet = 25000; await A.add('3.20', 'Coffee 1 (hung)'); const t0 = Date.now();
    await A.T(9500); await A.add('2.10', 'Coffee 2');
    await A.page.evaluate(() => __x.commit([{ id: 'oct-h2', d: '2026-10-15T12:00', k: 'e', c: 'e-eating-out', a: 9, n: 'October dinner' }], []).catch(e => e.code));
    await A.T(3000); await A.noToast();
    const l = await A.sync();
    ok(w.inCloud('2026-10', t => t.id === 'oct-h2').length === 1, 'H2 another month is saved while November\'s write hangs');
    ok(/2 pending changes · waiting for the cloud to confirm/.test(l) && !/connection/.test(l), 'H2 the line says it waits for the cloud to confirm, not for the connection', l);
    await A.add('1.10', 'Coffee 3'); await A.T(600); const t1 = await A.toast();
    ok(!/Offline/.test(t1) && /slow to confirm/.test(t1), 'H2 a change made once the network is proven fine does not say "Offline"', t1);
    await A.noToast(); await A.page.click('.sync-line [data-act="sync-retry"]'); await A.T(1200);
    const t2 = await A.toast();
    ok(/has not confirmed/.test(t2) && !/offline/i.test(t2), 'H2 "Retry" while it hangs: says the cloud has not confirmed yet, not "Still offline"', t2);
    await until(() => Date.now() - t0 > 27000, 30000); await until(() => names(w, '2026-11', /^Coffee [123]/).length === 3, 8000);
    ok(names(w, '2026-11', /^Coffee [123]/).length === 3 && !(await A.box()).length, 'H2 once the hung write lands, the rest goes up by itself', { cloud: names(w, '2026-11', /^Coffee [123]/), box: await A.box() });
  });

  // H3: one iPhone, its budget write (250) takes 20 s; meanwhile 260, a reload with no network, the 250 lands
  await run('H3', async w => {
    const A = await w.device('iphone'), bud = () => w.cfg().cats.find(c => c.id === 'e-groceries').budget;
    A.stallSet = 20000; await A.cat('e-groceries', { '#c-budget': '250' }); const t0 = Date.now();
    await A.T(9000); await A.noToast();
    await A.cat('e-groceries', { '#c-budget': '260' });
    A.offline = true; await w.reload(A, 1500);
    await until(() => Date.now() - t0 > 24000, 30000);
    ok(bud() === 250, 'H3 (setup) the slow write of 250 landed while the tab was reloaded and offline', bud());
    A.offline = false; await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await A.T(6000);
    const scr = (await A.cats()).find(c => c.id === 'e-groceries').budget, t = await A.toast();
    ok(bud() === 260 && scr === 260, 'H3 after a reload its last value stays (260), in the cloud and on screen', { cloud: bud(), scr });
    ok(!/Another device/.test(t), 'H3 its own slow write is not "another device"', t);
  });

  // H4: malformed transactions in the cloud (an old version, another tool, an edit by hand)
  const h4 = sampleDocs(), X = `"><img src=x class=xss onerror="(window.__xss3=window.__xss3||[]).push(1)">`;
  h4['months/2026-11'].txs.push({ id: 'b1', d: '2026-11-23T13:00', k: 'e', c: 'e-groceries', a: '7', n: 'Text amount' },
    { id: 'b2', k: 'e', c: 'e-groceries', a: 5, n: 'No date' }, { id: 'b3', d: null, k: 'e', c: 'e-groceries', a: 5, n: 'Null date' },
    { id: 'b4', d: 'yesterday', k: 'e', c: 'e-groceries', a: 5, n: 'Odd date' }, { id: 'b5', d: '2026-11-22T13:00', k: 'e', c: 'e-groceries', a: '7' + X, n: 'HTML amount' },
    { id: 'b6', d: '2026-11-22T13:00', k: 'e', c: 'e-groceries', a: null, n: 'Null amount' });
  await run('H4', async w => {
    const snap0 = JSON.stringify(w.docs);
    const A = await w.device('iphone'); await A.T(600);
    const t = await A.toast(), res = {};
    for (const tab of ['resumen', 'movimientos', 'analisis', 'evolucion', 'categorias']) {
      await A.page.evaluate(t => { const S = __fc.state(); S.tab = t; __x.render(); }, t); await A.T(300);
      res[tab] = await A.page.evaluate(() => { const m = document.querySelector('#main').innerText; return /Loading|Cannot (show|connect)/.test(m) ? 'NO' : m.length < 80 ? 'EMPTY' : 'ok'; });
    }
    const st = await A.page.evaluate(() => { const S = __fc.state(), b = S.txs.filter(t => /^b\d$/.test(t.id)); return { ids: b.map(t => t.id), a: (b.find(t => t.id === 'b1') || {}).a }; });
    ok(Object.values(res).every(v => v === 'ok'), 'H4 with malformed transactions in the cloud every screen paints', res);
    ok(JSON.stringify(st.ids) === '["b1"]' && st.a === 7, 'H4 "7" is read as 7 €; no date, a date that is not one, or an amount that is not a number: left out', st);
    ok(/^5 damaged transactions in the cloud are not shown/.test(t), 'H4 a toast says how many are left out', t);
    await A.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); }); await A.T(4000);
    ok(!w.writes.length && JSON.stringify(w.docs) === snap0, 'H4 nothing is written back: the cloud keeps them as they are', w.writes);
    // a paint that fails: a way out, not "Loading…"
    const fb = await A.page.evaluate(() => { const S = __fc.state(); S.txs = S.txs.concat({ id: 'z', k: 'e', c: 'e-groceries', a: 5 }); S.tab = 'resumen'; __x.render();
      const m = document.querySelector('#main'), r = { txt: m.innerText.replace(/\s+/g, ' ').slice(0, 120), alert: !!m.querySelector('[role="alert"]'), copy: !!m.querySelector('[data-act="backup"]') };
      S.txs = S.txs.filter(t => t.id !== 'z'); __x.render(); r.back = !/Cannot show/.test(m.innerText); return r; });
    ok(/Cannot show this screen/.test(fb.txt) && fb.alert && fb.copy && fb.back, 'H4 a screen that fails to paint says "Cannot show this screen" with "Download backup", and comes back', fb);
    // the amount in the edit sheet is escaped, also if one ever got past the check
    await A.page.evaluate(X => { const S = __fc.state(), t = S.txs.find(t => t.id === 'n2'); t.a = '3' + X; __x.txSheet('n2'); }, X); await A.T(400);
    const inj = await A.page.evaluate(() => ({ img: document.querySelectorAll('.sheet img.xss').length, ran: (window.__xss3 || []).length, v: document.getElementById('f-amt').value }));
    ok(!inj.img && !inj.ran && /^3"><img/.test(inj.v), 'H4 HTML in an amount shows as text in the sheet and does not run', inj);
    await A.page.keyboard.press('Escape'); await A.T(300);
  }, h4);

  // N7: opening over data with the exact sample-data/ shape writes nothing, also after waiting for retries and duplicates
  await run('N7', async w => {
    const snap0 = JSON.stringify(w.docs);
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    for (const D of [A, B]) for (const t of ['movimientos', 'analisis', 'evolucion', 'categorias', 'resumen']) { await D.page.evaluate(t => { const S = __fc.state(); S.tab = t; __x.render(); }, t); await D.T(300); }
    await w.reload(A, 1500); await A.page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
    await A.T(8000);
    ok(!w.writes.length && JSON.stringify(w.docs) === snap0, 'N7 opening over the sample-data/ data writes nothing and leaves every document as it was', w.writes);
  }, rawSample());

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`\n${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
  server.close(); process.exit(fail ? 1 : 0);
})();
