// Design test for My Expenses: node tests/design.test.js [app.html]   (default: app/my-expenses.html)
// On the iPhone widths 320, 375 and 393 px, in light and dark, it opens every screen and sheet (fake cloud with the
// sample data, fixed date 25 nov 2026), the error screen and two toasts, and checks:
//   1. no horizontal scroll (page, #scroller, or an element past the right edge outside a scrolling strip);
//   2. no clipped or overflowing text: text cut by its box without "…", "…" on an amount, a button, a tag or a toast;
//   3. tap targets of at least 44 px (counting the invisible ::after area the app adds), see ALLOW_SMALL;
//   4. text contrast of at least 4.5:1 (3:1 for large text) over the real background, with transparencies blended.
// Plus the toasts: shown whole, at least ~5 s on screen, announced to screen readers; and the error screen: no "+".
// The forecast card on Summary: closed, it sits under the Net and above the bottom bar; a tap opens the details
// (aria-expanded), which pass the same audit; neighbouring segments of its bar differ by ≥ 3:1 or one is hatched; and
// in light mode the other months' bars of "Last 6 months" reach 2:1 against their card.
// The "Offline" line when the connection is lost with the data on screen (and the browser offline/online events); the
// error screen's role="alert", focus and Tab; and zoom at 150 % and 200 % (262 and 197 px) on every screen and sheet:
// no horizontal scroll, no cut text, contrast, and every control of the header, bottom bar and sheet on screen
// (ZOOM_ONLY=1 runs only the zoom part).
// v30: the forecast bar in two (day to day with the mark of "normal day-to-day", one-offs apart without it); "Offline ·
// Retry" in one row, and on Transactions too; the closed card also on 1, 15 and 30 Nov at every width, and on the
// SE (320 px) with "Offline" or "Nothing logged for N days" above it, also with a red pill and one-offs; the
// duplicate category chips of Transactions ("Gifts", "Other") say which is the income one.
const { chromium, devices } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.join(__dirname, '..');
const app = process.argv[2] || path.join(ROOT, 'app/my-expenses.html');
const VERBOSE = process.env.VERBOSE === '1';

// tap targets allowed under 44 px (none needed today; add a selector here with the reason if one ever is)
const ALLOW_SMALL = [];

const FAKE = `window.__fakeInit = function () {
  const K = 'fakedb', load = () => JSON.parse(localStorage.getItem(K) || '{}'), save = o => localStorage.setItem(K, JSON.stringify(o));
  const subs = { months: [], cfg: [] }, lost = []; window.__fail = null;
  window.__lose = () => lost.splice(0).forEach(e => e && e(Object.assign(new Error('fake lost'), { code: 'unavailable' }))); // the listeners fail
  const chk = () => { if (window.__fail) { const e = new Error('fake ' + window.__fail); e.code = window.__fail; throw e; } };
  const delay = () => new Promise(r => setTimeout(r, 30));
  const emitM = () => { const o = load(); const docs = Object.keys(o).filter(k => k.startsWith('months/')).map(k => ({ id: k.slice(7), data: () => o[k] })); subs.months.forEach(f => f({ docs })); };
  const emitC = () => { const o = load(); const d = o['meta/config']; subs.cfg.forEach(f => f({ exists: !!d, data: () => d })); };
  const doc = p => ({
    acquire: async () => { await delay(); chk(); return { acquired: true }; },
    get: async () => { await delay(); chk(); const o = load(); return { exists: !!o[p], data: () => o[p] }; },
    set: async v => { await delay(); chk(); const o = load(); o[p] = JSON.parse(JSON.stringify(v)); save(o); p.startsWith('months/') ? emitM() : emitC(); },
    delete: async () => { await delay(); chk(); const o = load(); delete o[p]; save(o); emitM(); },
    onSnapshot: (f, e) => { subs.cfg.push(f); lost.push(e); setTimeout(emitC, 10); return () => { subs.cfg = subs.cfg.filter(x => x !== f); }; }
  });
  const db = { doc, collection: () => ({ onSnapshot: (f, e) => { subs.months.push(f); lost.push(e); setTimeout(emitM, 10); return () => { subs.months = subs.months.filter(x => x !== f); }; } }) };
  window.claude = { use: async n => { if (window.__noDb && n === 'db') throw Object.assign(new Error('no db'), { code: 'unavailable' }); return n === 'db' ? db : { save: async () => {} }; } };
};`;

function sampleDocs() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-data/meta/config.json')));
  const dir = path.join(ROOT, 'sample-data/months'), out = {};
  for (const f of fs.readdirSync(dir)) for (const t of JSON.parse(fs.readFileSync(path.join(dir, f))).txs || []) (out['months/' + t.d.slice(0, 7)] ||= { txs: [] }).txs.push(t);
  // a November with an extraordinary expense in the longest category name, so the EXTRA tag is on screen
  const C = n => cfg.cats.find(c => c.name.startsWith(n)).id;
  out['months/2026-11'] = { txs: [
    { id: 'd1', d: '2026-11-24T12:00', k: 'e', c: C('Eating out'), a: 3.2, n: 'Coffee' },
    { id: 'd2', d: '2026-11-22T12:00', k: 'e', c: C('Groceries'), a: 45.6, n: 'Supermarket' },
    { id: 'd3', d: '2026-11-21T12:00', k: 'e', c: C('Sport and hobbies'), a: 64, n: 'Club dinner with the whole team after the final', x: true },
    { id: 'd4', d: '2026-11-10T12:00', k: 'e', c: C('Shopping'), a: 1250, n: 'New laptop', x: true },
    { id: 'd5', d: '2026-11-15T12:00', k: 'e', c: C('Transport'), a: 60, n: 'Petrol' } ] };
  out['meta/config'] = { cats: cfg.cats, currency: 'EUR', v: 1, lastBackup: '2026-11-20T10:00:00.000Z' };
  return out;
}

