#!/usr/bin/env node
/*
 * Learn a compact wolf survival rule from the tables.
 *
 * 1. Collect wolf-to-move DRAWN positions reachable from the start when the wolf
 *    plays any drawing move and the lambs play any value-preserving move (this is
 *    the drawing frontier: the positions a surviving wolf must handle against a
 *    perfect flock). Capped.
 * 2. For every legal wolf move in those positions compute simple features and the
 *    label "keeps the draw".
 * 3. Report which single features separate drawing from losing moves, and fit a
 *    small linear score by logistic regression; report how often argmax(score)
 *    picks a drawing move. Rounded weights are printed so the rule can be stated.
 *
 *   node solver/learnrule.js [maxPositions]
 */
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));

const maxPositions = +(process.argv[2] || 60000);
const buf = new Int32Array(64);
const ALL = (1 << 25) - 1;
function legal(p) { const n = B.genMoves(p, buf); const out = []; for (let i = 0; i < n; i++) out.push(buf[i]); return out; }
function after(p, m) { const q = B.clone(p); B.makeMove(q, m); return q; }
function neighbours(i) { const r = Math.floor(i / 5), c = i % 5, out = []; if (r > 0) out.push(i - 5); if (r < 4) out.push(i + 5); if (c > 0) out.push(i - 1); if (c < 4) out.push(i + 1); return out; }
function region(q) { const empty = ALL & ~(q.wolves | q.lambs); let reg = q.wolves, prev; do { prev = reg; reg |= (B.up(reg) | B.down(reg) | B.left(reg) | B.right(reg)) & empty; } while (reg !== prev); return B.popcount(reg & empty); }
function perWolf(q) { const out = []; for (let i = 0; i < 25; i++) if (q.wolves & (1 << i)) { let mob = 0, adjL = 0; for (const n of neighbours(i)) { if (!((q.wolves | q.lambs) & (1 << n))) mob++; else if (q.lambs & (1 << n)) adjL++; } out.push({ i, mob, adjL }); } return out; }
// can the lambs, moving next, immobilise some wolf at once? (1-ply trap check)
function lambCanTrapNow(q) { const p = B.clone(q); p.side = B.LAMB; const ms = legal(p); for (const m of ms) { const t = after(p, m); for (const w of perWolf(t)) { let jumps = 0; const r = Math.floor(w.i / 5), c = w.i % 5; for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) { const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc; if (r1 < 0 || r1 > 4 || c1 < 0 || c1 > 4 || r2 < 0 || r2 > 4 || c2 < 0 || c2 > 4) continue; const j = r1 * 5 + c1, j2 = r2 * 5 + c2; if (!((t.wolves | t.lambs) & (1 << j)) && (t.lambs & (1 << j2))) jumps++; } if (w.mob === 0 && jumps === 0) return 1; } } return 0; }

const FEATURES = ['capture', 'landRow', 'landCentreDist', 'mobAfter', 'minWolfMob', 'lambsAdjacent', 'threatened', 'region', 'wolvesOnEdge', 'wolfSpread', 'lambCanTrap'];
function features(p, m) {
  const q = after(p, m), to = B.moveTo(m), pw = perWolf(q);
  const edge = pw.filter(w => { const r = Math.floor(w.i / 5), c = w.i % 5; return r === 0 || r === 4 || c === 0 || c === 4; }).length;
  let spread = 0; for (let a = 0; a < 3; a++) for (let b = a + 1; b < 3; b++) spread += Math.abs(Math.floor(pw[a].i / 5) - Math.floor(pw[b].i / 5)) + Math.abs(pw[a].i % 5 - pw[b].i % 5);
  return [B.moveIsCapture(m), Math.floor(to / 5), Math.abs(Math.floor(to / 5) - 2) + Math.abs(to % 5 - 2), B.mobility(q, B.WOLF), Math.min(...pw.map(w => w.mob)), pw.reduce((s, w) => s + w.adjL, 0), B.popcount(B.threatenedLambs(q)), region(q), edge, spread, lambCanTrapNow(q)];
}

