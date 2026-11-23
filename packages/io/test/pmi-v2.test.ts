// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * ADR-101: PMI contract v2. Each v2 field survives annotation → export item → annotation, and the
 * item carries it (the exchange has a place for it, so the report has nothing to note).
 */

import type {
  Annotation,
  AnnotationResolution,
  EntityRef,
  PmiExportItem,
  PmiImportItem,
  PmiTarget,
} from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { annotationsFromPmi, type PmiEvaluate, pmiExportItem } from '../src/pmi';

const model = { kind: 'model' } as const;
const imported = { kind: 'import', file: 'a.step' } as const;
const id = (n: number) => `01JPMV${String(n).padStart(20, '0')}`;
const T = (index: number, kind: PmiTarget['kind'] = 'face'): PmiTarget => ({
  body: 0,
  kind,
  index,
});
const ref = (t: PmiTarget): EntityRef => ({ name: `FIMP:${t.kind}#${t.index}`, kind: t.kind });
const evaluate: PmiEvaluate = (expr) => {
  const m = /^\s*(-?[\d.]+)\s*mm\s*$/.exec(expr);
  return m ? Number(m[1]) : undefined;
};

function through(
  a: Annotation,
  targets: PmiTarget[],
  resolution: Partial<AnnotationResolution> = {},
  value?: number,
): { item: PmiExportItem; back: Annotation; notes: string[] } {
  const r: AnnotationResolution = {
    annotationId: a.id,
    state: 'ok',
    ...(value !== undefined ? { value } : {}),
    ...resolution,
  };
  const d = pmiExportItem({
    annotation: a,
    resolution: r,
    targets,
    annotations: new Map([[a.id, a]]),
    targetsOf: () => undefined,
    evaluate,
  });
  if (!d.ok) throw new Error(d.reason);
  const { annotations, report } = annotationsFromPmi({
    entries: [{ item: d.item as PmiImportItem, refs: targets.map(ref) }],
    issues: [],
    origin: imported,
    existing: [],
    newId: () => id(999),
  });
  expect(report.skipped).toEqual([]);
  const back = annotations[0] as Annotation;
  return { item: d.item, back, notes: report.notes.map((n) => n.note) };
}

/** The annotation as imported: same but for provenance and the nominal the file restates. */
const same = (back: Annotation, a: Annotation) => {
  const { origin: _o, ...rest } = back as Annotation & { nominal?: string };
  const { origin: _p, ...want } = a as Annotation & { nominal?: string };
  delete (rest as { nominal?: string }).nominal;
  delete (want as { nominal?: string }).nominal;
  expect(rest).toEqual(want);
};

describe('dimension v2 fields round-trip', () => {
  it('linear with a direction and point qualifiers', () => {
    const a: Annotation = {
      id: id(1),
      kind: 'linear',
      origin: model,
      refs: [ref(T(1, 'edge')), ref(T(2, 'edge'))],
      at: ['mid', 'start'],
      direction: [0, 1, 0],
    };
    const { item, back } = through(a, [T(1, 'edge'), T(2, 'edge')], {}, 12);
    expect(item).toMatchObject({ direction: [0, 1, 0], at: ['mid', 'start'] });
    same(back, a);
  });

  it('linear without a direction stays linear, aligned on points stays aligned', () => {
    const lin: Annotation = {
      id: id(2),
      kind: 'linear',
      origin: model,
      refs: [ref(T(1)), ref(T(2))],
    };
    const l = through(lin, [T(1), T(2)], {}, 5);
    expect(l.item).not.toHaveProperty('direction');
    expect(l.item).not.toHaveProperty('at');
    same(l.back, lin);
    const al: Annotation = {
      id: id(3),
      kind: 'aligned',
      origin: model,
      refs: [ref(T(1, 'vertex')), ref(T(2, 'vertex'))],
    };
    const r = through(al, [T(1, 'vertex'), T(2, 'vertex')], {}, 5);
    expect(r.item).not.toHaveProperty('direction');
    same(r.back, al);
    // Edges measured at points are aligned too.
    const mid: Annotation = {
      id: id(4),
      kind: 'aligned',
      origin: model,
      refs: [ref(T(1, 'edge')), ref(T(2, 'edge'))],
      at: ['mid', 'mid'],
    };
    same(through(mid, [T(1, 'edge'), T(2, 'edge')], {}, 5).back, mid);
  });

  it('ordinate', () => {
    const a: Annotation = {
      id: id(5),
      kind: 'ordinate',
      origin: model,
      refs: [ref(T(1, 'vertex')), ref(T(2, 'vertex'))],
      direction: [1, 0, 0],
    };
    const { item, back } = through(a, [T(1, 'vertex'), T(2, 'vertex')], {}, 30);
    expect(item).toMatchObject({ type: 'linearDistance', ordinate: true, direction: [1, 0, 0] });
    same(back, a);
  });

  it('basic and reference dimensions, with no note', () => {
    for (const kind of ['basic', 'reference'] as const) {
      const a: Annotation = {
        id: id(6),
        kind: 'diameter',
        origin: model,
        refs: [ref(T(3))],
        tolerance: { kind },
      };
      const { item, back, notes } = through(a, [T(3)], {}, 6);
      expect(item).toMatchObject({ qualifier: kind });
      expect(item).not.toHaveProperty('tolerance');
      expect(notes).toEqual([]);
      same(back, a);
    }
  });

  it('spherical radius and diameter follow the sphere anchor, a circle is not spherical', () => {
    for (const kind of ['radius', 'diameter'] as const) {
      const a: Annotation = { id: id(7), kind, origin: model, refs: [ref(T(4))] };
      const sphere = through(a, [T(4)], { anchors: [{ kind: 'point', at: [0, 0, 0] }] }, 8);
      expect(sphere.item).toMatchObject({ spherical: true });
      same(sphere.back, a);
      // Re-exporting the imported annotation on the same sphere says so again.
      const again = through(
        sphere.back,
        [T(4)],
        { anchors: [{ kind: 'point', at: [0, 0, 0] }] },
        8,
      );
      expect(again.item).toMatchObject({ spherical: true });
      const circle = through(
        a,
        [T(4)],
        {
          anchors: [{ kind: 'circle', center: [0, 0, 0], normal: [0, 0, 1], radius: 4 }],
        },
        8,
      );
      expect(circle.item).not.toHaveProperty('spherical');
      same(circle.back, a);
    }
  });
});