// in-page audit
function auditInPage([scope, ALLOW_SMALL]) {
  const W = innerWidth, out = { hscroll: [], clipped: [], small: [], contrast: [] };
  const root = scope ? document.querySelector(scope) : document.body; if (!root) return out;
  const vis = el => {
    if (el.closest('.sr,[hidden],[aria-hidden="true"]') || el.closest('details:not([open]) > :not(summary)')) return false;
    for (let e = el; e && e.nodeType === 1; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || (c.clip && c.clip !== 'auto')) return false; }
    const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0;
  };
  const opac = el => { let o = 1; for (let e = el; e && e.nodeType === 1; e = e.parentElement) o *= +getComputedStyle(e).opacity; return o; };
  const desc = el => { const t = (el.innerText || el.textContent || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50); return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.classList.length ? '.' + [...el.classList].join('.') : '') + ' "' + t + '"'; };
  const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  const parse = c => {
    if (!c || c === 'transparent') return [0, 0, 0, 0];
    let m = c.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; }
    m = c.match(/^color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]; }
    cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); const d = cv.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
  const bodyBg = parse(getComputedStyle(document.body).backgroundColor);
  const bgOf = el => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) { stack.push(c); if (c[3] >= 1) break; } } let b = stack.length && stack[stack.length - 1][3] >= 1 ? stack.pop() : (bodyBg[3] ? bodyBg : [255, 255, 255, 1]); while (stack.length) b = blend(stack.pop(), b); return b; };
  const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  // a horizontally scrolling strip (chips, sub-navigation, tables) may run past the edge on purpose
  const inStrip = el => { for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) { const o = getComputedStyle(e).overflowX; if (o === 'auto' || o === 'scroll') return true; } return false; };
  // "…" is fine on names and notes, never on amounts, buttons, tags or toasts
  const PROTECTED = '.num,.amt,.am,.val,.badge,.btn,#toast';
  const leaves = [];
  root.querySelectorAll('*').forEach(el => {
    if (el.closest('svg') && el.tagName !== 'text') return;
    if (!vis(el)) return;
    const own = [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
    if (own.length) leaves.push(el);
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.right > W + 1 && cs.position !== 'fixed' && !inStrip(el)) out.hscroll.push(desc(el) + ` right=${Math.round(r.right)}`);
    // text cut by a box that hides its overflow: measured on the laid-out text (Range), so the invisible ::after
    // tap areas and padding never count. "…" (text-overflow or line-clamp) is allowed, except on PROTECTED text.
    const clipX = /hidden|clip/.test(cs.overflowX), clipY = /hidden|clip/.test(cs.overflowY), clamp = cs.webkitLineClamp !== 'none';
    if ((clipX || clipY || clamp) && el.textContent.trim() && !el.closest('svg')) {
      const bx = { l: r.left + parseFloat(cs.borderLeftWidth) - 1, r: r.right - parseFloat(cs.borderRightWidth) + 1, t: r.top + parseFloat(cs.borderTopWidth) - 2, b: r.bottom - parseFloat(cs.borderBottomWidth) + 2 };
      const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) {
        const pe = n.parentElement; if (!n.textContent.trim() || !vis(pe)) continue;
        // an inner scroller, or an inner box that clips the same axis itself (and is checked on its own), wins
        let skip = false, inX = false, inY = false;
        for (let e = pe; e && e !== el; e = e.parentElement) { const o = getComputedStyle(e); if (/auto|scroll/.test(o.overflowX + o.overflowY)) { skip = true; break; } if (/hidden|clip/.test(o.overflowX)) inX = true; if (/hidden|clip/.test(o.overflowY) || o.webkitLineClamp !== 'none') inY = true; }
        if (skip) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        const rs = [...rg.getClientRects()].filter(q => q.width > 0.5);
        const outX = clipX && !inX && rs.some(q => q.right > bx.r || q.left < bx.l), outY = (clipY || clamp) && !inY && rs.some(q => q.bottom > bx.b || q.top < bx.t);
        if (!outX && !outY) continue;
        const ell = (cs.textOverflow === 'ellipsis' && !outY) || (clamp && !outX);
        if (!ell || pe.matches(PROTECTED) || el.matches(PROTECTED) || pe.closest(PROTECTED)) out.clipped.push((ell ? '"…" on ' : 'cut ') + desc(pe));
      }
    }
    // text spilling out of a box that does not clip it
    if (!clipX && !clipY && el.textContent.trim() && !el.closest('svg') && !inStrip(el)) {
      for (const n of [...el.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim())) {
        const rg = document.createRange(); rg.selectNodeContents(n);
        if ([...rg.getClientRects()].some(q => q.width > 0.5 && (q.right > r.right + 1 || q.left < r.left - 1)) && /block|flex|grid/.test(cs.display)) { out.clipped.push('spills ' + desc(el)); break; }
      }
    }
    // a protected element whose own text holds a child cut with "…" (the EXTRA tag inside a cut name)
    if (el.matches('.badge')) { for (let p = el.parentElement; p && p !== root; p = p.parentElement) { const c = getComputedStyle(p); if (c.textOverflow === 'ellipsis' && p.scrollWidth > p.clientWidth + 1) { out.clipped.push('tag inside a cut text ' + desc(el)); break; } } }
    const interactive = el.matches('button,a[href],input:not([type=hidden]),select,textarea,summary,[role=button],[role=tab],[tabindex]:not([tabindex="-1"])');
    if (interactive && !el.disabled && opac(el) > .05 && !el.closest('svg') && !el.closest('.sk-wrap')) {
      const tr = el.matches('input[type=checkbox],input[type=radio]') && el.labels && el.labels[0] ? el.labels[0].getBoundingClientRect() : r;
      const af = getComputedStyle(el, '::after'), ext = af.content !== 'none' && af.position === 'absolute';
      const gh = ext ? Math.max(0, -parseFloat(af.top)) + Math.max(0, -parseFloat(af.bottom)) : 0, gw = ext ? Math.max(0, -parseFloat(af.left)) + Math.max(0, -parseFloat(af.right)) : 0;
      const ew = tr.width + gw, eh = tr.height + gh;
      if ((ew < 43.5 || eh < 43.5) && !ALLOW_SMALL.some(s => el.matches(s))) out.small.push(desc(el) + ` ${Math.round(ew)}x${Math.round(eh)}`);
    }
  });
  for (const el of leaves) {
    if (el.disabled || el.closest('[aria-disabled="true"],:disabled')) continue; // inactive controls are exempt (WCAG 1.4.3)
    const cs = getComputedStyle(el); const fg = parse(el.tagName === 'text' ? cs.fill : cs.color); const b = bgOf(el);
    const eff = blend([fg[0], fg[1], fg[2], fg[3] * opac(el)], b);
    const r = ratio(eff, b), px = parseFloat(cs.fontSize), large = px >= 24 || (+cs.fontWeight >= 700 && px >= 18.66);
    const need = large ? 3 : 4.5;
    if (r < need - 0.005) out.contrast.push(`${r.toFixed(2)} (<${need}) ${px}px ${desc(el)}`);
  }
  const sc = document.getElementById('scroller');
  if (document.documentElement.scrollWidth > W + 1) out.hscroll.unshift(`page scrollWidth ${document.documentElement.scrollWidth} > ${W}`);
  if (sc && sc.scrollWidth > sc.clientWidth + 1) out.hscroll.unshift(`#scroller scrollWidth ${sc.scrollWidth} > ${sc.clientWidth}`);
  for (const k in out) out[k] = [...new Set(out[k])];
  return out;
}

