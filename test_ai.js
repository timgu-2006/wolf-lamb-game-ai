// Tactical tests for ai.js. Ground truth comes from a brute-force minimax over
// engine.js (the reference rules), so the AI is checked against the rules, not
// against hand analysis. Run: node test_ai.js
const E = require('./engine.js');
const B = require('./bitboard.js');
const AI = require('./ai.js');
const assert = require('assert');
const I = E.idx;

function custom(wolves, lambs, side) {
  const s = E.initialState();
  s.board.fill(E.EMPTY); s.repetitions = {}; s.moves = [];
  for (const [r, c] of wolves) s.board[I(r, c)] = E.WOLF;
  for (const [r, c] of lambs) s.board[I(r, c)] = E.LAMB;
  s.lambs = lambs.length; s.side = side;
  return s;
}

// Brute force: +1 side to move forces a win within `depth` plies, -1 loses
// within `depth` against best play, 0 unknown. Repetition ignored.
function solve(s, depth) {
  const r = E.result(s);
  if (r) return r.winner === null ? 0 : (r.winner === s.side ? 1 : -1);
  if (depth === 0) return 0;
  let allLose = true;
  for (const m of E.legalMoves(s)) {
    const v = -solve(E.applyMove(s, m), depth - 1);
    if (v === 1) return 1;
    if (v !== -1) allLose = false;
  }
  return allLose ? -1 : 0;
}
function winningMoves(s, depth) {
  return E.legalMoves(s).filter(m => -solve(E.applyMove(s, m), depth - 1) === 1);
}
function safeMoves(s, depth) {
  return E.legalMoves(s).filter(m => -solve(E.applyMove(s, m), depth - 1) !== -1);
}

const cases = [
  {
    name: 'lambs close a corner trap in 1',
    s: custom([[1,1],[1,2],[2,1]], [[1,3],[2,2],[4,1],[5,5]], E.LAMB), depth: 3, expect: 1,
  },
  {
    name: 'wolf wins by capturing down to 3 lambs',
    s: custom([[3,3],[1,1],[5,5]], [[3,5],[1,5],[5,1],[5,3]], E.WOLF), depth: 3, expect: 1,
  },
  {
    name: 'lambs trap three wolves along the top edge in 2',
    // wolves (1,1),(1,2),(1,3); lambs block (2,1),(2,2) and (1,4)... (2,3) is still open
    s: custom([[1,1],[1,2],[1,3]], [[2,1],[2,2],[1,4],[3,3],[3,4],[4,4]], E.LAMB), depth: 5, expect: 1,
  },
  // The positions below were mined from AI-vs-AI games (mine_positions.js) and
  // classified by the brute-force solver, so each one has a verified property.
  {
    name: 'mined: lambs force a win in 3 plies (A)',
    s: custom([[1,5],[2,3],[3,5]], [[1,2],[1,4],[2,2],[2,4],[3,2],[3,3],[3,4],[4,2],[4,4],[4,5],[5,2]], E.LAMB), depth: 3, expect: 1,
  },
  {
    name: 'mined: lambs force a win in 3 plies (B)',
    s: custom([[1,2],[3,1],[4,1]], [[1,3],[1,4],[2,1],[2,2],[2,4],[3,2],[4,2],[4,4],[4,5],[5,2],[5,4]], E.LAMB), depth: 3, expect: 1,
  },
  {
    name: 'mined: lambs force a win in 5 plies',
    s: custom([[1,1],[1,3],[2,5]], [[2,1],[2,2],[2,3],[2,4],[3,5],[4,1],[4,2],[4,3],[4,5],[5,2],[5,3],[5,4],[5,5]], E.LAMB), depth: 5, expect: 1,
  },
  {
    name: 'mined: wolves to move, one of four moves loses by force (A)',
    s: custom([[1,2],[1,4],[2,5]], [[1,1],[2,2],[2,3],[2,4],[3,1],[3,5],[4,2],[4,3],[4,4],[4,5],[5,2],[5,3],[5,5]], E.WOLF), depth: 5, expect: 0, losing: 1,
  },
  {
    name: 'mined: wolves to move, one of four moves loses by force (B)',
    s: custom([[1,2],[1,4],[2,5]], [[1,1],[2,1],[2,2],[2,3],[2,4],[3,3],[3,5],[4,2],[4,4],[4,5],[5,2],[5,3],[5,5]], E.WOLF), depth: 5, expect: 0, losing: 1,
  },
];

let passed = 0;
for (const c of cases) {
  const truth = solve(c.s, c.depth);
  console.log(`\n${c.name}\n${E.toString(c.s)}${E.sideName(c.s.side)} to move; brute force (depth ${c.depth}): ${truth}`);
  if (c.expect !== null) assert.strictEqual(truth, c.expect, 'test position is not what it claims to be');
  const p = B.fromState(c.s);
  const r = AI.chooseMove(p, { depth: c.depth, clearTT: true });
  const chosen = B.toEngineMove(r.move);
  console.log(`ai: ${E.describeMove(chosen)} score ${AI.scoreToString(r.score)} depth ${r.depth} nodes ${r.nodes}`);
  if (truth === 1) {
    assert.ok(r.score > AI.MATE_BOUND, 'AI failed to see the forced win');
    const wins = winningMoves(c.s, c.depth).map(E.describeMove);
    assert.ok(wins.includes(E.describeMove(chosen)), `AI move not among winning moves ${wins}`);
  } else if (truth === -1) {
    assert.ok(r.score < -AI.MATE_BOUND, 'AI failed to see the forced loss');
  } else {
    assert.ok(Math.abs(r.score) < AI.MATE_BOUND, 'AI claims a forced result brute force does not find');
    const safe = safeMoves(c.s, c.depth).map(E.describeMove);
    const total = E.legalMoves(c.s).length;
    if (c.losing) assert.strictEqual(total - safe.length, c.losing, 'test position does not have the claimed number of losing moves');
    assert.ok(safe.includes(E.describeMove(chosen)), `AI walked into a forced loss; safe moves: ${safe}`);
    console.log(`safe moves: ${safe.join(', ')}  of ${total}`);
  }
  passed++;
}

// Consistency: at every position of a few AI-vs-AI games, a depth-4 AI must never
// choose a move that the brute force proves lost within 4 plies while a safe move exists.
{
  let checked = 0, seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 3; g++) {
    let s = E.initialState(); const hist = [];
    for (let ply = 0; ply < 60 && !E.result(s); ply++) {
      let em;
      if (ply < 4) { const ms = E.legalMoves(s); em = ms[Math.floor(rand() * ms.length)]; }
      else {
        const p = B.fromState(s);
        em = B.toEngineMove(AI.chooseMove(p, { depth: 4, history: hist, clearTT: true }).move);
        const safe = safeMoves(s, 4).map(E.describeMove);
        if (safe.length) assert.ok(safe.includes(E.describeMove(em)), 'blunder into forced loss\n' + E.toString(s));
        checked++;
      }
      hist.push(B.key(B.fromState(s)));
      s = E.applyMove(s, em);
    }
  }
  console.log(`\nblunder check ok on ${checked} AI moves`);
}

console.log(`\nALL AI CHECKS PASSED (${passed} tactical positions)`);
