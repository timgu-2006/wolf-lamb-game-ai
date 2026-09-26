#!/usr/bin/env node
/*
 * Independent verifier for the solver tables (solver/tables/layer_<k>.bin).
 *
 * Uses its own state indexing (indexing.js, written independently of solve.c)
 * and bitboard.js (cross-checked against engine.js, the reference rules) for
 * move generation. For every state it checks the local consistency conditions that
 * characterise the exact game value under the full rules:
 *
 *   T(s) for the winner X = plies within which X forces a capture into an X-win
 *   state of the layer below, or a terminal win. Wins require T <= 100 (the
 *   no-capture clock). "Z-win-within n" for a child: a capture into a Z-win
 *   lower state, or a step to a state labelled Z-win with T <= n.
 *
 *   no moves      : label = opponent wins, T = 0
 *   mover wins, T : some child is mover-win-within T-1, none within T-2, 1<=T<=100
 *   opp. wins, T  : all children opp-win-within T-1, some not within T-2, 1<=T<=100
 *   draw          : no child mover-win-within 99, some child not opp-win-within 99
 *
 * By induction on T these conditions pin the labels to the true values (see
 * SOLUTION.md), given that layer k-1 is correct; fewer than 3 lambs is a wolf win.
 *
 * Usage: node solver/verify.js [minLayer] [maxLayer] [threads]
 */
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const B = require(path.join(__dirname, '..', 'bitboard.js'));

const IX = require(path.join(__dirname, 'indexing.js'));
const { xf, binom, nOrbits, orbitMask, orbitStab, rankLambs, expandLambs, isAlias, canonIndex, nextComb, layerSize } = IX;
const WOLF = 1, LAMB = 2, DRAW = 3, CLOCK = +(process.env.WL_CLOCK || 100);
const TABLES = process.env.WL_TABLES ? path.resolve(process.env.WL_TABLES) : path.join(__dirname, 'tables');

// ---- table IO ----------------------------------------------------------------
function loadShared(k) {
  const n = layerSize(k), file = path.join(TABLES, `layer_${k}.bin`);
  const st = fs.statSync(file);
  if (st.size !== n * 2) throw new Error(`${file}: size ${st.size}, expected ${n * 2}`);
  const sab = new SharedArrayBuffer(n * 2), u8 = new Uint8Array(sab);
  const fd = fs.openSync(file, 'r'); let off = 0;
  while (off < u8.length) { const got = fs.readSync(fd, u8, off, Math.min(1 << 26, u8.length - off), off); if (got <= 0) throw new Error('short read'); off += got; }
  fs.closeSync(fd);
  return sab;
}

// ---- worker: verify a stride of orbits -------------------------------------
function verifyRange(k, tab, lower, tid, nThreads) {
  const c22k = binom[22][k];
  const buf = new Int32Array(64);
  const stats = { states: 0, alias: 0, wolf: 0, lamb: 0, draw: 0, errors: 0, samples: [] };
  const p = { wolves: 0, lambs: 0, side: WOLF, clock: 0 };
  const cw = new Int32Array(64), ct = new Int32Array(64), cc = new Int32Array(64);
  function childWinWithin(i, Z, n) { return cw[i] === Z && (cc[i] === 1 || ct[i] <= n); }
  function fail(idx, msg, w, l, side) {
    stats.errors++;
    if (stats.samples.length < 5) stats.samples.push(`layer ${k} idx ${idx} side ${side} w=${w.toString(2)} l=${l.toString(2)}: ${msg}`);
  }
  for (let o = tid; o < nOrbits; o += nThreads) {
    const w = orbitMask[o];
    let cm = (1 << k) - 1, rank = 0;
    for (; cm < (1 << 22); cm = nextComb(cm), rank++) {
      const l = expandLambs(o, cm);
      const base = (o * c22k + rank) * 2;
      if (isAlias(o, l)) {
        // alias: must equal the canonical twin
        const st = orbitStab[o]; let best = l; for (let i = 1; i < st.length; i++) best = Math.min(best, xf(st[i], l));
        const src = (o * c22k + rankLambs(o, best)) * 2;
        if (tab[base] !== tab[src] || tab[base + 1] !== tab[src + 1]) fail(base, 'alias mismatch', w, l, -1);
        stats.alias += 2;
        continue;
      }
      for (let side = 0; side < 2; side++) {
        const idx = base + side;
        const v = tab[idx], win = v >>> 14, T = v & 0x3fff;
        const M = side === 0 ? WOLF : LAMB, Y = 3 - M;
        stats.states++;
        if (win === WOLF) stats.wolf++; else if (win === LAMB) stats.lamb++; else if (win === DRAW) stats.draw++; else { fail(idx, 'unset value', w, l, side); continue; }
        p.wolves = w; p.lambs = l; p.side = M; p.clock = 0;
        const n = B.genMoves(p, buf);
        for (let i = 0; i < n; i++) {
          const m = buf[i];
          const undo = B.makeMove(p, m);
          cc[i] = B.moveIsCapture(m);
          if (cc[i]) {
            if (k - 1 < 3) { cw[i] = WOLF; ct[i] = 0; }
            else { const lv = lower[canonIndex(k - 1, p.wolves, p.lambs, 1)]; cw[i] = lv >>> 14; ct[i] = lv & 0x3fff; }
          } else {
            const sv = tab[canonIndex(k, p.wolves, p.lambs, side ^ 1)]; cw[i] = sv >>> 14; ct[i] = sv & 0x3fff;
          }
          B.unmakeMove(p, m, undo);
        }
        if (n === 0) {
          if (!(win === Y && T === 0)) fail(idx, `terminal: expected opponent win T=0, got win=${win} T=${T}`, w, l, side);
          continue;
        }
        if (win === M) {
          if (T < 1 || T > CLOCK) { fail(idx, `mover win with T=${T}`, w, l, side); continue; }
          let ok = false, tooFast = false;
          for (let i = 0; i < n; i++) { if (childWinWithin(i, M, T - 1)) ok = true; if (T >= 2 && childWinWithin(i, M, T - 2)) tooFast = true; }
          if (!ok) fail(idx, `mover win T=${T} but no child wins within ${T - 1}`, w, l, side);
          else if (tooFast) fail(idx, `mover win T=${T} not minimal`, w, l, side);
        } else if (win === Y) {
          if (T < 1 || T > CLOCK) { fail(idx, `opponent win with T=${T}`, w, l, side); continue; }
          let all = true, attained = false;
          for (let i = 0; i < n; i++) { if (!childWinWithin(i, Y, T - 1)) all = false; if (T < 2 || !childWinWithin(i, Y, T - 2)) attained = true; }
          if (!all) fail(idx, `opponent win T=${T} but some child escapes`, w, l, side);
          else if (!attained) fail(idx, `opponent win T=${T} not maximal`, w, l, side);
        } else {
          if (T !== 0) { fail(idx, 'draw with T != 0', w, l, side); continue; }
          let moverWins = false, safe = false;
          for (let i = 0; i < n; i++) { if (childWinWithin(i, M, CLOCK - 1)) moverWins = true; if (!childWinWithin(i, Y, CLOCK - 1)) safe = true; }
          if (moverWins) fail(idx, 'draw but mover has a win within 100', w, l, side);
          else if (!safe) fail(idx, 'draw but every child loses within 100', w, l, side);
        }
      }
    }
  }
  return stats;
}

