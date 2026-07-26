/**
 * Lifestyle mockup compositing — deterministic (NO AI, NO deps).
 *
 * Perspective-warps a customer's EXACT artwork onto a 4-corner print
 * area inside a lifestyle scene photo, then molds it with the scene's
 * own lighting (shadows / highlights / fabric wrinkles darken or lift
 * the print) so it reads as part of the object. Design fidelity is
 * guaranteed by construction: every artwork pixel comes from the
 * artwork buffer — a generative model never repaints the design.
 *
 * Same design stance as the rest of commonpod: dependency-free and
 * storage-agnostic. This module works on RAW RGBA buffers; the
 * consuming app owns decode/encode (e.g. sharp:
 *
 * ```ts
 * import sharp from "sharp";
 * import { compositeLifestyleMockup } from "commonpod";
 *
 * const scene = sharp(sceneBytes).ensureAlpha();
 * const { width, height } = await scene.metadata();
 * const sceneRaw = { data: await scene.raw().toBuffer(), width, height };
 * const art = sharp(artBytes).ensureAlpha();
 * const am = await art.metadata();
 * const artRaw = { data: await art.raw().toBuffer(), width: am.width, height: am.height };
 *
 * compositeLifestyleMockup(sceneRaw, artRaw, {
 *   quad: [[36.5, 38], [58, 37.5], [58.5, 58], [36, 57.5]], // % TL,TR,BR,BL
 *   blend: 0.85,
 * });
 * const jpg = await sharp(sceneRaw.data, {
 *   raw: { width, height, channels: 4 },
 * }).jpeg({ quality: 90 }).toBuffer();
 * ```
 *
 * Scenes are meant to be AI-generated WITH A BLANK PRODUCT (or real
 * photos of blank products) — see the FurryBooth mockup-strategy doc
 * that motivated this module.
 */

/** One corner as [x, y] in PERCENT of scene width/height (0–100). */
export type QuadPoint = [number, number];

/** The print area's 4 corners, in order TL, TR, BR, BL. */
export type Quad = [QuadPoint, QuadPoint, QuadPoint, QuadPoint];

/** A 3×3 matrix, row-major. */
export type Mat3 = [
  number, number, number,
  number, number, number,
  number, number, number,
];

/** A decoded RGBA image (4 channels, row-major, no padding). */
export interface RawImage {
  data: Uint8Array;
  width: number;
  height: number;
}

export interface LifestyleCompositeOptions {
  /** Print-area corners as % of scene dimensions, TL, TR, BR, BL. */
  quad: Quad;
  /**
   * 0..1 — how strongly the scene's local luminance molds the artwork
   * (shadows/wrinkles show through the print). 0.85 suits fabric,
   * ~0.6 suits flat surfaces (framed prints, stickers). Default 0.85.
   */
  blend?: number;
  /** Soft anti-aliased edge width in scene pixels. Default 2. */
  featherPx?: number;
  /** Overall artwork opacity 0..1. Default 1. */
  opacity?: number;
}

/**
 * Projective mapping of the unit square (u,v)∈[0,1]² onto a quad
 * (Heckbert's square-to-quad). Returns the 3×3 homography, row-major.
 */
export function squareToQuad(quad: Quad): Mat3 {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = quad;
  const sx = x0 - x1 + x2 - x3;
  const sy = y0 - y1 + y2 - y3;
  let a: number, b: number, d: number, e: number, g: number, h: number;
  const c = x0;
  const f = y0;
  if (Math.abs(sx) < 1e-9 && Math.abs(sy) < 1e-9) {
    // Affine (parallelogram) shortcut.
    a = x1 - x0;
    b = x3 - x0;
    d = y1 - y0;
    e = y3 - y0;
    g = 0;
    h = 0;
  } else {
    const dx1 = x1 - x2;
    const dx2 = x3 - x2;
    const dy1 = y1 - y2;
    const dy2 = y3 - y2;
    const den = dx1 * dy2 - dy1 * dx2;
    g = (sx * dy2 - sy * dx2) / den;
    h = (dx1 * sy - dy1 * sx) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
  }
  return [a, b, c, d, e, f, g, h, 1];
}

/** Invert a 3×3 row-major matrix (adjugate / determinant). */
export function invert3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = c * h - b * i;
  const C = b * f - c * e;
  const D = f * g - d * i;
  const E = a * i - c * g;
  const F = c * d - a * f;
  const G = d * h - e * g;
  const H = b * g - a * h;
  const I = a * e - b * d;
  const det = a * A + b * D + c * G;
  return [
    A / det, B / det, C / det,
    D / det, E / det, F / det,
    G / det, H / det, I / det,
  ];
}

/** Apply a 3×3 projective transform to (x, y). */
export function applyHomography(m: Mat3, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [
    (m[0] * x + m[1] * y + m[2]) / w,
    (m[3] * x + m[4] * y + m[5]) / w,
  ];
}

