#!/usr/bin/env node
/*
 * Test simple hand-written rules against the exact tables.
 *
 * A rule is a policy for one side. Starting from the initial position the rule
 * plays that side while the opponent plays EVERY legal move (breadth-first over
 * raw positions, no symmetry reduction, capped). At each position where the rule moves we
 * check whether its move keeps the exact value (draw stays draw, win stays win).
 * A rule with zero blunders on the whole reachable set is a genuine non-losing
 * strategy from the start.
 *
 *   node solver/rules.js [maxStates] [opponent: any|perfect]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const IX = require(path.join(__dirname, 'indexing.js'));

const maxStates = +(process.argv[2] || 300000);
const perfectOpp = (process.argv[3] || 'any') === 'perfect';
const buf = new Int32Array(64);
const ALL = (1 << 25) - 1;

function legal(p) { const n = B.genMoves(p, buf); const out = []; for (let i = 0; i < n; i++) out.push(buf[i]); return out; }
function after(p, m) { const q = B.clone(p); B.makeMove(q, m); return q; }
function wolfMob(q) { return B.mobility(q, B.WOLF); }
function lambMob(q) { return B.mobility(q, B.LAMB); }
function threatened(q) { return B.popcount(B.threatenedLambs(q)); }   // lambs a wolf could capture next move
function pick(moves, score) { let best = null, bv = -Infinity; for (const m of moves) { const v = score(m); if (v > bv) { bv = v; best = m; } } return best; }
function neighbours(cell) { const r = Math.floor(cell / 5), c = cell % 5, out = []; if (r > 0) out.push(cell - 5); if (r < 4) out.push(cell + 5); if (c > 0) out.push(cell - 1); if (c < 4) out.push(cell + 1); return out; }
// how many wolf neighbours a lamb cell has (a "blocking" lamb touches wolves)
function wolfTouch(p, cell) { let n = 0; for (const x of neighbours(cell)) if (p.wolves & (1 << x)) n++; return n; }

const centreDist = cell => Math.abs(Math.floor(cell / 5) - 2) + Math.abs(cell % 5 - 2);
const row = cell => Math.floor(cell / 5);
const isStart = p => p.wolves === ((1 << 1) | (1 << 2) | (1 << 3)) && B.popcount(p.lambs) === 15 && p.side === B.WOLF;
const CENTRE_CAPTURE = B.move(2, 12, 1);
function captureRule(prefer) {                     // prefer: score for a capture move (higher first)
  return p => {
    if (isStart(p)) return CENTRE_CAPTURE;
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    if (caps.length) return pick(caps, prefer(p));
    return pick(ms, m => wolfMob(after(p, m)));
  };
}
const dirClass = m => { const f = B.moveFrom(m), t = B.moveTo(m); return t === f - 10 ? 3 : t === f + 10 ? 2 : 1; };   // up (toward row 1) > down > sideways
// ---- formation-holding strategies -------------------------------------------
// Target formation W (3 cells). Capture whenever possible (the capture that leaves the
// wolves closest to W); otherwise step a wolf toward W; when at W, make the waiting move
// that stays closest to W. Distance = best assignment of wolves to target cells (Manhattan).
const cellOf = (r, c) => (r - 1) * 5 + (c - 1);
function manhattan(a, b) { return Math.abs(Math.floor(a / 5) - Math.floor(b / 5)) + Math.abs(a % 5 - b % 5); }
function formationDist(w, targets) {
  const cells = []; for (let i = 0; i < 25; i++) if (w & (1 << i)) cells.push(i);
  let best = Infinity;
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const pm of perms) { let d = 0; for (let i = 0; i < 3; i++) d += manhattan(cells[i], targets[pm[i]]); if (d < best) best = d; }
  return best;
}
function formationRule(targets) {
  return p => {
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    const score = m => { const q = after(p, m); return -100 * formationDist(q.wolves, targets) + wolfMob(q); };
    if (caps.length) return pick(caps, score);
    return pick(ms, score);
  };
}
const FORMATIONS = {
  'hold (3,3),(2,2),(1,4)': [cellOf(3, 3), cellOf(2, 2), cellOf(1, 4)],
  'hold (3,3),(2,2),(2,4)': [cellOf(3, 3), cellOf(2, 2), cellOf(2, 4)],
  'hold diagonal (2,2),(3,3),(4,4)': [cellOf(2, 2), cellOf(3, 3), cellOf(4, 4)],
  'hold (3,3),(1,2),(1,4)': [cellOf(3, 3), cellOf(1, 2), cellOf(1, 4)],
  'hold (2,3),(3,1),(3,4)': [cellOf(2, 3), cellOf(3, 1), cellOf(3, 4)],
  'hold (3,3),(1,3),(5,3)': [cellOf(3, 3), cellOf(1, 3), cellOf(5, 3)],
};
const WOLF_RULES = {
  ...Object.fromEntries(Object.entries(FORMATIONS).map(([n, t]) => [n, formationRule(t)])),
  'W2: centre first; capture preferring up, then down, then sideways; ties by mobility; else max mobility':
    captureRule(p => m => dirClass(m) * 1000 + wolfMob(after(p, m)) * 10 - Math.abs(B.moveTo(m) % 5 - 2)),
  'W*: centre first, then capture preferring upward jumps, else max mobility': captureRule(p => m => -row(B.moveTo(m)) * 100 - (B.moveTo(m) % 5 === 0 || B.moveTo(m) % 5 === 4 ? 0 : 1)),
  'variant: capture preferring downward jumps': captureRule(p => m => row(B.moveTo(m)) * 100),
  'variant: capture preferring edge landing squares': captureRule(p => m => (row(B.moveTo(m)) === 0 || row(B.moveTo(m)) === 4 || B.moveTo(m) % 5 === 0 || B.moveTo(m) % 5 === 4) ? 1 : 0),
  'variant: capture preferring max mobility after it': captureRule(p => m => wolfMob(after(p, m))),
  'capture the most central lamb, else max mobility': p => {
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    if (caps.length) return pick(caps, m => -10 * centreDist(B.moveTo(m)) + wolfMob(after(p, m)));
    return pick(ms, m => wolfMob(after(p, m)));
  },
  'always capture (any capture)': p => {
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    return caps.length ? caps[0] : pick(ms, m => wolfMob(after(p, m)));
  },
  'capture the lamb touching most wolves (a blocker), else max mobility': p => {
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    if (caps.length) return pick(caps, m => wolfTouch(p, B.moveTo(m)) * 10 + wolfMob(after(p, m)));
    return pick(ms, m => wolfMob(after(p, m)));
  },
  'capture that leaves most wolf mobility, else max mobility': p => {
    const ms = legal(p), caps = ms.filter(m => B.moveIsCapture(m));
    if (caps.length) return pick(caps, m => wolfMob(after(p, m)));
    return pick(ms, m => wolfMob(after(p, m)));
  },
  'max (wolf mobility + 4 x threatened lambs), captures count 6': p => {
    const ms = legal(p);
    return pick(ms, m => { const q = after(p, m); return wolfMob(q) + 4 * threatened(q) + (B.moveIsCapture(m) ? 6 : 0); });
  },
};

const LAMB_RULES = {
  'block: leave no lamb capturable if possible, else max (lamb mob - 3 wolf mob)': p => {
    const ms = legal(p);
    const safe = ms.filter(m => threatened(after(p, m)) === 0);
    const cands = safe.length ? safe : ms;
    return pick(cands, m => { const q = after(p, m); return lambMob(q) - 3 * wolfMob(q) - 20 * threatened(q); });
  },
  'minimise wolf mobility (1 ply), captures allowed': p => pick(legal(p), m => -wolfMob(after(p, m))),
  'minimise threatened lambs, then wolf mobility': p => pick(legal(p), m => { const q = after(p, m); return -100 * threatened(q) - wolfMob(q); }),
  'advance the rearmost lamb that stays safe': p => {
    const ms = legal(p);
    const safe = ms.filter(m => threatened(after(p, m)) === 0);
    const cands = safe.length ? safe : ms;
    return pick(cands, m => { const from = B.moveFrom(m), to = B.moveTo(m); return Math.floor(from / 5) * 10 - Math.floor(to / 5) - wolfMob(after(p, m)); });
  },
};

// Rules may depend on the board's orientation (e.g. "toward the wolves' home row"),
// so positions are NOT reduced by symmetry here: the raw position is the key.
function canonKey(p) { return B.key(p); }
function valueOf(p) { return TB.lookup(p).winner; }

function testRule(name, side, rule) {
  const start = B.initial();
  const seen = new Set([canonKey(start)]);
  let frontier = [start], total = 1, decisions = 0, blunders = 0, capped = false;
  const examples = [];
  const worst = { draw2loss: 0, win2draw: 0, win2loss: 0 };
  while (frontier.length && !capped) {
    const next = [];
    for (const p of frontier) {
      if (B.popcount(p.lambs) < 4 || B.terminal(p) !== -1) continue;
      let moves;
      if (p.side === side) {
        const m = rule(p); moves = [m];
        decisions++;
        const before = valueOf(p), afterV = valueOf(after(p, m));
        const mover = side;
        const rank = v => v === mover ? 2 : v === TB.DRAW ? 1 : 0;
        if (rank(afterV) < rank(before)) {
          blunders++;
          if (rank(before) === 1) worst.draw2loss++; else if (rank(afterV) === 1) worst.win2draw++; else worst.win2loss++;
          if (examples.length < 2) {
            const good = TB.outcomes(p, 0).filter(o => o.winner === before).map(o => E.describeMove(B.toEngineMove(o.move)));
            examples.push({ p: B.clone(p), move: E.describeMove(B.toEngineMove(m)), good, before });
          }
        }
      } else if (perfectOpp) {
        const v = valueOf(p); moves = TB.outcomes(p, 0).filter(o => o.winner === v).map(o => o.move);
      } else moves = legal(p);
      for (const m of moves) {
        const q = after(p, m), k = canonKey(q);
        if (seen.has(k)) continue;
        seen.add(k); total++; next.push(q);
        if (total >= maxStates) { capped = true; break; }
      }
      if (capped) break;
    }
    frontier = next;
  }
  console.log(`\n${side === B.WOLF ? 'WOLF' : 'LAMB'} rule "${name}": ${decisions} decisions over ${total} positions${capped ? ' (capped)' : ''}, ${blunders} value-losing moves (${(100 * blunders / Math.max(1, decisions)).toFixed(2)}%)  draw->loss ${worst.draw2loss}, win->draw ${worst.win2draw}, win->loss ${worst.win2loss}`);
  for (const ex of examples) {
    const s = E.initialState(); s.board.fill(E.EMPTY);
    for (let i = 0; i < 25; i++) { if (ex.p.wolves & (1 << i)) s.board[i] = E.WOLF; else if (ex.p.lambs & (1 << i)) s.board[i] = E.LAMB; }
    s.side = ex.p.side;
    console.log(`  example (value ${['', 'wolf win', 'lamb win', 'draw'][ex.before]}, ${E.sideName(s.side)} to move): rule plays ${ex.move}; correct: ${ex.good.join(', ')}\n` + E.toString(s).split('\n').map(l => '    ' + l).join('\n'));
  }
}

module.exports = { WOLF_RULES, LAMB_RULES };
const only = process.argv[4];   // optional: substring of a rule name to test just that rule
if (require.main === module) {
console.log(`opponent plays ${perfectOpp ? 'only value-preserving moves' : 'every legal move'}; cap ${maxStates} positions per rule`);
for (const [name, rule] of Object.entries(WOLF_RULES)) if (!only || name.includes(only)) testRule(name, B.WOLF, rule);
for (const [name, rule] of Object.entries(LAMB_RULES)) if (!only || name.includes(only)) testRule(name, B.LAMB, rule);
}