// ---- self-test of the indexing ---------------------------------------------
function selfTest() {
  let seed = 12345; const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let it = 0; it < 20000; it++) {
    const k = 3 + Math.floor(rand() * 13);
    const cells = [...Array(25).keys()].sort(() => rand() - 0.5);
    let w = 0, l = 0;
    for (let i = 0; i < 3; i++) w |= 1 << cells[i];
    for (let i = 3; i < 3 + k; i++) l |= 1 << cells[i];
    const side = rand() < 0.5 ? 0 : 1;
    const idx = canonIndex(k, w, l, side);
    if (idx < 0 || idx >= layerSize(k)) throw new Error('index out of range');
    for (let t = 0; t < 8; t++) if (canonIndex(k, xf(t, w), xf(t, l), side) !== idx) throw new Error('symmetry images map to different indices');
    // round trip: the index must decode to a position equivalent to (w, l)
    const s = Math.floor(idx / 2), o = Math.floor(s / binom[22][k]), r = s % binom[22][k];
    let cm = 0, rr = r;
    for (let i = k - 1; i >= 0; i--) { let c = 21; while (binom[c][i + 1] > rr) c--; rr -= binom[c][i + 1]; cm |= 1 << c; }
    const l2 = expandLambs(o, cm), w2 = orbitMask[o];
    let equiv = false; for (let t = 0; t < 8; t++) if (xf(t, w) === w2 && xf(t, l) === l2) equiv = true;
    if (!equiv) throw new Error('round trip failed');
    if (rankLambs(o, l2) !== r) throw new Error('rank/unrank mismatch');
  }
}

if (isMainThread) {
  const minLayer = +(process.argv[2] || 3), maxLayer = +(process.argv[3] || 15), nThreads = +(process.argv[4] || 12);
  selfTest();
  console.log(`indexing self-test ok (${nOrbits} wolf orbits)`);
  (async () => {
    let allOk = true;
    for (let k = minLayer; k <= maxLayer; k++) {
      const t0 = Date.now();
      const tab = loadShared(k);
      const lower = k - 1 >= 3 ? loadShared(k - 1) : null;
      const results = await Promise.all([...Array(nThreads).keys()].map(tid => new Promise((res, rej) => {
        const wk = new Worker(__filename, { workerData: { k, tab, lower, tid, nThreads } });
        wk.on('message', res); wk.on('error', rej);
      })));
      const tot = { states: 0, alias: 0, wolf: 0, lamb: 0, draw: 0, errors: 0, samples: [] };
      for (const r of results) { for (const key of ['states', 'alias', 'wolf', 'lamb', 'draw', 'errors']) tot[key] += r[key]; tot.samples.push(...r.samples); }
      const secs = ((Date.now() - t0) / 1000).toFixed(0);
      console.log(`layer ${String(k).padStart(2)}: ${tot.states} states checked (+${tot.alias} aliases)  wolf-win ${tot.wolf}  lamb-win ${tot.lamb}  draw ${tot.draw}  errors ${tot.errors}  (${secs}s)`);
      for (const s of tot.samples.slice(0, 5)) console.log('   ' + s);
      if (tot.errors) allOk = false;
    }
    console.log(allOk ? 'ALL LAYERS VERIFIED' : 'VERIFICATION FAILED');
    process.exit(allOk ? 0 : 1);
  })();
} else {
  const { k, tab, lower, tid, nThreads } = workerData;
  const stats = verifyRange(k, new Uint16Array(tab), lower ? new Uint16Array(lower) : null, tid, nThreads);
  parentPort.postMessage(stats);
}
