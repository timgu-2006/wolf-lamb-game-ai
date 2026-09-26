#!/usr/bin/env node
/*
 * Self-play harness.
 *
 *   node selfplay.js [--games N] [--wolf SPEC] [--lamb SPEC]
 *                    [--wolf-weights JSON] [--lamb-weights JSON]
 *                    [--random-openings K] [--seed S] [--quiet]
 *
 * SPEC is one of:  random | depth:N | time:MS        (default depth:4)
 * The first K plies of each game are random (seeded) so games differ.
 * Every move is validated against engine.js, the reference rules.
 */
const E = require('./engine.js');
const B = require('./bitboard.js');
const AI = require('./ai.js');

function parseArgs(argv) {
  const a = { games: 10, wolf: 'depth:4', lamb: 'depth:4', wolfWeights: null, lambWeights: null, randomOpenings: 2, seed: 1, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--games') a.games = +v, i++;
    else if (k === '--wolf') a.wolf = v, i++;
    else if (k === '--lamb') a.lamb = v, i++;
    else if (k === '--wolf-weights') a.wolfWeights = JSON.parse(v), i++;
    else if (k === '--lamb-weights') a.lambWeights = JSON.parse(v), i++;
    else if (k === '--random-openings') a.randomOpenings = +v, i++;
    else if (k === '--seed') a.seed = +v, i++;
    else if (k === '--quiet') a.quiet = true;
    else throw new Error('unknown arg ' + k);
  }
  return a;
}

function makePlayer(spec, weights) {
  if (spec === 'random') return { name: 'random', pick: (p, hist, rand) => null };
  const [kind, num] = spec.split(':');
  const opts = kind === 'depth' ? { depth: +num } : { timeMs: +num };
  return {
    name: spec + (weights ? ' ' + JSON.stringify(weights) : ''),
    pick: (p, hist) => AI.chooseMove(p, Object.assign({ history: hist, weights: weights || undefined, clearTT: true }, opts)),
  };
}

function playGame(wolf, lamb, randomOpenings, rand, verbose) {
  let s = E.initialState();
  const hist = [];
  const buf = new Int32Array(64);
  let ply = 0, movesPlayed = [];
  for (;;) {
    const r = E.result(s);
    if (r) return { winner: r.winner, reason: r.reason, plies: ply, moves: movesPlayed };
    const p = B.fromState(s);
    const legal = E.legalMoves(s);
    let em;
    const player = s.side === E.WOLF ? wolf : lamb;
    if (ply < randomOpenings || player.name === 'random') {
      em = legal[Math.floor(rand() * legal.length)];
    } else {
      const res = player.pick(p, hist);
      em = B.toEngineMove(res.move);
      if (!E.isLegal(s, em)) throw new Error('AI produced illegal move ' + E.describeMove(em) + '\n' + E.toString(s));
    }
    hist.push(B.key(p));
    movesPlayed.push(E.describeMove(em));
    s = E.applyMove(s, em);
    ply++;
  }
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let seed = a.seed;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const wolf = makePlayer(a.wolf, a.wolfWeights);
  const lamb = makePlayer(a.lamb, a.lambWeights);
  const tally = { wolf: 0, lamb: 0, draw: 0 };
  const reasons = {};
  let totalPlies = 0;
  const t0 = Date.now();
  for (let g = 0; g < a.games; g++) {
    const res = playGame(wolf, lamb, a.randomOpenings, rand, !a.quiet);
    const w = res.winner === E.WOLF ? 'wolf' : res.winner === E.LAMB ? 'lamb' : 'draw';
    tally[w]++; totalPlies += res.plies;
    reasons[res.reason] = (reasons[res.reason] || 0) + 1;
    if (!a.quiet) console.log(`game ${g + 1}: ${w} (${res.reason}) in ${res.plies} plies`);
  }
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\nwolf=[${wolf.name}] vs lamb=[${lamb.name}]  games=${a.games} openings=${a.randomOpenings} seed=${a.seed}`);
  console.log(`result: wolf ${tally.wolf}  lamb ${tally.lamb}  draw ${tally.draw}   avg plies ${(totalPlies / a.games).toFixed(1)}  (${secs}s)`);
  console.log('reasons:', reasons);
}

if (require.main === module) main();
module.exports = { playGame, makePlayer };
