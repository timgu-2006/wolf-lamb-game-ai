// Mines tactical test positions from AI-vs-AI games (depth 4, random openings).
// Prints JSON lines: {kind, w:[[r,c]..], l:[[r,c]..], side}
const E = require('./engine.js'), B = require('./bitboard.js'), AI = require('./ai.js');
function solve(s, d) { const r = E.result(s); if (r) return r.winner === null ? 0 : (r.winner === s.side ? 1 : -1); if (d === 0) return 0; let all = true; for (const m of E.legalMoves(s)) { const v = -solve(E.applyMove(s, m), d - 1); if (v === 1) return 1; if (v !== -1) all = false; } return all ? -1 : 0; }
function enc(s, kind) { const w = [], l = []; for (let i = 0; i < 25; i++) { const [r, c] = E.rc(i); if (s.board[i] === E.WOLF) w.push([r, c]); if (s.board[i] === E.LAMB) l.push([r, c]); } return JSON.stringify({ kind, w, l, side: s.side }); }
let seed = 99; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
let esc = 0, m3 = 0, m5 = 0;
for (let g = 0; g < 40 && (esc < 2 || m3 < 2 || m5 < 1); g++) {
  let s = E.initialState(); const hist = [];
  for (let ply = 0; ply < 120 && !E.result(s); ply++) {
    if (s.side === E.WOLF && esc < 2 && s.lambs >= 6) {
      const ms = E.legalMoves(s);
      const vals = ms.map(m => -solve(E.applyMove(s, m), 4));
      const lose = vals.filter(v => v === -1).length, safe = vals.filter(v => v !== -1).length;
      if (lose >= 1 && safe >= 1 && ms.length >= 3 && solve(s, 5) !== 1) { esc++; console.log(enc(s, 'escape')); console.error(E.toString(s) + 'lose ' + lose + ' safe ' + safe); }
    }
    if (s.side === E.LAMB && m3 < 2 && s.lambs >= 6 && solve(s, 1) !== 1 && solve(s, 3) === 1) { m3++; console.log(enc(s, 'mate3')); console.error(E.toString(s)); }
    if (s.side === E.LAMB && m5 < 1 && s.lambs >= 8 && solve(s, 3) !== 1 && solve(s, 5) === 1) { m5++; console.log(enc(s, 'mate5')); console.error(E.toString(s)); }
    let em;
    if (ply < 6) { const ms = E.legalMoves(s); em = ms[Math.floor(rand() * ms.length)]; }
    else em = B.toEngineMove(AI.chooseMove(B.fromState(s), { depth: 4, history: hist, clearTT: true }).move);
    hist.push(B.key(B.fromState(s))); s = E.applyMove(s, em);
  }
}
console.error('done', esc, m3, m5);
