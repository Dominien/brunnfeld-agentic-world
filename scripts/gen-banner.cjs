#!/usr/bin/env node
// Generates banner.png — HERMES-style pixel art (no deps)
'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 1300, H = 220;
const px = Buffer.alloc(W * H * 3, 0);

function set(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = r; px[i+1] = g; px[i+2] = b;
}
function add(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  px[i] = Math.min(255, px[i]+r);
  px[i+1] = Math.min(255, px[i+1]+g);
  px[i+2] = Math.min(255, px[i+2]+b);
}

// ── Dark background with subtle warm vignette ──────────────────────────────
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    set(x, y, 0x14, 0x10, 0x08);  // very dark warm brown-black
  }
}

// ── 8×9 BOLD font — 2px strokes, like HERMES ──────────────────────────────
// bit 7 = leftmost column, bit 0 = rightmost
const G = {
  B: [0b11111110, 0b11000011, 0b11000011, 0b11111110, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11111110],
  R: [0b11111110, 0b11000011, 0b11000011, 0b11000011, 0b11111110, 0b11011000, 0b11001100, 0b11000110, 0b11000011],
  U: [0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b01111110],
  N: [0b11000011, 0b11100011, 0b11110011, 0b11111011, 0b11001111, 0b11000111, 0b11000011, 0b11000011, 0b11000011],
  F: [0b11111111, 0b11000000, 0b11000000, 0b11000000, 0b11111110, 0b11000000, 0b11000000, 0b11000000, 0b11000000],
  E: [0b11111111, 0b11000000, 0b11000000, 0b11000000, 0b11111110, 0b11000000, 0b11000000, 0b11000000, 0b11111111],
  L: [0b11000000, 0b11000000, 0b11000000, 0b11000000, 0b11000000, 0b11000000, 0b11000000, 0b11000000, 0b11111111],
  D: [0b11111110, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11000011, 0b11111110],
};

const CW = 8, CH = 9;   // glyph grid
const S  = 14;           // screen pixels per grid unit
const GAP = 2;           // grid units between chars
const TEXT = 'BRUNNFELD';

const totalW = (TEXT.length * (CW + GAP) - GAP) * S;
const startX = Math.floor((W - totalW) / 2);
const startY = Math.floor((H - CH * S) / 2);

// Helper: is glyph pixel on?
function on(g, row, col) {
  if (row < 0 || row >= CH || col < 0 || col >= CW) return false;
  return ((g[row] >> (CW - 1 - col)) & 1) === 1;
}

// Stepped gradient — 5 bands like HERMES (bright gold → deep brown)
function bandColor(row) {
  if (row <= 0) return [255, 225, 20];   // bright gold
  if (row <= 2) return [250, 185,  0];   // warm gold
  if (row <= 4) return [210, 130,  0];   // amber
  if (row <= 6) return [165,  80,  0];   // dark amber
  return               [105,  42,  8];   // saddle brown
}

// ── Pass 1: drop shadow (offset +4 down, +4 right) ───────────────────────
const SOFF = 4;
for (let ci = 0; ci < TEXT.length; ci++) {
  const g = G[TEXT[ci]]; if (!g) continue;
  const cx = startX + ci * (CW + GAP) * S;
  for (let row = 0; row < CH; row++) {
    for (let col = 0; col < CW; col++) {
      if (!on(g, row, col)) continue;
      for (let dy = 0; dy < S; dy++)
        for (let dx = 0; dx < S; dx++)
          set(cx + col*S + dx + SOFF, startY + row*S + dy + SOFF, 18, 6, 0);
    }
  }
}

// ── Pass 2: ambient glow ─────────────────────────────────────────────────
for (let ci = 0; ci < TEXT.length; ci++) {
  const g = G[TEXT[ci]]; if (!g) continue;
  const cx = startX + ci * (CW + GAP) * S;
  const GLOW = 18;
  for (let row = 0; row < CH; row++) {
    for (let col = 0; col < CW; col++) {
      if (!on(g, row, col)) continue;
      const [br, bg] = bandColor(row);
      for (let dy = -GLOW; dy < S + GLOW; dy++) {
        for (let dx = -GLOW; dx < S + GLOW; dx++) {
          const ex = Math.max(0, Math.abs(dx - S/2) - S/2);
          const ey = Math.max(0, Math.abs(dy - S/2) - S/2);
          const dist = Math.sqrt(ex*ex + ey*ey);
          if (dist > GLOW) continue;
          const f = (1 - dist/GLOW) ** 2.5 * 0.28;
          add(cx+col*S+dx, startY+row*S+dy, Math.round(br*f), Math.round(bg*f*0.7), 0);
        }
      }
    }
  }
}

// ── Pass 3: main letter pixels with bevel ────────────────────────────────
const BEV = 2;  // bevel thickness in screen pixels
for (let ci = 0; ci < TEXT.length; ci++) {
  const g = G[TEXT[ci]]; if (!g) continue;
  const cx = startX + ci * (CW + GAP) * S;
  for (let row = 0; row < CH; row++) {
    for (let col = 0; col < CW; col++) {
      if (!on(g, row, col)) continue;

      const edgeT = !on(g, row-1, col);
      const edgeB = !on(g, row+1, col);
      const edgeL = !on(g, row, col-1);
      const edgeR = !on(g, row, col+1);

      for (let dy = 0; dy < S; dy++) {
        for (let dx = 0; dx < S; dx++) {
          let [r, gr, b] = bandColor(row);

          // Top highlight: bright inner edge where stroke meets empty space above
          if (edgeT && dy < BEV) { r = Math.min(255, r+55); gr = Math.min(255, gr+40); }
          // Left highlight
          else if (edgeL && dx < BEV) { r = Math.min(255, r+30); gr = Math.min(255, gr+22); }
          // Bottom shadow
          else if (edgeB && dy >= S - BEV) { r = Math.max(0, r-70); gr = Math.max(0, gr-55); }
          // Right shadow
          else if (edgeR && dx >= S - BEV) { r = Math.max(0, r-50); gr = Math.max(0, gr-40); }

          set(cx + col*S + dx, startY + row*S + dy, r, gr, b);
        }
      }
    }
  }
}

// ─── PNG encoder ─────────────────────────────────────────────────────────
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c&1) ? (0xEDB88320^(c>>>1)) : (c>>>1);
    t[i] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC[(c^b)&0xFF] ^ (c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}
function chunk(type, data) {
  const tb = Buffer.from(type,'ascii');
  const lb = Buffer.alloc(4); lb.writeUInt32BE(data.length);
  const cb = Buffer.alloc(4); cb.writeUInt32BE(crc32(Buffer.concat([tb,data])));
  return Buffer.concat([lb,tb,data,cb]);
}
const raw = Buffer.alloc((1+W*3)*H);
let p = 0;
for (let y = 0; y < H; y++) {
  raw[p++] = 0;
  px.copy(raw, p, y*W*3, (y+1)*W*3);
  p += W*3;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W,0); ihdr.writeUInt32BE(H,4);
ihdr[8]=8; ihdr[9]=2;

const out = Buffer.concat([
  Buffer.from([137,80,78,71,13,10,26,10]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw,{level:9})),
  chunk('IEND', Buffer.alloc(0)),
]);
const dest = path.join(__dirname,'..','banner.png');
fs.writeFileSync(dest, out);
console.log(`banner.png  ${W}×${H}  ${out.length} bytes`);