const audit = (page, scope) => page.evaluate(auditInPage, [scope, ALLOW_SMALL]);
const WIDTHS = [['se320', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: devices['iPhone SE'].userAgent }],
  ['se375', { ...devices['iPhone SE (3rd gen)'] }], ['i15', { ...devices['iPhone 15'] }]];
const SCREENS = [['resumen'], ['movimientos'], ['analisis', 'general'], ['analisis', 'habitos'], ['analisis', 'comparar'], ['analisis', 'fijos'], ['analisis', 'viajes'], ['evolucion'], ['categorias']];
const SHEETS = [['add', 'resumen'], ['more', 'resumen'], ['month', 'resumen'], ['data', 'resumen'], ['period', 'movimientos'], ['edit', 'movimientos'], ['cat', 'categorias']];
const LONG = 'There is no space left to save more data. What you typed is kept under "+".';

let pass = 0, fail = 0; const report = [];
const ok = (c, msg, detail) => { if (c) pass++; else { fail++; report.push('FAIL  ' + msg + (detail ? '\n        ' + detail : '')); } };
const ISSUE = { hscroll: 'horizontal scroll', clipped: 'clipped text', small: 'tap target < 44 px', contrast: 'contrast < 4.5:1' };
const counts = { hscroll: 0, clipped: 0, small: 0, contrast: 0 };
function check(where, a) {
  for (const k of Object.keys(ISSUE)) {
    counts[k] += a[k].length;
    ok(!a[k].length, `${where}: ${ISSUE[k]}`, a[k].slice(0, VERBOSE ? 99 : 4).join('\n        ') + (a[k].length > 4 && !VERBOSE ? `\n        … ${a[k].length} in all` : ''));
  }
}

