/*
 * Wolf and Lamb — search and evaluation.
 *
 * Negamax alpha-beta on bitboard.js with iterative deepening, a transposition
 * table, killer/history move ordering, path repetition detection and a small
 * capture-only quiescence for the wolf side.
 *
 * Scores are from the side to move's point of view. Wins are WIN - ply so the
 * search prefers faster wins and slower losses. Draws score -contempt for the
 * root side (default 150), so neither side settles for a draw in a level game.
 *
 *   chooseMove(position, { timeMs | depth, history, weights, onIteration })
 *     -> { move, score, depth, pv, nodes, timeMs }
 *   analyze(position, { timeMs | depth, history, weights, contempt, onIteration })
 *     -> { moves: [{ move, score, pv }, ...] sorted best first, depth, nodes, timeMs }
 *        every legal root move gets an exact score (multi-PV), for analysis GUIs
 *
 * `history` is an array of key() values of every earlier position in the game,
 * used for repetition detection. `weights` overrides evaluation weights.
 */
(function (root, factory) {
  const isNode = typeof module === 'object' && module.exports;
  const api = factory(isNode ? require('./bitboard.js') : root.Bitboard);
  api._source = factory.toString();
  if (isNode) module.exports = api; else root.WolfLambAI = api;
})(typeof self !== 'undefined' ? self : this, function aiFactory(B) {
  'use strict';

  const WOLF = B.WOLF, LAMB = B.LAMB, ALL = B.ALL;
  const popcount = B.popcount, up = B.up, down = B.down, left = B.left, right = B.right;
  const genMoves = B.genMoves, makeMove = B.makeMove, unmakeMove = B.unmakeMove;
  const mobility = B.mobility, threatenedLambs = B.threatenedLambs, terminal = B.terminal, key = B.key;

  const MAX_PLY = 64;
  const MOVES_PER_PLY = 64;
  const WIN = 30000;             // mate score at ply 0
  const MATE_BOUND = WIN - MAX_PLY;
  const INF = 32000;
  const MAX_QDEPTH = 4;

  // ---- evaluation --------------------------------------------------------
  const DEFAULT_WEIGHTS = {
    lamb: 100,        // per captured lamb
    threshold: 350,   // extra per lamb below 5 (steep near the 3-lamb limit)
    wolfMob: 28,      // per legal wolf move
    trapped: 250,     // wolves currently have zero moves (lamb to move)
    confine: 10,      // per empty cell reachable by wolves through empty cells
    threat: 55,       // per capturable lamb, wolf to move
    threatLamb: 20,   // per capturable lamb, lamb to move
    vulnerable: 14,   // per lamb with an open jump lane
    isolated: 18,     // per lamb with no lamb neighbour
    base: 500,        // subtracted so the start position scores near 0 (draw calibration)
  };
  let W = Object.assign({}, DEFAULT_WEIGHTS);

  /** Static evaluation from the side to move's perspective. */
  function evaluate(p) {
    const wolves = p.wolves, L = p.lambs;
    const empty = ALL & ~(wolves | L);
    const nl = popcount(L);
    let s = (15 - nl) * W.lamb - W.base;
    if (nl < 5) s += (5 - nl) * W.threshold;

    const wm = mobility(p, WOLF);
    s += wm * W.wolfMob;
    if (wm === 0) s -= W.trapped;

    // confinement: flood fill from wolves through empty cells
    let region = wolves, prev;
    do {
      prev = region;
      region |= (up(region) | down(region) | left(region) | right(region)) & empty;
    } while (region !== prev);
    s += popcount(region & empty) * W.confine;

    // lambs a wolf could capture on its next move
    s += popcount(threatenedLambs(p)) * (p.side === WOLF ? W.threat : W.threatLamb);

    // lamb structure: open jump lanes (empty cell on one side, non-lamb two away)
    const notLamb = ALL & ~L;
    const vul = L & (
      (down(empty) & down(down(notLamb))) |
      (up(empty) & up(up(notLamb))) |
      (right(empty) & right(right(notLamb))) |
      (left(empty) & left(left(notLamb))));
    s += popcount(vul) * W.vulnerable;

    // isolated lambs
    const iso = L & ~(up(L) | down(L) | left(L) | right(L));
    s += popcount(iso) * W.isolated;

    return p.side === WOLF ? s : -s;
  }

  // ---- search state (preallocated) ---------------------------------------
  const moveBuf = [];
  const scoreBuf = [];
  for (let i = 0; i < MAX_PLY + MAX_QDEPTH + 2; i++) {
    moveBuf.push(new Int32Array(MOVES_PER_PLY));
    scoreBuf.push(new Int32Array(MOVES_PER_PLY));
  }
  const killers = new Int32Array(MAX_PLY * 2);
  const histHeur = new Int32Array(2 * 1024);     // [side][from | to<<5]
  const path = new Float64Array(MAX_PLY + 512);  // game history keys + search path keys
  let pathLen = 0;

  const TT_BITS = 20, TT_SIZE = 1 << TT_BITS, TT_MASK = TT_SIZE - 1;
  const ttKey = new Float64Array(TT_SIZE);
  const ttMove = new Int16Array(TT_SIZE);
  const ttScore = new Int16Array(TT_SIZE);
  const ttDepth = new Int8Array(TT_SIZE);
  const ttFlag = new Int8Array(TT_SIZE);
  const EXACT = 1, LOWER = 2, UPPER = 3;

  function ttIndex(p) {
    const h = Math.imul(p.wolves, 0x9E3779B1) ^ Math.imul(p.lambs + 0x7F4A7C15, 0x85EBCA77) ^ (p.side * 0x27D4EB2F);
    return (h ^ (h >>> 15)) & TT_MASK;
  }
  function clearTT() { ttKey.fill(0); }

  let nodes = 0, stopTime = 0, stopped = false, useTime = false;
  let rootSide = WOLF, contempt = 150;
  // Draws are scored as slightly bad for the root side, so the AI does not grab a
  // repetition or move-limit draw merely because the static eval is against it.
  function drawScore(p) { return p.side === rootSide ? -contempt : contempt; }

  function scoreToTT(s, ply) { return s > MATE_BOUND ? s + ply : s < -MATE_BOUND ? s - ply : s; }
  function scoreFromTT(s, ply) { return s > MATE_BOUND ? s - ply : s < -MATE_BOUND ? s + ply : s; }

  function isRepetition(p, k) {
    // Only positions since the last capture can repeat; keys include side to move.
    const lim = pathLen - p.clock;
    for (let i = pathLen - 1; i >= lim && i >= 0; i--) if (path[i] === k) return true;
    return false;
  }

  // ---- quiescence: wolf captures only ------------------------------------
  function quiesce(p, alpha, beta, ply, qd) {
    nodes++;
    const t = terminal(p);
    if (t !== -1) return t === 0 ? drawScore(p) : (t === p.side ? WIN - ply : -(WIN - ply));
    const stand = evaluate(p);
    if (p.side !== WOLF || qd >= MAX_QDEPTH) return stand;
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const moves = moveBuf[ply];
    const n = genMoves(p, moves);
    let best = stand;
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      if (!(m & 1024)) break;                       // captures come first
      const undo = makeMove(p, m);
      const sc = -quiesce(p, -beta, -alpha, ply + 1, qd + 1);
      unmakeMove(p, m, undo);
      if (sc > best) { best = sc; if (sc > alpha) { alpha = sc; if (alpha >= beta) break; } }
    }
    return best;
  }

  // ---- main search -------------------------------------------------------
  function search(p, depth, alpha, beta, ply) {
    if (useTime && (nodes & 2047) === 0 && Date.now() >= stopTime) { stopped = true; return 0; }
    const t = terminal(p);
    if (t !== -1) { nodes++; return t === 0 ? drawScore(p) : (t === p.side ? WIN - ply : -(WIN - ply)); }
    const k = key(p);
    if (ply > 0 && isRepetition(p, k)) { nodes++; return drawScore(p); }
    if (depth <= 0) return quiesce(p, alpha, beta, ply, 0);
    nodes++;

    const alphaOrig = alpha;
    const ti = ttIndex(p);
    let hashMove = 0;
    if (ttKey[ti] === k) {
      hashMove = ttMove[ti];
      if (ttDepth[ti] >= depth) {
        const sc = scoreFromTT(ttScore[ti], ply), f = ttFlag[ti];
        if (f === EXACT) return sc;
        if (f === LOWER && sc > alpha) alpha = sc;
        else if (f === UPPER && sc < beta) beta = sc;
        if (alpha >= beta) return sc;
      }
    }

    const moves = moveBuf[ply], scores = scoreBuf[ply];
    const n = genMoves(p, moves);
    const k1 = killers[ply * 2], k2 = killers[ply * 2 + 1];
    const hbase = (p.side === WOLF ? 0 : 1024);
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      scores[i] = m === hashMove ? 1000000 : (m & 1024) ? 500000 : m === k1 ? 400000 : m === k2 ? 390000 : histHeur[hbase + (m & 1023)];
    }

    path[pathLen++] = k;
    let best = -INF, bestMove = 0;
    for (let i = 0; i < n; i++) {
      // selection: bring the best remaining move to slot i
      let bi = i;
      for (let j = i + 1; j < n; j++) if (scores[j] > scores[bi]) bi = j;
      if (bi !== i) {
        const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
        const ts = scores[i]; scores[i] = scores[bi]; scores[bi] = ts;
      }
      const m = moves[i];
      const undo = makeMove(p, m);
      const sc = -search(p, depth - 1, -beta, -alpha, ply + 1);
      unmakeMove(p, m, undo);
      if (stopped) { pathLen--; return 0; }
      if (sc > best) {
        best = sc; bestMove = m;
        if (sc > alpha) {
          alpha = sc;
          if (alpha >= beta) {
            if (!(m & 1024)) {
              if (killers[ply * 2] !== m) { killers[ply * 2 + 1] = killers[ply * 2]; killers[ply * 2] = m; }
              histHeur[hbase + (m & 1023)] += depth * depth;
            }
            break;
          }
        }
      }
    }
    pathLen--;

    ttKey[ti] = k; ttMove[ti] = bestMove; ttDepth[ti] = depth;
    ttScore[ti] = scoreToTT(best, ply);
    ttFlag[ti] = best <= alphaOrig ? UPPER : best >= beta ? LOWER : EXACT;
    return best;
  }

  /** Root search: returns { move, score } or null if stopped before finishing. */
  function searchRoot(p, depth, prevBest) {
    const moves = moveBuf[0], scores = scoreBuf[0];
    const n = genMoves(p, moves);
    const k = key(p);
    const ti = ttIndex(p);
    const hashMove = ttKey[ti] === k ? ttMove[ti] : 0;
    for (let i = 0; i < n; i++) {
      const m = moves[i];
      scores[i] = m === prevBest ? 2000000 : m === hashMove ? 1000000 : (m & 1024) ? 500000 : histHeur[(p.side === WOLF ? 0 : 1024) + (m & 1023)];
    }
    path[pathLen++] = k;
    let alpha = -INF, best = -INF, bestMove = 0;
    for (let i = 0; i < n; i++) {
      let bi = i;
      for (let j = i + 1; j < n; j++) if (scores[j] > scores[bi]) bi = j;
      if (bi !== i) {
        const tm = moves[i]; moves[i] = moves[bi]; moves[bi] = tm;
        const ts = scores[i]; scores[i] = scores[bi]; scores[bi] = ts;
      }
      const m = moves[i];
      const undo = makeMove(p, m);
      const sc = -search(p, depth - 1, -INF, -alpha, 1);
      unmakeMove(p, m, undo);
      if (stopped) { pathLen--; return null; }
      if (sc > best) { best = sc; bestMove = m; if (sc > alpha) alpha = sc; }
    }
    pathLen--;
    ttKey[ti] = k; ttMove[ti] = bestMove; ttDepth[ti] = depth; ttScore[ti] = scoreToTT(best, 0); ttFlag[ti] = EXACT;
    return { move: bestMove, score: best };
  }

  /** Principal variation from the transposition table, verified for legality. */
  function extractPV(p, maxLen) {
    const pv = [], undos = [];
    const buf = new Int32Array(MOVES_PER_PLY);
    for (let i = 0; i < maxLen; i++) {
      const ti = ttIndex(p);
      if (ttKey[ti] !== key(p) || !ttMove[ti]) break;
      const m = ttMove[ti];
      const n = genMoves(p, buf);
      let legal = false;
      for (let j = 0; j < n; j++) if (buf[j] === m) { legal = true; break; }
      if (!legal) break;
      pv.push(m); undos.push(makeMove(p, m));
      if (terminal(p) !== -1) break;
    }
    for (let i = pv.length - 1; i >= 0; i--) unmakeMove(p, pv[i], undos[i]);
    return pv;
  }

  function chooseMove(p0, opts) {
    opts = opts || {};
    const p = B.clone(p0);
    W = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
    rootSide = p.side;
    contempt = opts.contempt != null ? opts.contempt : 150;
    const maxDepth = opts.depth || MAX_PLY - 1;
    useTime = !!opts.timeMs && !opts.depth;
    const t0 = Date.now();
    stopTime = t0 + (opts.timeMs || 0);
    nodes = 0;
    killers.fill(0); histHeur.fill(0);
    if (opts.clearTT) clearTT();

    const history = opts.history || [];
    pathLen = 0;
    for (let i = Math.max(0, history.length - 256); i < history.length; i++) path[pathLen++] = history[i];

    let result = null;
    for (let depth = 1; depth <= maxDepth; depth++) {
      stopped = false;
      const r = searchRoot(p, depth, result ? result.move : 0);
      if (!r) break;
      result = { move: r.move, score: r.score, depth, pv: extractPV(p, depth), nodes, timeMs: Date.now() - t0 };
      if (opts.onIteration) opts.onIteration(result);
      if (Math.abs(r.score) > MATE_BOUND) break;   // forced result found
      if (useTime && Date.now() - t0 > (opts.timeMs) * 0.5) break; // next iteration unlikely to finish
    }
    if (result) { result.nodes = nodes; result.timeMs = Date.now() - t0; }
    return result;
  }

  // ---- multi-PV analysis -------------------------------------------------
  // Like chooseMove, but every root move is searched to an exact score at each
  // depth (aspiration window around its previous score, full-window re-search on
  // failure). Draws default to 0 here: analysis should be neutral.
  function analyze(p0, opts) {
    opts = opts || {};
    const p = B.clone(p0);
    W = Object.assign({}, DEFAULT_WEIGHTS, opts.weights || {});
    rootSide = p.side;
    contempt = opts.contempt != null ? opts.contempt : 0;
    const maxDepth = opts.depth || MAX_PLY - 1;
    useTime = !!opts.timeMs;
    const t0 = Date.now();
    stopTime = t0 + (opts.timeMs || 0);
    nodes = 0;
    killers.fill(0); histHeur.fill(0);
    if (opts.clearTT) clearTT();

    const history = opts.history || [];
    pathLen = 0;
    for (let i = Math.max(0, history.length - 256); i < history.length; i++) path[pathLen++] = history[i];

    const buf = new Int32Array(MOVES_PER_PLY);
    const n = terminal(p) === -1 ? genMoves(p, buf) : 0;
    let entries = [];
    for (let i = 0; i < n; i++) entries.push({ move: buf[i], score: 0, pv: [buf[i]] });
    let result = { moves: entries.slice(), depth: 0, nodes: 0, timeMs: 0 };
    if (n === 0) return result;

    path[pathLen++] = key(p);
    const ASP = 60;
    for (let depth = 1; depth <= maxDepth; depth++) {
      stopped = false;
      const cur = [];
      let complete = true;
      for (let i = 0; i < entries.length; i++) {
        const m = entries[i].move, prev = entries[i].score;
        const undo = makeMove(p, m);
        let sc;
        if (depth > 1 && Math.abs(prev) < MATE_BOUND) {
          const lo = prev - ASP, hi = prev + ASP;
          sc = -search(p, depth - 1, -hi, -lo, 1);
          if (!stopped && (sc <= lo || sc >= hi)) sc = -search(p, depth - 1, -INF, INF, 1);
        } else {
          sc = -search(p, depth - 1, -INF, INF, 1);
        }
        const pv = stopped ? null : [m].concat(extractPV(p, depth));
        unmakeMove(p, m, undo);
        if (stopped) { complete = false; break; }
        cur.push({ move: m, score: sc, pv });
      }
      if (!complete) break;
      cur.sort((a, b) => b.score - a.score);
      entries = cur;
      result = { moves: entries.map(e => ({ move: e.move, score: e.score, pv: e.pv.slice() })), depth, nodes, timeMs: Date.now() - t0 };
      if (opts.onIteration) opts.onIteration(result);
      if (entries.every(e => Math.abs(e.score) > MATE_BOUND)) break;   // every move is decided
      if (useTime && Date.now() - t0 > opts.timeMs * 0.5) break;
    }
    pathLen--;
    result.nodes = nodes; result.timeMs = Date.now() - t0;
    return result;
  }

  function scoreToString(sc) {
    if (sc > MATE_BOUND) return 'win in ' + (WIN - sc);
    if (sc < -MATE_BOUND) return 'loss in ' + (WIN + sc);
    return (sc > 0 ? '+' : '') + (sc / 100).toFixed(2);
  }

  return { chooseMove, analyze, evaluate, clearTT, DEFAULT_WEIGHTS, WIN, MATE_BOUND, scoreToString, extractPV };
});
