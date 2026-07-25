// Generate PWA icons by resampling the design team's master artwork
// (assets/app-icon-1024.png) — no npm dependencies, just Node's built-in zlib
// for a minimal PNG decoder/encoder. We decode the real master rather than
// re-deriving its teardrop shape from CSS math, so the icon is pixel-faithful
// to what was actually designed and reviewed.
// Run: node scripts/generate-icons.cjs
const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

function readPng(filePath) {
  const buf = fs.readFileSync(filePath);
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) throw new Error(`${filePath}: not a PNG`);

  let offset = 8;
  let width, height, bitDepth, colorType, interlace;
  const idatParts = [];
  while (offset < buf.length) {
    const len = buf.readUInt32BE(offset);
    const tag = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (tag === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (tag === "IDAT") {
      idatParts.push(data);
    }
    offset += 12 + len; // length + tag + data + crc
  }
  if (bitDepth !== 8) throw new Error(`${filePath}: expected 8-bit depth, got ${bitDepth}`);
  if (colorType !== 6 && colorType !== 2) throw new Error(`${filePath}: expected RGBA or RGB colour type, got ${colorType}`);
  if (interlace !== 0) throw new Error(`${filePath}: interlaced PNGs aren't supported`);

  const bpp = colorType === 6 ? 4 : 3;
  const rowBytes = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idatParts));

  // Reverse the per-scanline PNG filter (spec: each row is prefixed with a
  // filter-type byte; Sub/Up/Average/Paeth all reference already-reconstructed
  // neighbour bytes, so rows must be unfiltered in order).
  const pixels = Buffer.alloc(width * height * 4);
  let prevRow = Buffer.alloc(rowBytes);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + rowBytes);
    const filterType = raw[rowStart];
    const src = raw.subarray(rowStart + 1, rowStart + 1 + rowBytes);
    const out = Buffer.alloc(rowBytes);
    for (let x = 0; x < rowBytes; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prevRow[x];
      const c = x >= bpp ? prevRow[x - bpp] : 0;
      let val = src[x];
      if (filterType === 1) val += a;
      else if (filterType === 2) val += b;
      else if (filterType === 3) val += Math.floor((a + b) / 2);
      else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        val += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      } else if (filterType !== 0) {
        throw new Error(`unknown PNG filter type ${filterType}`);
      }
      out[x] = val & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const srcOff = x * bpp;
      const dstOff = (y * width + x) * 4;
      pixels[dstOff] = out[srcOff];
      pixels[dstOff + 1] = out[srcOff + 1];
      pixels[dstOff + 2] = out[srcOff + 2];
      pixels[dstOff + 3] = bpp === 4 ? out[srcOff + 3] : 255;
    }
    prevRow = out;
  }
  return { width, height, pixels };
}

// Simple box-filter downsample: every output pixel averages the block of
// source pixels it covers. Correct for non-integer ratios (e.g. 1024 -> 192),
// and — since the source is a flat two-tone icon — this anti-aliases the
// drop's edge cleanly at every target size rather than aliasing it.
function resample(src, targetSize) {
  const out = Buffer.alloc(targetSize * targetSize * 4);
  const scale = src.width / targetSize;
  for (let oy = 0; oy < targetSize; oy++) {
    const sy0 = Math.floor(oy * scale), sy1 = Math.max(sy0 + 1, Math.ceil((oy + 1) * scale));
    for (let ox = 0; ox < targetSize; ox++) {
      const sx0 = Math.floor(ox * scale), sx1 = Math.max(sx0 + 1, Math.ceil((ox + 1) * scale));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let sy = sy0; sy < sy1 && sy < src.height; sy++) {
        for (let sx = sx0; sx < sx1 && sx < src.width; sx++) {
          const off = (sy * src.width + sx) * 4;
          r += src.pixels[off]; g += src.pixels[off + 1]; b += src.pixels[off + 2]; a += src.pixels[off + 3];
          n++;
        }
      }
      const dstOff = (oy * targetSize + ox) * 4;
      out[dstOff] = Math.round(r / n);
      out[dstOff + 1] = Math.round(g / n);
      out[dstOff + 2] = Math.round(b / n);
      out[dstOff + 3] = Math.round(a / n);
    }
  }
  return { width: targetSize, height: targetSize, pixels: out };
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

function writePng(filePath, img) {
  const { width: size, pixels } = img;
  const rowBytes = 1 + size * 4;
  const raw = Buffer.alloc(rowBytes * size);
  for (let y = 0; y < size; y++) {
    raw[y * rowBytes] = 0; // filter type 0 (None) per row
    pixels.copy(raw, y * rowBytes + 1, y * size * 4, (y + 1) * size * 4);
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
  const assetsDir = path.join(__dirname, "..", "assets");
  const outDir = path.join(__dirname, "..", "icons");
  fs.mkdirSync(outDir, { recursive: true });

  const master = readPng(path.join(assetsDir, "app-icon-1024.png"));
  for (const size of [192, 512]) {
    const resized = size === master.width ? master : resample(master, size);
    writePng(path.join(outDir, `icon-${size}.png`), resized);
    console.log("wrote", `icon-${size}.png`);
  }

  // The 180x180 apple-touch-icon is used as-is — it's already the exact
  // target size, no resampling needed.
  fs.copyFileSync(path.join(assetsDir, "apple-touch-icon-180.png"), path.join(outDir, "apple-touch-icon.png"));
  console.log("wrote", "apple-touch-icon.png");
}

main();
