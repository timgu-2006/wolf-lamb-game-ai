#!/usr/bin/env node
/*
 * Practical winning chances: the table player (exact values, trap ranking) against
 * imperfect opponents, from the drawn start position. Compares the uniform-opponent
 * ranking with the modelled-opponent ranking.
 *
 *   node solver/practical.js [gamesPerPair]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));
process.argv[2] = '1'; process.argv[3] = 'any'; process.argv[4] = 'no rule';
const R = require(path.join(__dirname, 'rules.js'));
const games = +(process.argv[5] || 60);
let seed = 99; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function tablePlayer(mode) {          // 'model' | 'uniform' | 'plain' (no trap ranking: first value-preserving move)
  return (s) => {
    const p = B.fromState(s);
    const opts = TB.bestMoves(p, s.turnsSinceCapture, { depth: mode === 'plain' ? 1 : 3 });
    const mover = s.side;
    let best = opts[0];
    if (mode !== 'model') {
      const score = r => r.winner === mover ? 3 : r.winner === TB.DRAW ? 2 : 1;
      const len = r => r.d !== undefined ? r.d : r.t;
      const key = mode === 'uniform' ? (o => o.blunderUniform) : (o => 0);
      best = opts.slice().sort((a, b) => (score(b) - score(a)) || (a.winner === mover ? len(a) - len(b) : (key(b) - key(a)) || (len(b) - len(a))))[0];
    }
    return B.toEngineMove(best.move);
  };
}
const greedyWolf = Object.entries(R.WOLF_RULES).find(([n]) => n.startsWith('always capture'))[1];
const opponents = {
  'greedy wolf (always captures, else max mobility)': (s) => B.toEngineMove(greedyWolf(B.fromState(s))),
  'engine wolf depth 6': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 6, history: hist, clearTT: true }).move),
  'engine wolf 0.3 s': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { timeMs: 300, history: hist, clearTT: true }).move),
  'careful lamb (block threats, else engine d4)': (s, hist) => {
    const p = B.fromState(s); const ms = E.legalMoves(s);
    const before = B.popcount(B.threatenedLambs(p));
    if (before) { let best = null, bv = Infinity; for (const m of ms) { const t = B.fromState(E.applyMove(s, m)); const a = B.popcount(B.threatenedLambs(t)); if (a < bv) { bv = a; best = m; } } if (bv < before) return best; }
    return B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 4, history: hist, clearTT: true }).move);
  },
  'engine lamb depth 6': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 6, history: hist, clearTT: true }).move),
};
function play(sideOfTable, tp, opp, n) {
  const res = { win: 0, draw: 0, loss: 0 };
  for (let g = 0; g < n; g++) {
    let s = E.initialState(); const hist = [];
    // a little variety: the opponent's first move is random 1 time in 3
    let ply = 0;
    while (!E.result(s)) {
      let em;
      if (s.side === sideOfTable) em = tp(s);
      else if (ply < 2 && rand() < 0.34) { const ms = E.legalMoves(s); em = ms[Math.floor(rand() * ms.length)]; }
      else em = opp(s, hist);
      hist.push(B.key(B.fromState(s))); s = E.applyMove(s, em); ply++;
    }
    const r = E.result(s);
    if (r.winner === sideOfTable) res.win++; else if (r.winner === null) res.draw++; else res.loss++;
  }
  return res;
}
for (const mode of ['plain', 'uniform', 'model']) {
  console.log(`\n== table player ranking: ${mode}`);
  for (const [name, opp] of Object.entries(opponents)) {
    const side = name.includes('wolf') ? E.LAMB : E.WOLF;   // the table plays the other side
    const r = play(side, tablePlayer(mode), opp, games);
    console.log(`  table ${side === E.WOLF ? 'WOLF' : 'LAMB'} vs ${name.padEnd(48)} win ${String(r.win).padStart(3)}  draw ${String(r.draw).padStart(3)}  loss ${String(r.loss).padStart(3)}`);
  }
}
