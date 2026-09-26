#!/usr/bin/env node
/*
 * Play a hand-written wolf rule (from rules.js) in many games against three
 * kinds of lamb opponent and count its value-losing moves.
 *   node solver/rules_games.js "<rule name substring>" [gamesPerOpponent]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));
process.argv[2] = '1'; process.argv[3] = 'any'; process.argv[4] = 'no rule matches this';
const R = require(path.join(__dirname, 'rules.js'));
const ruleName = process.argv[5] || 'most central', games = +(process.argv[6] || 200);
const rule = Object.entries(R.WOLF_RULES).find(([n]) => n.includes(ruleName));
if (!rule) { console.error('no such rule'); process.exit(1); }
let seed = 77; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const opponents = {
  'random lamb': (s) => { const ms = E.legalMoves(s); return ms[Math.floor(rand() * ms.length)]; },
  'engine lamb (depth 6)': (s, hist) => B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 6, history: hist, clearTT: true }).move),
  'table-perfect lamb (random value-preserving move)': (s) => { const p = B.fromState(s); const v = TB.value(p, s.turnsSinceCapture).winner; const good = TB.outcomes(p, s.turnsSinceCapture).filter(o => o.winner === v); const o = good[Math.floor(rand() * good.length)]; return B.toEngineMove(o.move); },
};
for (const [oname, opp] of Object.entries(opponents)) {
  let decisions = 0, blunders = 0; const results = { wolf: 0, lamb: 0, draw: 0 }; const examples = [];
  for (let g = 0; g < games; g++) {
    let s = E.initialState(); const hist = [];
    while (!E.result(s)) {
      let em;
      if (s.side === E.WOLF) {
        const p = B.fromState(s); const m = rule[1](p); em = B.toEngineMove(m); decisions++;
        const before = TB.value(p, s.turnsSinceCapture).winner; const q = B.clone(p); B.makeMove(q, m);
        const aft = TB.value(q, em.capture !== null ? 0 : s.turnsSinceCapture + 1).winner;
        const rank = v => v === E.WOLF ? 2 : v === TB.DRAW ? 1 : 0;
        if (rank(aft) < rank(before)) { blunders++; if (examples.length < 3) examples.push(E.toString(s) + 'rule: ' + E.describeMove(em) + '  (value was ' + ['', 'wolf win', 'lamb win', 'draw'][before] + ')'); }
      } else em = opp(s, hist);
      hist.push(B.key(B.fromState(s))); s = E.applyMove(s, em);
    }
    const r = E.result(s); results[r.winner === E.WOLF ? 'wolf' : r.winner === E.LAMB ? 'lamb' : 'draw']++;
  }
  console.log(`vs ${oname}: ${games} games -> wolf ${results.wolf} lamb ${results.lamb} draw ${results.draw}; wolf-rule decisions ${decisions}, value-losing ${blunders}`);
  for (const ex of examples) console.log(ex.split('\n').map(l => '   ' + l).join('\n'));
}
