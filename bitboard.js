/*
 * Wolf and Lamb — fast bitboard core for search.
 *
 * Board cells are numbered 0..24, cell = (row-1)*5 + (col-1), same as engine.js.
 * A side's pieces are one 25-bit mask (bit i set = piece on cell i).
 *
 * Position: { wolves, lambs, side, clock }
 *   wolves, lambs : 25-bit masks
 *   side          : WOLF (1) or LAMB (2), side to move
 *   clock         : turns since the last capture (for the 100-turn draw rule)
 *
 * Move: a small integer  from | to << 5 | capture << 10   (capture is 0/1;
 * a captured lamb always sits on `to`).
 *
 * Move generation fills a caller-supplied Int32Array and returns the count.
 * makeMove/unmakeMove mutate the position in place; unmake takes the undo value
 * makeMove returned. No allocation happens on the hot path.
 *
 * Repetition draws are the search's job (it owns the path); this core only
 * tracks the no-capture clock.
 */
(function (root, factory) {
  const api = factory();
  api._source = factory.toString();   // lets index.html build a Web Worker from file://
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bitboard = api;
})(typeof self !== 'undefined' ? self : this, function bitboardFactory() {
  'use strict';

  const N = 5;
  const WOLF = 1, LAMB = 2;
  const MIN_LAMBS = 4;
  const MOVE_LIMIT = 100;
  const ALL = (1 << 25) - 1;

  // Column masks, to stop horizontal shifts wrapping between rows.
  let COL1 = 0, COL5 = 0;
  for (let r = 0; r < N; r++) { COL1 |= 1 << (r * N); COL5 |= 1 << (r * N + 4); }
  const NOT_COL1 = ALL & ~COL1;
  const NOT_COL5 = ALL & ~COL5;

  // ---- bit utilities -----------------------------------------------------
  function popcount(x) {
    x = x - ((x >>> 1) & 0x55555555);
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
    return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
  }
  function lsb(x) { return 31 - Math.clz32(x & -x); }

  // ---- moves -------------------------------------------------------------
  function move(from, to, capture) { return from | (to << 5) | (capture << 10); }
  function moveFrom(m) { return m & 31; }
  function moveTo(m) { return (m >>> 5) & 31; }
  function moveIsCapture(m) { return (m >>> 10) & 1; }

  // Shift a set of pieces one step in each direction, masked to the board.
  function up(b) { return b >>> N; }
  function down(b) { return (b << N) & ALL; }
  function left(b) { return (b >>> 1) & NOT_COL5; }
  function right(b) { return (b << 1) & NOT_COL1; }

  /**
   * Generate all legal moves for the side to move into `out` (Int32Array of
   * length >= 64). Captures are emitted first, which helps move ordering.
   * Returns the number of moves written.
   */
  function genMoves(p, out) {
    const empty = ALL & ~(p.wolves | p.lambs);
    let n = 0, b, t;

    if (p.side === WOLF) {
      const w = p.wolves, L = p.lambs;
      // captures: wolf -> empty -> lamb, all in one direction
      b = up(up(w) & empty) & L;      while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + 2 * N, t, 1); }
      b = down(down(w) & empty) & L;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - 2 * N, t, 1); }
      b = left(left(w) & empty) & L;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + 2, t, 1); }
      b = right(right(w) & empty) & L; while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - 2, t, 1); }
      // steps
      b = up(w) & empty;    while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + N, t, 0); }
      b = down(w) & empty;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - N, t, 0); }
      b = left(w) & empty;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + 1, t, 0); }
      b = right(w) & empty; while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - 1, t, 0); }
    } else {
      const L = p.lambs;
      b = up(L) & empty;    while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + N, t, 0); }
      b = down(L) & empty;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - N, t, 0); }
      b = left(L) & empty;  while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t + 1, t, 0); }
      b = right(L) & empty; while (b) { t = lsb(b); b &= b - 1; out[n++] = move(t - 1, t, 0); }
    }
    return n;
  }

  /** Number of legal moves for `side` (defaults to side to move) without listing them. */
  function mobility(p, side) {
    side = side || p.side;
    const empty = ALL & ~(p.wolves | p.lambs);
    if (side === WOLF) {
      const w = p.wolves, L = p.lambs;
      return popcount(up(w) & empty) + popcount(down(w) & empty) +
             popcount(left(w) & empty) + popcount(right(w) & empty) +
             popcount(up(up(w) & empty) & L) + popcount(down(down(w) & empty) & L) +
             popcount(left(left(w) & empty) & L) + popcount(right(right(w) & empty) & L);
    }
    const L = p.lambs;
    return popcount(up(L) & empty) + popcount(down(L) & empty) +
           popcount(left(L) & empty) + popcount(right(L) & empty);
  }

  /** Mask of lambs a wolf could capture right now (regardless of side to move). */
  function threatenedLambs(p) {
    const empty = ALL & ~(p.wolves | p.lambs);
    const w = p.wolves, L = p.lambs;
    return (up(up(w) & empty) | down(down(w) & empty) | left(left(w) & empty) | right(right(w) & empty)) & L;
  }

  // ---- make / unmake -----------------------------------------------------
  /** Apply `m` in place. Returns an undo token for unmakeMove. */
  function makeMove(p, m) {
    const from = m & 31, to = (m >>> 5) & 31;
    const undo = p.clock;                       // the only non-derivable state
    if (p.side === WOLF) {
      p.wolves ^= (1 << from) | (1 << to);
      if (m & 1024) { p.lambs &= ~(1 << to); p.clock = 0; } else p.clock++;
      p.side = LAMB;
    } else {
      p.lambs ^= (1 << from) | (1 << to);
      p.clock++;
      p.side = WOLF;
    }
    return undo;
  }

  function unmakeMove(p, m, undo) {
    const from = m & 31, to = (m >>> 5) & 31;
    if (p.side === LAMB) {                      // a wolf move is being undone
      p.wolves ^= (1 << from) | (1 << to);
      if (m & 1024) p.lambs |= 1 << to;
      p.side = WOLF;
    } else {
      p.lambs ^= (1 << from) | (1 << to);
      p.side = LAMB;
    }
    p.clock = undo;
  }

  // ---- terminal detection ------------------------------------------------
  /**
   * Returns WOLF or LAMB if that side has won, 0 for a draw by the move-limit
   * rule, or -1 if the game is still running. Repetition is not checked here.
   */
  function terminal(p) {
    const nl = popcount(p.lambs);
    if (nl < MIN_LAMBS) return WOLF;            // covers nl === 0 too
    if (mobility(p) === 0) return p.side === WOLF ? LAMB : WOLF;
    if (p.clock >= MOVE_LIMIT) return 0;
    return -1;
  }

  // ---- keys and conversion -----------------------------------------------
  /** Exact 51-bit position key (wolves, lambs, side) as a safe integer. */
  function key(p) { return p.wolves * 67108864 + p.lambs * 2 + (p.side === WOLF ? 1 : 0); }

  function initial() {
    let lambs = 0;
    for (let i = 10; i < 25; i++) lambs |= 1 << i;
    return { wolves: (1 << 1) | (1 << 2) | (1 << 3), lambs, side: WOLF, clock: 0 };
  }

  function clone(p) { return { wolves: p.wolves, lambs: p.lambs, side: p.side, clock: p.clock }; }

  /** Build from an engine.js state. */
  function fromState(s) {
    let wolves = 0, lambs = 0;
    for (let i = 0; i < 25; i++) {
      if (s.board[i] === WOLF) wolves |= 1 << i;
      else if (s.board[i] === LAMB) lambs |= 1 << i;
    }
    return { wolves, lambs, side: s.side, clock: s.turnsSinceCapture };
  }

  /** Convert an engine.js move object to a packed move, and back. */
  function fromEngineMove(m) { return move(m.from, m.to, m.capture === null ? 0 : 1); }
  function toEngineMove(m) { return { from: moveFrom(m), to: moveTo(m), capture: moveIsCapture(m) ? moveTo(m) : null }; }

  function toString(p) {
    let out = '';
    for (let r = 0; r < N; r++) {
      const row = [];
      for (let c = 0; c < N; c++) {
        const bit = 1 << (r * N + c);
        row.push(p.wolves & bit ? 'W' : p.lambs & bit ? 'L' : '.');
      }
      out += row.join(' ') + '\n';
    }
    return out;
  }

  return {
    N, WOLF, LAMB, MIN_LAMBS, MOVE_LIMIT, ALL,
    popcount, lsb, up, down, left, right,
    move, moveFrom, moveTo, moveIsCapture,
    genMoves, mobility, threatenedLambs, makeMove, unmakeMove, terminal,
    key, initial, clone, fromState, fromEngineMove, toEngineMove, toString,
  };
});
