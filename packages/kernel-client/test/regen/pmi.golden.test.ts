/**
 * M5a golden (ADR-100, PLAN M5 accept): the M4 bracket's drawing annotations as STEP AP242 PMI
 * export items, with the real kernel. The drawing is the one the app makes: three standard views
 * and a section, "Import model annotations" planned with the kernel's anchors, plus datums A, B
 * (and C on the hole's size), a flatness, a perpendicularity and a position frame, and tolerances.
 *
 * Checks: 28 items; every item is one of the drawing's annotations with the same id, kind and
 * value; every annotation the export leaves out says why; each target is the face the
 * annotation's ref resolves to (by name, never guessed); presentation comes from the drawing
 * views; the plan is deterministic.
 *
 * Sketch dimensions (ADR-101 phase 1c): the import-planned dimensions whose refs are sketch
 * entities export on what those entities generated (`sketchEntityGenerated`): the hole circles'
 * diameters on the cut's cylinders, the upright's thickness between the edges swept from its
 * corners (both merged into the plate's faces by the add: exported on the survivors, noted), and
 * the plate's width and depth: their corner edges were removed by the corner fillet, so each such
 * corner is attached to the side face of the profile line through it across the dimension's
 * direction (the drawing import's rule, `profileLineAcross`), noted. Every dimension from a
 * sketch's construction origin stays skipped with that reason.
 *
 * Round trip (simulated façade, see `fakeFacade`): the items are written with a real AP242 file of
 * the shapes, read back as `PmiImportItem`s on the re-read body, mapped to the import feature's
 * names (`importedPmi`), turned into annotations (`@wren-cad/io/pmi`), regenerated and exported
 * again: the second items equal the first (ids, kinds, types, values, tolerances, datums and the
 * same faces). The end-to-end Wasm round trip through the kernel-engineer's façade is at the end,
 * skipped until the façade has `exportStepPmi` (marker: FACADE-PMI-PENDING).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type {
  Annotation,
  AnnotationPlacement,
  AnnotationResolution,
  Command,
  Drawing,
  DrawingView,
  ExportOptions,
  Expr,
  Id,
  ImportFeature,
  PmiExportItem,
  PmiImportItem,
  PmiTarget,
  ShapeFingerprints,
  Vec3,
  WrenDoc,
} from '@wren-cad/contracts';
import { expressionEngine, scopeOf } from '@wren-cad/document';
import {
  anchorLookup,
  importAnchorQueries,
  importCommands,
  planImport,
  type SketchFrame,
  solveViews,
  standardPreset,
  stylePreset,
} from '@wren-cad/drawing';
import { annotationsFromPmi } from '@wren-cad/io/pmi';
import { createSketchSolverCore } from '@wren-cad/sketch/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernelApi, type ExportShape, type KernelWorkerApi } from '../../src/kernel-api';
import { RegenEngine, type RegenOutput } from '../../src/regen/engine';
import { sha256Hex } from '../../src/regen/imports';
import { reprojectLinkedSketch } from '../../src/regen/linked-sketch';
import { B, bracketDoc } from './bracket';
import { built, edgeName, fid, part, side, skipNote, variants } from './helpers';

/** Does the kernel build have the M5a façade (`exportStepPmi`)? */
async function probeFacade(): Promise<boolean> {
  if (!built) return false;
  const k = createKernelApi({ variants, canUseThreads: () => false });
  if (!(await k.init({ variant: 'single' })).ok) return false;
  const r = await k.exportStepPmi([], [], { stepSchema: 'AP242', pmi: {} });
  return !(r.ok === false && r.error.code === 'UNSUPPORTED_FEATURE');
}
const facadeReady = await probeFacade();

const TTF = new Uint8Array(
  readFileSync(
    fileURLToPath(new URL('../../../drawing/assets/fonts/osifont-lgpl3fe.ttf', import.meta.url)),
  ),
);

// ---------------------------------------------------------------------------------------------
// The simulated façade: real STEP bytes of the shapes, PMI carried beside them.
// ---------------------------------------------------------------------------------------------

interface Written {
  items: PmiExportItem[];
  options: unknown;
  bytes: Uint8Array;
  /** Fingerprints of the exported shapes (for the simulated reader's targets). */
  fingerprints: ShapeFingerprints[];
}

const centroidKey = (c: Vec3) => c.map((x) => Math.round(x * 1e4) / 1e4).join(',');

/**
 * Stands in for `exportStepPmi` and the extended STEP `importFile` (pmi-facade.ts): the shapes
 * are written as real AP242 with `exportShapes`, the items kept beside the bytes; reading those
 * bytes back gives them as `PmiImportItem`s named by annotation id, with each target found on the
 * re-read body by its geometry (what `STEPCAFControl_Reader` gets from the file's references).
 */
