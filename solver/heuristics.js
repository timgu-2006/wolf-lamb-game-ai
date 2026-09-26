#!/usr/bin/env node
/*
 * How well can the best move be found WITHOUT the tables?
 *
 * Samples positions from engine-vs-engine games (random openings), looks up the
 * exact value-preserving moves in the tables, and measures how often various
 * table-free move choosers pick one of them:
 *   - the alpha-beta engine at several depths / time budgets
 *   - simple rules: random move; wolf captures when it can; maximise own mobility
 * Also reports how often the position has a single value-preserving move.
 *
 *   node solver/heuristics.js [samples]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));

const samples = +(process.argv[2] || 300);
let seed = 2024; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const buf = new Int32Array(64);

// ---- collect positions from engine-vs-engine games -----------------------
const pool = [];
while (pool.length < samples * 6) {
  let s = E.initialState(); const hist = [];
  for (let ply = 0; ply < 120 && !E.result(s); ply++) {
    let em;
    const ms = E.legalMoves(s);
    if (ply < 4 || rand() < 0.15) em = ms[Math.floor(rand() * ms.length)];         // some noise so positions vary
    else em = B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 4, history: hist, clearTT: true }).move);
    hist.push(B.key(B.fromState(s)));
    s = E.applyMove(s, em);
    if (!E.result(s) && s.lambs >= 4) pool.push({ s, hist: hist.slice() });
  }
}
// pick a spread over lamb counts
pool.sort(() => rand() - 0.5);
const chosen = pool.slice(0, samples);

// ---- choosers ------------------------------------------------------------
const choosers = {
  'random': (s) => { const ms = E.legalMoves(s); return ms[Math.floor(rand() * ms.length)]; },
  'wolf captures if it can, else engine d6': (s, hist) => {
    if (s.side === E.WOLF) { const caps = E.legalMoves(s).filter(m => m.capture !== null); if (caps.length) return caps[Math.floor(rand() * caps.length)]; }
    return B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 6, history: hist, clearTT: true }).move);
  },
  'maximise own mobility (1 ply)': (s) => {
    let best = null, bestV = -Infinity;
    for (const m of E.legalMoves(s)) {
      const t = E.applyMove(s, m); const p = B.fromState(t);
      const v = (s.side === E.WOLF ? B.mobility(p, B.WOLF) - B.mobility(p, B.LAMB) : B.mobility(p, B.LAMB) - 3 * B.mobility(p, B.WOLF)) + (m.capture !== null ? 5 : 0);
      if (v > bestV) { bestV = v; best = m; }
    }
    return best;
  },
  'engine depth 4': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 4, history: hist, clearTT: true }).move),
  'engine depth 8': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 8, history: hist, clearTT: true }).move),
  'engine depth 12': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 12, history: hist, clearTT: true }).move),
  'engine 1 s': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { timeMs: 1000, history: hist, clearTT: true }).move),
};

// ---- evaluate --------------------------------------------------------------
const stats = {}; for (const k in choosers) stats[k] = { ok: 0, n: 0, okOnly: 0, nOnly: 0 };
let onlyMoves = 0, decided = 0, wins = 0, draws = 0, losses = 0;
const byLayerOnly = {};
for (const { s, hist } of chosen) {
  const p = B.fromState(s);
  const v = TB.value(p, s.turnsSinceCapture);
  const outs = TB.outcomes(p, s.turnsSinceCapture);
  const mover = s.side;
  if (v.winner !== mover && v.winner !== TB.DRAW) { losses++; continue; }   // lost: every move loses, nothing to find
  if (v.winner === mover) wins++; else draws++;
  const good = new Set(outs.filter(o => o.winner === v.winner).map(o => B.moveFrom(o.move) + ':' + B.moveTo(o.move)));
  decided++;
  const only = good.size === 1;
  if (only) { onlyMoves++; byLayerOnly[s.lambs] = (byLayerOnly[s.lambs] || 0) + 1; }
  for (const k in choosers) {
    const m = choosers[k](s, hist);
    const hit = good.has(m.from + ':' + m.to);
    stats[k].n++; if (hit) stats[k].ok++;
    if (only) { stats[k].nOnly++; if (hit) stats[k].okOnly++; }
  }
}
console.log(`positions: ${chosen.length} sampled, ${decided} where the mover is not lost (${wins} won, ${draws} drawn), ${losses} lost`);
console.log(`positions with a single value-preserving move: ${onlyMoves} of ${decided} (${(100 * onlyMoves / decided).toFixed(0)}%)`);
console.log('single-move positions by lamb count:', byLayerOnly);
console.log('\nchooser                                    keeps the value   ...in single-move positions');
for (const k in stats) {
  const st = stats[k];
  console.log(k.padEnd(42) + (100 * st.ok / st.n).toFixed(0).padStart(6) + '%' + (st.nOnly ? (100 * st.okOnly / st.nOnly).toFixed(0).padStart(20) + '%  (' + st.nOnly + ')' : ''));
}
