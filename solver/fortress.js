#!/usr/bin/env node
/*
 * Fortress search over the solved tables.
 *
 *   node solver/fortress.js lamb <k>   aggregate layer k by lamb shape (up to symmetry):
 *                                      for each shape, over every wolf placement and both
 *                                      sides to move, how many states are lamb wins / draws /
 *                                      wolf wins. Shapes with no wolf win are lamb fortresses.
 *   node solver/fortress.js wolf <k>   aggregate layer k by wolf placement (orbit): shapes
 *                                      with no lamb win are wolf fortresses in that layer.
 */
const fs = require('fs');
const path = require('path');
const IX = require(path.join(__dirname, 'indexing.js'));
const { xf, binom, nOrbits, orbitMask, orbitStab, expandLambs, isAlias, nextComb, layerSize } = IX;
const WOLF = 1, LAMB = 2, DRAW = 3;
const mode = process.argv[2] || 'lamb', k = +(process.argv[3] || 5), top = +(process.argv[4] || 12);

const buf = fs.readFileSync(path.join(__dirname, 'tables', `layer_${k}.bin`));
const tab = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
if (tab.length !== layerSize(k)) throw new Error('size');
const c22k = binom[22][k];

function canonMask(m) { let best = m; for (let t = 1; t < 8; t++) { const x = xf(t, m); if (x < best) best = x; } return best; }
function board(w, l) {
  let out = '';
  for (let r = 0; r < 5; r++) { let line = ''; for (let c = 0; c < 5; c++) { const i = r * 5 + c; line += (w >> i) & 1 ? 'W ' : (l >> i) & 1 ? 'L ' : '. '; } out += '    ' + line.trim() + '\n'; }
  return out;
}

const agg = new Map();   // key -> [wolfWins, lambWins, draws]
for (let o = 0; o < nOrbits; o++) {
  const w = orbitMask[o];
  let cm = (1 << k) - 1, rank = 0;
  for (; cm < (1 << 22); cm = nextComb(cm), rank++) {
    const l = expandLambs(o, cm);
    if (isAlias(o, l)) continue;
    const base = (o * c22k + rank) * 2;
    const key = mode === 'lamb' ? canonMask(l) : o;
    let a = agg.get(key); if (!a) { a = [0, 0, 0, 0]; agg.set(key, a); }
    for (let side = 0; side < 2; side++) { const v = tab[base + side] >>> 14; a[v === WOLF ? 0 : v === LAMB ? 1 : 2]++; a[3]++; }
  }
}

const rows = [...agg.entries()].map(([key, a]) => ({ key, wolf: a[0], lamb: a[1], draw: a[2], n: a[3] }));
if (mode === 'lamb') {
  const fort = rows.filter(r => r.wolf === 0).sort((a, b) => b.draw - a.draw);
  const nearly = rows.filter(r => r.wolf > 0).sort((a, b) => (a.wolf / a.n) - (b.wolf / b.n));
  console.log(`layer ${k}: ${rows.length} lamb shapes (up to symmetry). ${fort.length} shapes are never lost for the lambs whatever the wolves do (lamb fortresses).`);
  for (const r of fort.slice(0, top)) console.log(`\n  fortress shape: ${r.n} states, draws ${r.draw}, lamb wins ${r.lamb}\n` + board(0, r.key));
  console.log(`\nleast breakable non-fortress shapes (share of states the wolves win):`);
  for (const r of nearly.slice(0, 5)) console.log(`  wolf wins ${(100 * r.wolf / r.n).toFixed(2)}%  (${r.wolf} of ${r.n})\n` + board(0, r.key));
  const totalStates = rows.reduce((s, r) => s + r.n, 0), fortStates = fort.reduce((s, r) => s + r.n, 0);
  console.log(`fortress shapes cover ${fortStates} of ${totalStates} states in the layer`);
} else {
  const fort = rows.filter(r => r.lamb === 0).sort((a, b) => b.draw - a.draw);
  const byDraw = rows.slice().sort((a, b) => (b.draw / b.n) - (a.draw / a.n));
  console.log(`layer ${k}: ${rows.length} wolf placements (orbits). ${fort.length} placements are never lost for the wolves in this layer (wolf fortresses).`);
  for (const r of fort.slice(0, top)) console.log(`\n  wolf fortress: ${r.n} states, draws ${r.draw}, wolf wins ${r.wolf}\n` + board(orbitMask[r.key], 0));
  console.log(`\nplacements with the highest draw share:`);
  for (const r of byDraw.slice(0, top)) console.log(`  draw ${(100 * r.draw / r.n).toFixed(2)}%  lamb wins ${(100 * r.lamb / r.n).toFixed(2)}%  wolf wins ${(100 * r.wolf / r.n).toFixed(2)}%\n` + board(orbitMask[r.key], 0));
}
