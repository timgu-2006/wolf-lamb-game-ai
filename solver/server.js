#!/usr/bin/env node
/*
 * Local lookup server for the solved tables, used by index.html.
 *
 *   node solver/server.js [port]        (default 8787)
 *
 *   GET /health
 *   GET /eval?w=<wolf mask>&l=<lamb mask>&side=<1 wolf|2 lamb>&clock=<plies since capture>
 *     -> { value: {winner, t, d, dExact}, moves: [{from, to, capture, winner, t, d, dExact, replies, blunder}] }
 *        winner: 1 wolf, 2 lamb, 3 draw. t: plies to the winner's next capture or the end.
 *        d: plies to the end of the game with best play; dExact: whether d is exact under
 *        the 100-turn rule from here (else it is a lower bound).
 *        replies: {n, oppWins, draws, oppLoses} = how the opponent's answers to that
 *        move are valued for the opponent (null when the move ends the game).
 *        blunder: for drawing and losing moves, the probability that a modelled
 *        opponent (wolves love captures, lambs rescue threatened lambs and avoid
 *        hanging them) throws away value within 3 of their moves, we answering
 *        optimally; blunderUniform is the same for a uniformly random opponent.
 *   GET /line?w=&l=&side=&clock=&from=<cell>&to=<cell>&n=<plies>
 *     -> { line: [{from, to, capture}] }  best play after that move (winner fastest,
 *        loser slowest, draws avoid repeating), at most n plies
 *
 *   Shared game (one game at a time, stored in solver/games/<id>.json):
 *   GET  /game                      -> { id, moves, players, result, ... }
 *   POST /game/new?wolf=<p>&lamb=<p>  start a new game; each side's player p is
 *                                   browser (the page), tables (answers at once) or remote
 *                                   (moves posted from the command line)
 *   POST /game/move?from=<cell>&to=<cell>  play a move for the side to move
 *   POST /game/undo                 take back the last ply, plus any tables replies before it
 *
 * Every response carries Access-Control-Allow-Origin: * so a page opened from
 * file:// can query it. Only listens on localhost.
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const E = require(path.join(__dirname, '..', 'engine.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const TAC = require(path.join(__dirname, 'tactics.js'));

const port = +(process.argv[2] || 8787);
if (!TB.available()) {
  console.error(`tables not found in ${TB.TABLES} (need layer_4.bin .. layer_15.bin). Build them with solver/solve first.`);
  process.exit(1);
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

// ---- shared game -----------------------------------------------------------
const GAMES_DIR = path.join(__dirname, 'games');
fs.mkdirSync(GAMES_DIR, { recursive: true });
let game = null;   // { id, started, players: {wolf, lamb}, moves: [{from,to,capture,by,value,t}], version }
const PLAYERS = ['browser', 'tables', 'remote'];
function gameState(g) {   // replay the record with the reference engine
  let s = E.initialState();
  for (const m of g.moves) s = E.applyMove(s, { from: m.from, to: m.to, capture: m.capture ? m.to : null });
  return s;
}
function exact(s) { const p = B.fromState(s); const v = TB.value(p, s.turnsSinceCapture); return { winner: v.winner, d: v.d, dExact: v.dExact }; }
function saveGame(g) { fs.writeFileSync(path.join(GAMES_DIR, g.id + '.json'), JSON.stringify(g, null, 1)); }
function newGame(players) {
  game = { id: new Date().toISOString().replace(/[:.]/g, '-'), started: Date.now(), players, moves: [], version: 1, start: exact(E.initialState()) };
  autoReply(game);
  saveGame(game);
  return game;
}
function playerOf(g, side) { return g.players[side === E.WOLF ? 'wolf' : 'lamb']; }
function applyRecorded(g, em, by) {
  const s = gameState(g);
  if (!E.isLegal(s, em)) return 'illegal move';
  const t = E.applyMove(s, em);
  const ex = exact(t), before = exact(s);
  const mover = s.side, rank = v => v === mover ? 2 : v === TB.DRAW ? 1 : 0;
  g.moves.push({ from: em.from, to: em.to, capture: em.capture !== null, by, side: s.side, text: E.describeMove(em), value: ex, blunder: rank(ex.winner) < rank(before.winner), at: Date.now() });
  g.version++;
  const r = E.result(t);
  if (r) g.result = { winner: r.winner, reason: r.reason };
  return null;
}
function autoReply(g) {   // while the side to move is played by the tables, play the trap-ranked best move
  for (let guard = 0; guard < 400; guard++) {
    const s = gameState(g);
    if (E.result(s) || playerOf(g, s.side) !== 'tables') return;
    const opts = TB.bestMoves(B.fromState(s), s.turnsSinceCapture, { depth: DEPTH });
    applyRecorded(g, B.toEngineMove(opts[0].move), 'tables');
  }
}
function gameJson(g) {
  const s = gameState(g);
  return { id: g.id, players: g.players, version: g.version, moves: g.moves, sideToMove: s.side, toMoveBy: E.result(s) ? null : playerOf(g, s.side), result: g.result || null, lambs: s.lambs, clock: s.turnsSinceCapture, start: g.start };
}

const DEPTH = 3;   // opponent moves considered by the blunder probability
function moveObj(o, p) { return { from: B.moveFrom(o.move), to: B.moveTo(o.move), capture: !!o.capture, winner: o.winner, t: o.t, d: o.d, dExact: o.dExact, replies: o.replies, blunder: o.blunder, blunderUniform: o.blunderUniform, tactic: (p && p.side === B.WOLF && TAC.discoveredDouble(p, o.move)) ? 'discovered double attack' : undefined }; }

/* best play from p for up to n plies: winner fastest, loser slowest, draws set the biggest trap (and avoid repeating) */
function bestLine(p, n) {
  const line = [], seen = new Set([B.key(p)]);
  for (let i = 0; i < n; i++) {
    if (B.popcount(p.lambs) < 4 || B.terminal(p) !== -1) break;
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
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (u.pathname === '/health') return send(res, 200, { ok: true, tables: TB.TABLES, clock: TB.CLOCK, game: game ? game.id : null });
  if (u.pathname === '/game') return send(res, 200, game ? gameJson(game) : { id: null });
  if (u.pathname === '/game/new') {
    const pick = (v, d) => PLAYERS.includes(v) ? v : d;
    newGame({ wolf: pick(u.searchParams.get('wolf'), 'browser'), lamb: pick(u.searchParams.get('lamb'), 'tables') });
    return send(res, 200, gameJson(game));
  }
  if (u.pathname === '/game/undo') {
    if (!game) return send(res, 400, { error: 'no game' });
    if (game.moves.length) { game.moves.pop(); while (game.moves.length && game.moves[game.moves.length - 1].by === 'tables') game.moves.pop(); }
    delete game.result; game.version++; saveGame(game);
    return send(res, 200, gameJson(game));
  }
  if (u.pathname === '/game/move') {
    if (!game) newGame({ wolf: 'browser', lamb: 'browser' });
    const from = +u.searchParams.get('from'), to = +u.searchParams.get('to');
    const s = gameState(game);
    const legalMove = E.legalMoves(s).find(m => m.from === from && m.to === to);
    if (!legalMove) return send(res, 400, { error: 'illegal move', state: gameJson(game) });
    const err = applyRecorded(game, legalMove, u.searchParams.get('by') || playerOf(game, s.side));
    if (err) return send(res, 400, { error: err });
    autoReply(game);
    saveGame(game);
    return send(res, 200, gameJson(game));
  }
  if (u.pathname !== '/eval' && u.pathname !== '/line') return send(res, 404, { error: 'not found' });
  const w = +u.searchParams.get('w'), l = +u.searchParams.get('l'), side = +u.searchParams.get('side'), clock = +(u.searchParams.get('clock') || 0);
  const ALL = (1 << 25) - 1;
  if (!(w >= 0 && w <= ALL && l >= 0 && l <= ALL) || (w & l) || B.popcount(w) !== 3 || (side !== 1 && side !== 2))
    return send(res, 400, { error: 'bad position' });
  try {
    const p = { wolves: w, lambs: l, side, clock };
    if (u.pathname === '/eval') {
      const value = TB.value(p, clock);
      const moves = TB.bestMoves(p, clock, { depth: DEPTH }).map(o => moveObj(o, p));
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