function fakeFacade(
  kernel: ReturnType<typeof createKernelApi>,
  mode: 'simulated' | 'real' = 'simulated',
) {
  const written: Written[] = [];
  const record = async (
    shapes: ExportShape[],
    items: PmiExportItem[],
    options: object,
    bytes: Uint8Array,
  ) => {
    const fingerprints: ShapeFingerprints[] = [];
    for (const s of shapes) {
      const fp = await kernel.fingerprints(s.shape);
      if (fp.ok) fingerprints.push(fp.value);
    }
    written.push({ items: structuredClone(items), options, bytes, fingerprints });
  };
  const api = {
    async exportStepPmi(shapes: ExportShape[], items: PmiExportItem[], options: ExportOptions) {
      if (mode === 'real') {
        const r = await kernel.exportStepPmi(shapes, items, options);
        if (r.ok) await record(shapes, items, options, r.value.files[0]?.bytes as Uint8Array);
        return r;
      }
      const r = await kernel.exportShapes(shapes, 'step', { stepSchema: 'AP242' });
      if (!r.ok) return r;
      await record(shapes, items, options, r.value[0]?.bytes as Uint8Array);
      return {
        ok: true as const,
        value: { files: r.value, report: { exported: items.length, skipped: [], notes: [] } },
      };
    },
    async importShapesWithPmi(bytes: Uint8Array, format: 'step') {
      if (mode === 'real') return kernel.importShapesWithPmi(bytes, format);
      const r = await kernel.importShapes(bytes, format);
      if (!r.ok) return r;
      const w = written.find(
        (x) => x.bytes.length === bytes.length && x.bytes.every((b, i) => b === bytes[i]),
      );
      if (!w) return { ok: true as const, value: { bodies: r.value } };
      const reread: ShapeFingerprints[] = [];
      for (const b of r.value) {
        const fp = await kernel.fingerprints(b.shape);
        if (!fp.ok) return fp;
        reread.push(fp.value);
      }
      const map = (t: PmiTarget): PmiTarget => {
        const was = w.fingerprints[t.body];
        const now = reread[t.body];
        if (!was || !now || t.kind === 'vertex') return t;
        const list = (fp: ShapeFingerprints) => (t.kind === 'face' ? fp.faces : fp.edges);
        const c = list(was)[t.index - 1]?.centroid as Vec3;
        const j = list(now).findIndex((f) => centroidKey(f.centroid) === centroidKey(c));
        return { ...t, index: j + 1 };
      };
      // As the real reader returns them: named by annotation id, no `annotationId`.
      const items: PmiImportItem[] = w.items.map((i) => {
        const { presentation: _p, annotationId, ...rest } = i;
        return { ...rest, name: annotationId, targets: i.targets.map(map) } as PmiImportItem;
      });
      return { ok: true as const, value: { bodies: r.value, pmi: { items, issues: [] } } };
    },
  };
  return { written, api };
}

// ---------------------------------------------------------------------------------------------
// The bracket and its drawing
// ---------------------------------------------------------------------------------------------

const face = (name: string) => ({ name, kind: 'face' as const });
const plateBottom = `F${B.E1}:start`;
const plateTop = `F${B.E1}:end`;
const plateLeft = side(B.E1, B.S1, 'L4');
const plateRight = side(B.E1, B.S1, 'L2');
const plateFront = side(B.E1, B.S1, 'L1');
const plateBack = side(B.E1, B.S1, 'L3');
const uprightFront = side(B.E3, B.S3, 'M1');
const uprightBack = side(B.E3, B.S3, 'M3');
const uprightTop = `F${B.E3}:end`;
const holeWall1 = `F${B.E2}:side(S${B.S2}:e(H1))`;
const holeWall2 = `F${B.E2}:side(S${B.S2}:e(H2))`;
const cornerFillet = `F${B.F1}:fillet(${edgeName(plateLeft, plateFront)})`;
const bendFillet = `F${B.F2}:fillet(${edgeName(plateTop, uprightFront)})`;
const chamferFace = `F${B.C1}:chamfer(${edgeName(uprightTop, uprightFront)})`;
const drawn = { kind: 'drawing', drawingId: fid('DRW') } as const;

const NEW = (n: number) => `01JPMX${String(n).padStart(20, '0')}`;

