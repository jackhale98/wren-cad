/**
 * Glyph outlines of the drawing font (Osifont, ADR-091) as polylines, for stroked text where a
 * renderer cannot use the font itself: STEP AP242 presentation PMI (M5, ADR-100) writes text as
 * tessellated curves, so receiving viewers show exactly what the PDF and DXF show. Reads the TTF's
 * `glyf` table (simple and composite glyphs, quadratic B-splines) with the same minimal reader the
 * PDF subsetter uses; nothing is shaped or kerned, like every other renderer here (text.ts).
 *
 * Text placement follows the PDF writer exactly: the advance widths, `textWidth` for alignment,
 * the ISO 3098 height h as the cap height, `middle` / `top` baselines at −h/2 / −h, the angle in
 * degrees CCW.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Vec2 } from '@wren-cad/contracts';
import type { Primitive } from '../annotation/display';
import { textWidth } from '../annotation/text';
import { parseTrueType, type TrueTypeFont } from '../pdf/ttf';

type Contour = Vec2[];

function view(data: Uint8Array): DataView {
  return new DataView(data.buffer, data.byteOffset, data.byteLength);
}

/** Quadratic segment p0 → p2 with control p1, flattened to chord error ≤ tol (font units). */
function quadTo(out: Vec2[], p0: Vec2, p1: Vec2, p2: Vec2, tol: number): void {
  const dx = p0[0] - 2 * p1[0] + p2[0];
  const dy = p0[1] - 2 * p1[1] + p2[1];
  // Uniform subdivision of a quadratic: error = |p0 − 2p1 + p2| / (8 n²).
  const n = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(Math.hypot(dx, dy) / (8 * tol)))));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
}

/** One TrueType contour (on/off-curve points) → a closed polyline. */
function flattenContour(pts: readonly Vec2[], on: readonly boolean[], tol: number): Contour {
  const n = pts.length;
  if (n === 0) return [];
  const mid = (a: Vec2, b: Vec2): Vec2 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  // Start at an on-curve point (or the implied midpoint when every point is off-curve). With an
  // on-curve start the walk ends on it again, which closes the contour.
  const s = on.indexOf(true);
  const start: Vec2 = s < 0 ? mid(pts[n - 1] as Vec2, pts[0] as Vec2) : (pts[s] as Vec2);
  const out: Vec2[] = [start];
  let cur = start;
  let ctrl: Vec2 | null = null;
  for (let k = 1; k <= n; k++) {
    const i = s < 0 ? k - 1 : (s + k) % n;
    const p = pts[i] as Vec2;
    if (on[i]) {
      if (ctrl) quadTo(out, cur, ctrl, p, tol);
      else out.push(p);
      cur = p;
      ctrl = null;
    } else if (ctrl) {
      const m = mid(ctrl, p);
      quadTo(out, cur, ctrl, m, tol);
      cur = m;
      ctrl = p;
    } else ctrl = p;
  }
  if (ctrl) quadTo(out, cur, ctrl, start, tol);
  return out;
}

function glyphRange(f: TrueTypeFont, gid: number): [number, number] {
  const d = view(f.data);
  const loca = f.tables.get('loca')?.offset ?? 0;
  const a = f.longLoca ? d.getUint32(loca + 4 * gid) : 2 * d.getUint16(loca + 2 * gid);
  const b = f.longLoca ? d.getUint32(loca + 4 * (gid + 1)) : 2 * d.getUint16(loca + 2 * (gid + 1));
  return [a, b];
}

