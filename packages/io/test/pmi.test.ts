// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * M5a (ADR-100): every annotation → PMI mapping and back, as pure functions. The worker hands in
 * targets resolved with the annotation rules; these tests stand in for it with fixed targets.
 */

import type {
  Annotation,
  AnnotationResolution,
  EntityRef,
  Id,
  PmiExportItem,
  PmiImportItem,
  PmiTarget,
} from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import {
  annotationsFromPmi,
  numberLiteral,
  type PmiEvaluate,
  type PmiImportEntry,
  type PmiTargetOrWhy,
  planPmiExport,
  pmiExportItem,
  valueExpr,
} from '../src/pmi';

const model = { kind: 'model' } as const;
const face = (name: string): EntityRef => ({ name, kind: 'face' });
const edge = (name: string): EntityRef => ({ name, kind: 'edge' });
const T = (index: number, kind: PmiTarget['kind'] = 'face', body = 0): PmiTarget => ({
  body,
  kind,
  index,
});
const ok = (annotationId: Id, value?: number): AnnotationResolution => ({
  annotationId,
  state: 'ok',
  ...(value !== undefined ? { value } : {}),
});

/** Lengths: `<n> mm` or a bare number; angles: `<n> deg`. Enough for these tests. */
const evaluate: PmiEvaluate = (expr, kind) => {
  const m = /^\s*(-?[\d.]+)\s*(mm|deg)?\s*$/.exec(expr);
  if (!m) return undefined;
  const v = Number(m[1]);
  if (m[2] === 'deg' || (kind === 'angle' && m[2] === undefined)) return (v * Math.PI) / 180;
  return v;
};

const ids = (n: number) => `01JPMX${String(n).padStart(20, '0')}`;

function exportOne(
  a: Annotation,
  r: AnnotationResolution | undefined,
  targets: PmiTargetOrWhy[],
  others: Annotation[] = [],
  targetsOf: Record<Id, PmiTargetOrWhy[]> = {},
) {
  return pmiExportItem({
    annotation: a,
    resolution: r,
    targets,
    annotations: new Map([...others, a].map((x) => [x.id, x])),
    targetsOf: (id) => targetsOf[id],
    evaluate,
  });
}

