#!/usr/bin/env node
/*
 * Spot check: compare table values with a brute-force bounded search that uses
 * only engine.js (the reference rules). For random states whose table value is
 * a win with small T, the brute force must find the same forced result in
 * exactly T plies; for drawn states it must find no win for either side within
 * the search depth. Run: node solver/spotcheck.js [samples] [maxDepth]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const IX = require(path.join(__dirname, 'indexing.js'));

const samples = +(process.argv[2] || 3000), maxDepth = +(process.argv[3] || 6);
let seed = 4242; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

function toState(p) {
  const s = E.initialState(); s.board.fill(E.EMPTY); s.repetitions = {}; s.moves = [];
  for (let i = 0; i < 25; i++) { if (p.wolves & (1 << i)) s.board[i] = E.WOLF; else if (p.lambs & (1 << i)) s.board[i] = E.LAMB; }
  s.lambs = B.popcount(p.lambs); s.side = p.side; s.turnsSinceCapture = 0;
  return s;
}

// canWin(s, X, n): can X force, within n plies, a capture into a state whose
// TABLE value is an X win, or a terminal X win? (This is exactly the T_X
// definition, using the lower layer through the tables and pure search within
// the layer, so it tests the layer being sampled against the reference rules.)
function canWin(s, X, n) {
  const r = E.result(s);
  if (r) return r.reason.startsWith('Wolves have no') || r.reason.startsWith('Lambs have no') ? r.winner === X : false;
  if (n === 0) return false;
  const moves = E.legalMoves(s);
  if (s.side === X) {
    for (const m of moves) {
      const t = E.applyMove(s, m);
      if (m.capture !== null) { if (TB.lookup(B.fromState(t)).winner === X) return true; }
      else if (canWin(t, X, n - 1)) return true;
    }
    return false;
  }
  for (const m of moves) {
    const t = E.applyMove(s, m);
    if (m.capture !== null) { if (TB.lookup(B.fromState(t)).winner !== X) return false; }
    else if (!canWin(t, X, n - 1)) return false;
  }
  return true;
}

let checked = 0, wins = 0, draws = 0, errors = 0;
const byLayer = {};
while (checked < samples) {
  const k = 4 + Math.floor(rand() * 12);
  const cells = [...Array(25).keys()].sort(() => rand() - 0.5);
  let w = 0, l = 0;
  for (let i = 0; i < 3; i++) w |= 1 << cells[i];
  for (let i = 3; i < 3 + k; i++) l |= 1 << cells[i];
  const p = { wolves: w, lambs: l, side: rand() < 0.5 ? B.WOLF : B.LAMB, clock: 0 };
  const v = TB.lookup(p);
  if (v.winner !== TB.DRAW && v.t > maxDepth) continue;   // too deep to brute force
  const s = toState(p);
  let ok;
  if (v.winner === TB.DRAW) {
    ok = !canWin(s, E.WOLF, maxDepth) && !canWin(s, E.LAMB, maxDepth);
    draws++;
  } else {
    const X = v.winner, Y = 3 - X;
    ok = canWin(s, X, v.t) && (v.t === 0 || !canWin(s, X, v.t - 1)) && !canWin(s, Y, maxDepth);
    wins++;
  }
  byLayer[k] = (byLayer[k] || 0) + 1;
  if (!ok) { errors++; if (errors <= 5) console.log('MISMATCH', v, '\n' + E.toString(s)); }
  checked++;
}
console.log(`spot check: ${checked} random states (${wins} wins with T <= ${maxDepth}, ${draws} draws checked to depth ${maxDepth}), errors ${errors}`);
console.log('by layer:', byLayer);
process.exit(errors ? 1 : 0);
