/**
 * gen-icons.mjs — generates functional default PWA icons.
 *
 * Produces:
 *   packages/app/public/icons/icon-192.png  (192×192)
 *   packages/app/public/icons/icon-512.png  (512×512)
 *
 * These are FUNCTIONAL DEFAULTS intended to be replaced with real brand art.
 * Design: dark (#1f1f1f) background, lighter (#4a9eff) centered rounded square
 * with the letter "Z" — matching ZilInventor's theme color.
 *
 * Uses only Node built-ins (zlib, fs, path) — no external dependencies.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

// --- PNG encoding helpers ---

function adler32(data) {
  let s1 = 1, s2 = 0;
  for (let i = 0; i < data.length; i++) {
    s1 = (s1 + data[i]) % 65521;
    s2 = (s2 + s1) % 65521;
  }
  return (s2 << 16) | s1;
}

function crc32(buf) {
  const table = crc32.table || (crc32.table = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    return t;
  })());
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u32be(n) {
  return Buffer.from([(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]);
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'ascii');
  const len = u32be(data.length);
  const crcInput = Buffer.concat([typeBytes, data]);
  const crc = u32be(crc32(crcInput));
  return Buffer.concat([len, typeBytes, data, crc]);
}

/**
 * Generate a PNG from a pixel data array (RGBA, row-major).
 * @param {number} w - width in pixels
 * @param {number} h - height in pixels
 * @param {Uint8Array} rgba - flat RGBA array, length w*h*4
 */
function makePng(w, h, rgba) {
  // IHDR
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(w, 0);
  ihdrData.writeUInt32BE(h, 4);
  ihdrData[8] = 8;   // bit depth
  ihdrData[9] = 2;   // color type: RGB (we'll write RGB scanlines, not RGBA, to keep it simple)
  // Actually let's use RGBA (color type 6) to handle transparency in future
  ihdrData[9] = 6;   // color type: RGBA
  ihdrData[10] = 0;  // compression
  ihdrData[11] = 0;  // filter
  ihdrData[12] = 0;  // interlace

  // Build raw scanline data with filter byte 0 (None) prepended per row
  const rawSize = h * (1 + w * 4);
  const raw = Buffer.alloc(rawSize);
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0; // filter byte: None
    for (let x = 0; x < w; x++) {
      const src = (y * w + x) * 4;
      const dst = y * (1 + w * 4) + 1 + x * 4;
      raw[dst]     = rgba[src];
      raw[dst + 1] = rgba[src + 1];
      raw[dst + 2] = rgba[src + 2];
      raw[dst + 3] = rgba[src + 3];
    }
  }

  const compressed = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdrData),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

// --- Icon drawing ---

/**
 * Draw the ZilInventor icon into an RGBA pixel buffer.
 * Layout: dark bg (#1f1f1f), accent square with rounded corners, letter "Z".
 *
 * We rasterize manually (no canvas API in pure Node).
 *
 * @param {number} size
 */
function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);

  // Background color: #1f1f1f
  const bgR = 0x1f, bgG = 0x1f, bgB = 0x1f;
  // Accent color: #4a9eff (blue-ish, visible on dark)
  const acR = 0x4a, acG = 0x9e, acB = 0xff;
  // "Z" letter color: #1f1f1f (same as bg — cut out from accent square)
  const zR = 0x1f, zG = 0x1f, zB = 0x1f;

  // Fill background
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4]     = bgR;
    rgba[i * 4 + 1] = bgG;
    rgba[i * 4 + 2] = bgB;
    rgba[i * 4 + 3] = 255;
  }

  // Accent square: occupies middle 60% of the icon with rounded corners
  const margin = Math.round(size * 0.15);
  const squareSize = size - 2 * margin;
  const radius = Math.round(squareSize * 0.18); // corner radius

  function setPixel(x, y, r, g, b) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i]     = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
    rgba[i + 3] = 255;
  }

  function inRoundedRect(px, py, x0, y0, w, h, r) {
    // Is (px, py) inside a rounded rect?
    const x1 = x0 + w, y1 = y0 + h;
    if (px < x0 || px >= x1 || py < y0 || py >= y1) return false;
    // Check corners
    const corners = [
      [x0 + r, y0 + r],
      [x1 - r - 1, y0 + r],
      [x0 + r, y1 - r - 1],
      [x1 - r - 1, y1 - r - 1],
    ];
    // If inside the "safe" inner rectangle (no corners), always inside
    if (px >= x0 + r && px < x1 - r && py >= y0 && py < y1) return true;
    if (px >= x0 && px < x1 && py >= y0 + r && py < y1 - r) return true;
    // Corner quadrant check
    for (const [cx, cy] of corners) {
      const dx = px - cx, dy = py - cy;
      if (Math.abs(dx) <= r && Math.abs(dy) <= r) {
        if (dx * dx + dy * dy <= r * r) return true;
      }
    }
    return false;
  }

  // Draw accent square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (inRoundedRect(x, y, margin, margin, squareSize, squareSize, radius)) {
        setPixel(x, y, acR, acG, acB);
      }
    }
  }

  // Draw letter "Z" using thick strokes inside the accent square.
  // "Z": top bar, diagonal, bottom bar — rasterized as thick rectangles.
  const zMargin = Math.round(size * 0.27);
  const zW = size - 2 * zMargin;
  const zH = Math.round(zW * 1.1);
  const zTop = Math.round((size - zH) / 2);
  const stroke = Math.max(2, Math.round(zW * 0.17));

  // Top bar
  for (let y = zTop; y < zTop + stroke; y++) {
    for (let x = zMargin; x < zMargin + zW; x++) {
      setPixel(x, y, zR, zG, zB);
    }
  }
  // Bottom bar
  for (let y = zTop + zH - stroke; y < zTop + zH; y++) {
    for (let x = zMargin; x < zMargin + zW; x++) {
      setPixel(x, y, zR, zG, zB);
    }
  }
  // Diagonal: from top-right to bottom-left
  for (let t = 0; t <= 100; t++) {
    const frac = t / 100;
    // Center of diagonal stroke at this parameter
    const cx = Math.round(zMargin + zW - frac * zW);
    const cy = Math.round(zTop + frac * zH);
    // Draw a thick point (square brush)
    const half = Math.ceil(stroke * 0.7);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) {
        setPixel(cx + dx, cy + dy, zR, zG, zB);
      }
    }
  }

  return rgba;
}

// Generate both sizes
for (const size of [192, 512]) {
  const rgba = drawIcon(size);
  const png = makePng(size, size, rgba);
  const outPath = join(outDir, `icon-${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Written: ${outPath} (${png.length} bytes)`);
}
