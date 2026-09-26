// Formation safety: for each wolf placement (orbit), over all lamb configurations of layer k
// with the LAMBS to move and no lamb currently capturable ("lambs staying away"), the share
// of lamb wins / draws / wolf wins. Prints the safest formations and a few named ones.
const fs = require('fs'), path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const IX = require(path.join(__dirname, 'indexing.js'));
const { xf, binom, nOrbits, orbitMask, expandLambs, isAlias, nextComb, layerSize, rank3 } = IX;
const k = +(process.argv[2] || 12), top = +(process.argv[3] || 8);
const buf = fs.readFileSync(path.join(__dirname, 'tables', `layer_${k}.bin`));
const tab = new Uint16Array(buf.buffer, buf.byteOffset, buf.length / 2);
const c22k = binom[22][k];
const rows = [];
for (let o = 0; o < nOrbits; o++) {
  const w = orbitMask[o]; let a = [0, 0, 0];
  let cm = (1 << k) - 1, rank = 0;
  for (; cm < (1 << 22); cm = nextComb(cm), rank++) {
    const l = expandLambs(o, cm); if (isAlias(o, l)) continue;
    if (B.threatenedLambs({ wolves: w, lambs: l }) ) continue;          // a lamb is capturable: not "staying away"
    const v = tab[(o * c22k + rank) * 2 + 1] >>> 14;                     // lamb to move
    a[v === 1 ? 0 : v === 2 ? 1 : 2]++;
  }
  rows.push({ o, w, wolf: a[0], lamb: a[1], draw: a[2], n: a[0] + a[1] + a[2] });
}
function board(w) { let out = ''; for (let r = 0; r < 5; r++) { let line = ''; for (let c = 0; c < 5; c++) line += (w >> (r * 5 + c)) & 1 ? 'W ' : '. '; out += '    ' + line.trim() + '\n'; } return out; }
rows.sort((a, b) => (a.lamb / a.n) - (b.lamb / b.n));
console.log(`layer ${k}: lambs to move, no lamb capturable. Formations with the smallest lamb-win share:`);
for (const r of rows.slice(0, top)) console.log(`  lamb wins ${(100 * r.lamb / r.n).toFixed(2)}%  draws ${(100 * r.draw / r.n).toFixed(1)}%  wolf wins ${(100 * r.wolf / r.n).toFixed(1)}%  (${r.n} positions)\n` + board(r.w));
// named formations (any orientation): find their orbit
const named = { 'centre + (2,2) + (1,4)': [[3,3],[2,2],[1,4]], 'centre + (1,2) + (1,4)': [[3,3],[1,2],[1,4]], 'centre + (2,2) + (2,4)': [[3,3],[2,2],[2,4]], 'centre + two corners (1,1),(1,5)': [[3,3],[1,1],[1,5]], 'diagonal (2,2),(3,3),(4,4)': [[2,2],[3,3],[4,4]], 'centre + (1,3) + (5,3)': [[3,3],[1,3],[5,3]] };
const cellMask = cells => cells.reduce((m, [r, c]) => m | (1 << ((r - 1) * 5 + (c - 1))), 0);
console.log('named formations:');
for (const [name, cells] of Object.entries(named)) {
  const w = cellMask(cells); let canon = w; for (let t = 1; t < 8; t++) canon = Math.min(canon, xf(t, w));
  const r = rows.find(x => x.w === canon);
  console.log(`  ${name.padEnd(36)} lamb wins ${(100 * r.lamb / r.n).toFixed(2)}%  draws ${(100 * r.draw / r.n).toFixed(1)}%  wolf wins ${(100 * r.wolf / r.n).toFixed(1)}%  rank ${rows.indexOf(r) + 1} of ${rows.length}`);
}
