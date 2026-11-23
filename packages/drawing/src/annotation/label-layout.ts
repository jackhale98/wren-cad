/**
 * Lays out text lines made of runs (text and vector symbols) and dimension labels (value,
 * tolerance stack, basic box, reference parentheses, lines below) in a local frame: origin at the
 * left end of the main line's baseline, x along the text, y up, sheet mm. Placement layout moves
 * and rotates the result. Pure and worker-safe.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Vec2 } from '@wren-cad/contracts';
import { type Primitive, transformPrimitive } from './display';
import type { Box2 } from './geom';
import { placeSymbol, symbolGlyph } from './symbols';
import { normalizeText, textWidth } from './text';
import { type DimensionLabel, type TextRun, TOLERANCE_TEXT_SCALE } from './tolerance';

/** Space between a symbol and its neighbours, in h. */
const SYMBOL_GAP = 0.25;
/** Space between the value and its tolerance, in h. */
const TOL_GAP = 0.35;

export interface TextBlock {
  prims: Primitive[];
  width: number;
  /** Extent around the origin (y up), for clearance and frames. */
  box: Box2;
}

function text(at: Vec2, s: string, h: number): Primitive {
  return { kind: 'text', at, text: s, height: h, angle: 0, align: 'left', baseline: 'baseline' };
}

/** Width of a run line at height h. */
export function runsWidth(input: readonly TextRun[], h: number): number {
  const runs = mergeRuns(input);
  let w = 0;
  runs.forEach((r, i) => {
    if (r.kind === 'text') w += textWidth(normalizeText(r.text), h);
    else {
      w += symbolGlyph(r.id).advance * h;
      if (i > 0) w += SYMBOL_GAP * h;
      if (i < runs.length - 1) w += SYMBOL_GAP * h;
    }
  });
  return w;
}

/** One line of runs starting at `at` (left baseline). */
/** Joins adjacent text runs, so one line of text is one text item (DXF, PDF, search). */
export function mergeRuns(runs: readonly TextRun[]): TextRun[] {
  const out: TextRun[] = [];
  for (const r of runs) {
    const prev = out[out.length - 1];
    if (r.kind === 'text' && prev?.kind === 'text')
      out[out.length - 1] = { kind: 'text', text: prev.text + r.text };
    else out.push(r);
  }
  return out;
}

export function layoutRuns(input: readonly TextRun[], at: Vec2, h: number): TextBlock {
  const prims: Primitive[] = [];
  let x = at[0];
  const runs = mergeRuns(input);
  runs.forEach((r, i) => {
    if (r.kind === 'text') {
      const s = normalizeText(r.text);
      if (s) prims.push(text([x, at[1]], s, h));
      x += textWidth(s, h);
    } else {
      if (i > 0) x += SYMBOL_GAP * h;
      prims.push(...placeSymbol(r.id, [x, at[1]], h));
      x += symbolGlyph(r.id).advance * h;
      if (i < runs.length - 1) x += SYMBOL_GAP * h;
    }
  });
  const width = x - at[0];
  return { prims, width, box: { min: [at[0], at[1] - 0.25 * h], max: [x, at[1] + h] } };
}

/** Several lines, the first baseline at `at`, each next one `pitch` × h lower. */
export function layoutLines(
  lines: readonly (readonly TextRun[])[],
  at: Vec2,
  h: number,
  align: 'left' | 'center' | 'right' = 'left',
  pitch = 1.6,
): TextBlock {
  const widths = lines.map((l) => runsWidth(l, h));
  const width = Math.max(0, ...widths);
  const prims: Primitive[] = [];
  lines.forEach((l, i) => {
    const w = widths[i] ?? 0;
    const dx = align === 'left' ? 0 : align === 'center' ? (width - w) / 2 : width - w;
    prims.push(...layoutRuns(l, [at[0] + dx, at[1] - i * pitch * h], h).prims);
  });
  const n = Math.max(lines.length, 1);
  return {
    prims,
    width,
    box: { min: [at[0], at[1] - (n - 1) * pitch * h - 0.25 * h], max: [at[0] + width, at[1] + h] },
  };
}

/**
 * A dimension label in its local frame. Stacked deviations are `TOLERANCE_TEXT_SCALE` × h: the
 * upper one's baseline at 0.55 h, the lower one's at −0.35 h (provisional, ISO 129-1).
 */
