// How the wolves' own formation relates to the value: over layer k, tabulate
// (adjacent wolf pairs, wolves on the edge) against the share of draws and lamb wins.
const fs = require('fs'), path = require('path');
const IX = require(path.join(__dirname, 'indexing.js'));
const { binom, nOrbits, orbitMask, expandLambs, isAlias, nextComb, layerSize } = IX;
const k = +(process.argv[2] || 9);
const buf = fs.readFileSync(path.join(__dirname, 'tables', `layer_${k}.bin`));
const tab = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const c22k = binom[22][k];
function adjPairs(w) { let n = 0; for (let i = 0; i < 25; i++) if (w & (1 << i)) { const r = Math.floor(i / 5), c = i % 5; if (c < 4 && (w & (1 << (i + 1)))) n++; if (r < 4 && (w & (1 << (i + 5)))) n++; } return n; }
function onEdge(w) { let n = 0; for (let i = 0; i < 25; i++) if (w & (1 << i)) { const r = Math.floor(i / 5), c = i % 5; if (r === 0 || r === 4 || c === 0 || c === 4) n++; } return n; }
const agg = {};
for (let o = 0; o < nOrbits; o++) {
  const w = orbitMask[o], key = `adjacent pairs ${adjPairs(w)}, wolves on edge ${onEdge(w)}`;
  let cm = (1 << k) - 1, rank = 0;
  for (; cm < (1 << 22); cm = nextComb(cm), rank++) {
    const l = expandLambs(o, cm); if (isAlias(o, l)) continue;
    const base = (o * c22k + rank) * 2;
    const a = agg[key] || (agg[key] = [0, 0, 0]);
    for (let side = 0; side < 2; side++) { const v = tab[base + side] >>> 14; a[v === 1 ? 0 : v === 2 ? 1 : 2]++; }
  }
}
console.log(`layer ${k}: share of states by wolf formation`);
for (const [key, a] of Object.entries(agg).sort()) { const n = a[0] + a[1] + a[2]; console.log(`  ${key.padEnd(36)} wolf win ${(100 * a[0] / n).toFixed(1).padStart(5)}%  draw ${(100 * a[2] / n).toFixed(1).padStart(5)}%  lamb win ${(100 * a[1] / n).toFixed(1).padStart(5)}%   (${n})`); }
