#!/usr/bin/env node
/*
 * Structured wolf rules built from the observed motifs, scored on the drawing frontier
 * (how often the rule's move keeps the draw) and optionally in full games.
 *   node solver/rule_combo.js [positions]
 */
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const TAC = require(path.join(__dirname, 'tactics.js'));
const { collectFrontier } = require(path.join(__dirname, 'learnrule.js'));
const ALL = (1 << 25) - 1, buf = new Int32Array(64);
function legal(p) { const n = B.genMoves(p, buf); const out = []; for (let i = 0; i < n; i++) out.push(buf[i]); return out; }
function after(p, m) { const q = B.clone(p); B.makeMove(q, m); return q; }
function region(q) { const empty = ALL & ~(q.wolves | q.lambs); let reg = q.wolves, prev; do { prev = reg; reg |= (B.up(reg) | B.down(reg) | B.left(reg) | B.right(reg)) & empty; } while (reg !== prev); return B.popcount(reg & empty); }
const mob = q => B.mobility(q, B.WOLF);
const onEdge = i => { const r = Math.floor(i / 5), c = i % 5; return r === 0 || r === 4 || c === 0 || c === 4; };
function pick(ms, score) { let best = null, bv = -Infinity; for (const m of ms) { const v = score(m); if (v > bv) { bv = v; best = m; } } return best; }
// worst case for the wolves after any lamb reply, measured by mobility (2-ply safety)
function worstMob(q) { const ql = B.clone(q); ql.side = B.LAMB; let w = Infinity; for (const r of legal(ql)) { const t = after(ql, r); w = Math.min(w, mob(t)); } return w === Infinity ? mob(q) : w; }
const zero = { lamb: 0, threshold: 0, wolfMob: 0, trapped: 0, confine: 0, threat: 0, threatLamb: 0, vulnerable: 0, isolated: 0, base: 0 };
const mobWeights = Object.assign({}, zero, { wolfMob: 1 });
function searchMob(p, depth, allowed) {
  // mobility-only search restricted to an allowed move set: run the engine and take the best allowed move from its ranking
  const r = AI.analyze ? AI.analyze(p, { depth, clearTT: true, weights: mobWeights, contempt: 0 }) : null;
  if (r && r.moves) for (const e of r.moves) if (allowed.includes(e.move)) return e.move;
  return AI.chooseMove(p, { depth, clearTT: true, weights: mobWeights, contempt: 0 }).move;
}
const RULES = {
  'A: discovered double attack if available, else capture maximising mobility, else max mobility': p => {
    const ms = legal(p); const dda = ms.filter(m => TAC.discoveredDouble(p, m));
    if (dda.length) return pick(dda, m => mob(after(p, m)));
    const caps = ms.filter(m => B.moveIsCapture(m)); if (caps.length) return pick(caps, m => mob(after(p, m)));
    return pick(ms, m => mob(after(p, m)));
  },
  'B: as A but captures landing on the edge are refused': p => {
    const ms = legal(p); const dda = ms.filter(m => TAC.discoveredDouble(p, m));
    if (dda.length) return pick(dda, m => mob(after(p, m)));
    const caps = ms.filter(m => B.moveIsCapture(m) && !onEdge(B.moveTo(m))); if (caps.length) return pick(caps, m => mob(after(p, m)));
    return pick(ms, m => mob(after(p, m)));
  },
  'C: 2-ply safety: maximise worst-case mobility after any lamb reply (captures +2)': p => pick(legal(p), m => worstMob(after(p, m)) + (B.moveIsCapture(m) ? 2 : 0)),
  'D: discovered double attack if available, else 2-ply safety': p => {
    const ms = legal(p); const dda = ms.filter(m => TAC.discoveredDouble(p, m));
    if (dda.length) return pick(dda, m => worstMob(after(p, m)));
    return pick(ms, m => worstMob(after(p, m)) + (B.moveIsCapture(m) ? 2 : 0));
  },
  'E: discovered double attack if available, else mobility search 8 plies': p => {
    const ms = legal(p); const dda = ms.filter(m => TAC.discoveredDouble(p, m));
    if (dda.length) return pick(dda, m => mob(after(p, m)));
    return searchMob(p, 8, ms);
  },
  'G: mobility search 8 plies (baseline)': p => searchMob(p, 8, legal(p)),
  'F: mobility search 8 plies, edge captures refused': p => {
    const ms = legal(p); const allowed = ms.filter(m => !(B.moveIsCapture(m) && onEdge(B.moveTo(m))));
    return searchMob(p, 8, allowed.length ? allowed : ms);
  },
};
const n = +(process.argv[2] || 800);
let seed = 8; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const positions = collectFrontier(n * 3).sort(() => rand() - 0.5).slice(0, n);
console.log(`${positions.length} drawn wolf-to-move positions from the drawing frontier`);
const onlyRule = process.env.ONLY;
for (const [name, rule] of Object.entries(RULES)) {
  if (onlyRule && !name.includes(onlyRule)) continue;
  let ok = 0, onlyOk = 0, only = 0;
  for (const { p, outs } of positions) {
    const m = rule(p); const o = outs.find(x => x.move === m);
    const drawing = outs.filter(x => x.winner === TB.DRAW).length;
    if (drawing === 1) only++;
    if (o && o.winner === TB.DRAW) { ok++; if (drawing === 1) onlyOk++; }
  }
  console.log(name.padEnd(90) + (100 * ok / positions.length).toFixed(1).padStart(6) + '%   single-move positions: ' + (100 * onlyOk / Math.max(1, only)).toFixed(0) + '%');
}
module.exports = { RULES };
