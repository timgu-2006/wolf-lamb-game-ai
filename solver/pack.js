#!/usr/bin/env node
/*
 * Pack the value tables to 2 bits per entry (1 wolf win, 2 lamb win, 3 draw) for static
 * hosting, split into parts below GitHub's 100 MB file limit.
 *   node solver/pack.js [outDir=tables] [partMB=64]
 * Writes <outDir>/layer_<k>.p<n>.bin and <outDir>/index.json.
 */
const fs = require('fs'), path = require('path');
const IX = require(path.join(__dirname, 'indexing.js'));
const outDir = path.resolve(process.argv[2] || 'tables'), partBytes = (+(process.argv[3] || 64)) * 1024 * 1024;
fs.mkdirSync(outDir, { recursive: true });
const index = { bitsPerEntry: 2, partBytes, minLambs: 4, maxLambs: 15, layers: {} };
for (let k = 4; k <= 15; k++) {
  const src = path.join(__dirname, 'tables', `layer_${k}.bin`);
  const n = IX.layerSize(k), fd = fs.openSync(src, 'r');
  const packed = Buffer.alloc(Math.ceil(n / 4));
  const CH = 1 << 22, buf = Buffer.alloc(CH * 2);
  for (let i = 0; i < n; i += CH) {
    const cnt = Math.min(CH, n - i);
    fs.readSync(fd, buf, 0, cnt * 2, i * 2);
    for (let j = 0; j < cnt; j++) { const v = buf.readUInt16LE(j * 2) >>> 14; const e = i + j; packed[e >> 2] |= v << ((e & 3) * 2); }
  }
  fs.closeSync(fd);
  const parts = [];
  for (let off = 0, p = 0; off < packed.length; off += partBytes, p++) {
    const name = `layer_${k}.p${p}.bin`;
    fs.writeFileSync(path.join(outDir, name), packed.subarray(off, Math.min(off + partBytes, packed.length)));
    parts.push(name);
  }
  index.layers[k] = { entries: n, bytes: packed.length, parts };
  console.log(`layer ${k}: ${n} entries -> ${(packed.length / 1e6).toFixed(1)} MB in ${parts.length} part(s)`);
}
fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index));
console.log('total ' + (Object.values(index.layers).reduce((s, l) => s + l.bytes, 0) / 1e6).toFixed(0) + ' MB');
