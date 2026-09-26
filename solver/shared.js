#!/usr/bin/env node
/*
 * Command-line side of the shared game (talks to solver/server.js).
 *   node solver/shared.js status                 show the shared game
 *   node solver/shared.js new [tables|remote]    start a game; who plays the lambs
 *   node solver/shared.js move "(3,1) -> (2,1)"  play a move for the side to move
 *   node solver/shared.js undo
 *   node solver/shared.js hint                   exact ranking of the moves for the side to move
 *   node solver/shared.js list                   stored games with their outcomes
 */
const path = require('path'), fs = require('fs');
const E = require(path.join(__dirname, '..', 'engine.js'));
const base = 'http://localhost:' + (process.env.WL_PORT || 8787);
const N = ['', 'WOLF', 'LAMB', 'DRAW'];
async function api(p, method) { const r = await fetch(base + p, { method: method || 'GET' }); return r.json(); }
function show(g) {
  if (!g.id) { console.log('no shared game yet'); return; }
  let s = E.initialState();
  for (const m of g.moves) s = E.applyMove(s, { from: m.from, to: m.to, capture: m.capture ? m.to : null });
  console.log(`game ${g.id}  lambs played by: ${g.lambBy}  moves: ${g.moves.length}`);
  console.log(E.toString(s));
  console.log(g.moves.map((m, i) => `${i + 1}. ${E.sideName(m.side)[0]} ${m.text}${m.blunder ? ' ??' : ''} -> ${N[m.value.winner]}${m.value.d !== undefined ? ' ' + (m.value.dExact === false ? '>=' : '') + m.value.d : ''}`).join('\n'));
  if (g.result) console.log(`RESULT: ${g.result.winner ? E.sideName(g.result.winner) + ' wins' : 'draw'} (${g.result.reason})`);
  else console.log(`${E.sideName(g.sideToMove)} to move; exact value now: ${N[g.moves.length ? g.moves[g.moves.length - 1].value.winner : g.start.winner]}`);
}
(async () => {
  const cmd = process.argv[2] || 'status', arg = process.argv[3];
  if (cmd === 'status') show(await api('/game'));
  else if (cmd === 'new') show(await api('/game/new?lamb=' + (arg || 'tables'), 'POST'));
  else if (cmd === 'undo') show(await api('/game/undo', 'POST'));
  else if (cmd === 'move') {
    const m = arg.match(/\((\d),(\d)\)\s*(->|x)\s*\((\d),(\d)\)/);
    if (!m) { console.log('format: "(3,1) -> (2,1)" or "(1,3) x (3,3)"'); process.exit(1); }
    const r = await api(`/game/move?from=${E.idx(+m[1], +m[2])}&to=${E.idx(+m[4], +m[5])}&by=claude`, 'POST');
    if (r.error) console.log('error: ' + r.error); show(r.state || r);
  } else if (cmd === 'hint') {
    const g = await api('/game'); let s = E.initialState();
    for (const m of g.moves) s = E.applyMove(s, { from: m.from, to: m.to, capture: m.capture ? m.to : null });
    const B = require(path.join(__dirname, '..', 'bitboard.js')), TB = require(path.join(__dirname, 'tables.js'));
    for (const o of TB.bestMoves(B.fromState(s), s.turnsSinceCapture, { depth: 3 })) console.log(`  ${E.describeMove(B.toEngineMove(o.move)).padEnd(15)} ${N[o.winner]}${o.d !== undefined ? ' ends in ' + o.d : ''}${o.winner === TB.DRAW || o.winner !== s.side ? '  opponent errs within 3: ' + (o.blunder * 100).toFixed(0) + '%' : ''}`);
  } else if (cmd === 'list') {
    for (const f of fs.readdirSync(path.join(__dirname, 'games')).sort()) { const g = JSON.parse(fs.readFileSync(path.join(__dirname, 'games', f))); const bl = g.moves.filter(m => m.blunder); console.log(`${g.id}  ${g.moves.length} plies  lambs by ${g.lambBy}  ${g.result ? (g.result.winner ? E.sideName(g.result.winner) + ' wins' : 'draw') : 'unfinished'}  blunders: ${bl.map(m => E.sideName(m.side)[0] + m.text).join(', ') || 'none'}`); }
  } else console.log('commands: status | new [tables|remote] | move "(r,c) -> (r,c)" | undo | hint | list');
})();
