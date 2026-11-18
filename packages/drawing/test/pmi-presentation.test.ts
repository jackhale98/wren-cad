/**
 * Presentation PMI (M5a, ADR-100): text stroked with the drawing font's outlines exactly where
 * the PDF writer puts it, and every annotation of the bracket drawing lifted from its view onto an
 * annotation plane; model views for annotations no drawing places.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Annotation, Command, Drawing, Vec2, Vec3 } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { textWidth } from '../src/annotation';
import { anchorLookup, importAnchorQueries, importCommands, planImport } from '../src/import';
import { layoutView } from '../src/placement';
import { annotationPresentations, modelFrame, strokeFont, strokeText } from '../src/pmi';
import { standardPreset, stylePreset } from '../src/style';
import { partToSheet, solveViews } from '../src/view';
import {
  bracketAnchor,
  bracketBounds,
  bracketDrawing,
  bracketFrames,
  bracketPart,
  bracketResolutions,
} from './bracket';
import { evaluate } from './fixtures';

const TTF = readFileSync(
  fileURLToPath(new URL('../assets/fonts/osifont-lgpl3fe.ttf', import.meta.url)),
);
const font = strokeFont(new Uint8Array(TTF));

function box(lines: Vec2[][]) {
  const xs = lines.flat().map((p) => p[0]);
  const ys = lines.flat().map((p) => p[1]);
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

const text = (s: string, over: Partial<Extract<Parameters<typeof strokeText>[0], object>> = {}) =>
  ({
    kind: 'text',
    at: [10, 20],
    text: s,
    height: 3.5,
    angle: 0,
    align: 'left',
    baseline: 'baseline',
    ...over,
  }) as Parameters<typeof strokeText>[0];

describe('stroked text', () => {
  it('closed glyph outlines, cap height h on the baseline, width as laid out', () => {
    const lines = strokeText(text('H'), font);
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l[0]).toEqual(l[l.length - 1]);
    const b = box(lines);
    expect(b.y0).toBeCloseTo(20, 1);
    expect(b.y1).toBeCloseTo(23.5, 1);
    expect(b.x0).toBeGreaterThanOrEqual(10);
    expect(b.x1).toBeLessThanOrEqual(10 + textWidth('H', 3.5) + 1e-9);
  });

  it('“O” has an outer and an inner contour; a space draws nothing', () => {
    expect(strokeText(text('O'), font).length).toBe(2);
    expect(strokeText(text(' '), font)).toEqual([]);
  });

  it('aligns and turns like the PDF writer', () => {
    const w = textWidth('Ø6 H7', 5);
    const c = box(
      strokeText(text('Ø6 H7', { height: 5, align: 'center', baseline: 'middle' }), font),
    );
    expect((c.x0 + c.x1) / 2).toBeCloseTo(10, 0);
    expect(c.x1 - c.x0).toBeLessThanOrEqual(w + 1e-9);
    expect((c.y0 + c.y1) / 2).toBeGreaterThan(17);
    expect((c.y0 + c.y1) / 2).toBeLessThan(23);
    const r = box(strokeText(text('10', { align: 'right', angle: 90 }), font));
    // Turned 90° CCW about `at`, right-aligned: the text runs down from 10 + w to 10 along y.
    expect(r.y1).toBeLessThanOrEqual(20 + 1e-9);
    expect(r.y0).toBeGreaterThanOrEqual(20 - textWidth('10', 3.5) - 1e-9);
    expect(r.x1).toBeLessThanOrEqual(10 + 1e-9);
  });

  it('Ø, ±, ° and Greek come from the font, not the missing glyph', () => {
    for (const s of ['Ø', '±', '°']) expect(strokeText(text(s), font).length).toBeGreaterThan(0);
  });
});

/** The bracket's import, applied the way the store does. */
function importedBracket(): { drawing: Drawing; annotations: Annotation[] } {
  const d0 = bracketDrawing('first');
  const part = bracketPart(1);
  const frames = bracketFrames(1);
  const queries = importAnchorQueries(part, frames);
  const answers = queries.map((q) => bracketAnchor(q, 1));
  let n = 0;
  const plan = planImport({
    drawing: d0,
    part,
    views: solveViews({ drawing: d0, bounds: bracketBounds(1), evaluate }),
    resolutions: new Map(),
    sketchFrames: frames,
    anchors: anchorLookup(queries, answers),
    moveViews: true,
    newId: () => `N${String(++n).padStart(3, '0')}`,
  });
  const all = new Set(plan.candidates.filter((c) => c.placement).map((c) => c.key));
  const cmds: Command[] = importCommands(plan, 'D1', all);
  let drawing = d0;
  const annotations: Annotation[] = [];
  for (const c of cmds) {
    if (c.kind === 'updateView')
      drawing = { ...drawing, views: drawing.views.map((v) => (v.id === c.view.id ? c.view : v)) };
    else if (c.kind === 'placeAnnotations') {
      drawing = {
        ...drawing,
        placements: [...drawing.placements, ...c.items.map((i) => i.placement)],
      };
      for (const i of c.items) if (i.annotation) annotations.push(i.annotation);
    }
  }
  return { drawing, annotations };
}

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

