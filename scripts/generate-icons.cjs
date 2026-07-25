// Generate PWA icons: a single sage teardrop pointing left, centered with
// margin on the cream background — full-bleed square, no baked-in rounding
// (platforms apply their own mask). No npm dependencies, just Node's built-in
// zlib for a minimal PNG encoder.
// Run: node scripts/generate-icons.cjs
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

const BG = [246, 243, 236];  // --bg cream  #F6F3EC
const FG = [79, 111, 92];    // --accent sage #4F6F5C

function makeCanvas(size, bg) {
  const canvas = [];
  for (let y = 0; y < size; y++) canvas.push(new Array(size).fill(bg));
  return canvas;
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

// A rounded blob (circle) with a pointed tip extending to its LEFT — a
// teardrop lying on its side, tip pointing left. The triangle's two base
// corners are the actual tangent points of the lines from the apex to the
// circle (not an approximation), so the straight taper meets the circle's
// arc with matching slope — no seam or dimple at the join.
function drawDrop(canvas, size) {
  const cx = size * 0.58, cy = size * 0.5;
  const r = size * 0.22;
  const apexX = size * 0.16;

  const d = cx - apexX; // apex is directly left of the circle's center
  const angle = Math.acos(r / d);
  const offX = r * Math.cos(angle);
  const offY = r * Math.sin(angle);
  const baseX = cx - offX;
  const baseTopY = cy - offY;
  const baseBottomY = cy + offY;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inCircle = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const inTip = inTriangle(x, y, apexX, cy, baseX, baseTopY, baseX, baseBottomY);
      if (inCircle || inTip) canvas[y][x] = FG;
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
