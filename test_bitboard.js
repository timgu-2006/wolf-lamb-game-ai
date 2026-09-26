// Cross-checks bitboard.js against the reference engine.js. Run: node test_bitboard.js
const E = require('./engine.js');
const B = require('./bitboard.js');
const assert = require('assert');

let rng = 987654321;
const rand = () => (rng = (rng * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const buf = new Int32Array(64);

function moveSet(p) {
  const n = B.genMoves(p, buf);
  return Array.from(buf.subarray(0, n)).sort((a, b) => a - b);
}
function refMoveSet(s) {
  return E.legalMoves(s).map(B.fromEngineMove).sort((a, b) => a - b);
}

// 1. Initial position matches.
assert.strictEqual(B.key(B.initial()), B.key(B.fromState(E.initialState())));
assert.deepStrictEqual(moveSet(B.initial()), refMoveSet(E.initialState()));

// 2. Random playouts with the reference engine: at every position, move lists,
//    mobility and terminal status must agree; make/unmake must round-trip.
let positions = 0, games = 0, maxMoves = 0;
while (positions < 200000) {
  let s = E.initialState();
  games++;
  for (;;) {
    const p = B.fromState(s);
    const ref = refMoveSet(s);
    const got = moveSet(p);
    assert.deepStrictEqual(got, ref, 'move mismatch at\n' + E.toString(s));
    assert.strictEqual(B.mobility(p), ref.length);
    maxMoves = Math.max(maxMoves, ref.length);

    const r = E.result(s);
    const t = B.terminal(p);
    if (r && r.reason !== 'Threefold repetition') {
      assert.strictEqual(t, r.winner === null ? 0 : r.winner, 'terminal mismatch: ' + r.reason);
    } else if (!r) {
      assert.strictEqual(t, -1);
    }
    positions++;
    if (r) break;

    // make/unmake round trip on every legal move
    const k0 = B.key(p), c0 = p.clock;
    for (const m of got) {
      const undo = B.makeMove(p, m);
      const next = E.applyMove(s, B.toEngineMove(m));
      assert.strictEqual(B.key(p), B.key(B.fromState(next)));
      assert.strictEqual(p.clock, next.turnsSinceCapture);
      B.unmakeMove(p, m, undo);
      assert.strictEqual(B.key(p), k0);
      assert.strictEqual(p.clock, c0);
    }
    s = E.applyMove(s, B.toEngineMove(got[Math.floor(rand() * got.length)]));
  }
}
console.log(`cross-check ok: ${positions} positions over ${games} games, max moves in a position ${maxMoves}`);

// 2b. Uniformly random positions (any piece layout, any lamb count, either side).
{
  let checked = 0;
  for (let i = 0; i < 100000; i++) {
    const s = E.initialState();
    s.board.fill(E.EMPTY); s.repetitions = {}; s.moves = [];
    const cells = [...Array(25).keys()].sort(() => rand() - 0.5);
    const nl = Math.floor(rand() * 16);
    for (let k = 0; k < 3; k++) s.board[cells[k]] = E.WOLF;
    for (let k = 3; k < 3 + nl; k++) s.board[cells[k]] = E.LAMB;
    s.lambs = nl; s.side = rand() < 0.5 ? E.WOLF : E.LAMB;
    const p = B.fromState(s);
    assert.deepStrictEqual(moveSet(p), refMoveSet(s), 'random position mismatch\n' + E.toString(s));
    const r = E.result(s), t = B.terminal(p);
    assert.strictEqual(t, r ? (r.winner === null ? 0 : r.winner) : -1);
    checked++;
  }
  console.log(`random positions ok: ${checked}`);
}

// 3. threatenedLambs agrees with the wolf capture list.
{
  let s = E.initialState();
  for (let i = 0; i < 40 && !E.result(s); i++) {
    const ms = E.legalMoves(s); s = E.applyMove(s, ms[Math.floor(rand() * ms.length)]);
  }
  const p = B.fromState(s);
  p.side = B.WOLF;
  const n = B.genMoves(p, buf);
  let mask = 0;
  for (let i = 0; i < n; i++) if (B.moveIsCapture(buf[i])) mask |= 1 << B.moveTo(buf[i]);
  assert.strictEqual(B.threatenedLambs(p), mask);
}

// 4. Benchmark: random walk using only the bitboard core.
{
  const p = B.initial();
  const stack = [];
  let nodes = 0;
  const t0 = process.hrtime.bigint();
  const N_NODES = 5_000_000;
  while (nodes < N_NODES) {
    const n = B.genMoves(p, buf);
    nodes++;
    if (n === 0 || B.popcount(p.lambs) < 3 || stack.length > 200) {
      while (stack.length) { const [m, u] = stack.pop(); B.unmakeMove(p, m, u); }
      continue;
    }
    const m = buf[Math.floor(rand() * n)];
    stack.push([m, B.makeMove(p, m)]);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log(`benchmark: ${(nodes / ms * 1000 / 1e6).toFixed(2)} M nodes/s (gen + make + random walk)`);
}
console.log('ALL BITBOARD CHECKS PASSED');