// ---- 1. the drawing frontier ------------------------------------------------
function collectFrontier(maxPositions) {
  const start = B.initial();
  const seen = new Set([B.key(start)]);
  let frontier = [start], positions = [];
  while (frontier.length && positions.length < maxPositions) {
    const next = [];
    for (const p of frontier) {
      if (B.popcount(p.lambs) < 4 || B.terminal(p) !== -1) continue;
      const v = TB.lookup(p).winner;
      if (v !== TB.DRAW) continue;
      const outs = TB.outcomes(p, 0);
      if (p.side === B.WOLF) positions.push({ p, outs });
      for (const o of outs) {
        if (o.winner !== TB.DRAW) continue;
        const q = after(p, o.move), k = B.key(q);
        if (seen.has(k)) continue;
        seen.add(k); next.push(q);
      }
      if (positions.length >= maxPositions) break;
    }
    frontier = next;
  }
  return positions;
}
module.exports = { FEATURES, features, collectFrontier };
if (require.main === module) {
const positions = collectFrontier(maxPositions);
console.log(`drawing frontier: ${positions.length} wolf-to-move drawn positions (lamb counts ${[...new Set(positions.map(x => B.popcount(x.p.lambs)))].sort((a, b) => b - a).join(',')})`);

// ---- 2. dataset ---------------------------------------------------------------
const rows = [];   // { pos, x: features, y: 1 if the move keeps the draw }
let onlyMoves = 0;
for (let pi = 0; pi < positions.length; pi++) {
  const { p, outs } = positions[pi];
  const good = outs.filter(o => o.winner === TB.DRAW).length;
  if (good === 1) onlyMoves++;
  for (const o of outs) rows.push({ pos: pi, x: features(p, o.move), y: o.winner === TB.DRAW ? 1 : 0 });
}
console.log(`${rows.length} candidate moves, ${rows.filter(r => r.y).length} keep the draw; ${onlyMoves} positions (${(100 * onlyMoves / positions.length).toFixed(0)}%) have a single drawing move`);

// ---- 3. single-feature separation --------------------------------------------
console.log('\nsingle features: how often "pick the move with the highest (or lowest) value of this feature" keeps the draw');
for (let f = 0; f < FEATURES.length; f++) {
  for (const dir of [1, -1]) {
    let ok = 0;
    for (let pi = 0; pi < positions.length; pi++) {
      const rs = rows.filter(r => r.pos === pi);
      let best = null, bv = -Infinity;
      for (const r of rs) { const v = dir * r.x[f]; if (v > bv) { bv = v; best = r; } }
      // ties: count as success only if every tied move keeps the draw
      const tied = rs.filter(r => dir * r.x[f] === bv);
      if (tied.every(r => r.y)) ok++;
    }
    console.log(`  ${(dir > 0 ? 'max ' : 'min ') + FEATURES[f]}`.padEnd(24) + (100 * ok / positions.length).toFixed(1).padStart(6) + '%');
  }
}

// ---- 4. logistic regression on standardised features -------------------------
const nf = FEATURES.length;
const mean = new Array(nf).fill(0), sd = new Array(nf).fill(0);
for (const r of rows) for (let f = 0; f < nf; f++) mean[f] += r.x[f] / rows.length;
for (const r of rows) for (let f = 0; f < nf; f++) sd[f] += (r.x[f] - mean[f]) ** 2 / rows.length;
for (let f = 0; f < nf; f++) sd[f] = Math.sqrt(sd[f]) || 1;
const X = rows.map(r => r.x.map((v, f) => (v - mean[f]) / sd[f]));
let w = new Array(nf).fill(0), b0 = 0;
const lr = 0.05, epochs = 60;
for (let e = 0; e < epochs; e++) {
  const gw = new Array(nf).fill(0); let gb = 0;
  for (let i = 0; i < rows.length; i++) {
    let z = b0; for (let f = 0; f < nf; f++) z += w[f] * X[i][f];
    const pr = 1 / (1 + Math.exp(-z)), err = pr - rows[i].y;
    for (let f = 0; f < nf; f++) gw[f] += err * X[i][f] / rows.length; gb += err / rows.length;
  }
  for (let f = 0; f < nf; f++) w[f] -= lr * 20 * gw[f]; b0 -= lr * 20 * gb;
}
function argmaxOk(scoreFn) {
  let ok = 0;
  for (let pi = 0; pi < positions.length; pi++) {
    const rs = rows.filter(r => r.pos === pi);
    let best = null, bv = -Infinity;
    for (const r of rs) { const v = scoreFn(r.x); if (v > bv) { bv = v; best = r; } }
    if (best.y) ok++;
  }
  return ok / positions.length;
}
console.log('\nlinear score (logistic regression): argmax keeps the draw in ' + (100 * argmaxOk(x => x.reduce((s, v, f) => s + w[f] * (v - mean[f]) / sd[f], 0))).toFixed(1) + '% of positions');
console.log('weights per raw feature unit: ' + FEATURES.map((n, f) => n + ' ' + (w[f] / sd[f]).toFixed(2)).join(', '));
// rounded small-integer version relative to the largest weight
const raw = w.map((v, f) => v / sd[f]); const scale = 9 / Math.max(...raw.map(Math.abs));
const ints = raw.map(v => Math.round(v * scale));
console.log('rounded integer weights: ' + FEATURES.map((n, f) => n + ' ' + ints[f]).join(', '));
console.log('rounded rule keeps the draw in ' + (100 * argmaxOk(x => x.reduce((s, v, f) => s + ints[f] * v, 0))).toFixed(1) + '% of positions');
}
