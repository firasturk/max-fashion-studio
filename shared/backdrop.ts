/**
 * Backdrop-colour check for the "Backdrop colour" approach: reads the border of every result,
 * groups the results by card (one card = one requested colour) and flags the ones whose backdrop
 * differs from what the rest of the group achieved. Pure functions; the browser loader that
 * decodes the images lives in src/lib/backdrop.ts.
 */

export interface Lab {
  L: number;
  a: number;
  b: number;
}

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** sRGB to CIE Lab (D65). */
export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = channel(r);
  const G = channel(g);
  const B = channel(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function deltaE(p: Lab, q: Lab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function medianLab(points: Lab[]): Lab {
  return {
    L: median(points.map((p) => p.L)),
    a: median(points.map((p) => p.a)),
    b: median(points.map((p) => p.b)),
  };
}

export interface BorderRead {
  /** The backdrop colour: median of the border pixels. */
  colour: Lab;
  /** Share of border pixels close to that colour; low when the product covers the edges. */
  agreement: number;
}

/** Read the backdrop colour from the outer ring of an RGBA image. */
export function readBorder(data: Uint8ClampedArray, width: number, height: number): BorderRead {
  const ring = Math.max(2, Math.round(Math.min(width, height) * 0.08));
  const pixels: Lab[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= ring && x < width - ring && y >= ring && y < height - ring) continue;
      const i = (y * width + x) * 4;
      pixels.push(rgbToLab(data[i], data[i + 1], data[i + 2]));
    }
  }
  const colour = medianLab(pixels);
  const close = pixels.filter((p) => deltaE(p, colour) < 8).length;
  return { colour, agreement: pixels.length ? close / pixels.length : 0 };
}

export interface BackdropItem {
  id: string;
  /** Group key: results that were asked for the same colour. */
  group: string | number;
  read: BorderRead;
}

/** How far a backdrop may sit from its group before it counts as the wrong colour (CIE ΔE). */
export const OFF_COLOUR_DISTANCE = 11;
/** Below this share of agreeing border pixels the edge is mostly product, so the read is skipped. */
export const MIN_AGREEMENT = 0.5;

/** Ids of the results whose backdrop does not match what their colour group achieved. */
export function findOffColour(items: BackdropItem[]): string[] {
  const groups = new Map<string | number, BackdropItem[]>();
  for (const it of items) groups.set(it.group, [...(groups.get(it.group) ?? []), it]);
  const off: string[] = [];
  for (const members of groups.values()) {
    const clean = members.filter((m) => m.read.agreement >= MIN_AGREEMENT);
    if (clean.length < 2) continue;
    const target = medianLab(clean.map((m) => m.read.colour));
    for (const m of clean) if (deltaE(m.read.colour, target) > OFF_COLOUR_DISTANCE) off.push(m.id);
  }
  return off;
}
