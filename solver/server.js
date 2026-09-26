#!/usr/bin/env node
/*
 * Local lookup server for the solved tables, used by index.html.
 *
 *   node solver/server.js [port]        (default 8787)
 *
 *   GET /health
 *   GET /eval?w=<wolf mask>&l=<lamb mask>&side=<1 wolf|2 lamb>&clock=<plies since capture>
 *     -> { value: {winner, t}, moves: [{from, to, capture, winner, t, replies}] }
 *        winner: 1 wolf, 2 lamb, 3 draw. t: plies to the winner's next capture or the end.
 *        replies: {n, oppWins, draws, oppLoses} = how the opponent's answers to that
 *        move are valued for the opponent (null when the move ends the game).
 *        blunder: for drawing moves, the probability that a uniformly random
 *        opponent is lost within 3 of their moves (we answer optimally).
 *   GET /line?w=&l=&side=&clock=&from=<cell>&to=<cell>&n=<plies>
 *     -> { line: [{from, to, capture}] }  best play after that move (winner fastest,
 *        loser slowest, draws avoid repeating), at most n plies
 *
 * Every response carries Access-Control-Allow-Origin: * so a page opened from
 * file:// can query it. Only listens on localhost.
 */
const http = require('http');
const path = require('path');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));

const port = +(process.argv[2] || 8787);
if (!TB.available()) {
  console.error(`tables not found in ${TB.TABLES} (need layer_3.bin .. layer_15.bin). Build them with solver/solve first.`);
  process.exit(1);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const DEPTH = 3;   // opponent moves considered by the blunder probability
function moveObj(o) { return { from: B.moveFrom(o.move), to: B.moveTo(o.move), capture: !!o.capture, winner: o.winner, t: o.t, replies: o.replies, blunder: o.blunder }; }

/* best play from p for up to n plies: winner fastest, loser slowest, draws set the biggest trap (and avoid repeating) */
function bestLine(p, n) {
  const line = [], seen = new Set([B.key(p)]);
  for (let i = 0; i < n; i++) {
    if (B.popcount(p.lambs) < 3 || B.terminal(p) !== -1) break;
    const opts = TB.bestMoves(p, p.clock, { depth: DEPTH });
    if (!opts.length) break;
    let pick = opts[0];
    if (pick.winner === TB.DRAW) {
      // drawing moves are already ordered by trap value; take the best one that does not repeat
      for (const o of opts) {
        if (o.winner !== TB.DRAW) break;
        const undo = B.makeMove(p, o.move); const fresh = !seen.has(B.key(p)); B.unmakeMove(p, o.move, undo);
        if (fresh) { pick = o; break; }
      }
    }
    line.push({ from: B.moveFrom(pick.move), to: B.moveTo(pick.move), capture: !!pick.capture });
    B.makeMove(p, pick.move);
    seen.add(B.key(p));
  }
  return line;
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname === '/health') return send(res, 200, { ok: true, tables: TB.TABLES, clock: TB.CLOCK });
  if (u.pathname !== '/eval' && u.pathname !== '/line') return send(res, 404, { error: 'not found' });
  const w = +u.searchParams.get('w'), l = +u.searchParams.get('l'), side = +u.searchParams.get('side'), clock = +(u.searchParams.get('clock') || 0);
  const ALL = (1 << 25) - 1;
  if (!(w >= 0 && w <= ALL && l >= 0 && l <= ALL) || (w & l) || B.popcount(w) !== 3 || (side !== 1 && side !== 2))
    return send(res, 400, { error: 'bad position' });
  try {
    const p = { wolves: w, lambs: l, side, clock };
    if (u.pathname === '/eval') {
      const value = TB.value(p, clock);
      const moves = TB.bestMoves(p, clock, { depth: DEPTH }).map(moveObj);
      return send(res, 200, { value, moves });
    }
    const from = +u.searchParams.get('from'), to = +u.searchParams.get('to'), n = Math.min(+(u.searchParams.get('n') || 8), 40);
    const buf = new Int32Array(64), cnt = B.genMoves(p, buf);
    let mv = -1;
    for (let i = 0; i < cnt; i++) if (B.moveFrom(buf[i]) === from && B.moveTo(buf[i]) === to) mv = buf[i];
    if (mv < 0) return send(res, 400, { error: 'illegal move' });
    B.makeMove(p, mv);
    send(res, 200, { line: bestLine(p, n) });
  } catch (e) {
    send(res, 500, { error: String(e.message || e) });
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Wolf and Lamb tables: http://localhost:${port}/  (tables in ${TB.TABLES}, clock ${TB.CLOCK})`));
