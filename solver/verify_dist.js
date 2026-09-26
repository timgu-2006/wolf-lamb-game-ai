#!/usr/bin/env node
/*
 * Independent verifier for the distance tables dist_<k>.bin (D) and seg_<k>.bin (S)
 * produced by dist.c, given the value tables layer_<k>.bin (already verified).
 *
 * For a won state s with winner X and mover M, and each child c:
 *   d(c) = 1 + D(c)         for a step to a state labelled X (else invalid)
 *        = 1 + D_lower(c)   for a capture into a lower state labelled X
 *        = 1                for a capture leaving 3 or fewer lambs (X must be the wolves)
 *   s(c) = S(c) for a step (INF if S(c) = 0xFFFF); for a capture: 0 if the landing
 *          position is exact (3 or fewer lambs, or its lower-layer S <= 100), else INF
 * Conditions:
 *   no moves      : D = 0, S = 0
 *   M = X         : D = 1 + min_c d(c);  S = 1 + min over children with d(c) = D of s(c)
 *   M != X        : all children valid; D = 1 + max_c d(c);  S = 1 + max_c s(c)
 *   (an infinite S is stored as 0xFFFF)
 *   draws         : D = S = 0xFFFF
 * By induction on D (and then on S) these pin both tables to the definitions.
 * Where S <= 100 - clock, D is exact under the full rules; otherwise a lower bound.
 *
 * Usage: node solver/verify_dist.js [minLayer] [maxLayer] [threads]
 */
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const B = require(path.join(__dirname, '..', 'bitboard.js'));
const IX = require(path.join(__dirname, 'indexing.js'));
const { xf, binom, nOrbits, orbitMask, orbitStab, rankLambs, expandLambs, isAlias, canonIndex, nextComb, layerSize } = IX;
const WOLF = 1, LAMB = 2, DRAW = 3, NONE = 0xffff, INF = 1e9;
const TABLES = process.env.WL_TABLES ? path.resolve(process.env.WL_TABLES) : path.join(__dirname, 'tables');

function loadShared(name, k) {
  const n = layerSize(k), file = path.join(TABLES, `${name}_${k}.bin`);
  const st = fs.statSync(file);
  if (st.size !== n * 2) throw new Error(`${file}: size ${st.size}, expected ${n * 2}`);
  const sab = new SharedArrayBuffer(n * 2), u8 = new Uint8Array(sab);
  const fd = fs.openSync(file, 'r'); let off = 0;
  while (off < u8.length) { const got = fs.readSync(fd, u8, off, Math.min(1 << 26, u8.length - off), off); if (got <= 0) throw new Error('short read'); off += got; }
  fs.closeSync(fd);
  return sab;
}