/** The app's drawing of the bracket: A3 ISO 1:1, three standard views and section A–A. */
function bracketDrawing(partId: Id): Drawing {
  const views: DrawingView[] = [
    {
      id: 'VF',
      sheetId: 'S1',
      kind: 'base',
      orientation: { kind: 'named', name: 'front' },
      layout: { kind: 'free', position: [78, 245] },
    },
    {
      id: 'VT',
      sheetId: 'S1',
      kind: 'projected',
      parentId: 'VF',
      from: 'top',
      layout: { kind: 'aligned', distance: 74 },
    },
    {
      id: 'VS',
      sheetId: 'S1',
      kind: 'projected',
      parentId: 'VF',
      from: 'left',
      layout: { kind: 'aligned', distance: 90 },
    },
    {
      id: 'VX',
      sheetId: 'S1',
      kind: 'section',
      parentId: 'VF',
      letter: 'A',
      cut: [
        { kind: 'free', at: [1, 24] },
        { kind: 'free', at: [79, 24] },
      ],
      look: 'left',
      layout: { kind: 'free', position: [330, 230] },
    },
  ];
  return {
    id: fid('DRW'),
    name: 'Bracket drawing',
    subject: { kind: 'part', partId },
    standard: standardPreset('iso'),
    projection: 'first',
    units: 'mm',
    style: stylePreset('iso'),
    template: { id: 'iso-5457', version: 1 },
    sheets: [
      { id: 'S1', name: 'Sheet 1', format: { size: 'A3', orientation: 'landscape' }, scale: '1' },
    ],
    views,
    placements: [],
    centerMarks: [],
    tables: [],
    notes: [],
  };
}

function evaluator(doc: WrenDoc) {
  const scope = scopeOf(doc);
  return (e: Expr, kind: 'scalar' | 'length' | 'angle') => {
    const r = expressionEngine.evaluate(e, kind, scope);
    return r.ok ? r.value : undefined;
  };
}

const leader = (
  id: string,
  viewId: Id,
  annotationId: Id,
  attach: Extract<AnnotationPlacement['layout'], { kind: 'leader' }>['attach'] = {
    kind: 'ref',
    index: 0,
  },
  text: [number, number] = [12, 12],
): AnnotationPlacement => ({ id, viewId, annotationId, layout: { kind: 'leader', attach, text } });

// ---------------------------------------------------------------------------------------------