/** Bilinear RGBA sample from a raw buffer (coordinates clamped). */
function sampleBilinear(
  buf: Uint8Array,
  w: number,
  h: number,
  x: number,
  y: number,
): [number, number, number, number] {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let ch = 0; ch < 4; ch++) {
    const p00 = buf[(y0 * w + x0) * 4 + ch]!;
    const p10 = buf[(y0 * w + x1) * 4 + ch]!;
    const p01 = buf[(y1 * w + x0) * 4 + ch]!;
    const p11 = buf[(y1 * w + x1) * 4 + ch]!;
    out[ch] =
      p00 * (1 - fx) * (1 - fy) +
      p10 * fx * (1 - fy) +
      p01 * (1 - fx) * fy +
      p11 * fx * fy;
  }
  return out;
}

/**
 * Composite `artwork` onto `scene` inside the quad. MUTATES
 * `scene.data` in place (and returns the same object for chaining).
 *
 * Per covered pixel: inverse-map into artwork space (bilinear sample),
 * feather the quad border, scale the artwork's brightness by the
 * scene's local-vs-mean luminance (clamped 0.35–1.65) weighted by
 * `blend`, then alpha-over onto the scene.
 */
export function compositeLifestyleMockup(
  scene: RawImage,
  artwork: RawImage,
  options: LifestyleCompositeOptions,
): RawImage {
  const { data: sceneBuf, width: sw, height: sh } = scene;
  const { data: art, width: aw, height: ah } = artwork;
  if (sceneBuf.length < sw * sh * 4) {
    throw new Error("commonpod lifestyle: scene buffer is not RGBA-sized");
  }
  if (art.length < aw * ah * 4) {
    throw new Error("commonpod lifestyle: artwork buffer is not RGBA-sized");
  }
  const blend = clamp01(options.blend ?? 0.85);
  const featherPx = Math.max(0, options.featherPx ?? 2);
  const opacity = clamp01(options.opacity ?? 1);

  // Quad % → scene pixels.
  const quad = options.quad.map(
    ([px, py]) => [(px / 100) * sw, (py / 100) * sh] as QuadPoint,
  ) as Quad;
  const H = squareToQuad(quad);
  const Hinv = invert3(H);

  // Mean scene luminance inside the quad (10×10 grid sample) — the
  // reference the lighting blend normalizes against.
  let lumSum = 0;
  let lumN = 0;
  for (let gu = 0.05; gu < 1; gu += 0.1) {
    for (let gv = 0.05; gv < 1; gv += 0.1) {
      const [x, y] = applyHomography(H, gu, gv);
      const xi = Math.round(x);
      const yi = Math.round(y);
      if (xi < 0 || yi < 0 || xi >= sw || yi >= sh) continue;
      const o = (yi * sw + xi) * 4;
      lumSum +=
        0.2126 * sceneBuf[o]! + 0.7152 * sceneBuf[o + 1]! + 0.0722 * sceneBuf[o + 2]!;
      lumN++;
    }
  }
  const lumRef = lumN ? lumSum / lumN : 200;

  // Feather width in unit space (approx via average edge lengths).
  const edge = (p: QuadPoint, q: QuadPoint) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  const quadW = (edge(quad[0], quad[1]) + edge(quad[3], quad[2])) / 2;
  const quadH = (edge(quad[0], quad[3]) + edge(quad[1], quad[2])) / 2;
  const featherU = featherPx / Math.max(1, quadW);
  const featherV = featherPx / Math.max(1, quadH);

  // Bounding box of the quad in scene space.
  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(sw - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(sh - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const [u, v] = applyHomography(Hinv, x + 0.5, y + 0.5);
      if (u < 0 || u > 1 || v < 0 || v > 1) continue;
      // Anti-aliased edge: fade within featherU/V of the quad border.
      const eu = Math.min(u, 1 - u) / Math.max(featherU, 1e-6);
      const ev = Math.min(v, 1 - v) / Math.max(featherV, 1e-6);
      const edgeAlpha = Math.max(0, Math.min(1, Math.min(eu, ev)));
      const [r, g, b, a] = sampleBilinear(art, aw, ah, u * (aw - 1), v * (ah - 1));
      const alpha = (a / 255) * edgeAlpha * opacity;
      if (alpha <= 0) continue;
      const o = (y * sw + x) * 4;
      // Lighting: mold the art by the scene's local luminance.
      const sceneLum =
        0.2126 * sceneBuf[o]! + 0.7152 * sceneBuf[o + 1]! + 0.0722 * sceneBuf[o + 2]!;
      const factor = Math.max(0.35, Math.min(1.65, sceneLum / Math.max(1, lumRef)));
      const lit = (ch: number) =>
        Math.max(0, Math.min(255, ch * (1 - blend + blend * factor)));
      sceneBuf[o] = lit(r) * alpha + sceneBuf[o]! * (1 - alpha);
      sceneBuf[o + 1] = lit(g) * alpha + sceneBuf[o + 1]! * (1 - alpha);
      sceneBuf[o + 2] = lit(b) * alpha + sceneBuf[o + 2]! * (1 - alpha);
    }
  }
  return scene;
}

/** Runtime guard for a quad arriving from JSON (admin UI / map files). */
export function isQuad(value: unknown): value is Quad {
  return (
    Array.isArray(value) &&
    value.length === 4 &&
    value.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((n) => typeof n === "number" && Number.isFinite(n)),
    )
  );
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}
