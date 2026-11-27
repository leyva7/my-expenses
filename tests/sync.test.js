// Sync tests for My Expenses against a shared fake cloud: node tests/sync.test.js [app.html]   (default: app/my-expenses.html)
// Each "device" is its own browser context (own localStorage and outbox) writing to one cloud kept in Node, with
// leases like the real one, snapshots pushed to every online device, per-device offline/hung network and fault
// injection. Uses the sample data. Checks the failures F1–F6 found in the fourth review round:
// F1 offline streak + reload · F2 hung network · F3 settings from two devices, merge while pending, stale pending ·
// F4 no silent local mode, local data offered · F5 offline import, date/amount validation · F6 one movement, one month.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/my-expenses.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'my-expenses-sync-')), RUN = path.join(TMP, 'app.html');
// served over http (a real origin): with file:// Chromium now and then starts a reloaded page with empty localStorage
const server = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); r.end(fs.readFileSync(RUN)); });
let URL0 = '';
fs.writeFileSync(RUN, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(app, 'utf8').replace('window.__fc = {', 'window.__x = { txSheet, catSheet, backupNow, get outbox() { return outbox; } };\nwindow.__fc = {'));

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
  window.claude = { use: async n => { if (window.__useFail && window.__useFail[n]) throw Object.assign(new Error('use ' + n), { code: 'unavailable' }); return n === 'db' ? db : dl; } };
})();`;

const BASE = new Date('2026-11-25T20:00:00+01:00').getTime();
class World {
  constructor(docs) { this.docs = docs || sampleDocs(); this.leases = {}; this.devs = []; this.latency = 25; this.t0 = Date.now(); }
  months() { const o = {}; for (const k in this.docs) if (k.startsWith('months/')) o[k.slice(7)] = this.docs[k]; return o; }
  async push(dev) { if (dev.offline || dev.page.isClosed()) return; try { await dev.page.evaluate(([m, c]) => window.__emit && window.__emit(m, c), [this.months(), this.docs['meta/config'] || null]); } catch (e) {} }
  pushAll() { for (const d of this.devs) setTimeout(() => this.push(d), 15); }
  async handle(dev, op, p, v) {
    if (op === 'hello') { setTimeout(() => this.push(dev), 10); return {}; }
    await new Promise(r => setTimeout(r, this.latency));
    if (dev.offline) return { err: 'unavailable' };
    if (dev.stall) { const s = dev.stall; await new Promise(r => setTimeout(r, s)); if (dev.closed) return { err: 'unavailable' }; }
    if (op === 'acquire') { const l = this.leases[p], now = Date.now(); if (!l || l.exp < now || l.holder === v.holder) { this.leases[p] = { holder: v.holder, exp: now + (v.ttlMs || 5000) }; return { acquired: true }; } return { acquired: false }; }
    if (op === 'get') { const d = this.docs[p]; return { data: d ? JSON.parse(JSON.stringify(d)) : null }; }
    if (op === 'set') { this.docs[p] = v; this.pushAll(); return {}; }
    if (op === 'delete') { delete this.docs[p]; this.pushAll(); return {}; }
    return { err: 'invalid_argument' };
  }
  async device(name, { dev = 'iPhone 15', init = null, pre = null } = {}) {
    const browser = this.browser || (this.browser = await chromium.launch());
    const D = dev === 'desktop' ? { viewport: { width: 1280, height: 860 } } : { ...devices[dev] };
    const ctx = await browser.newContext({ ...D, locale: 'en-GB', timezoneId: 'Europe/Madrid' });
    const d = { name, ctx, offline: false, errs: [] };
    await ctx.exposeBinding('__cloud', (src, op, p, v) => this.handle(d, op, p, v));
    await ctx.addInitScript(([init]) => { if (!localStorage.getItem('__init')) { localStorage.setItem('__init', '1'); localStorage.setItem('gastos.tab', 'resumen'); if (init) for (const k in init) localStorage.setItem(k, init[k]); } }, [init]);
    if (pre) await ctx.addInitScript(pre);
    await ctx.addInitScript(PAGE_FAKE);
    const page = await ctx.newPage(); d.page = page;
    page.on('pageerror', e => d.errs.push(e.message));
    // one timeline for every device (as two real devices share the real time)
    await page.clock.install({ time: new Date(BASE + Date.now() - this.t0) }); await page.clock.resume();
    await page.goto(URL0); await page.waitForTimeout(900);
    this.devs.push(d); this.helpers(d); return d;
  }
  async setOffline(d, off) { d.offline = off; if (!off) { await this.push(d); await d.page.evaluate(() => window.dispatchEvent(new Event('online'))); } }
  async reload(d) { await d.page.reload(); await d.page.waitForTimeout(900); }
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
    d.edit = async id => { await page.evaluate(id => __x.txSheet(id), id); await d.T(350); };
    d.sync = () => page.$eval('.sync-line', e => e.innerText).catch(() => '');
    d.cat = async (id, fill) => { await page.evaluate(id => __x.catSheet(id), id); await d.T(300); for (const k in fill) await page.fill(k, fill[k]); await page.click('#c-save'); await d.T(400); };
    d.imp = async (name, text) => { const f = path.join(TMP, name); fs.writeFileSync(f, text); await d.noToast(); await page.setInputFiles('#fileIn', f); return until(() => d.toast(), 30000); };
  }
  inCloud(m, f = () => true) { return ((this.docs['months/' + m] || { txs: [] }).txs).filter(f); }
  allCloud() { return Object.keys(this.docs).filter(k => k.startsWith('months/')).flatMap(k => this.docs[k].txs.map(t => ({ ...t, _doc: k.slice(7) }))); }
  cfg() { return this.docs['meta/config'] || { cats: [] }; }
  async close() { this.devs.forEach(d => d.closed = true); if (this.browser) await this.browser.close(); }
}
// waits until fn() is truthy (or the time is up) and returns its last value
async function until(fn, ms = 10000) { const end = Date.now() + ms; let v; while (!(v = await fn()) && Date.now() < end) await new Promise(r => setTimeout(r, 200)); return v; }

let pass = 0, fail = 0; const errs = [];
const ok = (c, msg, got) => { if (c) { pass++; console.log('ok    ' + msg); } else { fail++; console.log('FAIL  ' + msg + (got !== undefined ? '  → ' + JSON.stringify(got) : '')); } };
const run = async (name, fn) => { const w = new World(); try { await fn(w); } catch (e) { fail++; console.log('FAIL  ' + name + ': ' + e.message.split('\n')[0]); } finally { w.devs.forEach(d => errs.push(...d.errs.map(e => d.name + ': ' + e))); await w.close(); } };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r)); URL0 = `http://127.0.0.1:${server.address().port}/app.html`;
  // F1: the whole offline streak is kept in this browser, says so, survives a reload and reaches the cloud
  await run('F1', async w => {
    const A = await w.device('iphone');
    await w.setOffline(A, true);
    await A.add('3.20', 'Metro coffee 1'); await A.add('2.10', 'Metro coffee 2'); await A.add('12', 'Sandwich 3');
    const t3 = await A.toast();
    ok(/Offline/.test(t3), 'F1 offline: the last of three adds says it is pending, not "Expense added"', t3);
    ok((await A.box()).length === 3, 'F1 offline: all three are in the outbox saved in this browser', await A.box());
    ok(/3 pending changes/.test(await until(A.sync, 3000)), 'F1 offline: the line says "3 pending changes"', await A.sync());
    await w.reload(A);
    ok((await A.box()).length === 3, 'F1 reload while offline: the three are still in the outbox', await A.box());
    await w.setOffline(A, false);
    ok(await until(async () => (await A.has(t => /Metro coffee|Sandwich/.test(t.n))).length === 3, 5000), 'F1 back online after the reload: the three are on screen');
    const cl = await until(() => w.inCloud('2026-11', t => /Metro coffee|Sandwich/.test(t.n)).length === 3, 8000);
    ok(cl, 'F1 back online: the cloud has the three', w.inCloud('2026-11', t => /Metro coffee|Sandwich/.test(t.n)).map(t => t.n));
    ok(await until(async () => !(await A.sync()) && !(await A.box()).length, 3000), 'F1 back online: outbox empty and no pending line', await A.sync());
  });

  // F2: a cloud that does not answer: shown as not saved yet, kept in the outbox, counted as pending after ~8 s
  await run('F2', async w => {
    const A = await w.device('iphone');
    A.stall = 60000;
    await A.openAdd(); await A.fill('4.50', 'Coffee bad signal', 'Eating out'); await A.page.click('#f-save');
    await A.T(2500);
    ok((await A.box()).includes('Coffee bad signal'), 'F2 hung network: the coffee is in the outbox before the cloud answers', await A.box());
    ok(/pending|saving/.test(await A.sync()), 'F2 hung network: the line says it is not saved yet', await A.sync());
    const t = await until(async () => /Offline/.test(await A.toast()), 9000);
    ok(t, 'F2 hung network: after the timeout it says "Offline… pending"', await A.toast());
    A.stall = 0; await w.reload(A);
    ok(await until(() => w.inCloud('2026-11', t => t.n === 'Coffee bad signal').length === 1, 6000), 'F2 reload with a good network: the coffee reaches the cloud once');
  });

  // F3: settings travel as changes: nothing made on the other device is wiped out
  await run('F3', async w => {
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    const cc = n => w.cfg().cats.find(c => c.name === n), sup = () => w.cfg().cats.find(c => c.id === 'e-groceries').budget;
    // a) offline category on A, budget + category + movement on B
    await w.setOffline(A, true);
    await A.cat(null, { '#c-name': 'Christmas presents' });
    await B.cat('e-groceries', { '#c-budget': '250' });
    await B.cat(null, { '#c-name': 'Pet' });
    await B.openAdd(); await B.fill('30', 'Pet food', 'Pet'); await B.save();
    await w.setOffline(A, false);
    await until(() => cc('Christmas presents'), 9000);
    ok(sup() === 250 && !!cc('Pet') && !!cc('Christmas presents'), 'F3 two devices: A\'s offline category arrives and B\'s budget and category stay', { sup: sup(), pet: !!cc('Pet'), presents: !!cc('Christmas presents') });
    const p = w.inCloud('2026-11', t => t.n === 'Pet food')[0];
    ok(p && w.cfg().cats.some(c => c.id === p.c), 'F3 two devices: "Pet food" keeps its category');
    // b) while A has a change waiting, it still takes in what B changes
    await A.page.evaluate(() => { window.__failOn = { path: 'meta/config', code: 'unavailable' }; });
    await A.cat(null, { '#c-name': 'Allotment' });
    await B.cat('e-transport', { '#c-budget': '80' });
    const seen = await until(async () => { const c = await A.cats(); return c.some(x => x.name === 'Allotment') && (c.find(x => x.id === 'e-transport') || {}).budget === 80; }, 4000);
    ok(seen, 'F3 pending change: A shows B\'s new budget and keeps its own pending category', (await A.cats()).filter(x => x.name === 'Allotment' || x.id === 'e-transport'));
    await A.page.evaluate(() => { window.__failOn = null; window.dispatchEvent(new Event('online')); });
    await until(() => cc('Allotment'), 9000);
    ok(!!cc('Allotment') && w.cfg().cats.find(c => c.id === 'e-transport').budget === 80, 'F3 pending change: once sent, the cloud has both');
    // c) a change left pending in a tab, reopened later, does not overwrite a newer one from the other device
    await w.setOffline(A, true);
    await A.cat('e-groceries', { '#c-budget': '100' });
    await w.reload(A); await A.T(1000);
    await B.cat('e-groceries', { '#c-budget': '320' });
    await w.setOffline(A, false); await A.T(7000);
    ok(sup() === 320, 'F3 stale pending: an older pending budget does not overwrite the newer one', sup());
    ok(await until(async () => ((await A.cats()).find(c => c.id === 'e-groceries') || {}).budget === 320, 3000), 'F3 stale pending: A ends up showing the newer budget');
  });

  // F4: no silent switch to an empty local app; local-only movements are offered for upload
  await run('F4', async w => {
    const A = await w.device('iphone', { pre: 'window.__useFail = { downloads: true }' });
    ok(await A.page.evaluate(() => __fc.state().mode) === 'cloud' && (await A.has(() => true)).length > 800, 'F4 downloads fails at start: the app stays on the cloud with your data');
    const B = await w.device('mac', { pre: 'window.__useFail = { db: true }' });
    const mode = await B.page.evaluate(() => __fc.state().mode), txt = await B.page.innerText('#main');
    ok(mode !== 'local' && /Cannot connect/.test(txt) && !/No transactions yet/.test(txt), 'F4 db fails at start: a clear error with Retry, not an empty local app', { mode, txt: txt.slice(0, 80) });
    await B.page.evaluate(() => { window.__useFail = null; });
    await B.page.click('[data-act="boot-retry"]').catch(() => {});
    ok(await until(async () => (await B.has(() => true)).length > 800, 5000), 'F4 Retry: once the db answers, the data is there');
    const loc = JSON.stringify({ txs: [{ id: 'loc1', d: '2026-11-24T12:00', k: 'e', c: 'e-coffee', a: 2.4, n: 'Local coffee' }], cats: [{ id: 'e-coffee', name: 'Coffee', kind: 'e', color: '#7B6CD9' }] });
    const C = await w.device('ipad', { init: { 'gastos.local.v1': loc } });
    ok(/only in this browser/.test(await until(C.sync, 3000)), 'F4 local-only data with the cloud available: it is offered for upload', await C.sync());
    await C.page.click('[data-act="local-up"]').catch(() => {});
    const up = await until(() => { const t = w.inCloud('2026-11', t => t.n === 'Local coffee'); return t.length === 1 && w.cfg().cats.some(c => c.id === t[0].c && c.name === 'Coffee'); }, 8000);
    ok(up, 'F4 "Upload": the transaction reaches the cloud once, with its category', w.inCloud('2026-11', t => t.n === 'Local coffee'));
    await until(async () => !/only in this browser/.test(await C.sync()), 5000);
    await w.reload(C);
    ok(!/only in this browser/.test(await C.sync()), 'F4 after uploading, it is not offered again');
  });

  // F5: an offline import stays pending (and survives a reload); impossible dates and amounts are rejected
  await run('F5', async w => {
    const A = await w.device('iphone');
    await A.page.evaluate(() => __x.backupNow()); await A.T(800);
    const bk = await A.page.evaluate(() => window.__saved.at(-1).data), n = JSON.parse(bk).txs.length;
    const w2 = new World({ 'meta/config': { cats: [], currency: 'EUR', v: 1 } }); w2.browser = w.browser;
    const E = await w2.device('new');
    try {
      await w2.setOffline(E, true);
      const t1 = await E.imp('backup.json', bk);
      ok(/pending/.test(t1) && (await E.box()).length === n, 'F5 offline import: says it is pending and keeps every movement in the outbox', { t1, box: (await E.box()).length });
      await w2.reload(E);
      ok((await E.box()).length === n, 'F5 offline import: still in the outbox after a reload', (await E.box()).length);
      await w2.setOffline(E, false);
      ok(await until(async () => (await E.has(() => true)).length === n, 5000), 'F5 back online after the reload: every movement is on screen');
      const all = await until(() => w2.allCloud().length === n && w2.cfg().cats.length === JSON.parse(bk).cats.length, 25000);
      ok(all, 'F5 back online: the cloud gets every movement and category', [w2.allCloud().length, n]);
    } finally { errs.push(...E.errs); }
    const bad = { app: 'my-expenses', v: 2, cats: [], txs: [{ d: 'yesterday', k: 'e', a: 7, n: 'x1' }, { d: '2026-13-40', k: 'e', a: 9, n: 'x2' }, { d: '2026-02-30T12:00', k: 'e', a: 9, n: 'x3' }, { d: '2026-11-24', k: 'e', a: 0, n: 'x4' }, { d: '2026-11-24', k: 'e', a: 0.004, n: 'x5' }, { d: '2026-11-24T12:00', k: 'e', a: 5, n: 'good json' }] };
    const t2 = await A.imp('raro.json', JSON.stringify(bad));
    const garbage = Object.keys(w.docs).filter(k => k.startsWith('months/') && !/^months\/\d{4}-(0[1-9]|1[0-2])$/.test(k));
    ok(!garbage.length && !w.allCloud().some(t => /^x\d$/.test(t.n)) && w.allCloud().some(t => t.n === 'good json'), 'F5 JSON: no "yesterday", month 13, 30 February, 0 € or 0.004 €; the good row is imported', { t2, garbage });
    const csv = 'Date,Amount,Note,Category\n30/02/2026,-4,thirty feb,Other\n24/11/2026,0.00,zero,Other\n24/11/2026,-0.004,almost zero,Other\n24/11/2026,-3.20,good csv,Other\n';
    const t3 = await A.imp('lim.csv', csv);
    ok(!w.allCloud().some(t => /thirty feb|^zero$|almost zero/.test(t.n)) && w.allCloud().some(t => t.n === 'good csv') && /invalid rows/.test(t3), 'F5 CSV: 30/02 and amounts under 0.01 € are rejected and counted', t3);
  });

  // F6: one movement lives in one month
  await run('F6', async w => {
    w.latency = 60;
    const A = await w.device('iphone'), B = await w.device('mac', { dev: 'desktop' });
    const copies = id => w.allCloud().filter(t => t.id === id).map(t => t._doc + ' ' + t.a);
    // a) moved on one device while the other device has its sheet open and saves an edit
    await A.edit('n3'); await B.edit('n3');
    await A.page.fill('#f-date', '2026-10-31'); await A.save(); await A.T(1500);
    await B.page.fill('#f-amt', '30'); await B.save(); await until(B.toast, 12000); await B.T(1000);
    ok(copies('n3').length === 1, 'F6 moved on one device, edited on the other: one copy in the cloud', copies('n3'));
    ok((await A.has(t => t.id === 'n3')).length === 1 && (await B.has(t => t.id === 'n3')).length === 1, 'F6 moved/edited: one copy on each screen');
    // b) moving to another month where the old month's delete fails for good: no copy left behind, even after a reload
    await A.edit('n2'); await A.page.fill('#f-date', '2026-10-30');
    await A.page.evaluate(() => { window.__failOn = { op: 'set', path: 'months/2026-11', code: 'quota_exceeded' }; });
    await A.noToast(); await A.page.click('#f-save'); await until(A.toast, 12000);
    await A.page.evaluate(() => { window.__failOn = null; }); await A.T(800);
    ok(copies('n2').length === 1, 'F6 move cut in half by a fatal error: one copy in the cloud', copies('n2'));
    await w.reload(A);
    ok((await A.has(t => t.id === 'n2')).length === 1, 'F6 move cut in half: one copy on screen after a reload');
    // c) a duplicate already in the cloud (same id in two months): shown once, and the older copy is removed
    w.docs['months/2026-10'].txs.push({ id: 'n1', d: '2026-10-29T12:00', k: 'e', c: 'e-groceries', a: 47, n: 'Supermarket', u: Date.parse('2026-11-25T19:00:00Z') });
    w.pushAll(); await A.T(800);
    ok((await A.has(t => t.id === 'n1')).length === 1, 'F6 duplicate in the cloud: shown once');
    ok(await until(() => copies('n1').length === 1, 8000) && copies('n1')[0] === '2026-10 47', 'F6 duplicate in the cloud: the newest copy stays and the other is removed', copies('n1'));
  });

  ok(!errs.length, 'no page errors' + (errs.length ? ': ' + errs.slice(0, 3).join(' | ') : ''));
  console.log(`\n${fail ? fail + ' FAILED, ' : 'all '}${pass} passed`);
  server.close(); process.exit(fail ? 1 : 0);
})();