describe.skipIf(!built)(`STEP AP242 PMI export of the M4 bracket${skipNote}`, () => {
  let kernel: ReturnType<typeof createKernelApi>;
  let engine: RegenEngine;
  let facade: ReturnType<typeof fakeFacade>;
  let doc: WrenDoc;
  let drawing: Drawing;
  let annotations: Annotation[];
  let regen: RegenOutput;
  let exported: Extract<Awaited<ReturnType<RegenEngine['exportPart']>>, { ok: true }>;
  let bounds: { min: Vec3; max: Vec3 };
  const partId = fid('PART');

  beforeAll(async () => {
    kernel = createKernelApi({ variants, canUseThreads: () => false });
    const init = await kernel.init({ variant: 'single' });
    if (!init.ok) throw new Error(JSON.stringify(init.error));
    facade = fakeFacade(kernel);
    engine = new RegenEngine({
      kernel: { ...kernel, ...facade.api } as unknown as KernelWorkerApi,
      sketchSolver: () => createSketchSolverCore(),
      reprojectLinked: reprojectLinkedSketch,
      pmiFont: async () => TTF,
    });

    // 1. The bracket, its sketch frames and bounds.
    doc = bracketDoc();
    const r0 = await engine.regenerate({ doc, partId, quality: 'coarse' });
    const frames = new Map<Id, SketchFrame>(r0.sketches.map((s) => [s.featureId, s.frame]));
    const sfd = await engine.shapeForDrawing(partId);
    if (!sfd.ok) throw new Error(sfd.error.message);
    bounds = sfd.value.bounds;

    // 2. Import model annotations into the drawing, with the kernel's anchors.
    const ev = evaluator(doc);
    const d0 = bracketDrawing(partId);
    const p0 = part(doc);
    const queries = importAnchorQueries(p0, frames);
    const answers = await engine.annotationAnchors(partId, queries);
    if (!answers.ok) throw new Error(answers.error.message);
    let n = 0;
    const plan = planImport({
      drawing: d0,
      part: p0,
      views: solveViews({
        drawing: d0,
        bounds,
        evaluate: (e, k) => ev(e, k === 'ratio' ? 'scalar' : 'angle'),
      }),
      resolutions: new Map(),
      sketchFrames: frames,
      anchors: anchorLookup(queries, answers.value),
      moveViews: true,
      newId: () => NEW(++n),
    });
    const all = new Set(plan.candidates.filter((c) => c.placement).map((c) => c.key));
    let dr = d0;
    const made: Annotation[] = [];
    for (const c of importCommands(plan, d0.id, all) as Command[]) {
      if (c.kind === 'updateView')
        dr = { ...dr, views: dr.views.map((v) => (v.id === c.view.id ? c.view : v)) };
      else if (c.kind === 'placeAnnotations') {
        dr = { ...dr, placements: [...dr.placements, ...c.items.map((i) => i.placement)] };
        for (const i of c.items) if (i.annotation) made.push(i.annotation);
      }
    }

    // 3. Dimensions drawn with the drawing's Dimension tool on model faces (picks on view edges
    //    store model refs), with tolerances; datums and frames, placed as the drawing tools do.
    const lin = (id: Id, a: string, b: string, extra: Partial<Annotation> = {}): Annotation =>
      ({ id, kind: 'linear', origin: drawn, refs: [face(a), face(b)], ...extra }) as Annotation;
    const D = {
      width: NEW(201),
      depth: NEW(202),
      thickness: NEW(203),
      height: NEW(204),
      upright: NEW(205),
      hole1: NEW(206),
      hole2: NEW(207),
      holeX: NEW(208),
      spacing: NEW(209),
      holeY: NEW(210),
      corner: NEW(211),
      bend: NEW(212),
      chamferAngle: NEW(213),
    };
    const dims: Annotation[] = [
      lin(D.width, plateLeft, plateRight, { tolerance: { kind: 'symmetric', value: '0.1 mm' } }),
      lin(D.depth, plateFront, plateBack),
      lin(D.thickness, plateBottom, plateTop, {
        tolerance: { kind: 'bilateral', upper: '0.05 mm', lower: '-0.1 mm' },
      }),
      lin(D.height, plateBottom, uprightTop),
      lin(D.upright, uprightFront, uprightBack),
      {
        id: D.hole1,
        kind: 'diameter',
        origin: drawn,
        refs: [face(holeWall1)],
        tolerance: { kind: 'fit', hole: 'H7', show: 'symbol' },
      },
      { id: D.hole2, kind: 'diameter', origin: drawn, refs: [face(holeWall2)] },
      lin(D.holeX, plateLeft, holeWall1, { at: ['self', 'axis'], direction: [1, 0, 0] }),
      lin(D.spacing, holeWall1, holeWall2, { at: ['axis', 'axis'], direction: [1, 0, 0] }),
      lin(D.holeY, plateFront, holeWall1, { at: ['self', 'axis'], direction: [0, 1, 0] }),
      { id: D.corner, kind: 'radius', origin: drawn, refs: [face(cornerFillet)] },
      { id: D.bend, kind: 'radius', origin: drawn, refs: [face(bendFillet)] },
      {
        id: D.chamferAngle,
        kind: 'angle',
        origin: drawn,
        refs: [face(chamferFace), face(uprightTop)],
      },
    ];
    const A = NEW(101);
    const Bd = NEW(102);
    const C = NEW(103);
    const gdt: Annotation[] = [
      { id: A, kind: 'datumFeature', origin: drawn, label: 'A', refs: [face(plateBottom)] },
      { id: Bd, kind: 'datumFeature', origin: drawn, label: 'B', refs: [face(plateBack)] },
      { id: C, kind: 'datumFeature', origin: drawn, label: 'C', refs: [], appliesTo: D.hole1 },
      {
        id: NEW(104),
        kind: 'geometricTolerance',
        origin: drawn,
        characteristic: 'flatness',
        zone: { value: '0.05 mm' },
        refs: [face(plateTop)],
      },
      {
        id: NEW(105),
        kind: 'geometricTolerance',
        origin: drawn,
        characteristic: 'perpendicularity',
        zone: { value: '0.1 mm' },
        datums: [{ datums: [{ datum: A }] }],
        refs: [face(uprightBack)],
      },
      {
        id: NEW(106),
        kind: 'geometricTolerance',
        origin: drawn,
        characteristic: 'position',
        zone: { value: '0.1 mm', shape: 'diameter', material: 'mmc' },
        datums: [{ datums: [{ datum: A }] }, { datums: [{ datum: Bd }] }],
        refs: [],
        appliesTo: D.hole1,
      },
    ];
    annotations = [...made, ...dims, ...gdt].sort((x, y) => (x.id < y.id ? -1 : 1));
    const off = (
      id: string,
      viewId: Id,
      annotationId: Id,
      distance: number,
    ): AnnotationPlacement => ({
      id,
      viewId,
      annotationId,
      layout: { kind: 'offset', distance },
    });
    const radial = (id: string, viewId: Id, annotationId: Id, angle = 45): AnnotationPlacement => ({
      id,
      viewId,
      annotationId,
      layout: { kind: 'radial', angle, distance: 8 },
    });
    drawing = {
      ...dr,
      placements: [
        ...dr.placements,
        off('M1', 'VF', D.width, -14),
        off('M2', 'VS', D.depth, -14),
        off('M3', 'VF', D.thickness, -10),
        off('M4', 'VF', D.height, 100),
        off('M5', 'VS', D.upright, 12),
        radial('M6', 'VT', D.hole1),
        radial('M7', 'VT', D.hole2, 135),
        off('M8', 'VT', D.holeX, -8),
        off('M9', 'VT', D.spacing, -16),
        off('M10', 'VT', D.holeY, -10),
        radial('M11', 'VT', D.corner, 225),
        radial('M12', 'VS', D.bend, 60),
        {
          id: 'M13',
          viewId: 'VS',
          annotationId: D.chamferAngle,
          layout: { kind: 'arc', radius: 12 },
        },
        leader('PA', 'VF', A, { kind: 'ref', index: 0 }, [10, -10]),
        leader('PB', 'VS', Bd),
        leader('PC', 'VT', C, { kind: 'dimensionLine', placementId: 'M6', t: 0.5 }, [0, -10]),
        leader('PD', 'VF', NEW(104), { kind: 'ref', index: 0 }, [15, 12]),
        leader('PE', 'VS', NEW(105), { kind: 'ref', index: 0 }, [-25, 12]),
        leader('PF', 'VT', NEW(106), { kind: 'placement', placementId: 'M6' }, [0, -8]),
      ],
    };
    doc = structuredClone(doc);
    const p = part(doc);
    p.annotations = annotations;
    doc.drawings = [drawing];

    // 4. Regenerate with annotations, then export with PMI.
    regen = await engine.regenerate({ doc, partId, quality: 'coarse', annotations: true });
    const r = await engine.exportPart(partId, 'step', { stepSchema: 'AP242', pmi: {} });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    exported = r;
  }, 120_000);

  afterAll(async () => {
    await engine?.closePart(partId);
  });

  const resolution = (id: Id) =>
    regen.annotations?.find((r) => r.annotationId === id) as AnnotationResolution;

  it('the bracket drawing has at least 15 resolved annotations, all placed', () => {
    const ok = annotations.filter((a) => resolution(a.id)?.state === 'ok');
    expect(ok.length).toBeGreaterThanOrEqual(15);
    for (const a of annotations)
      expect(drawing.placements.some((p) => p.annotationId === a.id)).toBe(true);
  });

  it('exports at least 15 items, each one of the drawing’s annotations by id, kind and value', () => {
    const items = facade.written[0]?.items ?? [];
    expect(exported.pmi?.exported).toBe(items.length);
    expect(items.length).toBeGreaterThanOrEqual(15);
    const kinds: Record<string, string> = {
      linear: 'dimension',
      aligned: 'dimension',
      ordinate: 'dimension',
      diameter: 'dimension',
      radius: 'dimension',
      angle: 'dimension',
      datumFeature: 'datum',
      geometricTolerance: 'tolerance',
    };
    for (const item of items) {
      const a = annotations.find((x) => x.id === item.annotationId);
      expect(a, item.annotationId).toBeDefined();
      if (!a) continue;
      expect(item.kind).toBe(kinds[a.kind]);
      if (item.kind === 'dimension') expect(item.value).toBe(resolution(a.id).value);
      if (item.kind === 'datum' && a.kind === 'datumFeature') expect(item.label).toBe(a.label);
    }
    // The items are sorted by id and every kind of the drawing is there.
    expect(items.map((i) => i.annotationId)).toEqual([...items.map((i) => i.annotationId)].sort());
    expect(new Set(items.map((i) => i.kind))).toEqual(new Set(['dimension', 'datum', 'tolerance']));
  });

  it('what is left out is listed with its reason, never dropped', () => {
    const items = facade.written[0]?.items ?? [];
    const inItems = new Set(items.map((i) => i.annotationId));
    const skipped = new Map((exported.pmi?.skipped ?? []).map((s) => [s.annotationId, s.reason]));
    for (const a of annotations) {
      expect(inItems.has(a.id) !== skipped.has(a.id), a.id).toBe(true);
    }
    for (const reason of skipped.values())
      expect(reason).toMatch(/construction geometry|was removed by|not exported as PMI yet/);
    expect([...skipped.values()].some((r) => /in a sketch/.test(r))).toBe(false);
  });

  /** The import-planned annotation promoted from constraint `c` of sketch `s`. */
  const fromSketch = (s: Id, c: string) =>
    annotations.find(
      (a) =>
        'source' in a &&
        a.source?.kind === 'sketchDimension' &&
        a.source.featureId === s &&
        a.source.constraintId === c,
    ) as Annotation;

  it('sketch dimensions export on what their entities generated, or say exactly why not', () => {
    const items = facade.written[0]?.items ?? [];
    const skipped = new Map((exported.pmi?.skipped ?? []).map((s) => [s.annotationId, s.reason]));
    const sketchDims = annotations.filter(
      (a) => 'source' in a && a.source?.kind === 'sketchDimension',
    );
    // Every one of them has sketch refs (they were all skipped "in a sketch" before 1c).
    expect(sketchDims.length).toBe(9);
    for (const a of sketchDims)
      for (const r of a.refs) expect(r.name).toMatch(/^S[0-9A-Z]+:[pe]\(/);
    const item = (a: Annotation) => items.find((i) => i.annotationId === a.id);
    // Exported: hole diameters (circle → cylinder) and the upright's thickness (corner points →
    // swept edges), with the sketch dimension's value.
    for (const [s, c] of [
      [B.S2, 'd2'],
      [B.S2, 'd5'],
    ] as const) {
      const a = fromSketch(s, c);
      expect(item(a)).toMatchObject({ kind: 'dimension', type: 'linearDiameter', value: 6 });
      expect(item(a)?.targets.map((t) => t.kind)).toEqual(['face']);
    }
    const upright = fromSketch(B.S3, 'd7');
    expect(item(upright)).toMatchObject({
      kind: 'dimension',
      type: 'linearDistance',
      value: 8,
      direction: [0, 1, 0],
    });
    expect(item(upright)?.targets.map((t) => t.kind)).toEqual(['edge', 'edge']);
    // Plate width and depth: corners whose edges the fillet removed stand in by the face beside.
    expect(item(fromSketch(B.S1, 'd5'))).toMatchObject({
      type: 'linearDistance',
      value: 80,
      direction: [1, 0, 0],
    });
    expect(item(fromSketch(B.S1, 'd5'))?.targets.map((t) => t.kind)).toEqual(['face', 'face']);
    expect(item(fromSketch(B.S1, 'd6'))).toMatchObject({
      type: 'linearDistance',
      value: 50,
      direction: [0, 1, 0],
    });
    // pb's edge is gone (the face beside it), pc's is there (its own edge).
    expect(item(fromSketch(B.S1, 'd6'))?.targets.map((t) => t.kind)).toEqual(['face', 'edge']);
    // Skipped, each with its own reason.
    const reason = (s: Id, c: string) => skipped.get(fromSketch(s, c).id);
    for (const c of ['d3', 'd4', 'd6'])
      expect(reason(B.S2, c)).toBe(
        `S${B.S2}:p(o) is construction geometry: it generated no face or edge`,
      );
    expect(reason(B.S3, 'd9')).toBe(
      `S${B.S3}:p(o) is construction geometry: it generated no face or edge`,
    );
    // 23 exported from face annotations alone before 1c; 26 with sketch refs; 28 with the
    // face beside a removed corner.
    expect(items.length).toBe(28);
    expect(exported.pmi?.exported).toBe(28);
  });

  it('targets are the faces the refs resolve to, and frames follow their datums and dimensions', async () => {
    const sfd = await engine.shapeForDrawing(partId);
    if (!sfd.ok) throw new Error('no shape');
    const items = facade.written[0]?.items ?? [];
    const byId = new Map(annotations.map((a) => [a.id, a]));
    for (const item of items) {
      for (const t of item.targets) {
        expect(t.body).toBe(0);
        expect(t.index).toBeGreaterThanOrEqual(1);
      }
      const a = byId.get(item.annotationId) as Annotation;
      const refs =
        (a.kind === 'datumFeature' || a.kind === 'geometricTolerance') && a.appliesTo
          ? (byId.get(a.appliesTo) as Annotation).refs
          : a.refs;
      expect(item.targets.length).toBe(refs.length);
      item.targets.forEach((t, i) => {
        const ref = refs[i];
        if (t.kind !== 'face' || !ref || ref.kind !== 'face') return;
        // Exact names resolve to themselves (merged or split names are reported by the resolution).
        const r = resolution(a.id);
        const named = sfd.value.faceNames[t.index - 1];
        if (!r.merged?.length && !r.rebound?.length) expect(named).toBe(ref.name);
      });
    }
    const pos = items.find((i) => i.annotationId === NEW(106));
    expect(pos).toMatchObject({
      kind: 'tolerance',
      type: 'position',
      value: 0.1,
      diameter: true,
      material: 'M',
      datums: [{ label: 'A' }, { label: 'B' }],
    });
    const dia = items.find((i) => i.annotationId === NEW(206));
    expect(pos?.targets).toEqual(dia?.targets);
    expect(dia).toMatchObject({ tolerance: { kind: 'fit', hole: 'H7' } });
    expect(items.find((i) => i.annotationId === NEW(103))?.targets).toEqual(dia?.targets);
    // Sketch refs: the exact names of what the entities generated.
    const names = (id: Id) =>
      items
        .find((i) => i.annotationId === id)
        ?.targets.map((t) =>
          t.kind === 'face' ? sfd.value.faceNames[t.index - 1] : sfd.value.edgeNames[t.index - 1],
        );
    expect(names(fromSketch(B.S2, 'd2').id)).toEqual([holeWall1]);
    expect(names(fromSketch(B.S2, 'd5').id)).toEqual([holeWall2]);
    expect(names(fromSketch(B.S3, 'd7').id)).toEqual([
      edgeName(plateRight, uprightFront),
      edgeName(plateRight, plateBack),
    ]);
    expect(names(fromSketch(B.S1, 'd5').id)).toEqual([plateLeft, plateRight]);
    expect(names(fromSketch(B.S1, 'd6').id)).toEqual([plateFront, edgeName(plateRight, plateBack)]);
  });

  it('every item has presentation from its drawing view, on the view’s plane', () => {
    const items = facade.written[0]?.items ?? [];
    const ev = evaluator(doc);
    const views = solveViews({
      drawing,
      bounds,
      evaluate: (e, k) => ev(e, k === 'ratio' ? 'scalar' : 'angle'),
    });
    for (const item of items) {
      const p = item.presentation;
      expect(p, item.annotationId).toBeDefined();
      if (!p) continue;
      expect(p.polylines.length).toBeGreaterThan(2);
      // On the plane of the view that places it (each annotation here has one placement).
      const placement = drawing.placements.find((x) => x.annotationId === item.annotationId);
      const v = views.get(placement?.viewId ?? '');
      if (!v?.ok) throw new Error(`no view for ${item.annotationId}`);
      expect(p.plane.normal).toEqual(v.frame.n);
      for (const l of p.polylines) {
        for (const q of l) {
          const d = [0, 1, 2].reduce(
            (s, k) =>
              s +
              ((q[k] as number) - (p.plane.origin[k] as number)) * (p.plane.normal[k] as number),
            0,
          );
          expect(Math.abs(d)).toBeLessThan(1e-6);
        }
      }
    }
    // The only notes: the upright's corner edges are on the plate's faces the add merged them
    // into; the plate's width and depth are on the faces next to the corners the fillet removed.
    const upright = fromSketch(B.S3, 'd7').id;
    const width = fromSketch(B.S1, 'd5').id;
    const depth = fromSketch(B.S1, 'd6').id;
    const notes = exported.pmi?.notes ?? [];
    const of = (id: Id) => notes.filter((n) => n.annotationId === id).map((n) => n.note);
    expect(new Set(notes.map((n) => n.annotationId))).toEqual(new Set([upright, width, depth]));
    expect(of(upright)[0]).toBe(
      `S${B.S3}:p(qb): exported on ${edgeName(plateRight, uprightFront)}, which ‘Extrude’ merged its edge ${edgeName(uprightFront, side(B.E3, B.S3, 'M2'))} into`,
    );
    expect(of(upright)[1]).toMatch(/^S[0-9A-Z]+:p\(qc\): exported on edge\(/);
    const beside = (p: string, line: string, face: string) =>
      `S${B.S1}:p(${p}): its corner edge was removed by ‘Fillet’; attached to ${face}, the face of S${B.S1}:e(${line}) next to the removed corner`;
    expect(of(width)).toEqual([beside('pa', 'L4', plateLeft), beside('pb', 'L2', plateRight)]);
    expect(of(depth)).toEqual([beside('pb', 'L1', plateFront)]);
  });

  it('is deterministic, and the presentation can be left out', async () => {
    const again = await engine.exportPart(partId, 'step', { stepSchema: 'AP242', pmi: {} });
    expect(again.ok).toBe(true);
    expect(facade.written[1]?.items).toEqual(facade.written[0]?.items);
    const bare = await engine.exportPart(partId, 'step', { pmi: { presentation: false } });
    expect(bare.ok).toBe(true);
    const last = facade.written[facade.written.length - 1];
    expect(last?.items.every((i) => i.presentation === undefined)).toBe(true);
    expect(last?.items.length).toBe(facade.written[0]?.items.length);
    expect((last?.options as { stepSchema?: string } | undefined)?.stepSchema).toBe('AP242');
  });

  it('refuses PMI in AP214', async () => {
    const r = await engine.exportPart(partId, 'step', { stepSchema: 'AP214', pmi: {} });
    expect(r.ok).toBe(false);
  });

  /**
   * items → STEP → import feature → `importedPmi` → annotations → regen → items again, through
   * `rec` (the simulated façade or the recording real one). `lost`: annotation ids the reader is
   * known to drop (OCCT reads a datum only through a frame that references it; ADR-100 amendment).
   */
  async function roundTrip(
    eng: RegenEngine,
    rec: ReturnType<typeof fakeFacade>,
    first: Written,
    tag: string,
    lost: ReadonlySet<Id> = new Set(),
  ) {
    const bytes = first.bytes;
    const sha = await sha256Hex(bytes);
    const partB = fid(`PRT${tag}`);
    const imp = fid(`IMP${tag}`);
    const feature: ImportFeature = {
      id: imp,
      type: 'import',
      name: 'Import',
      suppressed: false,
      source: {
        path: 'imports/bracket.step',
        format: 'step',
        sha256: sha,
        fileName: 'bracket.step',
      },
      op: 'new',
    };
    const docB = structuredClone(bracketDoc());
    docB.parts = [{ id: partB, name: 'Imported', features: [feature], rollbackIndex: 1 }];
    const attachments = { 'imports/bracket.step': bytes };
    const r1 = await eng.regenerate({ doc: docB, partId: partB, quality: 'coarse', attachments });
    expect(r1.features[0]?.state).toBe('ok');
    const pmi = await eng.importedPmi(partB, imp);
    if (!pmi.ok) throw new Error(pmi.error.message);
    expect(pmi.value.supported).toBe(true);
    let k = 0;
    const { annotations: back, report } = annotationsFromPmi({
      entries: pmi.value.entries,
      issues: pmi.value.issues,
      origin: { kind: 'import', file: pmi.value.file },
      existing: [],
      newId: () => fid(`NEW${tag}${++k}`),
    });
    expect(report.notes).toEqual([]);
    const kept = first.items.filter((i) => !lost.has(i.annotationId));
    expect(back.map((a) => a.id).sort()).toEqual(kept.map((i) => i.annotationId).sort());
    expect(report.skipped.length).toBe(first.items.length - kept.length);

    const pb = docB.parts[0] as WrenDoc['parts'][0];
    pb.annotations = back;
    const r2 = await eng.regenerate({
      doc: docB,
      partId: partB,
      quality: 'coarse',
      annotations: true,
    });
    for (const r of r2.annotations ?? []) expect(r.state, r.annotationId).toBe('ok');
    const again = await eng.exportPart(partB, 'step', { pmi: {} });
    if (!again.ok) throw new Error(again.error.message);
    const second = rec.written[rec.written.length - 1] as Written;
    expect(again.pmi?.skipped).toEqual([]);

    // Same faces: compare targets by the geometry they name in each export.
    const where = (w: Written, t: PmiTarget) => {
      const fp = w.fingerprints[t.body];
      if (t.kind === 'face') return centroidKey(fp?.faces[t.index - 1]?.centroid as Vec3);
      if (t.kind === 'edge') return `edge ${centroidKey(fp?.edges[t.index - 1]?.centroid as Vec3)}`;
      return `${t.kind}${t.index}`;
    };
    const norm = (w: Written, items: PmiExportItem[]) =>
      items.map((i) => {
        const { presentation: _p, ...rest } = i;
        const r = { ...rest, targets: i.targets.map((t) => where(w, t)) } as Record<
          string,
          unknown
        >;
        if (i.kind !== 'datum') r.value = Math.round(i.value * 1e9) / 1e9;
        if (i.kind === 'dimension' && i.tolerance?.kind === 'deviation') {
          r.tolerance = {
            ...i.tolerance,
            upper: Math.round(i.tolerance.upper * 1e9) / 1e9,
            lower: Math.round(i.tolerance.lower * 1e9) / 1e9,
          };
        }
        return r;
      });
    expect(norm(second, second.items)).toEqual(norm(first, kept));
    await eng.closePart(partB);
  }

  it('round trip (simulated façade): items → STEP → import → annotations → items is lossless', async () => {
    await roundTrip(engine, facade, facade.written[0] as Written, 'SIM');
  });

  // The end-to-end round trip through the real façade (STEPCAFControl_Writer and Reader). Runs
  // when the kernel build has `exportStepPmi` (CI's Wasm since the M5a façade; a local dist from
  // before it skips, marker FACADE-PMI-PENDING).
  it.skipIf(!facadeReady)(
    `Wasm round trip through exportStepPmi and STEPCAFControl_Reader${facadeReady ? '' : ' — SKIPPED: FACADE-PMI-PENDING (kernel dist without exportStepPmi)'}`,
    async () => {
      const real = fakeFacade(kernel, 'real');
      const eng = new RegenEngine({
        kernel: { ...kernel, ...real.api } as unknown as KernelWorkerApi,
        sketchSolver: () => createSketchSolverCore(),
        reprojectLinked: reprojectLinkedSketch,
        pmiFont: async () => TTF,
      });
      await eng.regenerate({ doc, partId, quality: 'coarse', annotations: true });
      const r = await eng.exportPart(partId, 'step', { pmi: {} });
      if (!r.ok) throw new Error(r.error.message);
      const first = real.written[0] as Written;
      expect(r.pmi?.exported).toBe(first.items.length);
      // Nothing is lost: datum C (referenced by no frame) and the v2 fields come back (ADR-101 1b).
      await roundTrip(eng, real, first, 'WASM');
      await eng.closePart(partId);
    },
    120_000,
  );
});
