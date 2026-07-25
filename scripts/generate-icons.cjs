// Generate PWA icons (a water drop on the linen background) as raw PNGs
// using only Node's built-in zlib — zero npm dependencies.
// Run: node scripts/generate-icons.cjs
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const BG = [244, 241, 235];   // --bg linen  #F4F1EB
const FG = [79, 107, 92];     // --accent pine #4F6B5C
const FG_HI = [110, 138, 122]; // slightly lighter pine for the highlight

function makeCanvas(size, bg) {
  const canvas = [];
  for (let y = 0; y < size; y++) {
    canvas.push(new Array(size).fill(bg));
  }
  return canvas;
}

function fillRoundedRect(canvas, x0, y0, x1, y1, radius, color) {
  const size = canvas.length;
  for (let y = Math.max(0, y0); y < Math.min(size, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(size, x1); x++) {
      let cx = 0, cy = 0, inCorner = false;
      if (x < x0 + radius && y < y0 + radius) { cx = x0 + radius; cy = y0 + radius; inCorner = true; }
      else if (x >= x1 - radius && y < y0 + radius) { cx = x1 - radius; cy = y0 + radius; inCorner = true; }
      else if (x < x0 + radius && y >= y1 - radius) { cx = x0 + radius; cy = y1 - radius; inCorner = true; }
      else if (x >= x1 - radius && y >= y1 - radius) { cx = x1 - radius; cy = y1 - radius; inCorner = true; }
      if (inCorner && ((x - cx) ** 2 + (y - cy) ** 2 > radius * radius)) continue;
      canvas[y][x] = color;
    }
  }
}

// Point-in-triangle via sign of cross products (same winding test 3x).
function inTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

// Draws a simple water-drop silhouette: a circular bulb with a pointed tip
// above it (triangle), plus a small pale highlight ellipse for depth.
function drawDrop(canvas, size) {
  const bgR = Math.round(size * 0.22);
  fillRoundedRect(canvas, 0, 0, size, size, bgR, BG);

  const cx = size / 2;
  const rBulb = size * 0.24;
  const cyBulb = size * 0.60;
  const topY = size * 0.18;

  const ax = cx, ay = topY;
  const bx = cx - rBulb, by = cyBulb - rBulb * 0.15;
  const ccx = cx + rBulb, ccy = cyBulb - rBulb * 0.15;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCircle = (x - cx) ** 2 + (y - cyBulb) ** 2 <= rBulb * rBulb;
      const inTip = inTriangle(x, y, ax, ay, bx, by, ccx, ccy);
      if (inCircle || inTip) canvas[y][x] = FG;
    }
  }

  // Small highlight ellipse, upper-left of the bulb.
  const hx = cx - rBulb * 0.35;
  const hy = cyBulb - rBulb * 0.35;
  const hrx = rBulb * 0.22;
  const hry = rBulb * 0.30;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = (x - hx) / hrx;
      const ny = (y - hy) / hry;
      if (nx * nx + ny * ny <= 1) canvas[y][x] = FG_HI;
    }
  }
}

function crc32(buf) {
  return zlib.crc32 ? zlib.crc32(buf) >>> 0 : (() => {
    let c, crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
      c = (crc ^ buf[i]) & 0xff;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
  })();
}

function chunk(tag, data) {
  const tagBuf = Buffer.from(tag, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([tagBuf, data])), 0);
  return Buffer.concat([lenBuf, tagBuf, data, crcBuf]);
}

function writePng(filePath, canvas) {
  const size = canvas.length;
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b] = canvas[y][x];
      const off = rowStart + 1 + x * 4;
      raw[off] = r; raw[off + 1] = g; raw[off + 2] = b; raw[off + 3] = 255;
    }
  }
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
  fs.writeFileSync(filePath, png);
}

function main() {
  const outDir = path.join(__dirname, "..", "icons");
  fs.mkdirSync(outDir, { recursive: true });
  for (const [size, name] of [[192, "icon-192.png"], [512, "icon-512.png"], [180, "apple-touch-icon.png"]]) {
    const canvas = makeCanvas(size, BG);
    drawDrop(canvas, size);
    writePng(path.join(outDir, name), canvas);
    console.log("wrote", name);
  }
}

main();
