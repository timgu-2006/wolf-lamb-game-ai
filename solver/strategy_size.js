#!/usr/bin/env node
/*
 * How big is a complete perfect-play strategy for one side?
 *
 * Starting from the initial position, the chosen side always plays one fixed
 * value-preserving move (fastest win, else a draw, else slowest loss) while the
 * opponent may play anything. The set of positions reached is what that side
 * would need to memorise to play perfectly. Positions are counted up to symmetry
 * and without the no-capture clock (moves are chosen as with a fresh clock).
 *
 *   node solver/strategy_size.js wolf|lamb [maxStates] [perfect]
 *
 * With "perfect", the opponent is restricted to value-preserving moves as well:
 * the result is the set of positions two perfect players can reach, i.e. the
 * "book" needed to hold the result against a perfect opponent.
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const IX = require(path.join(__dirname, 'indexing.js'));

const side = process.argv[2] === 'lamb' ? B.LAMB : B.WOLF;
const maxStates = +(process.argv[3] || 5e6);
const perfectOpp = process.argv[4] === 'perfect';
const buf = new Int32Array(64);

function canonKey(p) { return B.popcount(p.lambs) * 1e12 + IX.canonIndex(B.popcount(p.lambs), p.wolves, p.lambs, p.side === B.WOLF ? 0 : 1); }

function ourMove(p) {
  // fastest win by D, else the first drawing move, else slowest loss: cheap, deterministic
  const outs = TB.outcomes(p, 0);
  const mover = p.side;
  let best = null, bestScore = -Infinity;
  for (const o of outs) {
    const sc = o.winner === mover ? 3e6 - (o.d !== undefined ? o.d : o.t) : o.winner === TB.DRAW ? 2e6 : 1e6 + (o.d !== undefined ? o.d : o.t);
    if (sc > bestScore) { bestScore = sc; best = o; }
  }
  return best ? best.move : null;
}

const start = B.initial();
const seen = new Set([canonKey(start)]);
let frontier = [start];
const perLayer = {};
let total = 1, depth = 0, capped = false;
perLayer[15] = 1;
while (frontier.length && !capped) {
  const next = [];
  for (const p of frontier) {
    if (B.popcount(p.lambs) < 4 || B.terminal(p) !== -1) continue;
    let moves = [];
    if (p.side === side) { const m = ourMove(p); if (m !== null) moves = [m]; }
    else if (perfectOpp) {
      const v = TB.lookup(p).winner;
      for (const o of TB.outcomes(p, 0)) if (o.winner === v) moves.push(o.move);
    }
    else { const n = B.genMoves(p, buf); for (let i = 0; i < n; i++) moves.push(buf[i]); }
    for (const m of moves) {
      const q = B.clone(p); B.makeMove(q, m);
      const k = canonKey(q);
      if (seen.has(k)) continue;
      seen.add(k); total++;
      const nl = B.popcount(q.lambs); perLayer[nl] = (perLayer[nl] || 0) + 1;
      next.push(q);
      if (total >= maxStates) { capped = true; break; }
    }
    if (capped) break;
  }
  frontier = next; depth++;
  if (depth % 10 === 0) console.error(`depth ${depth}: ${total} positions, frontier ${frontier.length}`);
}
console.log(`${side === B.WOLF ? 'WOLF' : 'LAMB'} strategy${perfectOpp ? ' against a perfect opponent' : ' against any opponent'}: ${total} positions${capped ? ' (capped)' : ''}, max depth ${depth} plies`);
console.log('by lamb count:', Object.entries(perLayer).sort((a, b) => b[0] - a[0]).map(([k, v]) => k + ':' + v).join('  '));
