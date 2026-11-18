/**
 * STEP AP242 presentation PMI from the M4 layout (M5a, ADR-100 decision 2): every exported
 * annotation is laid out by the same code the drawing views use (`layoutView` → display items),
 * its curves flattened and its text stroked with the drawing font's outlines (`strokeText`), then
 * lifted from the view onto an **annotation plane** in part coordinates: the view's plane through
 * the annotation's first anchor. Receiving viewers that read only presentation PMI then show the
 * same dimensions, frames and datums as the PDF and DXF.
 *
 * Which view: the annotation's first placement in a drawing of the part, in a view regenerated in
 * the exported configuration (base, then projected, section, iso, detail views; drawings and
 * placements by id). An annotation without such a placement gets a **model view** derived from its
 * ref geometry (a named view that sees the measured direction true length, a circle face-on, a
 * datum face edge-on) and a default placement; a datum or frame on a feature of size goes in its
 * dimension's view, on its dimension. Sizes stay sheet mm on the plane (scale 1 in model views, the
 * view's scale in drawing views), so text heights are those of the drawing.
 *
 * Nothing here changes layout behaviour (placement/layout.ts is only called). Pure and worker-safe.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  Annotation,
  AnnotationAnchor,
  AnnotationPlacement,
  AnnotationResolution,
  BaseView,
  Drawing,
  DrawingStyle,
  DrawingView,
  Expr,
  GpsStandard,
  Id,
  PmiPresentation,
  Vec2,
  Vec3,
} from '@wren-cad/contracts';
import type { DisplayItem } from '../annotation/display';
import { flattenPrimitive } from '../annotation/flatten';
import { add3, cross3, dot3, len3, norm3, scale3, sub3 } from '../annotation/geom';
import type { FitDeviationLookup } from '../annotation/tolerance';
import { viewConfiguration } from '../attention/aggregate';
import { type StrokeFont, strokeText } from '../font/glyph-outlines';
import { anchorPoints } from '../placement/anchors';
import {
  type FeatureCalloutData,
  layoutView,
  type PlacedAnnotation,
  type PlacementContext,
} from '../placement/layout';
import { standardPreset, stylePreset } from '../style';
import { orientationFrame, projectBounds, type ViewFrame, viewToPart } from '../view/frame';
import { type ExprEvaluator, type SolvedView, sheetToView, solveViews } from '../view/solve';

/** Chord tolerance of flattened arcs, ellipses and splines, sheet mm. */
export const PMI_CHORD_TOLERANCE = 0.02;

/** Display items → polylines (sheet mm): curves flattened, fills as closed loops, text stroked. */
export function tessellateItems(
  items: readonly DisplayItem[],
  font: StrokeFont,
  tol = PMI_CHORD_TOLERANCE,
): Vec2[][] {
  const out: Vec2[][] = [];
  for (const it of items) {
    const lines = it.kind === 'text' ? strokeText(it, font) : flattenPrimitive(it, tol);
    for (const l of lines) if (l.length >= 2) out.push(l);
  }
  return out;
}

/** Sheet point of a view → part point on the view's plane through `through` (part mm). */
export function sheetToPlane(v: SolvedView, through: Vec3): (p: Vec2) => Vec3 {
  const depth = dot3(through, v.frame.n);
  const offset = scale3(v.frame.n, depth);
  return (p) => add3(viewToPart(v.frame, sheetToView(v, p)), offset);
}

/** The point an annotation's plane passes through: its first anchor's first point. */
export function planePoint(
  res: AnnotationResolution | undefined,
  fallback: Vec3,
  at?: Annotation['at'],
): Vec3 {
  for (const [i, a] of (res?.anchors ?? []).entries()) {
    if (!a) continue;
    const p = anchorPoints(a, at?.[i] ?? 'self')[0];
    if (p) return p;
  }
  return fallback;
}

/** One laid-out placement as presentation PMI on its view's plane through `through`. */
export function placedPresentation(
  placed: PlacedAnnotation,
  v: SolvedView,
  font: StrokeFont,
  through: Vec3,
): PmiPresentation {
  const toPart = sheetToPlane(v, through);
  const tol = PMI_CHORD_TOLERANCE * Math.max(v.scale, 1e-9);
  const polylines = tessellateItems(placed.items, font, tol).map((l) => l.map(toPart));
  return {
    plane: { origin: toPart(v.position), x: v.frame.x, normal: v.frame.n },
    polylines,
  };
}

