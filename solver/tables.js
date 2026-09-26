/*
 * Read access to the solved tables (solver/tables/layer_<k>.bin) from Node.
 *
 *   const TB = require('./solver/tables.js');
 *   TB.lookup(position)          -> { winner: WOLF|LAMB|DRAW, t } for a bitboard.js position (fresh clock)
 *   TB.value(position, clock)    -> same, but a win that does not fit in the remaining clock becomes a draw
 *   TB.bestMoves(position, clock)-> every legal move with its exact outcome for the mover, best first:
 *                                   fastest win, else the draw that gives the opponent the most
 *                                   losing replies, else the slowest loss
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

function fd(k) {
  if (fds.has(k)) return fds.get(k);
  const file = path.join(TABLES, `layer_${k}.bin`);
  const st = fs.statSync(file);
  if (st.size !== IX.layerSize(k) * 2) throw new Error(`${file}: unexpected size ${st.size}`);
  const h = fs.openSync(file, 'r');
  fds.set(k, h);
  return h;
}

function available() {
  try { for (let k = 3; k <= 15; k++) fd(k); return true; } catch (e) { return false; }
}

function lookup(p) {
  const k = B.popcount(p.lambs);
  if (k < 3) return { winner: WOLF, t: 0 };
  const idx = IX.canonIndex(k, p.wolves, p.lambs, p.side === WOLF ? 0 : 1);
  if (fs.readSync(fd(k), two, 0, 2, idx * 2) !== 2) throw new Error('short read');
  const v = two.readUInt16LE(0);
  return { winner: v >>> 14, t: v & 0x3fff };
}

/* value of a position that already has `clock` plies on the no-capture counter */
function value(p, clock) {
  const r = lookup(p);
  if (r.winner !== DRAW && r.t + (clock || 0) > CLOCK) return { winner: DRAW, t: 0 };
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
    let winner = r.winner, t = r.t;
    if (winner !== DRAW) {
      if (!cap && t + 1 + clock > CLOCK) { winner = DRAW; t = 0; }   // does not fit in the clock
      else t = t + 1;
    }
    out.push({ move: m, winner, t, capture: cap });
  }
  return out;
}

/* How the opponent's replies after move o are valued for the opponent:
 * { n, oppWins, draws, oppLoses }, or null when the move ends the game. */
function replies(p, o) {
  const undo = B.makeMove(p, o.move);
  let r = null;
  if (B.popcount(p.lambs) >= 3 && B.terminal(p) === -1) {
    r = { n: 0, oppWins: 0, draws: 0, oppLoses: 0 };
    for (const x of outcomes(p, p.clock)) { r.n++; if (x.winner === DRAW) r.draws++; else if (x.winner === p.side) r.oppWins++; else r.oppLoses++; }
  }
  B.unmakeMove(p, o.move, undo);
  return r;
}

/* fraction of the opponent's replies that lose for the opponent (the "trap" value of a move) */
function trap(o) { return o.replies && o.replies.n ? o.replies.oppLoses / o.replies.n : 0; }

/* Blunder probability with a horizon: after our move into a drawn position c
 * (opponent to move), the probability that an opponent who picks uniformly among
 * legal replies is lost within `depth` of their moves, when we always answer with
 * the drawing move that maximises the same quantity. depth 1 equals trap(). */
const memo = new Map();
function blunderProb(c, depth) {
  const k = B.key(c) + ':' + c.clock + ':' + depth;
  if (memo.has(k)) return memo.get(k);
  const opp = c.side, us = 3 - opp;
  const rs = outcomes(c, c.clock);
  let sum = 0;
  for (const r of rs) {
    if (r.winner === us) { sum += 1; continue; }
    if (r.winner !== DRAW || depth <= 1) continue;
    const undo = B.makeMove(c, r.move);
    let best = 0;
    for (const m of outcomes(c, c.clock)) {
      if (m.winner !== DRAW) continue;
      const u2 = B.makeMove(c, m.move);
      const v = blunderProb(c, depth - 1);
      B.unmakeMove(c, m.move, u2);
      if (v > best) best = v;
    }
    B.unmakeMove(c, r.move, undo);
    sum += best;
  }
  const res = rs.length ? sum / rs.length : 0;
  if (memo.size > 2000000) memo.clear();
  memo.set(k, res);
  return res;
}

/* Every legal move with its exact outcome for the mover, best first:
 *   winning moves first, fastest win first;
 *   then drawing moves, the one after which the largest fraction of opponent
 *   replies lose first (best practical chance);
 *   then losing moves, slowest loss first, then fewest winning replies for the opponent.
 * Each entry: { move, winner, t, capture, replies, blunder }. With opts.depth = d > 1,
 * drawing moves are ranked by blunderProb over d opponent moves (stored in .blunder),
 * with the one-move fraction as tie-break. */
function bestMoves(p, clock, opts) {
  const depth = (opts && opts.depth) || 1;
  const mover = p.side, opp = 3 - mover;
  const out = outcomes(p, clock);
  for (const o of out) {
    o.replies = replies(p, o);
    o.blunder = trap(o);                        // horizon-1 value
    if (depth > 1 && o.winner === DRAW && o.replies) {
      const undo = B.makeMove(p, o.move);
      o.blunder = blunderProb(p, depth);
      B.unmakeMove(p, o.move, undo);
    }
  }
  const score = r => r.winner === mover ? 3 : r.winner === DRAW ? 2 : 1;
  out.sort((a, b) => {
    const d = score(b) - score(a); if (d) return d;
    if (a.winner === mover) return a.t - b.t;
    if (a.winner === DRAW) return (b.blunder - a.blunder) || (trap(b) - trap(a));
    return (b.t - a.t) || ((a.replies ? a.replies.oppWins : 0) - (b.replies ? b.replies.oppWins : 0));
  });
  return out;
}

module.exports = { lookup, value, outcomes, bestMoves, trap, blunderProb, available, WOLF, LAMB, DRAW, CLOCK, TABLES };