export function layoutDimensionLabel(label: DimensionLabel, h: number): TextBlock {
  if (label.inspection && label.frame !== 'parens') return layoutInspection(label, h);
  const prims: Primitive[] = [];
  let x = 0;
  const pad = 0.3 * h;
  if (label.frame === 'parens') {
    prims.push(text([x, 0], '(', h));
    x += textWidth('(', h);
  }
  const startMain = x;
  if (label.frame === 'box') x += pad;
  const main = layoutRuns(label.main, [x, 0], h);
  prims.push(...main.prims);
  x += main.width;
  let top = h;
  let bottom = -0.25 * h;
  const tol = label.tolerance;
  if (tol?.kind === 'inline') {
    if (main.width > 0) x += TOL_GAP * h;
    const s = normalizeText(tol.text);
    prims.push(text([x, 0], s, h));
    x += textWidth(s, h);
  } else if (tol) {
    if (main.width > 0) x += TOL_GAP * h;
    if (tol.before) {
      const s = normalizeText(tol.before);
      prims.push(text([x, 0], s, h));
      x += textWidth(s, h) + TOL_GAP * h;
    }
    const th = h * TOLERANCE_TEXT_SCALE;
    if (tol.parens) {
      prims.push(text([x, 0], '(', h));
      x += textWidth('(', h);
    }
    const up = normalizeText(tol.upper);
    const lo = normalizeText(tol.lower);
    const wUp = textWidth(up, th);
    const wLo = textWidth(lo, th);
    const w = Math.max(wUp, wLo);
    // Right-align the numbers so the decimal places line up for equal precision.
    prims.push(text([x + w - wUp, 0.55 * h], up, th));
    prims.push(text([x + w - wLo, -0.35 * h], lo, th));
    x += w;
    top = Math.max(top, 0.55 * h + th);
    bottom = Math.min(bottom, -0.35 * h - 0.25 * th);
    if (tol.parens) {
      prims.push(text([x, 0], ')', h));
      x += textWidth(')', h);
    }
    if (tol.after) {
      x += TOL_GAP * h;
      const s = normalizeText(tol.after);
      prims.push(text([x, 0], s, h));
      x += textWidth(s, h);
    }
  }
  if (label.frame === 'box') {
    x += pad;
    prims.push({
      kind: 'polyline',
      closed: true,
      points: [
        [startMain, bottom - pad * 0.5],
        [x, bottom - pad * 0.5],
        [x, top + pad],
        [startMain, top + pad],
      ],
    });
    top += pad;
    bottom -= pad * 0.5;
  }
  if (label.frame === 'parens') {
    prims.push(text([x, 0], ')', h));
    x += textWidth(')', h);
  }
  if (label.suffix) {
    x += TOL_GAP * h;
    const s = normalizeText(label.suffix);
    prims.push(text([x, 0], s, h));
    x += textWidth(s, h);
  }
  const width = x;
  for (const [i, line] of (label.below ?? []).entries()) {
    const s = normalizeText(line);
    const y = -(i + 1) * 1.6 * h;
    prims.push(text([(width - textWidth(s, h)) / 2, y], s, h));
    bottom = Math.min(bottom, y - 0.25 * h);
  }
  return { prims, width, box: { min: [0, bottom], max: [width, top] } };
}

/**
 * An inspection dimension (ISO 129-1): the size symbol, value and tolerance (with a basic box
 * inside) in a frame with semicircular ends. The instance count and prefix sit before the frame
 * and the suffix and lines below stay outside it: they are notes about the dimension, not part of
 * what is inspected. The frame is two lines and two arcs, sized from the content's extent.
 */
function layoutInspection(label: DimensionLabel, h: number): TextBlock {
  const leadN = Math.min(label.leadRuns ?? 0, label.main.length);
  const leadRuns = label.main.slice(0, leadN);
  const inner = layoutDimensionLabel(
    {
      ...label,
      main: label.main.slice(leadN),
      inspection: false,
      suffix: undefined,
      below: undefined,
    } as DimensionLabel,
    h,
  );
  const prims: Primitive[] = [];
  let x0 = 0;
  if (leadRuns.length > 0) {
    const lead = layoutRuns(leadRuns, [0, 0], h);
    prims.push(...lead.prims);
    const last = leadRuns[leadRuns.length - 1];
    x0 = lead.width + (last?.kind === 'text' && /\s$/.test(last.text) ? 0 : TOL_GAP * h);
  }
  const top = inner.box.max[1];
  const bottom = inner.box.min[1];
  const yTop = top + 0.3 * h;
  const yBottom = bottom - 0.1 * h;
  const r = (yTop - yBottom) / 2;
  const cy = (yTop + yBottom) / 2;
  const dy = (top - bottom) / 2;
  // Inset so that the content's corners sit inside the end arcs, with a little air.
  const off = r - Math.sqrt(Math.max(0, r * r - dy * dy)) + 0.2 * h;
  const x1 = Math.max(x0 + 2 * off + inner.width, x0 + 2 * r);
  const dx = x0 + off + (x1 - x0 - 2 * off - inner.width) / 2;
  for (const p of inner.prims) prims.push(transformPrimitive(p, { at: [dx, 0] }));
  prims.push(
    { kind: 'line', a: [x0 + r, yTop], b: [x1 - r, yTop] },
    { kind: 'line', a: [x0 + r, yBottom], b: [x1 - r, yBottom] },
    { kind: 'arc', center: [x0 + r, cy], radius: r, start: Math.PI / 2, end: (3 * Math.PI) / 2 },
    { kind: 'arc', center: [x1 - r, cy], radius: r, start: -Math.PI / 2, end: Math.PI / 2 },
  );
  let x = x1;
  let bot = yBottom;
  if (label.suffix) {
    x += TOL_GAP * h;
    const s = normalizeText(label.suffix);
    prims.push(text([x, 0], s, h));
    x += textWidth(s, h);
  }
  const width = x;
  for (const [i, line] of (label.below ?? []).entries()) {
    const s = normalizeText(line);
    const y = -(i + 1) * 1.6 * h;
    prims.push(text([(width - textWidth(s, h)) / 2, y], s, h));
    bot = Math.min(bot, y - 0.25 * h);
  }
  return { prims, width, box: { min: [0, bot], max: [width, yTop] } };
}