// ---------------------------------------------------------------------------------------------
// Model views (no drawing placement)
// ---------------------------------------------------------------------------------------------

const NAMED: readonly ('front' | 'top' | 'right')[] = ['front', 'top', 'right'];

/** The direction an anchor gives: a line's, an axis's, a plane's or circle's normal. */
function anchorDir(a: AnnotationAnchor | null | undefined): Vec3 | null {
  if (!a) return null;
  switch (a.kind) {
    case 'line':
      return len3(sub3(a.b, a.a)) > 1e-9 ? norm3(sub3(a.b, a.a)) : null;
    case 'axis':
      return norm3(a.direction);
    case 'plane':
      return norm3(a.normal);
    case 'circle':
      return norm3(a.normal);
    case 'torus':
      return norm3(a.axis);
    case 'curve': {
      const p = a.points[0];
      const q = a.points[a.points.length - 1];
      return p && q && len3(sub3(q, p)) > 1e-9 ? norm3(sub3(q, p)) : null;
    }
    case 'point':
      return null;
  }
}

/** The named frame (front, top, right) whose normal best fits `score` (higher is better). */
function bestFrame(score: (n: Vec3) => number): ViewFrame {
  let best = orientationFrame({ kind: 'named', name: 'front' });
  let s = Number.NEGATIVE_INFINITY;
  for (const name of NAMED) {
    const f = orientationFrame({ kind: 'named', name });
    const v = score(f.n);
    if (v > s + 1e-9) {
      s = v;
      best = f;
    }
  }
  return best;
}

/** Where a measurement runs: the stated direction, else the planes' normal, else point to point. */
function measureDir(a: Annotation, res: AnnotationResolution): Vec3 | null {
  if ('direction' in a && a.direction) return norm3(a.direction);
  const anchors = res.anchors ?? [];
  const plane = anchors.find((x) => x?.kind === 'plane');
  if (plane && a.kind !== 'aligned') return anchorDir(plane);
  const pts: Vec3[] = [];
  anchors.forEach((x, i) => {
    const p = x ? anchorPoints(x, a.at?.[i] ?? 'self')[0] : undefined;
    if (p) pts.push(p);
  });
  const [p, q] = pts;
  if (p && q && len3(sub3(q, p)) > 1e-9) return norm3(sub3(q, p));
  return null;
}

/** The frame a model view of this annotation uses (text upright in a named view). */
export function modelFrame(a: Annotation, res: AnnotationResolution): ViewFrame {
  const anchors = res.anchors ?? [];
  switch (a.kind) {
    case 'linear':
    case 'aligned':
    case 'ordinate': {
      const d = measureDir(a, res);
      // Sees the measured direction true length; between planes, sees them edge-on.
      return d ? bestFrame((n) => -Math.abs(dot3(n, d))) : bestFrame(() => 0);
    }
    case 'diameter':
    case 'radius': {
      const d = anchorDir(anchors[0]);
      // The circle face-on.
      return d ? bestFrame((n) => Math.abs(dot3(n, d))) : bestFrame(() => 0);
    }
    case 'angle': {
      const d1 = anchorDir(anchors[0]);
      const d2 = anchorDir(anchors[1]);
      const axis = d1 && d2 ? cross3(d1, d2) : null;
      return axis && len3(axis) > 1e-9
        ? bestFrame((n) => Math.abs(dot3(n, norm3(axis))))
        : bestFrame(() => 0);
    }
    default: {
      const d = anchorDir(anchors[0]);
      // Faces edge-on (a datum triangle on the face's line), axes side-on.
      return d ? bestFrame((n) => -Math.abs(dot3(n, d))) : bestFrame(() => 0);
    }
  }
}

