/*
 * Wolf and Lamb — rules engine.
 * Pure, dependency-free. Works in the browser (global `WolfLamb`) and in Node (module.exports).
 * Implements SPEC.md v1.0.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WolfLamb = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const N = 5;
  const EMPTY = 0, WOLF = 1, LAMB = 2;
  const MIN_LAMBS = 3;          // fewer than this -> wolves can never be trapped
  const MOVE_LIMIT = 100;       // turns without a capture -> draw
  const REPETITION_LIMIT = 3;   // same position + side to move -> draw

  // ---- coordinates -------------------------------------------------------
  // Internal index i = (row-1)*5 + (col-1), rows/cols 1-indexed as in SPEC.md.
  function idx(r, c) { return (r - 1) * N + (c - 1); }
  function rc(i) { return [Math.floor(i / N) + 1, (i % N) + 1]; }
  function onBoard(r, c) { return r >= 1 && r <= N && c >= 1 && c <= N; }
  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  // ---- state -------------------------------------------------------------
  function initialState() {
    const board = new Array(N * N).fill(EMPTY);
    board[idx(1, 2)] = WOLF; board[idx(1, 3)] = WOLF; board[idx(1, 4)] = WOLF;
    for (let r = 3; r <= N; r++) for (let c = 1; c <= N; c++) board[idx(r, c)] = LAMB;
    const s = {
      board,
      side: WOLF,             // side to move
      lambs: 15,
      turnsSinceCapture: 0,
      repetitions: {},        // positionKey -> count
      moves: [],              // history of applied moves
    };
    s.repetitions[positionKey(s)] = 1;
    return s;
  }

  function cloneState(s) {
    return {
      board: s.board.slice(),
      side: s.side,
      lambs: s.lambs,
      turnsSinceCapture: s.turnsSinceCapture,
      repetitions: Object.assign({}, s.repetitions),
      moves: s.moves.slice(),
    };
  }

  function positionKey(s) { return s.board.join('') + s.side; }

  // ---- move generation ---------------------------------------------------
  // A move is { from, to, capture } with indices; capture is the index of the
  // captured lamb (equal to `to` for wolves) or null.
  function legalMoves(s) {
    const out = [];
    const b = s.board;
    for (let i = 0; i < N * N; i++) {
      if (b[i] !== s.side) continue;
      const [r, c] = rc(i);
      for (const [dr, dc] of DIRS) {
        const r1 = r + dr, c1 = c + dc;
        if (!onBoard(r1, c1)) continue;
        const j = idx(r1, c1);
        if (b[j] !== EMPTY) continue;          // blocked: no step and no jump
        out.push({ from: i, to: j, capture: null });
        if (s.side === WOLF) {
          const r2 = r + 2 * dr, c2 = c + 2 * dc;
          if (onBoard(r2, c2)) {
            const k = idx(r2, c2);
            if (b[k] === LAMB) out.push({ from: i, to: k, capture: k });
          }
        }
      }
    }
    return out;
  }

  function sameMove(a, b) { return a.from === b.from && a.to === b.to && a.capture === b.capture; }

  function isLegal(s, m) { return legalMoves(s).some(x => sameMove(x, m)); }

  // ---- applying moves ----------------------------------------------------
  function applyMove(s, m) {
    if (!isLegal(s, m)) throw new Error('Illegal move ' + describeMove(m));
    const t = cloneState(s);
    const piece = t.board[m.from];
    t.board[m.from] = EMPTY;
    t.board[m.to] = piece;
    if (m.capture !== null) {
      t.lambs -= 1;
      t.turnsSinceCapture = 0;
    } else {
      t.turnsSinceCapture += 1;
    }
    t.side = s.side === WOLF ? LAMB : WOLF;
    t.moves.push(m);
    const k = positionKey(t);
    t.repetitions[k] = (t.repetitions[k] || 0) + 1;
    return t;
  }

  // ---- result ------------------------------------------------------------
  // Returns null while the game is running, else { winner: WOLF|LAMB|null, reason }.
  function result(s) {
    if (s.lambs === 0) return { winner: WOLF, reason: 'All lambs captured' };
    if (s.lambs < MIN_LAMBS) return { winner: WOLF, reason: 'Fewer than ' + MIN_LAMBS + ' lambs remain' };
    if (legalMoves(s).length === 0) {
      return s.side === WOLF
        ? { winner: LAMB, reason: 'Wolves have no legal move' }
        : { winner: WOLF, reason: 'Lambs have no legal move' };
    }
    if ((s.repetitions[positionKey(s)] || 0) >= REPETITION_LIMIT) return { winner: null, reason: 'Threefold repetition' };
    if (s.turnsSinceCapture >= MOVE_LIMIT) return { winner: null, reason: MOVE_LIMIT + ' turns without a capture' };
    return null;
  }

  // ---- helpers -----------------------------------------------------------
  function cellName(i) { const [r, c] = rc(i); return '(' + r + ',' + c + ')'; }
  function describeMove(m) {
    return m.capture !== null ? cellName(m.from) + ' x ' + cellName(m.to) : cellName(m.from) + ' -> ' + cellName(m.to);
  }
  function sideName(side) { return side === WOLF ? 'Wolf' : 'Lamb'; }

  function toString(s) {
    let out = '';
    for (let r = 1; r <= N; r++) {
      let line = '';
      for (let c = 1; c <= N; c++) {
        const v = s.board[idx(r, c)];
        line += (v === WOLF ? 'W' : v === LAMB ? 'L' : '.') + ' ';
      }
      out += line.trim() + '\n';
    }
    return out;
  }

  return {
    N, EMPTY, WOLF, LAMB, MIN_LAMBS, MOVE_LIMIT, REPETITION_LIMIT,
    idx, rc, initialState, cloneState, legalMoves, isLegal, applyMove, result,
    positionKey, cellName, describeMove, sideName, toString,
  };
});
