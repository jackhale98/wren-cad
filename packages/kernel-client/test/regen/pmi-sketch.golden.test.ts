/**
 * ADR-101 phase 1c golden: sketch dimensions as STEP AP242 PMI, with the real kernel. A plate
 * whose outline has two parallel lines, a slanted line and an arc, dimensioned in its sketch
 * (reference dimensions, as "Import model annotations" promotes them: refs are sketch entities,
 * `source` the sketch dimension). Each exports on what its entities generated, by exact name:
 * parallel lines → `linearDistance` between the two side faces (with the v2 `direction` when the
 * dimension has one), the arc → `linearRadius` on its cylinder, two lines → `angular` between
 * their faces, two corner points → `linearDistance` between their swept edges. Values are the
 * resolutions'. A second extrude of the same region makes its entities generate faces in two
 * features: dimensions on them are skipped with that reason, never exported on a guessed face.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  Annotation,
  ExportOptions,
  Feature,
  Id,
  PmiExportItem,
  SketchConstraint,
  WrenDoc,
} from '@wren-cad/contracts';
import { createSketchSolverCore } from '@wren-cad/sketch/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKernelApi, type ExportShape, type KernelWorkerApi } from '../../src/kernel-api';
import { RegenEngine, type RegenOutput } from '../../src/regen/engine';
import { reprojectLinkedSketch } from '../../src/regen/linked-sketch';
import {
  built,
  describeFailures,
  edge,
  edgeName,
  extrude,
  fid,
  fillet,
  makeDoc,
  part,
  region,
  Sk,
  side,
  skipNote,
  states,
  variants,
} from './helpers';

const S = fid('QS1');
const E = fid('QE1');
const S2 = fid('QS2');
const S4 = fid('QS4');
const E4 = fid('QE4');
const FL = fid('QF4');
const SN = fid('QSN');
const EN = fid('QEN');
const E2 = fid('QE2');
const E3 = fid('QE3');
const PART = fid('QPART');
const id = (n: number) => `01JQPMI${String(n).padStart(19, '0')}`;

/**
 * Outline: a(0,0) → b(40,0) → c(40,10) ⌒ d(30,20) (arc about (30,10)) → e(5,20) → a. Every
 * point fixed; the dimensions are reference (driven) dimensions.
 */
function outline(): Sk {
  const s = new Sk();
  for (const [p, x, y] of [
    ['a', 0, 0],
    ['b', 40, 0],
    ['c', 40, 10],
    ['d', 30, 20],
    ['e', 5, 20],
    ['m', 30, 10],
  ] as const) {
    s.point(p, x, y);
    s.geo({ kind: 'fix', entity: p });
  }
  s.line('L1', 'a', 'b');
  s.line('L2', 'b', 'c');
  s.entities.push({
    id: 'A1',
    kind: 'arc',
    center: 'm',
    start: 'c',
    end: 'd',
    construction: false,
  });
  s.line('L3', 'd', 'e');
  s.line('L4', 'e', 'a');
  /** A reference (driven) dimension: its value is the solved one. */
  const ref = (c: { id: string; kind: string } & Record<string, string>) =>
    s.constraints.push({ ...c, value: '0', driving: false } as SketchConstraint);
  ref({ id: 'r1', kind: 'distance', a: 'L1', b: 'L3' });
  ref({ id: 'r2', kind: 'radius', curve: 'A1' });
  // CCW from L4 (e → a) to L1 (a → b): π − atan2(20, 5).
  ref({ id: 'r3', kind: 'angle', a: 'L4', b: 'L1' });
  ref({ id: 'r4', kind: 'hDistance', a: 'a', b: 'b' });
  return s;
}

const PROFILE = 'A1,L1,L2,L3,L4';
const sk = (sketch: Id, e: string, point = false) =>
  ({ name: `S${sketch}:${point ? 'p' : 'e'}(${e})`, kind: point ? 'vertex' : 'edge' }) as const;
const src = (sketch: Id, constraintId: string) =>
  ({ kind: 'sketchDimension', featureId: sketch, constraintId }) as const;
const model = { kind: 'model' } as const;