/** A solved model view at scale 1 (sheet mm = part mm on the plane), centred on the part. */
export function modelView(id: Id, frame: ViewFrame, bounds: { min: Vec3; max: Vec3 }): SolvedView {
  const pb = projectBounds(frame, bounds);
  const view: BaseView = {
    id,
    sheetId: '',
    kind: 'base',
    orientation: { kind: 'matrix', x: frame.x, y: frame.y },
    layout: { kind: 'free', position: pb.center },
  };
  return {
    view,
    ok: true,
    frame,
    scale: 1,
    position: pb.center,
    center: pb.center,
    bounds: { min: pb.min, max: pb.max },
    display: {
      lines: 'visible',
      tangentEdges: 'off',
      centerMarks: false,
      centerLines: false,
      threads: false,
    },
  };
}

/** The default placement of an annotation in a model view (sheet mm at scale 1). */
export function modelPlacement(
  a: Annotation,
  viewId: Id,
  dimensionPlacement?: Id,
): AnnotationPlacement {
  const base = { id: `pmi:${a.id}`, viewId, annotationId: a.id };
  switch (a.kind) {
    case 'linear':
    case 'aligned':
    case 'ordinate':
      return { ...base, layout: { kind: 'offset', distance: 10 } };
    case 'diameter':
    case 'radius':
      return { ...base, layout: { kind: 'radial', angle: 45, distance: 8 } };
    case 'angle':
      return { ...base, layout: { kind: 'arc', radius: 20 } };
    case 'datumFeature':
      return {
        ...base,
        layout: {
          kind: 'leader',
          attach: dimensionPlacement
            ? { kind: 'dimensionLine', placementId: dimensionPlacement, t: 0.5 }
            : { kind: 'ref', index: 0 },
          text: [0, -10],
        },
      };
    default:
      return {
        ...base,
        layout: {
          kind: 'leader',
          attach: dimensionPlacement
            ? { kind: 'placement', placementId: dimensionPlacement }
            : { kind: 'ref', index: 0 },
          text: [12, 12],
        },
      };
  }
}

// ---------------------------------------------------------------------------------------------
// The whole part
// ---------------------------------------------------------------------------------------------

export interface PmiPresentationInput {
  /** The part's annotations (configuration-resolved). */
  annotations: readonly Annotation[];
  /** Which of them to present (the exported ones). */
  ids: Iterable<Id>;
  /** The latest regen's resolutions, in `configurationId`. */
  resolutions: ReadonlyMap<Id, AnnotationResolution>;
  /** The configuration exported (null = Default): only views regenerated in it are used. */
  configurationId: Id | null;
  /** The document's drawings; only those of `partId` are used. */
  drawings: readonly Drawing[];
  partId: Id;
  /** Part bounding box (union of the exported bodies' boxes). */
  bounds: { min: Vec3; max: Vec3 };
  /** Drawing expressions: view scales (`ratio`) and rotations (`angle`). */
  evaluate: ExprEvaluator;
  /** Annotation expressions: lengths in mm, angles in rad. */
  evaluateAnnotation: (expr: Expr, kind: 'length' | 'angle') => number | undefined;
  fitDeviations?: FitDeviationLookup;
  features?: FeatureCalloutData;
  font: StrokeFont;
  /** Model views: style and GPS standard (default ISO presets). */
  style?: DrawingStyle;
  standard?: GpsStandard;
}

export type PmiPresentationResult =
  | { ok: true; presentation: PmiPresentation; source: { drawingId: Id; viewId: Id } | 'model' }
  | { ok: false; reason: string };

const VIEW_ORDER: Record<DrawingView['kind'], number> = {
  base: 0,
  projected: 1,
  section: 2,
  iso: 3,
  detail: 4,
};

function usable(p: PlacedAnnotation | undefined): string | null {
  if (!p) return 'The layout produced nothing';
  if (p.suppressed) return 'Not in this configuration';
  if (p.attention) return 'Its layout needs attention';
  if (p.issues.length > 0) return `Its layout has a problem (${p.issues[0]?.kind})`;
  if (p.items.length === 0) return 'The layout produced nothing';
  return null;
}

/**
 * Presentation PMI for each annotation in `ids`: from its first drawing placement in a view of the
 * exported configuration, else from a model view. A layout that needs attention gives a reason
 * instead (the item is then exported with semantic PMI only, and the report says so).
 */