describe('tolerance zone v2 fields round-trip', () => {
  const frame = (patch: Partial<Annotation>): Annotation =>
    ({
      id: id(20),
      kind: 'geometricTolerance',
      origin: model,
      characteristic: 'position',
      zone: { value: '0.1 mm' },
      refs: [ref(T(1))],
      ...patch,
    }) as Annotation;

  it('spherical zone (SØ)', () => {
    const a = frame({ zone: { value: '0.1 mm', shape: 'sphericalDiameter' } });
    const { item, back } = through(a, [T(1)]);
    expect(item).toMatchObject({ diameter: true, spherical: true });
    same(back, a);
  });

  it('a plain diameter zone is not spherical', () => {
    const a = frame({ zone: { value: '0.1 mm', shape: 'diameter' } });
    const { item, back } = through(a, [T(1)]);
    expect(item).not.toHaveProperty('spherical');
    same(back, a);
  });

  it('modifiers, projected and unequal zones, all around', () => {
    const a = frame({
      characteristic: 'surfaceProfile',
      zone: {
        value: '0.1 mm',
        modifiers: ['freeState', 'statistical'],
        projected: '10 mm',
        unequal: '0.02 mm',
      },
      allAround: true,
    });
    const { item, back } = through(a, [T(1)]);
    expect(item).toMatchObject({
      modifiers: ['freeState', 'statistical'],
      projected: 10,
      unequal: 0.02,
      allAround: true,
    });
    same(back, a);
  });

  it('still refuses what the contract does not carry', () => {
    const a = frame({ zone: { value: '0.1 mm', perUnit: { value: '0.01 mm', length: '100 mm' } } });
    const d = pmiExportItem({
      annotation: a,
      resolution: { annotationId: a.id, state: 'ok' },
      targets: [T(1)],
      annotations: new Map([[a.id, a]]),
      targetsOf: () => undefined,
      evaluate,
    });
    expect(d.ok).toBe(false);
  });
});

describe('import of v2 items with something to say', () => {
  const run = (item: PmiImportItem) =>
    annotationsFromPmi({
      entries: [{ item, refs: ('targets' in item ? item.targets : []).map(ref) }],
      issues: [],
      origin: imported,
      existing: [],
      newId: () => id(998),
    });

  it('an ordinate without a direction is reported, not guessed', () => {
    const { annotations, report } = run({
      kind: 'dimension',
      type: 'linearDistance',
      targets: [T(1), T(2)],
      value: 3,
      ordinate: true,
    });
    expect(annotations).toEqual([]);
    expect(report.skipped[0]).toMatchObject({ code: 'ordinateNoDirection' });
  });

  it('a qualifier wins over a tolerance and says so', () => {
    const { annotations, report } = run({
      kind: 'dimension',
      type: 'linearDiameter',
      targets: [T(1)],
      value: 3,
      qualifier: 'basic',
      tolerance: { kind: 'deviation', upper: 0.1, lower: -0.1 },
    });
    expect(annotations[0]).toMatchObject({ tolerance: { kind: 'basic' } });
    expect(report.notes[0]?.note).toMatch(/no tolerance/);
  });

  it('an unknown zone modifier is left out with a note', () => {
    const { annotations, report } = run({
      kind: 'tolerance',
      type: 'flatness',
      targets: [T(1)],
      value: 0.1,
      modifiers: ['freeState', 'bogus' as never],
    });
    expect(annotations[0]).toMatchObject({ zone: { modifiers: ['freeState'] } });
    expect(report.notes[0]?.note).toMatch(/modifier/);
  });

  it('issues keep their code and severity', () => {
    const { report } = annotationsFromPmi({
      entries: [],
      issues: [
        { name: 'A', reason: 'Filled text', code: 'filledPresentation', severity: 'cosmetic' },
      ],
      origin: imported,
      existing: [],
      newId: () => id(997),
    });
    expect(report.skipped).toEqual([
      { name: 'A', reason: 'Filled text', code: 'filledPresentation', severity: 'cosmetic' },
    ]);
  });
});