function verifyRange(k, val, dist, seg, lval, ldist, lseg, tid, nThreads) {
  const c22k = binom[22][k];
  const buf = new Int32Array(64);
  const stats = { states: 0, won: 0, errors: 0, maxD: 0, maxS: 0, over100: 0, samples: [] };
  const p = { wolves: 0, lambs: 0, side: WOLF, clock: 0 };
  const cd = new Int32Array(64), cs = new Int32Array(64), cv = new Int32Array(64);
  function fail(idx, msg, w, l, side) { stats.errors++; if (stats.samples.length < 5) stats.samples.push(`layer ${k} idx ${idx} side ${side} w=${w.toString(2)} l=${l.toString(2)}: ${msg}`); }
  for (let o = tid; o < nOrbits; o += nThreads) {
    const w = orbitMask[o];
    let cm = (1 << k) - 1, rank = 0;
    for (; cm < (1 << 22); cm = nextComb(cm), rank++) {
      const l = expandLambs(o, cm);
      const base = (o * c22k + rank) * 2;
      if (isAlias(o, l)) {
        const st = orbitStab[o]; let best = l; for (let i = 1; i < st.length; i++) best = Math.min(best, xf(st[i], l));
        const src = (o * c22k + rankLambs(o, best)) * 2;
        for (let side = 0; side < 2; side++) if (dist[base + side] !== dist[src + side] || seg[base + side] !== seg[src + side]) fail(base + side, 'alias mismatch', w, l, side);
        continue;
      }
      for (let side = 0; side < 2; side++) {
        const idx = base + side, X = val[idx] >>> 14, D = dist[idx], S = seg[idx];
        const M = side === 0 ? WOLF : LAMB;
        stats.states++;
        if (X === DRAW) { if (D !== NONE || S !== NONE) fail(idx, 'draw with a distance', w, l, side); continue; }
        stats.won++;
        if (D === NONE) { fail(idx, 'won state without distance', w, l, side); continue; }
        if (D > stats.maxD) stats.maxD = D;
        if (S !== NONE && S > stats.maxS) stats.maxS = S;
        if (S > 100) stats.over100++;
        p.wolves = w; p.lambs = l; p.side = M; p.clock = 0;
        const n = B.genMoves(p, buf);
        for (let i = 0; i < n; i++) {
          const m = buf[i], undo = B.makeMove(p, m);
          if (B.moveIsCapture(m)) {
            if (B.popcount(p.lambs) < 4) { cv[i] = X === WOLF ? 1 : 0; cd[i] = 1; cs[i] = 0; }
            else { const ci = canonIndex(k - 1, p.wolves, p.lambs, 1); cv[i] = (lval[ci] >>> 14) === X ? 1 : 0; cd[i] = 1 + ldist[ci]; cs[i] = lseg[ci] <= 100 ? 0 : INF; }
          } else {
            const ci = canonIndex(k, p.wolves, p.lambs, side ^ 1);
            cv[i] = (val[ci] >>> 14) === X ? 1 : 0; cd[i] = 1 + dist[ci]; cs[i] = seg[ci] === NONE ? INF : seg[ci];
          }
          B.unmakeMove(p, m, undo);
        }
        const Sv = S === NONE ? INF : S;
        if (n === 0) { if (D !== 0 || S !== 0) fail(idx, `terminal with D=${D} S=${S}`, w, l, side); continue; }
        if (M === X) {
          let minD = Infinity, minS = Infinity;
          for (let i = 0; i < n; i++) if (cv[i]) { if (cd[i] < minD) minD = cd[i]; }
          if (minD === Infinity || D !== minD) { fail(idx, `winner to move: D=${D}, expected ${minD}`, w, l, side); continue; }
          for (let i = 0; i < n; i++) if (cv[i] && cd[i] === D) { const sc = cs[i]; if (sc < minS) minS = sc; }
          if (Sv !== (minS === INF ? INF : 1 + minS)) fail(idx, `winner to move: S=${S}, expected ${minS === INF ? 'inf' : 1 + minS}`, w, l, side);
        } else {
          let maxD = -1, maxS = -1, bad = false;
          for (let i = 0; i < n; i++) { if (!cv[i]) bad = true; if (cd[i] > maxD) maxD = cd[i]; if (cs[i] > maxS) maxS = cs[i]; }
          if (bad) { fail(idx, 'loser to move has an escaping child', w, l, side); continue; }
          if (D !== maxD) { fail(idx, `loser to move: D=${D}, expected ${maxD}`, w, l, side); continue; }
          if (Sv !== (maxS === INF ? INF : 1 + maxS)) fail(idx, `loser to move: S=${S}, expected ${maxS === INF ? 'inf' : 1 + maxS}`, w, l, side);
        }
      }
    }
  }
  return stats;
}

if (isMainThread) {
  const minLayer = +(process.argv[2] || 4), maxLayer = +(process.argv[3] || 15), nThreads = +(process.argv[4] || 12);
  (async () => {
    let allOk = true;
    for (let k = minLayer; k <= maxLayer; k++) {
      const t0 = Date.now();
      const val = loadShared('layer', k), dist = loadShared('dist', k), seg = loadShared('seg', k);
      const lval = k - 1 >= 4 ? loadShared('layer', k - 1) : null, ldist = k - 1 >= 4 ? loadShared('dist', k - 1) : null, lseg = k - 1 >= 4 ? loadShared('seg', k - 1) : null;
      const results = await Promise.all([...Array(nThreads).keys()].map(tid => new Promise((res, rej) => {
        const wk = new Worker(__filename, { workerData: { k, val, dist, seg, lval, ldist, lseg, tid, nThreads } });
        wk.on('message', res); wk.on('error', rej);
      })));
      const tot = { states: 0, won: 0, errors: 0, maxD: 0, maxS: 0, over100: 0, samples: [] };
      for (const r of results) { for (const key of ['states', 'won', 'errors', 'over100']) tot[key] += r[key]; tot.maxD = Math.max(tot.maxD, r.maxD); tot.maxS = Math.max(tot.maxS, r.maxS); tot.samples.push(...r.samples); }
      console.log(`layer ${String(k).padStart(2)}: ${tot.states} states, ${tot.won} won, errors ${tot.errors}, max D ${tot.maxD}, max exact S ${tot.maxS}, won states where D is a lower bound: ${tot.over100}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
      for (const s of tot.samples.slice(0, 5)) console.log('   ' + s);
      if (tot.errors) allOk = false;
    }
    console.log(allOk ? 'ALL DISTANCE TABLES VERIFIED' : 'DISTANCE VERIFICATION FAILED');
    process.exit(allOk ? 0 : 1);
  })();
} else {
  const { k, val, dist, seg, lval, ldist, lseg, tid, nThreads } = workerData;
  const stats = verifyRange(k, new Uint16Array(val), new Uint16Array(dist), new Uint16Array(seg), lval ? new Uint16Array(lval) : null, ldist ? new Uint16Array(ldist) : null, lseg ? new Uint16Array(lseg) : null, tid, nThreads);
  parentPort.postMessage(stats);
}