export function annotationPresentations(
  input: PmiPresentationInput,
): Map<Id, PmiPresentationResult> {
  const wanted = new Set(input.ids);
  const annotations = new Map(input.annotations.map((a) => [a.id, a]));
  const out = new Map<Id, PmiPresentationResult>();
  const center: Vec3 = scale3(add3(input.bounds.min, input.bounds.max), 0.5);
  const baseCtx = {
    evaluate: input.evaluateAnnotation,
    annotations,
    resolutions: input.resolutions,
    ...(input.fitDeviations ? { fitDeviations: input.fitDeviations } : {}),
    ...(input.features ? { features: input.features } : {}),
  };

  // 1. Drawing placements, in a stable order.
  const drawings = input.drawings
    .filter((d) => d.subject.partId === input.partId)
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  for (const d of drawings) {
    const solved = solveViews({ drawing: d, bounds: input.bounds, evaluate: input.evaluate });
    const views = d.views
      .filter((v) => viewConfiguration(d, v) === input.configurationId)
      .sort(
        (x, y) =>
          VIEW_ORDER[x.kind] - VIEW_ORDER[y.kind] || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
      );
    for (const v of views) {
      const sol = solved.get(v.id);
      if (!sol?.ok) continue;
      const own = d.placements.filter((p) => p.viewId === v.id);
      const todo = own.filter((p) => wanted.has(p.annotationId) && !out.get(p.annotationId)?.ok);
      if (todo.length === 0) continue;
      const ctx: Omit<PlacementContext, 'placed'> = {
        ...baseCtx,
        view: sol,
        style: d.style,
        standard: d.standard.gps,
      };
      const placed = new Map(layoutView(own, ctx).map((p) => [p.placementId, p]));
      for (const p of [...todo].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))) {
        const pa = placed.get(p.id);
        const why = usable(pa);
        if (why || !pa) {
          if (!out.has(p.annotationId)) out.set(p.annotationId, { ok: false, reason: why ?? '' });
          continue;
        }
        const a = annotations.get(p.annotationId);
        const through = planePoint(input.resolutions.get(p.annotationId), center, a?.at);
        out.set(p.annotationId, {
          ok: true,
          presentation: placedPresentation(pa, sol, input.font, through),
          source: { drawingId: d.id, viewId: v.id },
        });
      }
    }
  }

  // 2. Model views for the rest (a datum or frame on a feature of size in its dimension's view).
  const style = input.style ?? stylePreset('iso');
  const standard = input.standard ?? standardPreset('iso').gps;
  const ids = [...wanted].sort();
  for (const id of ids) {
    if (out.get(id)?.ok) continue;
    const a = annotations.get(id);
    const res = input.resolutions.get(id);
    if (!a || !res || res.state !== 'ok') {
      out.set(id, { ok: false, reason: 'Not resolved' });
      continue;
    }
    const dimId =
      (a.kind === 'datumFeature' || a.kind === 'geometricTolerance') && a.appliesTo !== undefined
        ? a.appliesTo
        : undefined;
    const dim = dimId !== undefined ? annotations.get(dimId) : undefined;
    const dimRes = dimId !== undefined ? input.resolutions.get(dimId) : undefined;
    if (dimId !== undefined && (!dim || !dimRes || dimRes.state !== 'ok')) {
      out.set(id, { ok: false, reason: 'The dimension it applies to is not resolved' });
      continue;
    }
    const lead = dim && dimRes ? { a: dim, r: dimRes } : { a, r: res };
    const viewId = `pmi-view:${lead.a.id}`;
    const v = modelView(viewId, modelFrame(lead.a, lead.r), input.bounds);
    const placements: AnnotationPlacement[] = [
      modelPlacement(a, viewId, dim ? `pmi:${dim.id}` : undefined),
    ];
    if (dim) placements.push(modelPlacement(dim, viewId));
    const placed = layoutView(placements, { ...baseCtx, view: v, style, standard });
    const pa = placed.find((p) => p.annotationId === id);
    const why = usable(pa);
    if (why || !pa) {
      out.set(id, { ok: false, reason: why ?? '' });
      continue;
    }
    const through = planePoint(lead.r, center, lead.a.at);
    out.set(id, {
      ok: true,
      presentation: placedPresentation(pa, v, input.font, through),
      source: 'model',
    });
  }
  return out;
}
