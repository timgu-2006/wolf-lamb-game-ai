/*
 * Tactical motifs recognised from a position and a wolf move.
 *   threats(q)                -> [{wolf, mid, lamb}] capture threats on the board
 *   discoveredDouble(p, m)    -> null, or { threats, revealed } when the wolf move m
 *                                creates two or more threats, at least one revealed by
 *                                vacating a square on another wolf's capture line, and
 *                                no single lamb move removes them all
 */
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const buf = new Int32Array(64);
function legal(p) { const n = B.genMoves(p, buf); const out = []; for (let i = 0; i < n; i++) out.push(buf[i]); return out; }
// list of {wolf, mid, lamb} capture threats in position q (any side to move)
function threats(q) {
  const out = [];
  for (let w = 0; w < 25; w++) if (q.wolves & (1 << w)) {
    const r = Math.floor(w / 5), c = w % 5;
    for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const r1 = r + dr, c1 = c + dc, r2 = r + 2 * dr, c2 = c + 2 * dc;
      if (r2 < 0 || r2 > 4 || c2 < 0 || c2 > 4) continue;
      const mid = r1 * 5 + c1, lamb = r2 * 5 + c2;
      if (!((q.wolves | q.lambs) & (1 << mid)) && (q.lambs & (1 << lamb))) out.push({ wolf: w, mid, lamb });
    }
  }
  return out;
}
function discoveredDouble(p, m) {
  const from = B.moveFrom(m), to = B.moveTo(m);
  const q = B.clone(p); B.makeMove(q, m);
  const th = threats(q);
  const lambs = new Set(th.map(t => t.lamb));
  if (lambs.size < 2) return null;
  const revealed = th.filter(t => t.wolf !== to && t.mid === from);
  if (!revealed.length) return null;
  // can one lamb move remove every threat?
  const ql = B.clone(q); ql.side = B.LAMB;
  for (const r of legal(ql)) { const t = B.clone(ql); B.makeMove(t, r); if (threats(t).length === 0) return null; }
  return { threats: th, revealed };
}
module.exports = { threats, discoveredDouble };
