// Run with: node test.js
const E = require('./engine.js');
const assert = require('assert');
const I = E.idx;

function custom(cells, side, lambs) {
  const t = E.initialState();
  t.board.fill(E.EMPTY);
  for (const [r, c, v] of cells) t.board[I(r, c)] = v;
  t.side = side; t.lambs = lambs; t.repetitions = {}; t.moves = [];
  return t;
}

// Start position: 5 steps + 3 captures, game running.
let s = E.initialState();
let m = E.legalMoves(s);
assert.strictEqual(m.length, 8);
assert.strictEqual(m.filter(x => x.capture !== null).length, 3);
assert.strictEqual(E.result(s), null);

// Capture: wolf lands on the lamb's cell, lamb count drops, side flips.
s = E.applyMove(s, { from: I(1, 3), to: I(3, 3), capture: I(3, 3) });
assert.strictEqual(s.board[I(3, 3)], E.WOLF);
assert.strictEqual(s.board[I(1, 3)], E.EMPTY);
assert.strictEqual(s.lambs, 14);
assert.strictEqual(s.side, E.LAMB);
assert.strictEqual(s.turnsSinceCapture, 0);

// Lambs only step, never capture.
m = E.legalMoves(s);
assert.ok(m.every(x => x.capture === null && s.board[x.from] === E.LAMB));

// Illegal move rejected.
assert.throws(() => E.applyMove(s, { from: I(3, 2), to: I(1, 2), capture: null }));

// Trap: 3 wolves in a corner L blocked by 3 lambs -> lambs win on wolves' turn.
let t = custom([[1,1,E.WOLF],[1,2,E.WOLF],[2,1,E.WOLF],[1,3,E.LAMB],[2,2,E.LAMB],[3,1,E.LAMB]], E.WOLF, 3);
assert.strictEqual(E.result(t).winner, E.LAMB);
t.side = E.LAMB;
assert.strictEqual(E.result(t), null);

// Threshold: fewer than 3 lambs -> wolves win.
t = custom([[3,3,E.WOLF],[1,1,E.WOLF],[5,5,E.WOLF],[1,5,E.LAMB],[5,1,E.LAMB]], E.LAMB, 2);
assert.strictEqual(E.result(t).winner, E.WOLF);

// Lambs with no move -> wolves win.
t = custom([[1,1,E.LAMB],[1,2,E.WOLF],[2,1,E.WOLF],[2,2,E.LAMB],[1,3,E.LAMB],[3,1,E.LAMB],[2,3,E.LAMB],[3,2,E.LAMB]], E.LAMB, 6);
// Fill the rest with lambs so nothing can move.
for (let i = 0; i < 25; i++) if (t.board[i] === E.EMPTY) t.board[i] = E.LAMB;
t.lambs = 23;
assert.strictEqual(E.legalMoves(t).length, 0);
assert.strictEqual(E.result(t).winner, E.WOLF);

// Threefold repetition.
s = E.initialState();
const seq = [[I(1,2),I(1,1)],[I(3,1),I(2,1)],[I(1,1),I(1,2)],[I(2,1),I(3,1)],
             [I(1,2),I(1,1)],[I(3,1),I(2,1)],[I(1,1),I(1,2)],[I(2,1),I(3,1)]];
for (const [from, to] of seq) s = E.applyMove(s, { from, to, capture: null });
assert.strictEqual(E.result(s).reason, 'Threefold repetition');

// Random playouts always terminate.
let rng = 12345; const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const outcomes = { wolf: 0, lamb: 0, draw: 0 };
for (let g = 0; g < 300; g++) {
  let st = E.initialState(); let n = 0;
  while (!E.result(st)) { const ms = E.legalMoves(st); st = E.applyMove(st, ms[Math.floor(rand() * ms.length)]); assert.ok(++n < 2000); }
  const r = E.result(st); outcomes[r.winner === E.WOLF ? 'wolf' : r.winner === E.LAMB ? 'lamb' : 'draw']++;
}
console.log('random playouts:', outcomes);
console.log('ALL ENGINE CHECKS PASSED');