describe('annotations → PMI export items', () => {
  it('maps linear, aligned and ordinate dimensions to linearDistance with the resolved value', () => {
    for (const kind of ['linear', 'aligned', 'ordinate'] as const) {
      const a = {
        id: ids(1),
        kind,
        origin: model,
        refs: [face('a'), face('b')],
        ...(kind === 'ordinate' ? { direction: [1, 0, 0] as [number, number, number] } : {}),
      } as Annotation;
      const d = exportOne(a, ok(a.id, 42.5), [T(3), T(7)]);
      expect(d).toEqual({
        ok: true,
        notes: [],
        item: {
          annotationId: a.id,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [T(3), T(7)],
          value: 42.5,
        },
      });
    }
  });

  it('maps diameter, radius and angle, and their tolerances', () => {
    const dia: Annotation = {
      id: ids(2),
      kind: 'diameter',
      origin: model,
      refs: [face('hole')],
      tolerance: { kind: 'fit', hole: 'H7', show: 'symbol' },
    };
    expect(exportOne(dia, ok(dia.id, 6), [T(12)])).toMatchObject({
      ok: true,
      item: { type: 'linearDiameter', value: 6, tolerance: { kind: 'fit', hole: 'H7' } },
    });
    const rad: Annotation = {
      id: ids(3),
      kind: 'radius',
      origin: model,
      refs: [face('fillet')],
      tolerance: { kind: 'symmetric', value: '0.1 mm' },
    };
    expect(exportOne(rad, ok(rad.id, 5), [T(4)])).toMatchObject({
      ok: true,
      item: {
        type: 'linearRadius',
        value: 5,
        tolerance: { kind: 'deviation', upper: 0.1, lower: -0.1 },
      },
    });
    const ang: Annotation = {
      id: ids(4),
      kind: 'angle',
      origin: model,
      refs: [face('a'), face('b')],
      tolerance: { kind: 'bilateral', upper: '1 deg', lower: '-0.5 deg' },
    };
    const d = exportOne(ang, ok(ang.id, Math.PI / 4), [T(1), T(2)]);
    expect(d.ok && d.item).toMatchObject({ type: 'angular', value: Math.PI / 4 });
    if (!d.ok || d.item.kind !== 'dimension' || d.item.tolerance?.kind !== 'deviation') {
      throw new Error('angle tolerance missing');
    }
    expect(d.item.tolerance.upper).toBeCloseTo(Math.PI / 180, 12);
    expect(d.item.tolerance.lower).toBeCloseTo(-Math.PI / 360, 12);
  });

  it('writes limits as deviations and basic/reference without a tolerance, with a note', () => {
    const lim: Annotation = {
      id: ids(5),
      kind: 'linear',
      origin: model,
      refs: [face('a'), face('b')],
      tolerance: { kind: 'limits', upper: '0.2 mm', lower: '0 mm' },
    };
    const d = exportOne(lim, ok(lim.id, 10), [T(1), T(2)]);
    expect(d).toMatchObject({
      ok: true,
      item: { tolerance: { kind: 'deviation', upper: 0.2, lower: 0 } },
      notes: ['Limits are written as deviations'],
    });
    for (const kind of ['basic', 'reference'] as const) {
      const b: Annotation = { ...lim, tolerance: { kind } } as Annotation;
      const e = exportOne(b, ok(b.id, 10), [T(1), T(2)]);
      expect(e.ok && 'tolerance' in e.item).toBe(false);
      expect(e.ok && e.notes[0]).toMatch(new RegExp(kind));
    }
  });

  it('skips what needs attention, is suppressed, has no value or is not mappable, with a reason', () => {
    const a: Annotation = {
      id: ids(6),
      kind: 'linear',
      origin: model,
      refs: [face('a'), face('b')],
    };
    expect(
      exportOne(
        a,
        {
          annotationId: a.id,
          state: 'needsAttention',
          error: { code: 'UNRESOLVED_REFERENCE', message: 'A reference no longer exists' },
        },
        [T(1), T(2)],
      ),
    ).toEqual({ ok: false, reason: 'Needs attention: A reference no longer exists' });
    expect(exportOne(a, { annotationId: a.id, state: 'suppressed' }, [T(1), T(2)])).toEqual({
      ok: false,
      reason: 'Suppressed in this configuration',
    });
    expect(exportOne({ ...a, suppressed: true }, ok(a.id, 1), [T(1), T(2)])).toMatchObject({
      ok: false,
    });
    expect(exportOne(a, undefined, [T(1), T(2)])).toMatchObject({ ok: false });
    expect(exportOne(a, ok(a.id), [T(1), T(2)])).toEqual({
      ok: false,
      reason: 'The dimension has no value',
    });
    expect(
      exportOne(a, ok(a.id, 3), [T(1), { reason: 'origin:XY is construction geometry' }]),
    ).toEqual({ ok: false, reason: 'origin:XY is construction geometry' });
    const tol: Annotation = { ...a, tolerance: { kind: 'symmetric', value: 'nope' } };
    expect(exportOne(tol, ok(a.id, 3), [T(1), T(2)])).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/does not evaluate/),
    });
    for (const other of [
      { kind: 'note', text: 'x' },
      { kind: 'surfaceFinish', process: 'any', requirements: [] },
      { kind: 'holeCallout', source: { kind: 'feature', featureId: 'F' } },
      { kind: 'chamfer', form: 'distanceAngle' },
    ]) {
      const n = { id: ids(7), origin: model, refs: [face('a')], ...other } as Annotation;
      const d = exportOne(n, ok(n.id, 2), [T(1)]);
      expect(d.ok).toBe(false);
      expect(!d.ok && d.reason).toMatch(/not exported as PMI yet/);
    }
  });

  it('maps a datum, and a datum on a feature of size to that dimension’s faces', () => {
    const datum: Annotation = {
      id: ids(8),
      kind: 'datumFeature',
      origin: model,
      label: 'A',
      refs: [face('bottom')],
    };
    expect(exportOne(datum, ok(datum.id), [T(5)])).toEqual({
      ok: true,
      notes: [],
      item: { annotationId: datum.id, kind: 'datum', label: 'A', targets: [T(5)] },
    });
    const width: Annotation = {
      id: ids(9),
      kind: 'linear',
      origin: model,
      refs: [face('l'), face('r')],
    };
    const fos: Annotation = {
      id: ids(10),
      kind: 'datumFeature',
      origin: model,
      label: 'B',
      refs: [],
      appliesTo: width.id,
    };
    expect(exportOne(fos, ok(fos.id), [], [width], { [width.id]: [T(1), T(2)] })).toMatchObject({
      ok: true,
      item: { kind: 'datum', label: 'B', targets: [T(1), T(2)] },
    });
  });

  it('maps a feature control frame: zone, diameter, material modifiers and the datum frame', () => {
    const A: Annotation = {
      id: ids(11),
      kind: 'datumFeature',
      origin: model,
      label: 'A',
      refs: [face('a')],
    };
    const B: Annotation = {
      id: ids(12),
      kind: 'datumFeature',
      origin: model,
      label: 'B',
      refs: [face('b')],
    };
    const hole: Annotation = { id: ids(13), kind: 'diameter', origin: model, refs: [face('h')] };
    const pos: Annotation = {
      id: ids(14),
      kind: 'geometricTolerance',
      origin: model,
      characteristic: 'position',
      zone: { value: '0.1 mm', shape: 'diameter', material: 'mmc' },
      datums: [{ datums: [{ datum: A.id }] }, { datums: [{ datum: B.id }], material: 'lmc' }],
      refs: [],
      appliesTo: hole.id,
    };
    expect(exportOne(pos, ok(pos.id), [], [A, B, hole], { [hole.id]: [T(9)] })).toEqual({
      ok: true,
      notes: [],
      item: {
        annotationId: pos.id,
        kind: 'tolerance',
        type: 'position',
        targets: [T(9)],
        value: 0.1,
        diameter: true,
        material: 'M',
        datums: [{ label: 'A' }, { label: 'B', material: 'L' }],
      },
    });
    const prof: Annotation = {
      id: ids(15),
      kind: 'geometricTolerance',
      origin: model,
      characteristic: 'surfaceProfile',
      zone: { value: '0.2 mm' },
      refs: [face('p')],
    };
    expect(exportOne(prof, ok(prof.id), [T(2)])).toMatchObject({
      ok: true,
      item: { type: 'profileOfSurface', value: 0.2 },
    });
  });

  it('skips frames with what the contract cannot carry, and unbound datums', () => {
    const base: Annotation = {
      id: ids(16),
      kind: 'geometricTolerance',
      origin: model,
      characteristic: 'flatness',
      zone: { value: '0.05 mm' },
      refs: [face('t')],
    };
    const cases: [Partial<Annotation>, RegExp][] = [
      [{ zone: { value: '0.05 mm', shape: 'sphericalDiameter' } }, /spherical/],
      [{ zone: { value: '0.05 mm', modifiers: ['freeState'] } }, /freeState/],
      [{ zone: { value: '0.05 mm', projected: '10 mm' } }, /projected/],
      [{ zone: { value: '0.05 mm', unequal: '0.01 mm' } }, /unequally/],
      [{ zone: { value: '0.05 mm', perUnit: { value: '0.01 mm', length: '100 mm' } } }, /per-unit/],
      [{ allAround: true }, /all around/],
      [{ datums: [{ datums: [{ label: 'A' }, { label: 'B' }] }] }, /common datum/],
      [{ datums: [{ datums: [{ label: 'Z' }] }] }, /not bound/],
      [{ zone: { value: 'x' } }, /does not evaluate/],
    ];
    for (const [patch, why] of cases) {
      const d = exportOne({ ...base, ...patch } as Annotation, ok(base.id), [T(1)]);
      expect(d.ok).toBe(false);
      expect(!d.ok && d.reason).toMatch(why);
    }
  });

  it('plans a whole part: sorted by id, report of what is skipped, frames lose skipped datums', () => {
    const A: Annotation = {
      id: ids(21),
      kind: 'datumFeature',
      origin: model,
      label: 'A',
      refs: [face('a')],
    };
    const frame: Annotation = {
      id: ids(20),
      kind: 'geometricTolerance',
      origin: model,
      characteristic: 'perpendicularity',
      zone: { value: '0.1 mm' },
      datums: [{ datums: [{ datum: A.id }] }],
      refs: [face('u')],
    };
    const dim: Annotation = {
      id: ids(22),
      kind: 'linear',
      origin: model,
      refs: [face('a'), face('b')],
    };
    const plan = planPmiExport({
      annotations: [dim, A, frame],
      resolutions: new Map([
        [A.id, { annotationId: A.id, state: 'needsAttention' }],
        [frame.id, ok(frame.id)],
        [dim.id, ok(dim.id, 8)],
      ]),
      targets: new Map<Id, PmiTargetOrWhy[]>([
        [A.id, [T(1)]],
        [frame.id, [T(2)]],
        [dim.id, [T(1), T(3)]],
      ]),
      evaluate,
    });
    expect(plan.items.map((i) => i.annotationId)).toEqual([dim.id]);
    expect(plan.report).toEqual({
      exported: 1,
      skipped: [
        { annotationId: frame.id, reason: 'Its datum A is not exported' },
        { annotationId: A.id, reason: 'Needs attention' },
      ],
    });
    const only = planPmiExport({
      annotations: [dim, A, frame],
      resolutions: new Map([[dim.id, ok(dim.id, 8)]]),
      targets: new Map([[dim.id, [T(1), T(3)]]]),
      evaluate,
      only: [dim.id],
    });
    expect(only.report).toEqual({ exported: 1, skipped: [] });
  });
});

