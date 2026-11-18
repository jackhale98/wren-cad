/**
 * Leader forms of datums and tolerance frames (ADR-094): the rules shared by the layout, the
 * drawing route's tools and drags, and the import planner.
 *
 * - On a surface: the datum triangle's base sits on the line the surface is seen as (or on an
 *   extension of it, `t` outside [0, 1]), the triangle outside the material; a frame's leader ends
 *   there in an arrow square to it. Either leader leaves along that axis (`leaderCorners`).
 * - On a feature of size: the datum triangle sits at an end of the size dimension's line, in line
 *   with it (`dimensionLine`, `t` 0 or 1, never the end its text is beyond); a frame sits with the
 *   dimension's text (`placement`).
 *
 * ISO 5459:2011 §5 and ASME Y14.5-2018 §6.3 both allow a filled or an open datum triangle; Wren
 * draws it filled for every standard it supports (`datumTriangleFilled`), the form both show
 * first. Provisional (secondary sources, owner D9).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { AnnotationAnchor, AnnotationPlacement, GpsStandard, Vec2 } from '@wren-cad/contracts';
import { dot2, dot3, norm3 } from '../annotation/geom';
import type { SolvedView } from '../view/solve';
import { projectedSegment, viewDirection } from './anchors';

/** Whether the datum triangle is drawn filled (else open) under a GPS standard. */
export function datumTriangleFilled(standard: GpsStandard): boolean {
  switch (standard) {
    case 'ISO 1101:2017':
    case 'ASME Y14.5-2018':
    case 'ASME Y14.5-2009':
      return true;
  }
}

/** Datum triangle size for text height h: base and height, sheet mm. */
export function datumTriangleSize(h: number): { base: number; height: number } {
  const base = 1.15 * h;
  return { base, height: base * 0.866 };
}

/**
 * `t` of the point of a line nearest `p` (unclamped: below 0 or above 1 is on the line's
 * extension). A zero-length line gives 0.
 */
export function lineParameter(line: readonly [Vec2, Vec2], p: Vec2): number {
  const d: Vec2 = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
  const l2 = d[0] * d[0] + d[1] * d[1];
  if (l2 < 1e-18) return 0;
  return dot2([p[0] - line[0][0], p[1] - line[0][1]], d) / l2;
}

/**
 * The range a stored `LeaderAttach.t` (kind `ref`) may take: [0, 1] is on the projected edge,
 * outside it on the edge's extension line (ADR-094; the document validator allows -10 to 11, ten
 * edge lengths out).
 */
export const ATTACH_T_RANGE: readonly [number, number] = [-10, 11];

/** `t` clamped to what a placement can store. */
export function storableAttachT(t: number): number {
  return Math.max(ATTACH_T_RANGE[0], Math.min(ATTACH_T_RANGE[1], t));
}

/** The end of a dimension line a feature-of-size datum snaps to: the nearer one. */
export function dimensionLineEnd(t: number): 0 | 1 {
  return t < 0.5 ? 0 : 1;
}

/**
 * The end of a dimension line that its own text sits beyond, or null: a radial diameter's text
 * end (its line runs on out to the text there), or a linear dimension whose text was pushed past
 * an extension line. A datum in line with the dimension line never goes there: its triangle would
 * sit on the dimension's own leader and its letter box on the value (ADR-094 amendment,
 * 2026-11-18).
 */
export function dimensionTextEnd(
  line: readonly [Vec2, Vec2],
  textBox: readonly Vec2[],
): 0 | 1 | null {
  if (textBox.length === 0) return null;
  const c: Vec2 = [
    textBox.reduce((s, p) => s + p[0], 0) / textBox.length,
    textBox.reduce((s, p) => s + p[1], 0) / textBox.length,
  ];
  const t = lineParameter(line, c);
  return t > 1 ? 1 : t < 0 ? 0 : null;
}

/**
 * The end of a dimension line a datum goes to when `wanted` is asked for: that end, unless the
 * dimension's text is beyond it (`dimensionTextEnd`), then the other one.
 */
export function freeDimensionLineEnd(
  wanted: 0 | 1,
  line: readonly [Vec2, Vec2],
  textBox: readonly Vec2[],
): 0 | 1 {
  return dimensionTextEnd(line, textBox) === wanted ? ((1 - wanted) as 0 | 1) : wanted;
}

type LeaderLayout = Extract<AnnotationPlacement['layout'], { kind: 'leader' }>;

const round3 = (x: number) => Math.round(x * 1000) / 1000;

/**
 * A leader on a dimension line moved to its other end: the text offset and the bends are
 * mirrored along the line, so the datum keeps pointing out of the dimension. Other attaches are
 * returned as they are.
 */
export function flipDimensionLineEnd(
  layout: LeaderLayout,
  line: readonly [Vec2, Vec2],
): LeaderLayout {
  const a = layout.attach;
  if (a.kind !== 'dimensionLine') return layout;
  const d: Vec2 = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
  const l = Math.hypot(d[0], d[1]) || 1;
  const u: Vec2 = [d[0] / l, d[1] / l];
  const mirror = (q: Vec2): Vec2 => {
    const k = dot2(q, u);
    return [round3(q[0] - 2 * k * u[0]), round3(q[1] - 2 * k * u[1])];
  };
  const end = dimensionLineEnd(a.t) === 0 ? 1 : 0;
  return {
    ...layout,
    attach: { ...a, t: end },
    text: mirror(layout.text),
    ...(layout.bends ? { bends: layout.bends.map(mirror) } : {}),
  };
}