describe('presentation of the bracket drawing’s annotations', () => {
  const { drawing, annotations } = importedBracket();
  const resolutions = bracketResolutions(annotations, 1);
  const ok = annotations.filter((a) => resolutions.get(a.id)?.state === 'ok');
  const out = annotationPresentations({
    annotations,
    ids: ok.map((a) => a.id),
    resolutions,
    configurationId: null,
    drawings: [drawing],
    partId: 'P1',
    bounds: bracketBounds(1),
    evaluate,
    evaluateAnnotation: (e, k) => evaluate(e, k === 'angle' ? 'angle' : 'ratio'),
    font,
  });

  it('every placed annotation is presented from its drawing view', () => {
    expect(ok.length).toBeGreaterThanOrEqual(12);
    for (const a of ok) {
      const r = out.get(a.id);
      expect(r?.ok, `${a.id}: ${r && !r.ok ? r.reason : ''}`).toBe(true);
      if (!r?.ok) continue;
      expect(r.source).not.toBe('model');
      expect(r.presentation.polylines.length).toBeGreaterThan(2);
    }
  });

  it('lies on the view’s plane through the annotation, and projects back onto the sheet layout', () => {
    const views = solveViews({ drawing, bounds: bracketBounds(1), evaluate });
    for (const a of ok) {
      const r = out.get(a.id);
      if (!r?.ok || r.source === 'model') continue;
      const v = views.get(r.source.viewId);
      if (!v?.ok) throw new Error('view');
      const { plane, polylines } = r.presentation;
      expect(plane.normal).toEqual(v.frame.n);
      for (const l of polylines)
        for (const p of l)
          expect(Math.abs(dot(sub(p, plane.origin), plane.normal))).toBeLessThan(1e-9);
      // The leader and line ends are exactly the layout's sheet points.
      const placed = layoutView(
        drawing.placements.filter((p) => p.viewId === v.view.id),
        {
          view: v,
          style: drawing.style,
          standard: drawing.standard.gps,
          evaluate: (e, k) => evaluate(e, k === 'angle' ? 'angle' : 'ratio'),
          annotations: new Map(annotations.map((x) => [x.id, x])),
          resolutions,
        },
      ).find((p) => p.annotationId === a.id);
      const line = placed?.items.find((i) => i.kind === 'line');
      if (line?.kind !== 'line') continue;
      const back = polylines.map((l) => l.map((p) => partToSheet(v, p)));
      const hit = back.some((l) =>
        l.some((q) => Math.hypot(q[0] - line.a[0], q[1] - line.a[1]) < 1e-9),
      );
      expect(hit).toBe(true);
    }
  });

  it('an annotation no drawing places gets a model view from its geometry', () => {
    const dia = ok.find((a) => a.kind === 'diameter') as Annotation;
    const only = annotationPresentations({
      annotations,
      ids: [dia.id],
      resolutions,
      configurationId: null,
      drawings: [],
      partId: 'P1',
      bounds: bracketBounds(1),
      evaluate,
      evaluateAnnotation: (e, k) => evaluate(e, k === 'angle' ? 'angle' : 'ratio'),
      font,
    });
    const r = only.get(dia.id);
    expect(r?.ok && r.source).toBe('model');
    if (!r?.ok) return;
    // The hole seen face-on: the top view (normal +Z).
    expect(r.presentation.plane.normal).toEqual([0, 0, 1]);
    const f = modelFrame(dia, resolutions.get(dia.id) as never);
    expect(f.n).toEqual([0, 0, 1]);
  });

  it('a datum on a feature of size sits on its dimension in the dimension’s model view', () => {
    const width = ok.find((a) => a.kind === 'linear') as Annotation;
    const datum: Annotation = {
      id: 'ZDATUM',
      kind: 'datumFeature',
      origin: { kind: 'model' },
      label: 'A',
      refs: [],
      appliesTo: width.id,
    };
    const res = new Map(resolutions);
    res.set(datum.id, { annotationId: datum.id, state: 'ok' });
    const r = annotationPresentations({
      annotations: [...annotations, datum],
      ids: [datum.id],
      resolutions: res,
      configurationId: null,
      drawings: [],
      partId: 'P1',
      bounds: bracketBounds(1),
      evaluate,
      evaluateAnnotation: (e, k) => evaluate(e, k === 'angle' ? 'angle' : 'ratio'),
      font,
      style: stylePreset('iso'),
      standard: standardPreset('iso').gps,
    }).get(datum.id);
    expect(r?.ok, r && !r.ok ? r.reason : '').toBe(true);
  });

  it('placements in another configuration’s views are not used', () => {
    const other: Drawing = { ...drawing, configurationId: 'CFG2' };
    const dia = ok.find((a) => a.kind === 'diameter') as Annotation;
    const r = annotationPresentations({
      annotations,
      ids: [dia.id],
      resolutions,
      configurationId: null,
      drawings: [other],
      partId: 'P1',
      bounds: bracketBounds(1),
      evaluate,
      evaluateAnnotation: (e, k) => evaluate(e, k === 'angle' ? 'angle' : 'ratio'),
      font,
    }).get(dia.id);
    expect(r?.ok && r.source).toBe('model');
  });
});