// ---------------------------------------------------------------------------------------------

const imported = { kind: 'import', file: 'parts/bracket.step' } as const;
let counter = 0;
const newId = () => `01JNEW${String(++counter).padStart(20, '0')}`;
const ref = (i: number): EntityRef => face(`FIMP:face#${i}`);

function entry(item: PmiImportItem, refs?: (EntityRef | { reason: string })[]): PmiImportEntry {
  const targets = item.kind === 'presentationOnly' ? [] : item.targets;
  return { item, refs: refs ?? targets.map((t) => ref(t.index)) };
}

describe('PMI import items → annotations', () => {
  it('maps every dimension type back, with nominal values and tolerances', () => {
    const items: PmiImportItem[] = [
      {
        annotationId: ids(1),
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(1), T(2)],
        value: 80,
      },
      {
        annotationId: ids(2),
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [T(3)],
        value: 6,
        tolerance: { kind: 'fit', hole: 'H7' },
      },
      {
        annotationId: ids(3),
        kind: 'dimension',
        type: 'linearRadius',
        targets: [T(4)],
        value: 5,
        tolerance: { kind: 'deviation', upper: 0.1, lower: -0.1 },
      },
      {
        annotationId: ids(4),
        kind: 'dimension',
        type: 'angular',
        targets: [T(5), T(6)],
        value: Math.PI / 4,
        tolerance: { kind: 'deviation', upper: Math.PI / 180, lower: 0 },
      },
      { annotationId: ids(5), kind: 'dimension', type: 'size', targets: [T(7), T(8)], value: 8 },
    ];
    const { annotations, report } = annotationsFromPmi({
      entries: items.map((i) => entry(i)),
      issues: [],
      origin: imported,
      existing: [],
      newId,
    });
    expect(annotations).toEqual([
      { id: ids(1), kind: 'linear', origin: imported, refs: [ref(1), ref(2)], nominal: '80 mm' },
      {
        id: ids(2),
        kind: 'diameter',
        origin: imported,
        refs: [ref(3)],
        nominal: '6 mm',
        tolerance: { kind: 'fit', hole: 'H7', show: 'symbol' },
      },
      {
        id: ids(3),
        kind: 'radius',
        origin: imported,
        refs: [ref(4)],
        nominal: '5 mm',
        tolerance: { kind: 'symmetric', value: '0.1 mm' },
      },
      {
        id: ids(4),
        kind: 'angle',
        origin: imported,
        refs: [ref(5), ref(6)],
        nominal: '45 deg',
        tolerance: { kind: 'bilateral', upper: '1 deg', lower: '0 deg' },
      },
      { id: ids(5), kind: 'linear', origin: imported, refs: [ref(7), ref(8)], nominal: '8 mm' },
    ]);
    expect(report.imported.map((i) => i.kind)).toEqual([
      'linear',
      'diameter',
      'radius',
      'angle',
      'linear',
    ]);
    expect(report.skipped).toEqual([]);
  });

  it('binds datums and frames, a datum or frame on a feature of size to its dimension', () => {
    const items: PmiImportItem[] = [
      {
        annotationId: ids(30),
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [T(9)],
        value: 6,
      },
      { annotationId: ids(31), kind: 'datum', label: 'A', targets: [T(1)] },
      { annotationId: ids(32), kind: 'datum', label: 'B', targets: [T(9)] },
      {
        annotationId: ids(33),
        kind: 'tolerance',
        type: 'position',
        targets: [T(9)],
        value: 0.1,
        diameter: true,
        material: 'M',
        datums: [{ label: 'A' }, { label: 'B', material: 'L' }, { label: 'C' }],
      },
    ];
    const { annotations, report } = annotationsFromPmi({
      entries: items.map((i) => entry(i)),
      issues: [],
      origin: imported,
      existing: [],
      newId,
    });
    const byId = new Map(annotations.map((a) => [a.id, a]));
    expect(byId.get(ids(32))).toEqual({
      id: ids(32),
      kind: 'datumFeature',
      origin: imported,
      label: 'B',
      refs: [],
      appliesTo: ids(30),
    });
    expect(byId.get(ids(33))).toEqual({
      id: ids(33),
      kind: 'geometricTolerance',
      origin: imported,
      characteristic: 'position',
      zone: { value: '0.1 mm', shape: 'diameter', material: 'mmc' },
      datums: [
        { datums: [{ datum: ids(31) }] },
        { datums: [{ datum: ids(32) }], material: 'lmc' },
        { datums: [{ label: 'C' }] },
      ],
      refs: [],
      appliesTo: ids(30),
    });
    expect(report.notes).toEqual([
      {
        annotationId: ids(33),
        note: 'Datum C is not defined in the file or the part: bind it to a datum',
      },
    ]);
  });

  it('keeps Wren ids from PMI names, mints new ids otherwise and never reuses one', () => {
    const existing: Annotation[] = [
      { id: ids(40), kind: 'datumFeature', origin: model, label: 'D', refs: [face('x')] },
    ];
    const items: PmiImportItem[] = [
      {
        annotationId: ids(40),
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(1), T(2)],
        value: 1,
      },
      {
        annotationId: 'DIM1',
        name: 'DIM1',
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(1), T(3)],
        value: 2,
      },
      {
        annotationId: ids(41),
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(2), T(3)],
        value: 3,
      },
      {
        annotationId: 'FCF1',
        name: 'FCF1',
        kind: 'tolerance',
        type: 'parallelism',
        targets: [T(4)],
        value: 0.1,
        datums: [{ label: 'D' }],
      },
    ];
    const { annotations } = annotationsFromPmi({
      entries: items.map((i) => entry(i)),
      issues: [],
      origin: imported,
      existing,
      newId,
    });
    expect(annotations[0]?.id).not.toBe(ids(40));
    expect(annotations[1]?.id).toMatch(/^01JNEW/);
    expect(annotations[2]?.id).toBe(ids(41));
    expect(annotations[3]).toMatchObject({ datums: [{ datums: [{ datum: ids(40) }] }] });
    expect(new Set(annotations.map((a) => a.id)).size).toBe(4);
  });

  it('reports presentation-only items, unreadable entities and unmappable items', () => {
    const items: PmiImportEntry[] = [
      entry({
        kind: 'presentationOnly',
        name: 'Note 3',
        presentation: {
          plane: { origin: [0, 0, 0], x: [1, 0, 0], normal: [0, 0, 1] },
          polylines: [],
        },
      }),
      entry({
        annotationId: 'X',
        name: 'X',
        kind: 'dimension',
        type: 'curveLength',
        targets: [T(1, 'edge')],
        value: 3,
      }),
      entry({
        annotationId: 'Y',
        name: 'Y',
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(1)],
        value: 3,
      }),
      entry(
        {
          annotationId: 'Z',
          name: 'Z',
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [T(2)],
          value: 3,
        },
        [{ reason: 'Face 2 of body 1 is not in the imported shape' }],
      ),
      entry({ annotationId: 'W', name: 'W', kind: 'datum', label: 'a', targets: [T(2)] }),
      entry({
        annotationId: 'V',
        name: 'V',
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [],
        value: 3,
      }),
      entry({
        annotationId: 'U',
        name: 'U',
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [T(2)],
        value: 3,
        tolerance: { kind: 'fit', hole: 'Q99' },
      }),
    ];
    const { annotations, report } = annotationsFromPmi({
      entries: items,
      issues: [{ name: 'GT7', reason: 'Tolerance value could not be read' }],
      origin: imported,
      existing: [],
      newId,
    });
    expect(annotations).toEqual([]);
    expect(report.presentationOnly).toEqual([{ name: 'Note 3' }]);
    expect(report.skipped).toEqual([
      { name: 'GT7', reason: 'Tolerance value could not be read' },
      { name: 'X', reason: 'Curve length dimensions have no Wren equivalent yet' },
      { name: 'Y', reason: 'A distance on 1 entities has no Wren equivalent' },
      { name: 'Z', reason: 'Face 2 of body 1 is not in the imported shape' },
      { name: 'V', reason: 'It is attached to no model geometry' },
      { name: 'U', reason: '“Q99” is not an ISO 286 hole class' },
      { name: 'W', reason: '“a” is not a datum letter' },
    ]);
  });

  it('edge targets map to edge refs', () => {
    const { annotations } = annotationsFromPmi({
      entries: [
        {
          item: {
            annotationId: ids(50),
            kind: 'dimension',
            type: 'linearRadius',
            targets: [T(3, 'edge')],
            value: 2,
          },
          refs: [edge('edge(FIMP:face#1|FIMP:face#2)')],
        },
      ],
      issues: [],
      origin: imported,
      existing: [],
      newId,
    });
    expect(annotations[0]?.refs).toEqual([edge('edge(FIMP:face#1|FIMP:face#2)')]);
  });
});

