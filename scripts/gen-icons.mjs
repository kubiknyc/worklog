/**
 * Rasterises the WorkLog brand mark into the PNGs Expo needs for store builds.
 *
 * The mark is authored once as `website/public/brand-mark.svg` (same geometry
 * and fixed palette as `src/components/BrandMark.tsx`'s chip variant). This
 * script re-draws that geometry — it does NOT parse the SVG — because the
 * shape list is eight primitives, and a dependency-free renderer beats adding
 * sharp/resvg to a React Native app's toolchain just to produce four files.
 * If the SVG changes, change SHAPES to match; `npm run gen:icons` is the only
 * way these PNGs are produced, so they are never hand-edited.
 *
 * Outputs (assets/, all committed — EAS builds from the repo):
 *   icon.png           1024²  square corners, fully opaque. iOS applies its own
 *                             mask and rejects alpha, so the chip's rx is
 *                             dropped here — baking corners in would show a
 *                             rounded icon inside Apple's rounded mask.
 *   adaptive-icon.png  1024²  Android foreground: the page only, no chip,
 *                             scaled into the centre 66% safe zone (a launcher
 *                             may mask anything outside it) on transparency.
 *                             The chip colour returns via
 *                             android.adaptiveIcon.backgroundColor.
 *   splash-icon.png     512²  page only on transparency; expo-splash-screen
 *                             composites it over its own backgroundColor.
 *   favicon.png          48²  web.
 *
 * Anti-aliasing is 4x4 supersampling per pixel — enough for these edges and
 * trivially cheap at this size.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import zlib from 'node:zlib';

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, '../assets');

// Fixed brand palette — mirrors BrandMark.tsx. Logos do not re-tint per theme.
const ACCENT = [0x4f, 0xc3, 0xf7];
const PAPER = [0xff, 0xff, 0xff];
const INK = [0x0f, 0x17, 0x2a];
const LINE = [0xcb, 0xd2, 0xda];
const LINE_FAINT = [0xe2, 0xe5, 0xea];
const GREEN = [0x16, 0xa3, 0x42];

/** The mark in its authored 1024-unit box, back to front. */
const CHIP = { kind: 'rect', x: 0, y: 0, w: 1024, h: 1024, r: 224, fill: ACCENT };
const PAGE = [
  { kind: 'rect', x: 128, y: 94, w: 768, h: 836, r: 85, fill: PAPER },
  { kind: 'rect', x: 179, y: 145, w: 290, h: 188, r: 43, fill: INK },
  { kind: 'rect', x: 179, y: 427, w: 666, h: 34, r: 17, fill: LINE },
  { kind: 'rect', x: 179, y: 529, w: 666, h: 34, r: 17, fill: LINE },
  { kind: 'rect', x: 179, y: 631, w: 512, h: 34, r: 17, fill: LINE_FAINT },
  { kind: 'circle', cx: 243, cy: 798, r: 64, fill: GREEN },
  {
    kind: 'polyline',
    points: [
      [212, 799],
      [235, 823],
      [279, 763],
    ],
    width: 20,
    fill: PAPER,
  },
];

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Signed distance to a rounded rect: negative inside, positive outside. */
function sdRoundRect(px, py, { x, y, w, h, r }) {
  const cx = x + w / 2;
  const cy = y + h / 2;
  const qx = Math.abs(px - cx) - (w / 2 - r);
  const qy = Math.abs(py - cy) - (h / 2 - r);
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

function sdSegment(px, py, [ax, ay], [bx, by]) {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : clamp01((wx * vx + wy * vy) / len2);
  return Math.hypot(wx - vx * t, wy - vy * t);
}

/** Inside-ness of one shape at a point, as a boolean — supersampling does the AA. */
function hit(shape, px, py) {
  if (shape.kind === 'rect') return sdRoundRect(px, py, shape) <= 0;
  if (shape.kind === 'circle') return Math.hypot(px - shape.cx, py - shape.cy) <= shape.r;
  // Round caps and joins fall out of "distance to any segment <= half width".
  for (let i = 0; i < shape.points.length - 1; i += 1) {
    if (sdSegment(px, py, shape.points[i], shape.points[i + 1]) <= shape.width / 2) return true;
  }
  return false;
}

/**
 * Renders `shapes` (authored in a 1024 box) into a `size`² RGBA buffer.
 * `scale` shrinks the artwork about the box centre — used for the Android
 * safe zone. `opaque` fills the background with the chip colour instead of
 * transparency.
 */
function render(shapes, size, { scale = 1, opaque = false } = {}) {
  const SS = 4; // supersampling factor per axis
  const pixels = Buffer.alloc(size * size * 4);
  const unit = 1024 / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          // Sample centre in the authored 1024 space, undoing `scale` about
          // the centre so the artwork shrinks rather than the canvas growing.
          const ux = ((x + (sx + 0.5) / SS) * unit - 512) / scale + 512;
          const uy = ((y + (sy + 0.5) / SS) * unit - 512) / scale + 512;

          let sr = 0;
          let sg = 0;
          let sb = 0;
          let sa = 0;
          if (opaque) {
            [sr, sg, sb] = ACCENT;
            sa = 1;
          }
          // Painter's algorithm: later shapes cover earlier ones. Every shape
          // is fully opaque, so "covered" is a straight replace.
          for (const shape of shapes) {
            if (hit(shape, ux, uy)) {
              [sr, sg, sb] = shape.fill;
              sa = 1;
            }
          }
          r += sr;
          g += sg;
          b += sb;
          a += sa;
        }
      }

      const n = SS * SS;
      const i = (y * size + x) * 4;
      // Straight (non-premultiplied) alpha: average colour over COVERED
      // samples only, so a half-covered edge keeps its own colour instead of
      // fading toward black.
      const covered = a === 0 ? 1 : a;
      pixels[i] = Math.round(r / covered);
      pixels[i + 1] = Math.round(g / covered);
      pixels[i + 2] = Math.round(b / covered);
      pixels[i + 3] = Math.round((a / n) * 255);
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body) >>> 0, 0);
  return Buffer.concat([len, body, crc]);
}

/** Minimal RGBA8 PNG: filter byte 0 per scanline, one deflated IDAT. */
function encodePng(pixels, size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (stride + 1)] = 0;
    pixels.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function write(name, pixels, size) {
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, encodePng(pixels, size));
  console.log(`gen-icons: wrote ${path.relative(path.resolve(HERE, '..'), file)} (${size}px)`);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

// iOS/store icon: chip + page, square corners, no alpha.
write('icon.png', render([{ ...CHIP, r: 0 }, ...PAGE], 1024, { opaque: true }), 1024);
// Android adaptive foreground: page only, inside the centre-66% safe zone.
write('adaptive-icon.png', render(PAGE, 1024, { scale: 0.66 }), 1024);
// Splash: page only, composited over expo-splash-screen's backgroundColor.
write('splash-icon.png', render(PAGE, 512, { scale: 0.8 }), 512);
write('favicon.png', render([{ ...CHIP, r: 48 }, ...PAGE], 48), 48);
