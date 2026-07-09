/**
 * Generates minimal solid-color PNG icons for the PWA manifest.
 * No external dependencies needed — pure Node.
 */
import { createWriteStream } from 'fs';
import { createDeflate } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable, Writable } from 'stream';
import { mkdir } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dir = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dir, '..', 'public');

await mkdir(PUBLIC, { recursive: true });

// Terracotta: #c56a4a → R=197 G=106 B=74
const R = 197, G = 106, B = 74;

async function writePNG(filename, size) {
  const buf = [];

  function u8(v) { buf.push(v & 0xff); }
  function u32be(v) {
    buf.push((v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff);
  }

  // Build raw image data: IHDR + IDAT + IEND
  function crc32(data) {
    let crc = 0xffffffff;
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[i] = c;
    }
    for (const b of data) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = [...type].map((c) => c.charCodeAt(0));
    const all = [...typeBytes, ...data];
    const crc = crc32(all);
    u32be(data.length);
    typeBytes.forEach(u8);
    data.forEach(u8);
    u32be(crc);
  }

  // PNG signature
  [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].forEach(u8);

  // IHDR
  const ihdrData = [];
  const w32 = (v) => { ihdrData.push((v>>>24)&0xff,(v>>>16)&0xff,(v>>>8)&0xff,v&0xff); };
  w32(size); w32(size);
  ihdrData.push(8, 2, 0, 0, 0); // bit depth=8, color=RGB, compress=0, filter=0, interlace=0
  chunk('IHDR', ihdrData);

  // Raw scanlines: filter=0 + RGB per pixel
  const scanline = [0, ...Array(size).fill(null).flatMap(() => [R, G, B])];
  const raw = Array(size).fill(scanline).flat();
  const rawBuf = Buffer.from(raw);

  // Deflate the raw data
  const compressedChunks = [];
  await new Promise((resolve, reject) => {
    const deflater = createDeflate({ level: 6 });
    deflater.on('data', (chunk) => compressedChunks.push(chunk));
    deflater.on('end', resolve);
    deflater.on('error', reject);
    deflater.end(rawBuf);
  });
  const compressed = Buffer.concat(compressedChunks);
  chunk('IDAT', [...compressed]);

  // IEND
  chunk('IEND', []);

  const output = Buffer.from(buf);
  const ws = createWriteStream(join(PUBLIC, filename));
  await new Promise((resolve, reject) => {
    ws.write(output, (err) => {
      if (err) reject(err);
      else { ws.end(); resolve(); }
    });
  });
  console.log(`✓ Created ${filename} (${size}x${size}, ${output.length} bytes)`);
}

await writePNG('pwa-192.png', 192);
await writePNG('pwa-512.png', 512);
console.log('Icons generated.');