/**
 * The corners a leader turns at so that its first leg leaves `from` along `axis` (unit), at least
 * `stub` out: none when `toward` already lies on that axis; one when it is off the axis ahead
 * (square off the axis to its level, then across); two when it is behind or too close (out a
 * stub, across to it, then back). A datum's leader leaves its triangle across the surface (or in
 * line with the dimension line), and a frame's arrow meets a surface square to it (ISO 5459,
 * ISO 1101, ASME Y14.5): a box placed off that axis is reached through these corners, never by a
 * slanted first leg.
 */
export function leaderCorners(from: Vec2, axis: Vec2, toward: Vec2, stub: number): Vec2[] {
  const d: Vec2 = [toward[0] - from[0], toward[1] - from[1]];
  const along = dot2(d, axis);
  const side: Vec2 = [d[0] - axis[0] * along, d[1] - axis[1] * along];
  const off = Math.hypot(side[0], side[1]) > 1e-6;
  if (along >= stub - 1e-9)
    return off ? [[from[0] + axis[0] * along, from[1] + axis[1] * along]] : [];
  const out: Vec2 = [from[0] + axis[0] * stub, from[1] + axis[1] * stub];
  return off ? [out, [out[0] + side[0], out[1] + side[1]]] : [out];
}

/**
 * A text offset brought onto a leader's axis when it is within `snap` of it (sheet mm), so a
 * letter box dragged near the in-line position lands exactly in line (no tiny jog in the leader).
 */
export function snapToAxis(text: Vec2, axis: Vec2, snap: number): Vec2 {
  const k = dot2(text, axis);
  const across: Vec2 = [text[0] - axis[0] * k, text[1] - axis[1] * k];
  if (k <= 0 || Math.hypot(across[0], across[1]) > snap) return text;
  return [round3(axis[0] * k), round3(axis[1] * k)];
}

/**
 * The faces an edge name says the edge lies between, from the naming rules (contracts
 * naming.ts): `edge(<A>|<B>)` and its split `#k`, the primitive form `F…:edge(<r>|<r>)` (faces
 * `F…:<r>`), a seam `edge(A|A)` (one face) and a free edge `edge(A)`. Anything else: none. A name
 * says which faces meet there; which of them a pick means is a geometric question (the caller
 * checks each against the view), never a guess.
 */
export function edgeFaceNames(edge: string): string[] {
  const primitive = /^(F[0-9A-Za-z]+):edge\(/.exec(edge);
  const start = primitive ? primitive[0].length : edge.startsWith('edge(') ? 5 : -1;
  if (start < 0) return [];
  let depth = 0;
  let from = start;
  const parts: string[] = [];
  for (let i = start; i < edge.length; i++) {
    const ch = edge[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      if (depth === 0) {
        parts.push(edge.slice(from, i));
        const rest = edge.slice(i + 1);
        if (rest !== '' && !/^#\d+$/.test(rest)) return [];
        const names = parts
          .filter((x) => x !== '')
          .map((x) => (primitive ? `${primitive[1]}:${x}` : x));
        return [...new Set(names)];
      }
      depth--;
    } else if (ch === '|' && depth === 0) {
      parts.push(edge.slice(from, i));
      from = i + 1;
    }
  }
  return [];
}

/**
 * Whether a face anchor is seen edge-on in a view along the picked line (view plane, sheet mm):
 * a plane whose normal lies in the view plane and whose projected outline runs along that line
 * within `tol`. This is how a picked edge maps to the surface it bounds (ADR-094).
 */
export function faceAlongLine(
  v: SolvedView,
  anchor: AnnotationAnchor,
  line: readonly [Vec2, Vec2],
  tol = 0.05,
): boolean {
  if (anchor.kind !== 'plane') return false;
  if (Math.abs(dot3(norm3(anchor.normal), v.frame.n)) > 1e-6) return false;
  const seg = projectedSegment(v, anchor);
  if (!seg) return false;
  const d: Vec2 = [line[1][0] - line[0][0], line[1][1] - line[0][1]];
  const l = Math.hypot(d[0], d[1]);
  if (l < 1e-9) return false;
  const n: Vec2 = [-d[1] / l, d[0] / l];
  const off = (p: Vec2) => Math.abs(dot2([p[0] - line[0][0], p[1] - line[0][1]], n));
  return off(seg[0]) <= tol && off(seg[1]) <= tol;
}

/**
 * The default text offset of a datum or frame on a surface: out of the material, along the
 * face's outward normal as seen in the view (`distance` sheet mm); null when the face is not
 * seen edge-on.
 */
export function outwardOffset(
  v: SolvedView,
  anchor: AnnotationAnchor | null | undefined,
  distance: number,
): Vec2 | null {
  if (anchor?.kind !== 'plane') return null;
  if (Math.abs(dot3(norm3(anchor.normal), v.frame.n)) > 1e-6) return null;
  const n = viewDirection(v, anchor.normal);
  return n ? [n[0] * distance, n[1] * distance] : null;
}

/** Whether a placement layout is a leader on another placement (a feature-of-size form). */
export function attachedPlacementId(layout: AnnotationPlacement['layout']): string | undefined {
  return layout.kind === 'leader' && layout.attach.kind !== 'ref'
    ? layout.attach.placementId
    : undefined;
}
