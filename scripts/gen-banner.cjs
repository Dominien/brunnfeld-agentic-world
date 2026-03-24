#!/usr/bin/env node
// Generates banner.png — HERMES-style pixel-art title card (no external deps)
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 1200, H = 200;
const px = Buffer.alloc(W * H * 3, 0);

function set(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i+1] = g; px[i+2] = b;
}
function add(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i]   = Math.min(255, px[i]   + r);
  px[i+1] = Math.min(255, px[i+1] + g);
  px[i+2] = Math.min(255, px[i+2] + b);
}

// ── Background: pure black with warm amber vignette glow behind text ──────────
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // Horizontal ambient band in the vertical center
    const dy = Math.abs(y - H / 2) / (H / 2);
    const dx = Math.abs(x - W / 2) / (W / 2);
    const ambientY = Math.pow(Math.max(0, 1 - dy * 1.6), 3);
    const ambientX = Math.pow(Math.max(0, 1 - dx * 1.1), 2);
    const a = ambientY * ambientX * 0.28;
    set(x, y, Math.round(a * 120), Math.round(a * 55), 0);
  }
}

// ── 5×7 Bitmap font ───────────────────────────────────────────────────────────
const G = {
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
};

const S   = 18;
const CW  = 5, CH = 7;
const GAP = 2;
const TEXT = 'BRUNNFELD';

const totalW = (TEXT.length * (CW + GAP) - GAP) * S;
const startX = Math.floor((W - totalW) / 2);
const startY = Math.floor((H - CH * S) / 2);

// ── Pass 1: fat ambient glow ──────────────────────────────────────────────────
const GLOW = 22;
for (let ci = 0; ci < TEXT.length; ci++) {
  const g = G[TEXT[ci]];
  if (!g) continue;
  const cx = startX + ci * (CW + GAP) * S;
  for (let row = 0; row < CH; row++) {
    const t = row / (CH - 1);
    // Glow colour mirrors the letter gradient but dimmed
    const gr = Math.round((255 - 116 * t) * 0.22);
    const gg = Math.round((215 - 146 * t) * 0.18);
    const gb = Math.round(19 * t * 0.08);
    for (let col = 0; col < CW; col++) {
      if (!((g[row] >> (CW - 1 - col)) & 1)) continue;
      for (let dy = -GLOW; dy < S + GLOW; dy++) {
        for (let dx = -GLOW; dx < S + GLOW; dx++) {
          const ex = Math.max(0, Math.abs(dx - (S-1)/2) - S/2);
          const ey = Math.max(0, Math.abs(dy - (S-1)/2) - S/2);
          const dist = Math.sqrt(ex*ex + ey*ey);
          if (dist > GLOW) continue;
          const fade = (1 - dist / GLOW) ** 2.2;
          add(cx + col*S + dx, startY + row*S + dy,
              Math.round(gr * fade), Math.round(gg * fade), Math.round(gb * fade));
        }
      }
    }
  }
}

// ── Pass 2: sharp letter pixels ───────────────────────────────────────────────
for (let ci = 0; ci < TEXT.length; ci++) {
  const g = G[TEXT[ci]];
  if (!g) continue;
  const cx = startX + ci * (CW + GAP) * S;
  for (let row = 0; row < CH; row++) {
    const t = row / (CH - 1);
    // #FFD700 → #8B4513
    const r  = Math.round(255 - 116 * t);
    const gr = Math.round(215 - 146 * t);
    const b  = Math.round(       19 * t);
    for (let col = 0; col < CW; col++) {
      if (!((g[row] >> (CW - 1 - col)) & 1)) continue;
      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          // Top-edge highlight
          const hi = (dy === 0 && dx > 0 && dx < S - 1);
          set(cx + col*S + dx, startY + row*S + dy,
              hi ? Math.min(255, r+40) : r,
              hi ? Math.min(255, gr+28) : gr,
              b);
        }
      }
    }
  }
}

// ── PNG encoder ───────────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const tb = Buffer.from(type, 'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb, data])));
  return Buffer.concat([lb, tb, data, cb]);
}

const raw = Buffer.alloc((1 + W * 3) * H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  px.copy(raw, p, y * W * 3, (y + 1) * W * 3);
  p += W * 3;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; ihdr[9] = 2;

const out = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const dest = path.join(__dirname, '..', 'banner.png');
fs.writeFileSync(dest, out);
console.log(`banner.png written (${out.length} bytes, ${W}×${H})`);
