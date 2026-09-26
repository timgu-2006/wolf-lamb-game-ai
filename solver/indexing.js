/*
 * State indexing for the solved tables, implemented independently of solve.c.
 *
 *   - Wolves: a 3-subset of the 25 cells. Subsets are grouped into orbits under
 *     the 8 symmetries of the square; the orbit's representative is the
 *     numerically smallest mask.
 *   - Lambs: a k-subset of the 22 non-wolf cells, ranked in colex order after
 *     the same transform (the smallest transformed lamb mask if several
 *     transforms fix the wolf mask).
 *   - index = (orbit * C(22,k) + lambRank) * 2 + side, side 0 = wolf to move.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require(require('path').join(__dirname, '..', 'bitboard.js')));
  else root.WolfLambIndexing = factory(root.Bitboard);
})(typeof self !== 'undefined' ? self : this, function (B) {
'use strict';
const ALL = (1 << 25) - 1;

// ---- symmetry --------------------------------------------------------------
const perms = [];
{
  const fns = [
    (r, c) => [r, c], (r, c) => [c, 4 - r], (r, c) => [4 - r, 4 - c], (r, c) => [4 - c, r],
    (r, c) => [r, 4 - c], (r, c) => [4 - r, c], (r, c) => [c, r], (r, c) => [4 - c, 4 - r],
  ];
  for (const f of fns) { const p = new Int32Array(25); for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) { const [r2, c2] = f(r, c); p[r * 5 + c] = r2 * 5 + c2; } perms.push(p); }
}
function xfSlow(t, m) { let out = 0; for (let i = 0; i < 25; i++) if (m & (1 << i)) out |= 1 << perms[t][i]; return out; }
const rowT = [];
for (let t = 0; t < 8; t++) { rowT.push([]); for (let r = 0; r < 5; r++) { const tab = new Int32Array(32); for (let b = 0; b < 32; b++) tab[b] = xfSlow(t, b << (5 * r)); rowT[t].push(tab); } }
function xf(t, m) { const R = rowT[t]; return R[0][m & 31] | R[1][(m >>> 5) & 31] | R[2][(m >>> 10) & 31] | R[3][(m >>> 15) & 31] | R[4][(m >>> 20) & 31]; }

// ---- binomials, orbits -----------------------------------------------------
const binom = [];
for (let n = 0; n <= 25; n++) { binom.push(new Float64Array(26)); binom[n][0] = 1; for (let k = 1; k <= 25; k++) binom[n][k] = n === 0 ? 0 : binom[n - 1][k - 1] + binom[n - 1][k]; }
function rank3(w) { const a = B.lsb(w); w &= w - 1; const b = B.lsb(w); w &= w - 1; const c = B.lsb(w); return binom[a][1] + binom[b][2] + binom[c][3]; }

const tripleOrbit = new Int32Array(2300).fill(-1), tripleCoset = [];
const orbitMask = [], orbitComp = [], orbitCells = [], orbitStab = [];
{
  const masks = new Int32Array(2300);
  for (let a = 0; a < 25; a++) for (let b = a + 1; b < 25; b++) for (let c = b + 1; c < 25; c++) { const w = (1 << a) | (1 << b) | (1 << c); masks[rank3(w)] = w; }
  const canonOrbit = new Map();
  for (let r = 0; r < 2300; r++) {
    const w = masks[r];
    let canon = ALL; for (let t = 0; t < 8; t++) canon = Math.min(canon, xf(t, w));
    if (!canonOrbit.has(canon)) {
      const o = orbitMask.length; canonOrbit.set(canon, o); orbitMask.push(canon);
      const comp = new Int8Array(25).fill(-1), cells = []; let ci = 0;
      for (let p = 0; p < 25; p++) if (!(canon & (1 << p))) { comp[p] = ci++; cells.push(p); }
      orbitComp.push(comp); orbitCells.push(cells);
      const stab = []; for (let t = 0; t < 8; t++) if (xf(t, canon) === canon) stab.push(t); orbitStab.push(stab);
    }
    tripleOrbit[r] = canonOrbit.get(canon);
    const coset = []; for (let t = 0; t < 8; t++) if (xf(t, w) === canon) coset.push(t); tripleCoset.push(coset);
  }
}
const nOrbits = orbitMask.length;

function rankLambs(o, lm) { const comp = orbitComp[o]; let r = 0, i = 0; while (lm) { const p = B.lsb(lm); lm &= lm - 1; i++; r += binom[comp[p]][i]; } return r; }
function expandLambs(o, cm) { const cells = orbitCells[o]; let m = 0; while (cm) { const c = B.lsb(cm); cm &= cm - 1; m |= 1 << cells[c]; } return m; }
function unrankCompressed(r, k) { let cm = 0; for (let i = k - 1; i >= 0; i--) { let c = 21; while (binom[c][i + 1] > r) c--; r -= binom[c][i + 1]; cm |= 1 << c; } return cm; }
function isAlias(o, l) { const st = orbitStab[o]; for (let i = 1; i < st.length; i++) if (xf(st[i], l) < l) return true; return false; }
function canonIndex(k, w, l, side) {
  const r = rank3(w), o = tripleOrbit[r], coset = tripleCoset[r];
  let best = Infinity; for (const t of coset) { const m = xf(t, l); if (m < best) best = m; }
  return ((o * binom[22][k] + rankLambs(o, best)) * 2) + side;
}
function nextComb(cm) { const c = cm & -cm, r = cm + c; return (((r ^ cm) >>> 2) / c | 0) | r; }
function layerSize(k) { return nOrbits * binom[22][k] * 2; }

/* decode an index to a (canonical) state */
function stateOf(k, idx) {
  const side = idx % 2, s = (idx - side) / 2, o = Math.floor(s / binom[22][k]), r = s % binom[22][k];
  return { wolves: orbitMask[o], lambs: expandLambs(o, unrankCompressed(r, k)), side };
}

return { ALL, xf, binom, rank3, nOrbits, orbitMask, orbitStab, orbitCells, rankLambs, expandLambs, unrankCompressed, isAlias, canonIndex, nextComb, layerSize, stateOf };
});
