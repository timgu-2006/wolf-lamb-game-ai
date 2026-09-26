#!/usr/bin/env node
/*
 * Whole-game survival of compact wolf strategies ("look d plies ahead maximising E")
 * against a perfect lamb (random among value-preserving moves) and an engine lamb.
 *   node solver/compact_games.js [games] [depth] [evalName]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const games = +(process.argv[2] || 100), depth = +(process.argv[3] || 8), evalName = process.argv[4] || 'mobility + reachable + 3 per lamb eaten';
const zero = { lamb: 0, threshold: 0, wolfMob: 0, trapped: 0, confine: 0, threat: 0, threatLamb: 0, vulnerable: 0, isolated: 0, base: 0 };
const EVALS = {
  'reachable squares only': { confine: 1 },
  'wolf mobility only': { wolfMob: 1 },
  'reachable squares + 3 per lamb eaten': { confine: 1, lamb: 3 },
  'mobility + 3 per lamb eaten': { wolfMob: 1, lamb: 3 },
  'mobility + reachable + 3 per lamb eaten': { wolfMob: 1, confine: 1, lamb: 3 },
  'full engine evaluation (9 terms)': {},
};
const wts = EVALS[evalName]; const weights = Object.keys(wts).length ? Object.assign({}, zero, wts) : undefined;
let seed = 11; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const wolf = (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth, history: hist, clearTT: true, weights, contempt: 0 }).move);
const opponents = {
  // perfect lamb: when winning, the fastest win (so blunders are punished); otherwise a random value-preserving move
  'table-perfect lamb': (s) => { const p = B.fromState(s); const v = TB.value(p, s.turnsSinceCapture).winner; const good = TB.outcomes(p, s.turnsSinceCapture).filter(o => o.winner === v); if (v === E.LAMB) { good.sort((a, b) => (a.d !== undefined ? a.d : a.t) - (b.d !== undefined ? b.d : b.t)); return B.toEngineMove(good[0].move); } return B.toEngineMove(good[Math.floor(rand() * good.length)].move); },
  'engine lamb depth 6': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 6, history: hist, clearTT: true }).move),
};
console.log(`wolf = look ${depth} plies ahead maximising "${evalName}"`);
for (const [name, opp] of Object.entries(opponents)) {
  const res = { wolf: 0, lamb: 0, draw: 0 }; let firstBlunderPlies = [];
  for (let g = 0; g < games; g++) {
    let s = E.initialState(); const hist = []; let ply = 0, blunderAt = null;
    while (!E.result(s)) {
      let em;
      if (s.side === E.WOLF) {
        em = wolf(s, hist);
        if (blunderAt === null) { const p = B.fromState(s); const before = TB.value(p, s.turnsSinceCapture).winner; const t = E.applyMove(s, em); const aft = TB.value(B.fromState(t), t.turnsSinceCapture).winner; const rank = v => v === E.WOLF ? 2 : v === TB.DRAW ? 1 : 0; if (rank(aft) < rank(before)) blunderAt = ply; }
      } else em = opp(s, hist);
      hist.push(B.key(B.fromState(s))); s = E.applyMove(s, em); ply++;
    }
    const r = E.result(s); res[r.winner === E.WOLF ? 'wolf' : r.winner === E.LAMB ? 'lamb' : 'draw']++;
    if (blunderAt !== null) firstBlunderPlies.push(blunderAt);
  }
  const med = firstBlunderPlies.length ? firstBlunderPlies.sort((a, b) => a - b)[Math.floor(firstBlunderPlies.length / 2)] : null;
  console.log(`  vs ${name.padEnd(22)} ${games} games: wolf ${res.wolf}  draw ${res.draw}  lamb ${res.lamb}   games with a value-losing wolf move: ${firstBlunderPlies.length}${med !== null ? ' (median first at ply ' + med + ')' : ''}`);
}
