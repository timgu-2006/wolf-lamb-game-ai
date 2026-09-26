#!/usr/bin/env node
/*
 * Compact "search + one-line evaluation" wolf strategies, scored on the drawing
 * frontier: how often does "look d plies ahead maximising E" keep the draw?
 *   node solver/simplesearch.js [positions] [depths...]
 */
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const { collectFrontier } = require(path.join(__dirname, 'learnrule.js'));
const n = +(process.argv[2] || 1500);
const depths = process.argv.slice(3).map(Number); if (!depths.length) depths.push(4, 8);
const zero = { lamb: 0, threshold: 0, wolfMob: 0, trapped: 0, confine: 0, threat: 0, threatLamb: 0, vulnerable: 0, isolated: 0, base: 0 };
const only = process.env.ONLY;
const EVALS = {
  'reachable squares only': { confine: 1 },
  'wolf mobility only': { wolfMob: 1 },
  'reachable squares + 3 per lamb eaten': { confine: 1, lamb: 3 },
  'mobility + 3 per lamb eaten': { wolfMob: 1, lamb: 3 },
  'mobility + reachable + 3 per lamb eaten': { wolfMob: 1, confine: 1, lamb: 3 },
  'full engine evaluation (9 terms)': {},
};
const all = collectFrontier(n * 3);
// spread over lamb counts
let seed = 3; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const positions = all.sort(() => rand() - 0.5).slice(0, n);
console.log(`${positions.length} drawn wolf-to-move positions from the drawing frontier`);
console.log('strategy'.padEnd(46) + depths.map(d => ('depth ' + d).padStart(10)).join(''));
for (const [name, wts] of Object.entries(EVALS)) {
  if (only && !name.includes(only)) continue;
  const weights = Object.keys(wts).length ? Object.assign({}, zero, wts) : undefined;
  const cells = [];
  for (const d of depths) {
    let ok = 0;
    for (const { p, outs } of positions) {
      const r = AI.chooseMove(p, { depth: d, clearTT: true, weights, contempt: 0 });
      const o = outs.find(x => x.move === r.move);
      if (o && o.winner === TB.DRAW) ok++;
    }
    cells.push((100 * ok / positions.length).toFixed(1) + '%');
  }
  console.log(name.padEnd(46) + cells.map(c => c.padStart(10)).join(''));
}
