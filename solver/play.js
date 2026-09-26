#!/usr/bin/env node
/*
 * Perfect play from the solved tables.
 *
 *   node solver/play.js line              print the optimal line from the start
 *   node solver/play.js line <plies>      ... limited to that many plies
 *   node solver/play.js play wolf|lamb    play that side against the tables
 *
 * In "play" mode enter moves as  r,c r,c  (from, to; 1-indexed), e.g.  1,3 3,3
 */
const readline = require('readline');
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const AI = require(path.join(__dirname, '..', 'ai.js'));

const NAME = ['', 'WOLF', 'LAMB', 'DRAW'];

function describe(r, mover) {
  if (r.winner === TB.DRAW) return 'draw' + (r.replies ? ` (opponent lost within 3 moves with probability ${(r.blunder * 100).toFixed(0)}%, ${r.replies.oppLoses} of ${r.replies.n} replies lose at once)` : '');
  const who = r.winner === mover ? 'wins' : 'loses';
  const side = r.winner === TB.WOLF ? 'wolf' : 'lamb';
  if (r.d !== undefined) return `${who}: ${side} ends the game in ${r.dExact === false ? 'at least ' : ''}${r.d} plies (next capture/trap within ${r.t})`;
  return `${who}, ${side} forces capture/trap within ${r.t}`;
}

/* choose the move the tables recommend: fastest win; else the drawing move that
 * gives a random opponent the highest chance of being lost within three moves;
 * else slowest loss. Ties
 * are broken by the search AI (a short search from the resulting position) so
 * the line looks like sensible play; among draws a repeated position is avoided
 * when possible. */
function bestMove(s, hist) {
  const p = B.fromState(s);
  const options = TB.bestMoves(p, s.turnsSinceCapture, { depth: 3 });
  const best = options[0];
  const len = o => o.d !== undefined ? o.d : o.t;
  const tied = options.filter(o => o.winner === best.winner && (best.winner === TB.DRAW ? o.blunder === best.blunder : len(o) === len(best)));
  if (tied.length === 1) return { em: B.toEngineMove(best.move), o: best };
  let pick = null, pickScore = -Infinity;
  for (const o of tied) {
    const em = B.toEngineMove(o.move);
    const next = E.applyMove(s, em);
    const repeats = best.winner === TB.DRAW && hist.has(B.key(B.fromState(next)));
    const r = AI.chooseMove(B.fromState(next), { depth: 6, clearTT: true, history: [...hist] });
    const score = -(r ? r.score : 0) - (repeats ? 1e6 : 0);   // from the mover's point of view
    if (score > pickScore) { pickScore = score; pick = { em, o }; }
  }
  return pick;
}

function printLine(maxPlies) {
  let s = E.initialState();
  const hist = new Set([B.key(B.fromState(s))]);
  const start = TB.lookup(B.fromState(s));
  console.log(`start: ${NAME[start.winner]}${start.winner !== TB.DRAW ? ' wins, first capture/end forced within ' + start.t + ' plies' : ''}\n`);
  console.log(E.toString(s));
  for (let ply = 1; ply <= maxPlies; ply++) {
    const r = E.result(s);
    if (r) { console.log(`game over: ${r.winner === null ? 'draw' : E.sideName(r.winner) + ' wins'} (${r.reason}) after ${ply - 1} plies`); return; }
    const { em, o } = bestMove(s, hist);
    s = E.applyMove(s, em);
    hist.add(B.key(B.fromState(s)));
    const v = TB.lookup(B.fromState(s));
    console.log(`${String(ply).padStart(3)}. ${E.sideName(s.side === E.WOLF ? E.LAMB : E.WOLF).padEnd(4)} ${E.describeMove(em).padEnd(16)} lambs ${String(s.lambs).padStart(2)}  clock ${String(s.turnsSinceCapture).padStart(3)}  now: ${NAME[v.winner]}${v.winner !== TB.DRAW ? (v.d !== undefined ? ' ends in ' + v.d : '') + ' (next exit ' + v.t + ')' : ''}`);
    if (em.capture !== null || ply % 10 === 0) console.log(E.toString(s));
  }
  console.log('(line truncated)');
}

async function play(humanSide) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = q => new Promise(res => rl.question(q, res));
  let s = E.initialState();
  const hist = new Set([B.key(B.fromState(s))]);
  for (;;) {
    console.log('\n' + E.toString(s));
    const r = E.result(s);
    if (r) { console.log(`game over: ${r.winner === null ? 'draw' : E.sideName(r.winner) + ' wins'} (${r.reason})`); break; }
    const v = TB.lookup(B.fromState(s));
    console.log(`${E.sideName(s.side)} to move. Tables: ${describe(v, s.side)}. Lambs ${s.lambs}, clock ${s.turnsSinceCapture}.`);
    let em;
    if (s.side === humanSide) {
      const legal = E.legalMoves(s);
      for (;;) {
        const ans = (await ask('your move (r,c r,c) or "hint": ')).trim();
        if (ans === 'hint') {
          for (const o of TB.bestMoves(B.fromState(s), s.turnsSinceCapture, { depth: 3 }).slice(0, 5)) console.log('  ' + E.describeMove(B.toEngineMove(o.move)) + ': ' + describe(o, s.side));
          continue;
        }
        const m = ans.match(/^(\d),(\d)\s+(\d),(\d)$/);
        if (!m) { console.log('format: 1,3 3,3'); continue; }
        const from = E.idx(+m[1], +m[2]), to = E.idx(+m[3], +m[4]);
        em = legal.find(x => x.from === from && x.to === to);
        if (!em) { console.log('illegal'); continue; }
        break;
      }
    } else {
      const { em: mv, o } = bestMove(s, hist);
      em = mv;
      console.log(`tables play ${E.describeMove(em)} (${describe(o, s.side)})`);
    }
    s = E.applyMove(s, em);
    hist.add(B.key(B.fromState(s)));
  }
  rl.close();
}

const mode = process.argv[2] || 'line';
if (mode === 'line') printLine(+(process.argv[3] || 400));
else if (mode === 'play') play(process.argv[3] === 'lamb' ? E.LAMB : E.WOLF);
else { console.log('usage: node solver/play.js line [plies] | play wolf|lamb'); process.exit(1); }