function annotations(sketch: Id, base: number): Annotation[] {
  return [
    {
      id: id(base + 1),
      kind: 'linear',
      origin: model,
      refs: [sk(sketch, 'L1'), sk(sketch, 'L3')],
      source: src(sketch, 'r1'),
    },
    {
      id: id(base + 2),
      kind: 'linear',
      origin: model,
      refs: [sk(sketch, 'L1'), sk(sketch, 'L3')],
      direction: [0, 1, 0],
      source: src(sketch, 'r1'),
    },
    {
      id: id(base + 3),
      kind: 'radius',
      origin: model,
      refs: [sk(sketch, 'A1')],
      source: src(sketch, 'r2'),
    },
    {
      id: id(base + 4),
      kind: 'angle',
      origin: model,
      refs: [sk(sketch, 'L4'), sk(sketch, 'L1')],
      source: src(sketch, 'r3'),
    },
    {
      id: id(base + 5),
      kind: 'linear',
      origin: model,
      refs: [sk(sketch, 'a', true), sk(sketch, 'b', true)],
      direction: [1, 0, 0],
      source: src(sketch, 'r4'),
    },
  ] as Annotation[];
}

describe.skipIf(!built)(`STEP AP242 PMI of sketch dimensions${skipNote}`, () => {
  const written: PmiExportItem[][] = [];
  let kernel: ReturnType<typeof createKernelApi>;
  let engine: RegenEngine;
  let regen: RegenOutput;
  let report: Extract<Awaited<ReturnType<RegenEngine['exportPart']>>, { ok: true }>['pmi'];
  let faceNames: string[];
  let edgeNames: string[];

  beforeAll(async () => {
    kernel = createKernelApi({ variants, canUseThreads: () => false });
    const init = await kernel.init({ variant: 'single' });
    if (!init.ok) throw new Error(JSON.stringify(init.error));
    // Records the items; the shapes are written as plain AP242.
    const exportStepPmi = async (
      shapes: ExportShape[],
      items: PmiExportItem[],
      _o: ExportOptions,
    ) => {
      written.push(structuredClone(items));
      const r = await kernel.exportShapes(shapes, 'step', { stepSchema: 'AP242' });
      if (!r.ok) return r;
      return {
        ok: true as const,
        value: { files: r.value, report: { exported: items.length, skipped: [], notes: [] } },
      };
    };
    engine = new RegenEngine({
      kernel: { ...kernel, exportStepPmi } as unknown as KernelWorkerApi,
      sketchSolver: () => createSketchSolverCore(),
      reprojectLinked: reprojectLinkedSketch,
    });
    // Sketch 1: one extrude. Sketch 2 (same outline, beside it): its region extruded twice.
    const s2 = outline();
    for (const e of s2.entities) if (e.kind === 'point') e.y -= 40;
    // Sketch 4: a block whose corner pa the fillet removes and whose left face (L4, the line
    // through pa across x) a notch splits: the face beside the corner cannot stand in.
    const s4 = new Sk();
    s4.rect('p', 'L', 100, 0, 120, 10);
    const notch = new Sk();
    notch.rect('n', 'N', 99, 4, 103, 6);
    for (const k of [s4, notch])
      for (const e of k.entities) if (e.kind === 'point') k.geo({ kind: 'fix', entity: e.id });
    const block = (e: string) => side(E4, S4, e);
    const features: Feature[] = [
      outline().feature(S),
      extrude(E, [region(S, PROFILE)], '5'),
      s2.feature(S2),
      { ...extrude(E2, [region(S2, PROFILE)], '5'), name: 'Upper' },
      { ...extrude(E3, [region(S2, PROFILE)], '3', 'new', 'reverse'), name: 'Lower' },
      s4.feature(S4),
      extrude(E4, [region(S4, 'L1,L2,L3,L4')], '5'),
      fillet(FL, [edge(edgeName(block('L1'), block('L4')))], '1 mm'),
      notch.feature(SN),
      { ...extrude(EN, [region(SN, 'N1,N2,N3,N4')], '20', 'cut', 'symmetric'), name: 'Notch' },
    ];
    const doc: WrenDoc = makeDoc({}, features, PART);
    const corner = (n: number, direction: [number, number, number], to: string): Annotation =>
      ({
        id: id(n),
        kind: 'linear',
        origin: model,
        refs: [sk(S4, 'pa', true), sk(S4, to, true)],
        direction,
        nominal: '20 mm',
      }) as Annotation;
    part(doc).annotations = [
      ...annotations(S, 0),
      ...annotations(S2, 10),
      corner(21, [1, 0, 0], 'pb'),
      corner(22, [0.6, 0.8, 0], 'pc'),
    ];
    regen = await engine.regenerate({ doc, partId: PART, quality: 'coarse', annotations: true });
    expect(states(regen), describeFailures(regen)).toEqual(features.map(() => 'ok'));
    const r = await engine.exportPart(PART, 'step', { pmi: { presentation: false } });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    report = r.pmi;
    const sfd = await engine.shapeForDrawing(PART);
    if (!sfd.ok) throw new Error(sfd.error.message);
    faceNames = sfd.value.faceNames;
    edgeNames = sfd.value.edgeNames;
  }, 120_000);

  afterAll(async () => {
    await engine?.closePart(PART);
  });

  const item = (n: number) => written[0]?.find((i) => i.annotationId === id(n));
  /** Names of an item's targets (one body per extrude: index into the concatenated maps). */
  const names = (n: number) =>
    item(n)?.targets.map((t) => {
      // Bodies in order B<E>, B<E2>, B<E3>; every target here is on the first.
      expect(t.body).toBe(0);
      return t.kind === 'face' ? faceNames[t.index - 1] : edgeNames[t.index - 1];
    });
  const value = (n: number) => regen.annotations?.find((r) => r.annotationId === id(n))?.value;

  it('every sketch dimension resolves', () => {
    for (const r of regen.annotations ?? []) expect(r.state, r.annotationId).toBe('ok');
    expect(value(1)).toBeCloseTo(20, 9);
    expect(value(3)).toBeCloseTo(10, 9);
    expect(value(4)).toBeCloseTo(Math.PI - Math.atan2(20, 5), 9);
    expect(value(5)).toBeCloseTo(40, 9);
  });

  it('parallel lines → linearDistance between their side faces, with the direction when set', () => {
    expect(item(1)).toMatchObject({ kind: 'dimension', type: 'linearDistance', value: value(1) });
    expect(item(1)).not.toHaveProperty('direction');
    expect(names(1)).toEqual([side(E, S, 'L1'), side(E, S, 'L3')]);
    expect(item(2)).toMatchObject({ type: 'linearDistance', direction: [0, 1, 0] });
    expect(names(2)).toEqual([side(E, S, 'L1'), side(E, S, 'L3')]);
  });

  it('an arc → linearRadius on its cylinder; two lines → angular between their faces', () => {
    expect(item(3)).toMatchObject({ type: 'linearRadius', value: value(3) });
    expect(names(3)).toEqual([side(E, S, 'A1')]);
    expect(item(4)).toMatchObject({ type: 'angular', value: value(4) });
    expect(names(4)).toEqual([side(E, S, 'L4'), side(E, S, 'L1')]);
  });

  it('corner points → linearDistance between the edges swept from them', () => {
    expect(item(5)).toMatchObject({
      type: 'linearDistance',
      value: value(5),
      direction: [1, 0, 0],
    });
    expect(names(5)).toEqual([
      edgeName(side(E, S, 'L1'), side(E, S, 'L4')),
      edgeName(side(E, S, 'L1'), side(E, S, 'L2')),
    ]);
  });

  it('entities that generated faces in two features: skipped with that reason', () => {
    const skipped = new Map((report?.skipped ?? []).map((s) => [s.annotationId, s.reason]));
    for (const n of [11, 12, 13, 14, 15]) expect(item(n), String(n)).toBeUndefined();
    const what = (e: string, kind: string) =>
      `S${S2}:${kind === 'edge' ? 'p' : 'e'}(${e}) generated a ${kind} in each of ‘Upper’, ‘Lower’: not one ${kind}`;
    expect(skipped.get(id(11))).toBe(what('L1', 'face'));
    expect(skipped.get(id(13))).toBe(what('A1', 'face'));
    expect(skipped.get(id(15))).toBe(what('a', 'edge'));
    expect(report?.exported).toBe(5);
    // Only the corner fallback could note anything; nothing here used it.
    expect(report?.notes).toBeUndefined();
  });

  it('a removed corner whose neighbouring face is not unique, or has none across: skipped', () => {
    const skipped = new Map((report?.skipped ?? []).map((s) => [s.annotationId, s.reason]));
    const gone = `The edge ‘Extrude’ made from S${S4}:p(pa) was removed by ‘Fillet’`;
    expect(item(21)).toBeUndefined();
    expect(skipped.get(id(21))).toBe(
      `${gone}; the face beside it does not stand in: The face ‘Extrude’ made from S${S4}:e(L4) was split into 2 by ‘Notch’`,
    );
    expect(item(22)).toBeUndefined();
    expect(skipped.get(id(22))).toBe(
      `${gone}; no single line of its profile through it runs across the dimension’s direction`,
    );
  });
});
