/*
 * Read access to the solved tables (solver/tables/layer_<k>.bin) from Node.
 *
 *   const TB = require('./solver/tables.js');
 *   TB.lookup(position)          -> { winner, t, d, s } for a bitboard.js position (fresh clock):
 *                                   t = plies to the winner's next capture or the end (solve.c),
 *                                   d = plies to the end of the game with best play (dist.c),
 *                                   s = capture-free plies the d-optimal strategy may need (dist.c);
 *                                   d and s are undefined when the distance tables are absent
 *   TB.value(position, clock)    -> same with the clock applied: a win that does not fit in the
 *                                   remaining clock becomes a draw; dExact says whether d is exact
 *                                   under the 100-turn rule (s <= 100 - clock)
 *   TB.bestMoves(position, clock, {depth})
 *                                -> every legal move with its exact outcome for the mover, best first:
 *                                   fastest win; else the draw (or, if lost, the move) after which a
 *                                   modelled opponent is most likely to throw away value within
 *                                   `depth` of their moves; then slowest loss
 *
 * Entries are read with positional reads (pread), so no table is loaded into
 * memory; a lookup costs one small read. The indexing is solver/indexing.js.
 * Environment: WL_TABLES (directory), WL_CLOCK (default 100).
 */
const fs = require('fs');
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const IX = require(path.join(__dirname, 'indexing.js'));

const WOLF = 1, LAMB = 2, DRAW = 3, CLOCK = +(process.env.WL_CLOCK || 100);
const TABLES = process.env.WL_TABLES ? path.resolve(process.env.WL_TABLES) : path.join(__dirname, 'tables');
const fds = new Map();
const two = Buffer.alloc(2);

function fdOf(name, k) {
  const key = name + k;
  if (fds.has(key)) return fds.get(key);
  const file = path.join(TABLES, `${name}_${k}.bin`);
  let h = null;
  try {
    const st = fs.statSync(file);
    if (st.size !== IX.layerSize(k) * 2) throw new Error(`${file}: unexpected size ${st.size}`);
    h = fs.openSync(file, 'r');
  } catch (e) { if (name === 'layer') throw e; }
  fds.set(key, h);
  return h;
}
function fd(k) { return fdOf('layer', k); }
function read16(h, idx) { if (fs.readSync(h, two, 0, 2, idx * 2) !== 2) throw new Error('short read'); return two.readUInt16LE(0); }

function available() {
  try { for (let k = 4; k <= 15; k++) fd(k); return true; } catch (e) { return false; }
}

function lookup(p) {
  const k = B.popcount(p.lambs);
  if (k < 4) return { winner: WOLF, t: 0, d: 0, s: 0 };
  const idx = IX.canonIndex(k, p.wolves, p.lambs, p.side === WOLF ? 0 : 1);
  const v = read16(fd(k), idx);
  const r = { winner: v >>> 14, t: v & 0x3fff };
  const hd = fdOf('dist', k), hs = fdOf('seg', k);
  if (hd && hs && r.winner !== DRAW) { r.d = read16(hd, idx); r.s = read16(hs, idx); }
  return r;
}

/* value of a position that already has `clock` plies on the no-capture counter */
function value(p, clock) {
  clock = clock || 0;
  const r = lookup(p);
  if (r.winner !== DRAW && r.t + clock > CLOCK) return { winner: DRAW, t: 0 };
  if (r.winner !== DRAW && r.d !== undefined) r.dExact = r.s + clock <= CLOCK;
  return r;
}

/* Exact outcome of each legal move for the mover, without reply statistics. */
function outcomes(p, clock) {
  clock = clock || 0;
  const buf = new Int32Array(64);
  const n = B.genMoves(p, buf);
  const out = [];
  for (let i = 0; i < n; i++) {
    const m = buf[i];
    const undo = B.makeMove(p, m);
    const cap = B.moveIsCapture(m);
    const r = lookup(p);
    B.unmakeMove(p, m, undo);
    let winner = r.winner, t = r.t, d, dExact;
    if (winner !== DRAW) {
      if (!cap && t + 1 + clock > CLOCK) { winner = DRAW; t = 0; }   // does not fit in the clock
      else {
        t = t + 1;
        if (r.d !== undefined) { d = r.d + 1; dExact = r.s + (cap ? 0 : clock + 1) <= CLOCK; }
      }
    }
    out.push({ move: m, winner, t, d, dExact, capture: cap });
  }
  return out;
}

/* How the opponent's replies after move o are valued for the opponent:
 * { n, oppWins, draws, oppLoses }, or null when the move ends the game. */
function replies(p, o) {
  const undo = B.makeMove(p, o.move);
  let r = null;
  if (B.popcount(p.lambs) >= 4 && B.terminal(p) === -1) {
    r = { n: 0, oppWins: 0, draws: 0, oppLoses: 0 };
    for (const x of outcomes(p, p.clock)) { r.n++; if (x.winner === DRAW) r.draws++; else if (x.winner === p.side) r.oppWins++; else r.oppLoses++; }
  }
  B.unmakeMove(p, o.move, undo);
  return r;
}

/* fraction of the opponent's replies that lose for the opponent (the "trap" value of a move) */
function trap(o) { return o.replies && o.replies.n ? o.replies.oppLoses / o.replies.n : 0; }