(async () => {
  const t0 = Date.now();
  const tmp = path.join(os.tmpdir(), 'my-expenses-design.html');
  fs.writeFileSync(tmp, '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' + fs.readFileSync(app, 'utf8'));
  const docs = JSON.stringify(sampleDocs());
  const b = await chromium.launch(); const errs = [];
  const open = async (dev, theme, { noDb = false, hang = false, date = '2026-11-25T20:00:00+01:00', data = docs } = {}) => {
    const ctx = await b.newContext({ ...dev, locale: 'en-GB', timezoneId: 'Europe/Madrid', colorScheme: theme, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(e.message));
    await page.clock.install({ time: new Date(date) });
    await page.addInitScript(FAKE);
    await page.addInitScript(([f, theme, noDb, hang]) => {
      if (!sessionStorage.getItem('init')) { sessionStorage.setItem('init', 1); localStorage.clear(); localStorage.setItem('fakedb', f); localStorage.setItem('gastos.tab', 'resumen'); localStorage.setItem('gastos.theme', theme); }
      window.__fakeInit(); if (noDb) window.__noDb = true;
      if (hang) { const never = { onSnapshot: () => () => {} }; window.claude = { use: async n => n === 'db' ? { collection: () => never, doc: () => ({ ...never, get: () => new Promise(() => {}), set: () => new Promise(() => {}) }) } : { save: async () => {} } }; }
    }, [data, theme, noDb, hang]);
    await page.goto('file://' + tmp);
    const T = async (ms = 500) => { await page.clock.runFor(ms); await page.waitForTimeout(60); };
    await T(1500);
    return { ctx, page, T };
  };
  const settle = async (page, T) => { await T(800); await page.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} })); };
  const nav = (page, tab, sub) => page.evaluate(([tab, sub]) => { const b = document.createElement('button'); b.dataset.goto = tab; if (sub) b.dataset.ansub = sub; document.body.appendChild(b); b.click(); b.remove(); }, [tab, sub]);

  if (!process.env.ZOOM_ONLY) for (const [dn, dev] of WIDTHS) for (const theme of ['light', 'dark']) {
    const tag = `${dn}-${theme}`;
    const { ctx, page, T } = await open(dev, theme);
    for (const [tab, sub] of SCREENS) {
      await nav(page, tab, sub); await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; }); await settle(page, T);
      // the whole screen, scrolled through: audit at each viewport-height step
      const steps = await page.evaluate(() => { const s = document.getElementById('scroller'); return Math.min(8, Math.ceil(s.scrollHeight / s.clientHeight)); });
      const all = { hscroll: [], clipped: [], small: [], contrast: [] };
      for (let i = 0; i < steps; i++) {
        await page.evaluate(i => { const s = document.getElementById('scroller'); s.scrollTop = i * s.clientHeight; }, i); await page.waitForTimeout(30);
        const a = await audit(page, '#main'); for (const k in all) all[k].push(...a[k]);
      }
      const chrome = await audit(page, 'header.top'), bar = await audit(page, '#bnav');
      for (const k in all) all[k] = [...new Set([...all[k], ...chrome[k], ...bar[k]])];
      check(`${tag} ${tab}${sub ? '/' + sub : ''}`, all);
    }
    // v28: the forecast card, closed and open
    await nav(page, 'resumen'); await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; }); await settle(page, T);
    const fit = await page.evaluate(() => { const R = e => e.getBoundingClientRect(), fc = document.querySelector('.fc'); return { top: Math.round(R(fc).top), bottom: Math.round(R(fc).bottom), neto: Math.round(R(document.querySelector('.flow-h')).bottom), bar: Math.round(R(document.getElementById('bnav')).top), det: getComputedStyle(fc.querySelector('.fc-det')).display, exp: fc.querySelector('.fc-sum').getAttribute('aria-expanded') }; });
    ok(fit.top >= fit.neto && fit.bottom <= fit.bar && fit.det === 'none' && fit.exp === 'false', `${tag} forecast card: closed, under the Net and whole above the bottom bar`, JSON.stringify(fit));
    await page.click('.fc-sum'); await settle(page, T);
    const opened = await page.evaluate(() => { const fc = document.querySelector('.fc'); return { exp: fc.querySelector('.fc-sum').getAttribute('aria-expanded'), det: getComputedStyle(fc.querySelector('.fc-det')).display, bar: !!fc.querySelector('.fc-det .fc-bar b'), leg: fc.querySelectorAll('.fc-det .fc-leg > span').length }; });
    ok(opened.exp === 'true' && opened.det !== 'none' && opened.bar && opened.leg >= 5, `${tag} forecast card: a tap opens the details with the bar and its legend`, JSON.stringify(opened));
    check(`${tag} forecast card open`, await audit(page, '.fc'));
    const seg = await page.evaluate(() => {
      const cv = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
      const rgb = c => { const m = c.match(/color\(srgb ([^)]+)\)/); if (m) return m[1].split(/[ /]+/).slice(0, 3).map(v => +v * 255); cv.clearRect(0, 0, 1, 1); cv.fillStyle = '#000'; cv.fillStyle = c; cv.fillRect(0, 0, 1, 1); return [...cv.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const lum = c => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const bars = [...document.querySelectorAll('.fc-bar')], bad = []; let n = 0;
      bars.forEach((bar, j) => { const bs = [...bar.querySelectorAll('b')].map(b => { const cs = getComputedStyle(b); return { hatch: /gradient/.test(cs.backgroundImage), c: rgb(cs.backgroundColor) }; }); n += bs.length;
        for (let i = 1; i < bs.length; i++) { const a = bs[i - 1], b = bs[i]; if (!a.hatch && !b.hatch && ratio(a.c, b.c) < 3) bad.push(`bar ${j + 1} segments ${i}/${i + 1}: ${ratio(a.c, b.c).toFixed(2)}:1`); } });
      // v30: the mark of "normal day-to-day" is on the day-to-day bar only; the one-offs (amber) are a bar of their own
      const mk = document.querySelectorAll('.fc-bar i'), warn = rgb(getComputedStyle(document.documentElement).getPropertyValue('--warn').trim()).join();
      const mark = { bars: bars.length, marks: mk.length, inFirst: !!bars[0] && !!bars[0].querySelector('i'), amberWithMark: bars.filter(b => b.querySelector('i') && [...b.querySelectorAll('b')].some(x => rgb(getComputedStyle(x).backgroundColor).join() === warn)).length };
      return { n, bad, mark, light: document.documentElement.dataset.theme !== 'dark' && !matchMedia('(prefers-color-scheme: dark)').matches,
        other: ['--bar', '--bar-in'].map(v => ratio(rgb(getComputedStyle(document.documentElement).getPropertyValue(v).trim()), rgb(getComputedStyle(document.querySelector('.fl-chart')).backgroundColor))) };
    });
    ok(seg.n >= 3 && !seg.bad.length, `${tag} forecast bar: neighbouring segments differ by ≥ 3:1 or a hatching`, JSON.stringify(seg));
    ok(seg.mark.bars === 2 && seg.mark.marks === 1 && seg.mark.inFirst && !seg.mark.amberWithMark, `${tag} forecast bar: the mark of "normal day-to-day" sits on the day-to-day bar, the amber one-offs are a bar apart`, JSON.stringify(seg.mark));
    if (theme === 'light') ok(seg.other.every(r => r >= 2), `${tag} "Last 6 months": the other months' bars reach 2:1 against their card`, JSON.stringify(seg.other));
    await page.click('.fc-sum'); await settle(page, T);
    ok(await page.$eval('.fc-det', e => getComputedStyle(e).display === 'none'), `${tag} forecast card: a second tap closes the details`);
    for (const [sh, tab] of SHEETS) {
      await nav(page, tab); await settle(page, T);
      if (sh === 'add') await page.click('#bnav .bplus');
      if (sh === 'more') await page.click('[data-bt="more"]');
      if (sh === 'month' || sh === 'period') await page.click('#periodBtn');
      if (sh === 'data') await page.click('#dataBtn');
      if (sh === 'edit') await page.locator('.txlist [data-edit]').first().click();
      if (sh === 'cat') await page.locator('#main [data-cat]').first().click();
      await settle(page, T);
      check(`${tag} sheet ${sh}`, await audit(page, '.sheet'));
      if (sh === 'edit') { const v = await page.inputValue('#f-amt'); ok(/^\d+\.\d\d$/.test(v), `${tag} edit sheet: the amount shows 2 decimals`, v); }
      await page.keyboard.press('Escape'); await settle(page, T);
      if (await page.$('#f-drx')) { /* a draft card would only appear on the next open */ }
    }
    // toasts: a long error (the cloud is full) and an "Undo" one
    await nav(page, 'resumen'); await settle(page, T);
    await page.evaluate(() => { window.__fail = 'quota_exceeded'; });
    await page.click('#bnav .bplus'); await T(400);
    if (await page.$('#f-drx')) { await page.click('#f-drx'); await T(200); }
    await page.fill('#f-amt', '12'); await page.fill('#f-note', 'Beers'); await T(200); await page.locator('#f-cats .ctile').first().click(); await page.click('#f-save'); await T(700);
    await page.evaluate(() => { window.__fail = null; });
    await page.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }));
    const t1 = await page.evaluate(() => { const el = document.getElementById('toast'); if (el.hidden) return null; const r = el.getBoundingClientRect(); return { text: el.innerText.replace(/\s+/g, ' ').trim(), left: r.left, right: r.right, top: r.top, live: [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].filter(x => x.id === 'toast' || x.closest('#toast') || /no space left/.test(x.textContent)).map(x => (x.getAttribute('aria-live') || x.getAttribute('role'))) }; });
    ok(t1 && t1.text.includes(LONG), `${tag} toast: the whole "no space left" message is shown`, t1 && t1.text);
    ok(t1 && t1.left >= 0 && t1.right <= dev.viewport.width, `${tag} toast: inside the screen`, t1 && `${t1.left}..${t1.right}`);
    await T(300); // the live region is filled a moment after the toast
    const live = await page.evaluate(() => [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].filter(x => /no space left/.test(x.textContent)).map(x => x.getAttribute('aria-live') || (x.getAttribute('role') === 'alert' ? 'assertive' : 'polite')));
    ok(live.includes('assertive'), `${tag} toast: an error is announced (aria-live assertive)`, JSON.stringify(live));
    check(`${tag} toast error`, await audit(page, '#toast'));
    await T(4300);
    ok(await page.$eval('#toast', e => !e.hidden), `${tag} toast: an error is still on screen after 5 s`);
    await T(12000);
    // no connection: one pending change, said in the singular, readable
    await page.evaluate(() => { window.__fail = 'unavailable'; });
    await page.click('#bnav .bplus'); await T(400);
    if (await page.$('#f-drx')) { await page.click('#f-drx'); await T(200); }
    await page.fill('#f-amt', '1.10'); await page.fill('#f-note', 'Pending design'); await T(200); await page.locator('#f-cats .ctile').first().click(); await page.click('#f-save'); await T(2500);
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; document.getElementById('toast').hidden = true; });
    const pend = await page.$eval('.sync-line', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    ok(/^1 pending change · it will be saved /.test(pend), `${tag} pending line: singular ("1 pending change · it will be saved…")`, pend);
    check(`${tag} pending line`, await audit(page, '.sync-line'));
    await page.evaluate(() => { window.__fail = null; window.dispatchEvent(new Event('online')); }); await T(3000);
    // add (works) → "Expense added" with Undo
    await page.click('#bnav .bplus'); await T(400);
    if (await page.$('#f-drx')) { await page.click('#f-drx'); await T(200); }
    await page.fill('#f-amt', '2.40'); await page.fill('#f-note', 'Design coffee'); await T(200); await page.locator('#f-cats .ctile').first().click(); await page.click('#f-save'); await T(700);
    await page.evaluate(() => document.getAnimations().forEach(a => { try { a.finish(); } catch (e) {} }));
    check(`${tag} toast Undo`, await audit(page, '#toast'));
    await T(300);
    const live2 = await page.evaluate(() => [...document.querySelectorAll('[aria-live],[role=status],[role=alert]')].filter(x => /added/.test(x.textContent)).map(x => x.getAttribute('aria-live') || (x.getAttribute('role') === 'alert' ? 'assertive' : 'polite')));
    ok(live2.includes('polite'), `${tag} toast: "Expense added" is announced (aria-live polite)`, JSON.stringify(live2));
    await T(5000);
    const still = await page.$eval('#toast', e => !e.hidden && /added/.test(e.innerText));
    ok(still, `${tag} toast: with Undo it lasts more than 5 s`);
    if (still) { await page.click('#toast button'); await T(700); }
    ok(!(await page.evaluate(() => __fc.state().txs.some(t => t.n === 'Design coffee'))), `${tag} toast: Undo still undoes`);
    // v29: the connection lost with the data on screen leaves an "Offline" line until the data comes back
    await page.evaluate(() => window.__lose()); await T(500);
    const offTxt = () => page.$eval('#main .sync-line', e => e.innerText.replace(/\s+/g, ' ')).catch(() => '');
    const l1 = await offTxt();
    ok(/^Offline/.test(l1) && /Retry/.test(l1), `${tag} connection lost: an "Offline · Retry" line`, l1);
    await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; });
    check(`${tag} offline line`, await audit(page, '.sync-line'));
    const row = await page.$eval('#main .sync-line', e => { const a = e.querySelector('b').getBoundingClientRect(), b = e.querySelector('button').getBoundingClientRect(); return { h: Math.round(e.getBoundingClientRect().height), same: Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) < 4 }; });
    ok(row.same && row.h <= 56, `${tag} connection lost: "Offline" and "Retry" in one row`, JSON.stringify(row));
    await nav(page, 'movimientos'); await settle(page, T);
    ok(/^Offline/.test(await offTxt()), `${tag} connection lost: the line shows on Transactions too`, await offTxt());
    const per0 = await page.evaluate(() => { const S = __fc.state(), p = S.period; S.period = 'todo'; return p; }); await nav(page, 'movimientos'); await settle(page, T);
    const dup = await page.$$eval('#main [data-cf]', bs => bs.map(b => b.innerText.replace(/\s+/g, ' ').trim()));
    await page.evaluate(p => { __fc.state().period = p; }, per0); await nav(page, 'movimientos'); await settle(page, T);
    ok(dup.length > 2 && new Set(dup).size === dup.length && dup.some(t => /Gifts · income/.test(t)), `${tag} Transactions: no two category chips with the same name ("Gifts · income")`, JSON.stringify(dup));
    await page.mouse.move(0, 0); await T(16000); await nav(page, 'analisis', 'general'); await settle(page, T);
    const l2 = await offTxt(), tGone = await page.$eval('#toast', e => e.hidden);
    ok(tGone && /^Offline/.test(l2), `${tag} connection lost: the line stays after the toast is gone and on another screen`, JSON.stringify({ tGone, l2 }));
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); await T(1500);
    ok(!(await offTxt()), `${tag} connection lost: back online, the data comes again and the line goes`, await offTxt());
    await page.evaluate(() => window.dispatchEvent(new Event('offline'))); await T(300);
    const l3 = await offTxt();
    await page.evaluate(() => window.dispatchEvent(new Event('online'))); await T(300);
    ok(/^Offline/.test(l3) && !(await offTxt()), `${tag} browser offline: the line shows, and goes when it is online again`, JSON.stringify({ l3, after: await offTxt() }));
    await ctx.close();

    // error screen: the db cannot be opened
    { const { ctx, page, T } = await open(dev, theme, { noDb: true });
      await settle(page, T);
      const txt = await page.innerText('#main');
      ok(/Cannot connect/.test(txt) && /Retry/.test(txt), `${tag} error screen: says it cannot connect and offers Retry`, txt.slice(0, 120));
      const alert = await page.evaluate(() => { const a = document.querySelector('#main [role="alert"]'), f = document.activeElement; return { alert: a ? a.innerText.replace(/\s+/g, ' ').slice(0, 40) : null, focus: f && f.innerText }; });
      ok(/Cannot connect/.test(alert.alert || ''), `${tag} error screen: its message is role="alert" (read out by screen readers)`, JSON.stringify(alert));
      ok(alert.focus === 'Retry', `${tag} error screen: the focus is on "Retry"`, JSON.stringify(alert));
      await page.keyboard.press('Tab');
      ok(await page.evaluate(() => document.activeElement && document.activeElement.innerText === 'Reload'), `${tag} error screen: Tab reaches "Reload"`);
      const plus = await page.$eval('#bnav .bplus', e => getComputedStyle(e).display !== 'none' && getComputedStyle(e).visibility !== 'hidden' && !e.disabled && e.getAttribute('aria-disabled') !== 'true');
      ok(!plus, `${tag} error screen: the "+" is hidden or disabled`);
      const a = await audit(page, '#main'); for (const k of ['hscroll', 'clipped', 'small', 'contrast']) a[k].push(...(await audit(page, '#bnav'))[k]);
      check(`${tag} error screen`, a);
      await ctx.close(); }
  }
  // v30: the closed forecast card on other days of the month (only what was noted up to that day), and on the SE with
  // a line above it: "Offline · Retry" or "Nothing logged for N days" (with a red pill and one-offs too)
  if (!process.env.ZOOM_ONLY) {
    const mk = (day, red) => { const d = sampleDocs(), C = n => d['meta/config'].cats.find(c => c.name.startsWith(n)).id;
      if (red) for (let k = 0; k < 10; k++) d['months/2026-11'].txs.push({ id: 'r' + k, d: `2026-11-1${k}T12:00`, k: 'e', c: C('Groceries'), a: 120, n: 'Groceries' });
      d['months/2026-11'].txs = d['months/2026-11'].txs.filter(t => t.d.slice(0, 10) <= day); if (!d['months/2026-11'].txs.length) delete d['months/2026-11'];
      return JSON.stringify(d); };
    const CASES = [];
    for (const [dn, dev] of WIDTHS) for (const day of ['2026-11-01', '2026-11-15', '2026-11-30']) CASES.push([`${dn} ${day.slice(8)}-nov`, dev, day]);
    CASES.push(['se320 25-nov "Offline"', WIDTHS[0][1], '2026-11-25', { lose: true }], ['se320 25-nov red pill + "Offline"', WIDTHS[0][1], '2026-11-25', { lose: true, red: true }],
      ['se320 30-nov red pill + "Nothing logged"', WIDTHS[0][1], '2026-11-30', { red: true, stale: true }], ['i15 30-nov red pill + "Nothing logged"', WIDTHS[2][1], '2026-11-30', { red: true, stale: true }]);
    for (const [name, dev, day, o = {}] of CASES) {
      const { ctx, page, T } = await open(dev, 'light', { date: day + 'T20:00:00+01:00', data: mk(day, o.red) });
      if (o.lose) { await page.evaluate(() => window.__lose()); await T(500); await page.evaluate(() => { document.getElementById('toast').hidden = true; }); }
      await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; }); await settle(page, T);
      const fit = await page.evaluate(() => { const R = e => e.getBoundingClientRect(), fc = document.querySelector('.fc'); return { top: Math.round(R(fc).top), bottom: Math.round(R(fc).bottom), neto: Math.round(R(document.querySelector('.flow-h')).bottom), bar: Math.round(R(document.getElementById('bnav')).top), det: getComputedStyle(fc.querySelector('.fc-det')).display,
        off: !!document.querySelector('#main .sync-line'), stale: [...document.querySelectorAll('#main .bk-line')].some(e => /Nothing logged/.test(e.innerText)), red: !!fc.querySelector('.delta.bad'), txt: fc.querySelector('.fc-sum').innerText.replace(/\s+/g, ' ').slice(0, 90) }; });
      const want = (!o.lose || fit.off) && (!o.stale || fit.stale) && (!o.red || fit.red);
      ok(want && fit.top >= fit.neto && fit.bottom <= fit.bar && fit.det === 'none', `${name}: the closed forecast card sits under the Net and whole above the bottom bar`, JSON.stringify(fit));
      check(`${name} forecast card`, await audit(page, '.fc'));
      await ctx.close();
    }
  }
  // v29, zoom at 150 % and 200 % (iPhone 15 seen through browser zoom: 262 and 197 px wide). Every screen and sheet:
  // no horizontal scroll and no text cut or spilling, and every control of the header, the bottom bar and the sheet
  // inside the screen (the backup button used to sit at 249-283 px on a 262 px screen). Contrast is checked too; the
  // 44 px tap size is not, since with zoom each CSS px is 1.5-2 times larger on the glass (5 tabs in 197 px are 38 px).
  const ZK = ['hscroll', 'clipped', 'contrast'];
  const ZOOMS = [['z150', { ...devices['iPhone 15'], viewport: { width: 262, height: 440 }, deviceScaleFactor: 4.5 }],
    ['z200', { ...devices['iPhone 15'], viewport: { width: 197, height: 330 }, deviceScaleFactor: 6 }]];
  const outside = (page, scope) => page.evaluate(sc => { const W = innerWidth; return [...document.querySelectorAll(sc)].flatMap(r => [...r.querySelectorAll('button,a[href],input,select,textarea,[role=button],[role=tab]')]).filter(e => { const b = e.getBoundingClientRect(), c = getComputedStyle(e); return b.width > 0 && b.height > 0 && c.visibility !== 'hidden' && !e.closest('.sr,[hidden]') && (b.left < -1 || b.right > W + 1) && !(e.closest('.tabs,.subnav,.chips') && getComputedStyle(e.closest('.tabs,.subnav,.chips')).overflowX !== 'visible'); }).map(e => (e.id ? '#' + e.id : e.tagName.toLowerCase()) + ' "' + (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '" ' + Math.round(e.getBoundingClientRect().left) + '..' + Math.round(e.getBoundingClientRect().right)); }, scope);
  for (const [zn, dev] of ZOOMS) {
    const { ctx, page, T } = await open(dev, 'light');
    for (const [tab, sub] of SCREENS) {
      await nav(page, tab, sub); await page.evaluate(() => { document.getElementById('scroller').scrollTop = 0; }); await settle(page, T);
      const steps = await page.evaluate(() => { const s = document.getElementById('scroller'); return Math.min(20, Math.ceil(s.scrollHeight / s.clientHeight)); });
      const all = { hscroll: [], clipped: [], contrast: [] };
      for (let i = 0; i < steps; i++) {
        await page.evaluate(i => { const s = document.getElementById('scroller'); s.scrollTop = i * s.clientHeight; }, i); await page.waitForTimeout(30);
        for (const sc of ['#main', 'header.top', '#bnav']) { const a = await audit(page, sc); for (const k of ZK) all[k].push(...a[k]); }
      }
      const where = `${zn} ${tab}${sub ? '/' + sub : ''}`, off = await outside(page, 'header.top,#bnav');
      for (const k in all) { all[k] = [...new Set(all[k])]; counts[k] += all[k].length; ok(!all[k].length, `${where}: ${ISSUE[k]}`, all[k].slice(0, VERBOSE ? 99 : 4).join('\n        ')); }
      ok(!off.length, `${where}: every control of the header and the bottom bar is on screen`, off.join(' | '));
    }
    for (const [sh, tab] of SHEETS) {
      await nav(page, tab); await settle(page, T);
      if (sh === 'add') await page.click('#bnav .bplus');
      if (sh === 'more') await page.click('[data-bt="more"]');
      if (sh === 'month' || sh === 'period') await page.click('#periodBtn');
      // at 200 % the backup button steps out of the header: "Your data" is then reached through More
      if (sh === 'data') { if (await page.isVisible('#dataBtn')) await page.click('#dataBtn'); else { await page.click('[data-bt="more"]'); await settle(page, T); await page.click('.sheet [data-go="__data"]'); } }
      if (sh === 'edit') await page.locator('.txlist [data-edit]').first().click();
      if (sh === 'cat') await page.locator('#main [data-cat]').first().click();
      await settle(page, T);
      const a = await audit(page, '.sheet'), off = await outside(page, '.sheet');
      for (const k of ZK) { counts[k] += a[k].length; ok(!a[k].length, `${zn} sheet ${sh}: ${ISSUE[k]}`, a[k].slice(0, VERBOSE ? 99 : 4).join('\n        ')); }
      ok(!off.length, `${zn} sheet ${sh}: every control is on screen`, off.join(' | '));
      await page.keyboard.press('Escape'); await settle(page, T);
    }
    await ctx.close();
  }
  // a cloud that never answers: an error screen with Retry/Reload, not an endless skeleton (one width is enough)
  { const { ctx, page, T } = await open(WIDTHS[0][1], 'light', { hang: true });
    await T(3000);
    await page.click('#bnav .bplus', { force: true, timeout: 2000 }).catch(() => {}); await T(600);
    ok(!(await page.$('.sheet')), 'hung cloud: "+" does not open an empty sheet while loading');
    await page.keyboard.press('Escape'); await T(500);
    await T(20000);
    const txt = await page.innerText('#main');
    ok(/Retry|Reload/.test(txt) && !(await page.$('#main .sk-wrap')), 'hung cloud: after 20 s an error screen with Retry/Reload replaces the skeleton', txt.slice(0, 120));
    await ctx.close(); }
  await b.close();
  ok(!errs.length, 'no page errors', errs.slice(0, 3).join(' | '));
  console.log(report.join('\n'));
  console.log(`\nissues: ${Object.entries(counts).map(([k, v]) => `${ISSUE[k]} ${v}`).join(' · ')}`);
  console.log(`${fail ? fail + ' FAILED, ' : 'all '}${pass} passed  (${Math.round((Date.now() - t0) / 1000)} s)`);
  process.exit(fail ? 1 : 0);
})();