/** Closed outline contours of glyph `gid`, font units, y up. Composite glyphs are resolved. */
export function glyphContours(f: TrueTypeFont, gid: number, tol: number, depth = 0): Contour[] {
  if (gid < 0 || gid >= f.numGlyphs || depth > 8) return [];
  const d = view(f.data);
  const glyf = f.tables.get('glyf')?.offset;
  if (glyf === undefined) return [];
  const [a, b] = glyphRange(f, gid);
  if (b <= a) return [];
  let p = glyf + a;
  const nContours = d.getInt16(p);
  p += 10;
  if (nContours >= 0) {
    const ends: number[] = [];
    for (let i = 0; i < nContours; i++) ends.push(d.getUint16(p + 2 * i));
    p += 2 * nContours;
    const nPoints = nContours === 0 ? 0 : (ends[nContours - 1] as number) + 1;
    p += 2 + d.getUint16(p); // instructions
    const flags: number[] = [];
    while (flags.length < nPoints) {
      const fl = d.getUint8(p++);
      flags.push(fl);
      if (fl & 0x08) {
        const r = d.getUint8(p++);
        for (let k = 0; k < r; k++) flags.push(fl);
      }
    }
    const xs: number[] = [];
    let x = 0;
    for (const fl of flags) {
      if (fl & 0x02) {
        const v = d.getUint8(p++);
        x += fl & 0x10 ? v : -v;
      } else if (!(fl & 0x10)) {
        x += d.getInt16(p);
        p += 2;
      }
      xs.push(x);
    }
    const ys: number[] = [];
    let y = 0;
    for (const fl of flags) {
      if (fl & 0x04) {
        const v = d.getUint8(p++);
        y += fl & 0x20 ? v : -v;
      } else if (!(fl & 0x20)) {
        y += d.getInt16(p);
        p += 2;
      }
      ys.push(y);
    }
    const out: Contour[] = [];
    let s = 0;
    for (const e of ends) {
      const pts: Vec2[] = [];
      const on: boolean[] = [];
      for (let i = s; i <= e; i++) {
        pts.push([xs[i] as number, ys[i] as number]);
        on.push(((flags[i] as number) & 0x01) !== 0);
      }
      const c = flattenContour(pts, on, tol);
      if (c.length > 1) out.push(c);
      s = e + 1;
    }
    return out;
  }
  // Composite glyph.
  const out: Contour[] = [];
  for (;;) {
    const flags = d.getUint16(p);
    const child = d.getUint16(p + 2);
    p += 4;
    let dx = 0;
    let dy = 0;
    const xy = (flags & 0x0002) !== 0; // ARGS_ARE_XY_VALUES
    if (flags & 0x0001) {
      dx = xy ? d.getInt16(p) : 0;
      dy = xy ? d.getInt16(p + 2) : 0;
      p += 4;
    } else {
      dx = xy ? d.getInt8(p) : 0;
      dy = xy ? d.getInt8(p + 1) : 0;
      p += 2;
    }
    let m = [1, 0, 0, 1];
    const f2 = (o: number) => d.getInt16(o) / 16384;
    if (flags & 0x0008) {
      const s = f2(p);
      m = [s, 0, 0, s];
      p += 2;
    } else if (flags & 0x0040) {
      m = [f2(p), 0, 0, f2(p + 2)];
      p += 4;
    } else if (flags & 0x0080) {
      m = [f2(p), f2(p + 2), f2(p + 4), f2(p + 6)];
      p += 8;
    }
    const [ma, mb, mc, md] = m as [number, number, number, number];
    for (const c of glyphContours(f, child, tol, depth + 1)) {
      out.push(c.map(([u, v]) => [ma * u + mc * v + dx, mb * u + md * v + dy] as Vec2));
    }
    if (!(flags & 0x0020)) break; // MORE_COMPONENTS
  }
  return out;
}

/** The drawing font, parsed once per TTF buffer, with a per-glyph outline cache. */
export interface StrokeFont {
  font: TrueTypeFont;
  /** Chord tolerance of the cached outlines, font units. */
  tolerance: number;
  cache: Map<number, Contour[]>;
}

/**
 * Prepares the TTF (the bundled `osifont-lgpl3fe.ttf`, `loadDrawingFont()`) for stroking.
 * `tolerance`: chord error of glyph curves as a fraction of the em (default 1/500).
 */
export function strokeFont(ttf: Uint8Array, tolerance = 1 / 500): StrokeFont {
  const font = parseTrueType(ttf);
  return { font, tolerance: tolerance * font.unitsPerEm, cache: new Map() };
}

function outlines(sf: StrokeFont, gid: number): Contour[] {
  let c = sf.cache.get(gid);
  if (!c) {
    c = glyphContours(sf.font, gid, sf.tolerance);
    sf.cache.set(gid, c);
  }
  return c;
}

/**
 * One text primitive as closed glyph-outline polylines in its own (sheet mm) coordinates, placed
 * exactly as the PDF writer places the text.
 */
export function strokeText(item: Extract<Primitive, { kind: 'text' }>, sf: StrokeFont): Vec2[][] {
  const f = sf.font;
  const em = f.unitsPerEm;
  const size = (item.height * em) / (f.capHeight || em * 0.7);
  const k = size / em;
  const w = textWidth(item.text, item.height);
  const dx = item.align === 'left' ? 0 : item.align === 'center' ? -w / 2 : -w;
  const dy =
    item.baseline === 'middle' ? -item.height / 2 : item.baseline === 'top' ? -item.height : 0;
  const a = (item.angle * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Vec2[][] = [];
  let pen = 0;
  for (const ch of item.text) {
    const gid = f.cmap.get(ch.codePointAt(0) ?? 0) ?? 0;
    for (const contour of outlines(sf, gid)) {
      out.push(
        contour.map(([u, v]) => {
          const lx = dx + pen + u * k;
          const ly = dy + v * k;
          return [item.at[0] + lx * c - ly * s, item.at[1] + lx * s + ly * c] as Vec2;
        }),
      );
    }
    pen += f.advance(gid) * k;
  }
  return out;
}