/* ---- opponent model ------------------------------------------------------
 * How a realistic (not perfect, not uniformly random) opponent chooses among
 * their legal replies. Weights are relative probabilities. Wolves love
 * captures; lambs rescue threatened lambs, avoid hanging lambs, and like to
 * squeeze the wolves. The weights are deliberately simple and exposed here.
 */
const MODEL = {
  wolfCapture: 8,        // a wolf reply that captures, relative to a plain step
  lambHangs: 0.2,        // a lamb reply that leaves a lamb capturable
  lambRescues: 4,        // a lamb reply that reduces the number of capturable lambs
  lambSqueezes: 1.5,     // a lamb reply that reduces the wolves' mobility
};
function replyWeight(c, r) {
  // c: position with the opponent to move; r: one of their outcomes (before the move is made)
  if (c.side === WOLF) return r.capture ? MODEL.wolfCapture : 1;
  const before = B.popcount(B.threatenedLambs(c)), wm = B.mobility(c, WOLF);
  const undo = B.makeMove(c, r.move);
  const after = B.popcount(B.threatenedLambs(c)), wm2 = B.mobility(c, WOLF);
  B.unmakeMove(c, r.move, undo);
  let w = 1;
  if (after > 0) w *= MODEL.lambHangs;
  if (after < before) w *= MODEL.lambRescues;
  if (wm2 < wm) w *= MODEL.lambSqueezes;
  return w;
}

/* Blunder probability with a horizon: after our move into position c (opponent
 * to move), the probability that an opponent who picks replies with the weights
 * above makes a value-losing move within `depth` of their moves, when we always
 * answer with the value-preserving move that maximises the same quantity.
 * Works from drawn positions (they lose the draw) and from positions we are
 * losing (they throw the win away). uniform = true uses a uniform opponent. */
const memo = new Map();
function rankFor(side, winner) { return winner === side ? 2 : winner === DRAW ? 1 : 0; }
function blunderProb(c, depth, uniform) {
  const k = B.key(c) + ':' + c.clock + ':' + depth + (uniform ? 'u' : 'm');
  if (memo.has(k)) return memo.get(k);
  const opp = c.side, us = 3 - opp;
  const oppValue = rankFor(opp, value(c, c.clock).winner);
  const rs = outcomes(c, c.clock);
  let sum = 0, wsum = 0;
  for (const r of rs) {
    const w = uniform ? 1 : replyWeight(c, r);
    wsum += w;
    if (rankFor(opp, r.winner) < oppValue) { sum += w; continue; }     // they threw away value
    if (depth <= 1) continue;
    const undo = B.makeMove(c, r.move);
    const ourValue = rankFor(us, value(c, c.clock).winner);
    let best = 0;
    for (const m of outcomes(c, c.clock)) {
      if (rankFor(us, m.winner) < ourValue) continue;                     // keep our own value
      if (ourValue === 2) continue;                                       // we are winning: no trap needed
      const u2 = B.makeMove(c, m.move);
      const v = blunderProb(c, depth - 1, uniform);
      B.unmakeMove(c, m.move, u2);
      if (v > best) best = v;
    }
    B.unmakeMove(c, r.move, undo);
    sum += w * best;
  }
  const res = wsum ? sum / wsum : 0;
  if (memo.size > 2000000) memo.clear();
  memo.set(k, res);
  return res;
}

/* Every legal move with its exact outcome for the mover, best first:
 *   winning moves first, fastest win first (by d, plies to the end of the game,
 *   when the distance tables are present, else by t);
 *   then drawing moves, the one after which the largest fraction of opponent
 *   replies lose first (best practical chance);
 *   then losing moves, slowest loss first (by d, else t), then fewest winning replies for the opponent.
 * Each entry: { move, winner, t, d, dExact, capture, replies, blunder }. With opts.depth = d > 1,
 * drawing moves are ranked by blunderProb over d opponent moves (stored in .blunder),
 * with the one-move fraction as tie-break. */
function bestMoves(p, clock, opts) {
  const depth = (opts && opts.depth) || 1;
  const mover = p.side, opp = 3 - mover;
  const out = outcomes(p, clock);
  for (const o of out) {
    o.replies = replies(p, o);
    o.blunder = trap(o);                        // uniform, one move
    o.blunderUniform = o.blunder;
    if (depth > 1 && o.winner !== mover && o.replies) {
      const undo = B.makeMove(p, o.move);
      o.blunder = blunderProb(p, depth, false);         // modelled opponent
      o.blunderUniform = blunderProb(p, depth, true);   // uniform opponent (tie-break)
      B.unmakeMove(p, o.move, undo);
    }
  }
  const score = r => r.winner === mover ? 3 : r.winner === DRAW ? 2 : 1;
  const len = r => r.d !== undefined ? r.d : r.t;
  out.sort((a, b) => {
    const d = score(b) - score(a); if (d) return d;
    if (a.winner === mover) return len(a) - len(b);                                   // win: fastest
    const t = (b.blunder - a.blunder) || (b.blunderUniform - a.blunderUniform) || (trap(b) - trap(a));
    if (t) return t;                                                                  // draw or loss: most likely to trick the opponent
    if (a.winner === DRAW) return 0;
    return (len(b) - len(a)) || ((a.replies ? a.replies.oppWins : 0) - (b.replies ? b.replies.oppWins : 0));   // loss: then slowest
  });
  return out;
}

module.exports = { lookup, value, outcomes, bestMoves, trap, blunderProb, replyWeight, MODEL, available, WOLF, LAMB, DRAW, CLOCK, TABLES };
