// node tests/snapdiff.js <dirA> <dirB>: lists every element whose computed style or box differs between two snap.js runs
const fs = require('fs'), path = require('path');
const [, , A, B] = process.argv;
let total = 0;
for (const f of fs.readdirSync(A).filter(f => f.endsWith('.json')).sort()) {
  const a = JSON.parse(fs.readFileSync(path.join(A, f))), bp = path.join(B, f);
  if (!fs.existsSync(bp)) { console.log('missing in B:', f); total++; continue; }
  const b = new Map(JSON.parse(fs.readFileSync(bp)));
  const am = new Map(a); const diffs = [];
  for (const [k, pa] of a) {
    const pb = b.get(k); if (!pb) { diffs.push(`  - only in A: ${k}`); continue; }
    for (const n of new Set([...Object.keys(pa), ...Object.keys(pb)])) if (pa[n] !== pb[n]) diffs.push(`  ${k.slice(-90)}  ${n}: ${pa[n]} -> ${pb[n]}`);
  }
  for (const k of b.keys()) if (!am.has(k)) diffs.push(`  + only in B: ${k}`);
  if (diffs.length) { console.log(f, diffs.length); console.log(diffs.slice(0, 15).join('\n')); total += diffs.length; }
}
console.log(total ? `TOTAL ${total} differences` : 'IDENTICAL');
process.exit(total ? 1 : 0);