describe('number literals', () => {
  it('round-trips values through expressions to 1e-12', () => {
    for (const v of [0, 8, 0.1, -0.05, 1 / 3, 123456.789, 1e-7, Math.PI]) {
      expect(Number(numberLiteral(v))).toBeCloseTo(v, 12);
    }
    expect(valueExpr(Math.PI / 6, 'angle')).toBe('30 deg');
    expect(valueExpr(12.5, 'length')).toBe('12.5 mm');
  });
});

describe('export → import → export is a fixpoint', () => {
  it('a mixed set of items survives the trip unchanged', () => {
    const items: PmiExportItem[] = [
      {
        annotationId: ids(60),
        kind: 'dimension',
        type: 'linearDistance',
        targets: [T(1), T(2)],
        value: 80,
      },
      {
        annotationId: ids(61),
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [T(3)],
        value: 6,
        tolerance: { kind: 'deviation', upper: 0.012, lower: 0 },
      },
      { annotationId: ids(62), kind: 'datum', label: 'A', targets: [T(1)] },
      { annotationId: ids(63), kind: 'datum', label: 'B', targets: [T(3)] },
      {
        annotationId: ids(64),
        kind: 'tolerance',
        type: 'position',
        targets: [T(3)],
        value: 0.1,
        diameter: true,
        material: 'M',
        datums: [{ label: 'A' }, { label: 'B' }],
      },
      { annotationId: ids(65), kind: 'tolerance', type: 'flatness', targets: [T(1)], value: 0.05 },
    ];
    const { annotations } = annotationsFromPmi({
      entries: items.map((i) =>
        entry(
          i,
          i.targets.map((t) => ref(t.index)),
        ),
      ),
      issues: [],
      origin: imported,
      existing: [],
      newId,
    });
    // The import side's targets: the same indices, through the names.
    const index = (r: EntityRef) => Number(/#(\d+)$/.exec(r.name)?.[1]);
    const targets = new Map<Id, PmiTargetOrWhy[]>(
      annotations.map((a) => [a.id, a.refs.map((r) => T(index(r)))]),
    );
    const values = new Map(
      items.map((i) => [i.annotationId, i.kind === 'dimension' ? i.value : undefined]),
    );
    const again = planPmiExport({
      annotations,
      resolutions: new Map(annotations.map((a) => [a.id, ok(a.id, values.get(a.id))])),
      targets,
      evaluate,
    });
    expect(again.report.skipped).toEqual([]);
    const byId = (xs: PmiExportItem[]) =>
      [...xs].sort((a, b) => (a.annotationId < b.annotationId ? -1 : 1));
    const strip = (xs: PmiExportItem[]) =>
      byId(xs).map((x) =>
        x.kind === 'dimension' && x.tolerance?.kind === 'deviation'
          ? {
              ...x,
              tolerance: {
                ...x.tolerance,
                upper: round(x.tolerance.upper),
                lower: round(x.tolerance.lower),
              },
            }
          : x,
      );
    expect(strip(again.items)).toEqual(strip(items));
  });
});

const round = (v: number) => Math.round(v * 1e12) / 1e12;
