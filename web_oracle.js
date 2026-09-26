/*
 * Exact win/draw/loss oracle for the browser, reading 2-bit packed tables
 * (made by solver/pack.js) with HTTP range requests. No server needed.
 *
 *   const oracle = WolfLambOracle.create({ baseUrl: 'tables/', fetch });
 *   await oracle.ready();                     // loads index.json; false if unavailable
 *   await oracle.lookup(position)             // -> 1 wolf win, 2 lamb win, 3 draw (fresh clock)
 *   await oracle.evalPosition(state)          // -> { value:{winner}, moves:[{from,to,capture,winner}] }
 *
 * Works in Node too (pass a fetch that serves local files) for testing.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require(require('path').join(__dirname, 'bitboard.js')), require(require('path').join(__dirname, 'solver', 'indexing.js')));
  else root.WolfLambOracle = factory(root.Bitboard, root.WolfLambIndexing);
})(typeof self !== 'undefined' ? self : this, function (B, IX) {
  'use strict';
  const WOLF = 1, LAMB = 2, DRAW = 3, BLOCK = 4096;
  function create(opts) {
    const baseUrl = opts.baseUrl, fetchFn = opts.fetch || fetch;
    let index = null, indexPromise = null;
    const blocks = new Map();           // "file:block" -> Promise<Uint8Array>
    async function ready() {
      if (!indexPromise) indexPromise = (async () => {
        try { const r = await fetchFn(baseUrl + 'index.json', { cache: 'force-cache' }); if (!r.ok) return false; index = await r.json(); return true; } catch (e) { return false; }
      })();
      return indexPromise;
    }
    async function readByte(k, byteOffset) {
      const layer = index.layers[k];
      const part = Math.floor(byteOffset / index.partBytes), inPart = byteOffset - part * index.partBytes;
      const file = layer.parts[part], blk = Math.floor(inPart / BLOCK), key = file + ':' + blk;
      if (!blocks.has(key)) {
        blocks.set(key, (async () => {
          const start = blk * BLOCK, end = start + BLOCK - 1;
          const r = await fetchFn(baseUrl + file, { headers: { Range: 'bytes=' + start + '-' + end } });
          if (!r.ok) throw new Error('table fetch failed ' + r.status);
          const data = new Uint8Array(await r.arrayBuffer());
          if (r.status === 200 && data.length > BLOCK) return data.subarray(start, end + 1);   // host ignored the range
          return data;
        })());
      }
      const data = await blocks.get(key);
      return data[inPart - blk * BLOCK];
    }
    async function lookup(p) {
      const k = B.popcount(p.lambs);
      if (k < index.minLambs) return WOLF;
      const idx = IX.canonIndex(k, p.wolves, p.lambs, p.side === WOLF ? 0 : 1);
      const byte = await readByte(k, Math.floor(idx / 4));
      return (byte >> ((idx % 4) * 2)) & 3;
    }
    async function evalPosition(pos) {          // pos: bitboard position { wolves, lambs, side }
      const p = B.clone(pos);
      const value = await lookup(p);
      const buf = new Int32Array(64), n = B.genMoves(p, buf), jobs = [];
      for (let i = 0; i < n; i++) {
        const m = buf[i], q = B.clone(p); B.makeMove(q, m);
        jobs.push(lookup(q).then(w => ({ from: B.moveFrom(m), to: B.moveTo(m), capture: !!B.moveIsCapture(m), winner: w })));
      }
      const moves = await Promise.all(jobs);
      const mover = p.side, rank = w => w === mover ? 2 : w === DRAW ? 1 : 0;
      moves.sort((a, b) => rank(b.winner) - rank(a.winner));
      return { value: { winner: value }, moves, exactKind: 'values-only' };
    }
    return { ready, lookup, evalPosition };
  }
  return { create, WOLF, LAMB, DRAW };
});
