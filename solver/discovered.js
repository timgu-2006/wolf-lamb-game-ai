#!/usr/bin/env node
/*
 * Find "discovered double attacks": a wolf move after which two or more lambs are
 * capturable, at least one of them by a wolf that did NOT move and whose capture line
 * ran through the square the moving wolf just vacated (a revealed capture), and the
 * lambs cannot parry all threats with one move.
 *   node solver/discovered.js [frontierPositions]
 */
const path = require('path');
const E = require(path.join(__dirname, '..', 'engine.js'));
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const TB = require(path.join(__dirname, 'tables.js'));
const { collectFrontier } = require(path.join(__dirname, 'learnrule.js'));
const N = ['', 'WOLF', 'LAMB', 'DRAW'];
const { threats, discoveredDouble } = require(path.join(__dirname, 'tactics.js'));
function show(p) { const s = E.initialState(); s.board.fill(E.EMPTY); for (let i = 0; i < 25; i++) { if (p.wolves & (1 << i)) s.board[i] = E.WOLF; else if (p.lambs & (1 << i)) s.board[i] = E.LAMB; } return E.toString(s).split('\n').map(l => '    ' + l).join('\n'); }
const cellName = i => '(' + (Math.floor(i / 5) + 1) + ',' + (i % 5 + 1) + ')';

const positions = collectFrontier(+(process.argv[2] || 20000));
let nPos = 0, nWithTactic = 0, nOnlyMove = 0, nTacticDraws = 0, nTacticTotal = 0; const examples = [];
for (const { p, outs } of positions) {
  nPos++;
  const drawing = outs.filter(o => o.winner === TB.DRAW);
  let has = false;
  for (const o of outs) {
    const dd = discoveredDouble(p, o.move);
    if (!dd) continue;
    nTacticTotal++; has = true;
    if (o.winner === TB.DRAW) {
      nTacticDraws++;
      if (drawing.length === 1 && examples.length < 4) examples.push({ p, m: o.move, dd });
      if (drawing.length === 1) nOnlyMove++;
    }
  }
  if (has) nWithTactic++;
}
console.log(`${nPos} drawn wolf-to-move positions from the drawing frontier`);
console.log(`positions offering a discovered double attack: ${nWithTactic} (${(100 * nWithTactic / nPos).toFixed(1)}%)`);
console.log(`discovered double attacks found: ${nTacticTotal}, of which ${nTacticDraws} keep the draw; in ${nOnlyMove} positions it is the ONLY drawing move`);
for (const ex of examples) {
  const em = B.toEngineMove(ex.m);
  console.log(`\nonly drawing move: ${E.describeMove(em)}  (wolf to move)\n` + show(ex.p));
  console.log('    revealed: ' + ex.dd.revealed.map(t => 'wolf ' + cellName(t.wolf) + ' now threatens ' + cellName(t.lamb)).join('; ') + '; all threats after the move: ' + [...new Set(ex.dd.threats.map(t => cellName(t.lamb)))].join(' '));
}
