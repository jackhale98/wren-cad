/**
 * PMI decoding (src/pmi.ts): validation of the `pmi` member of a STEP import and of the
 * `exportStepPmi` report. Malformed kernel output and targets past their body's counts are
 * INTERNAL errors. No Wasm.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { PmiExportItem } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import {
  decodePmiExportReport,
  decodePmiImport,
  encodePmiExportItems,
  withAnnotationIds,
} from '../src/pmi';

const counts = [{ faces: 7, edges: 15, vertices: 10 }];
const prs = {
  plane: { origin: [0, 0, 10], x: [1, 0, 0], normal: [0, 0, 1] },
  polylines: [
    [
      [0, 0, 10],
      [8, 0, 10],
    ],
  ],
};

const raw = (items: unknown[], issues: unknown[] = [], c: unknown = counts) => ({
  items,
  issues,
  counts: c,
});

const dimension = {
  kind: 'dimension',
  type: 'linearDistance',
  targets: [
    { body: 0, kind: 'face', index: 1 },
    { body: 0, kind: 'face', index: 7 },
  ],
  value: 40,
  tolerance: { kind: 'deviation', upper: 0.2, lower: -0.1 },
  name: 'A1',
  presentation: prs,
};

const internalDetail = (r: ReturnType<typeof decodePmiImport>): string => {
  expect(r.ok).toBe(false);
  if (r.ok) return '';
  expect(r.error.code).toBe('INTERNAL');
  return r.error.detail ?? '';
};

describe('decodePmiImport', () => {
  it('accepts every item kind and keeps names, tolerances and presentation', () => {
    const items = [
      dimension,
      {
        kind: 'dimension',
        type: 'linearDiameter',
        targets: [{ body: 0, kind: 'face', index: 3 }],
        value: 10,
        tolerance: { kind: 'fit', hole: 'H7' },
      },
      { kind: 'datum', label: 'A', targets: [{ body: 0, kind: 'face', index: 2 }], name: 'D' },
      {
        kind: 'tolerance',
        type: 'position',
        targets: [{ body: 0, kind: 'face', index: 3 }],
        value: 0.1,
        diameter: true,
        material: 'M',
        datums: [{ label: 'A' }, { label: 'B', material: 'L' }],
      },
      { kind: 'presentationOnly', name: 'note', presentation: prs },
    ];
    const r = decodePmiImport(raw(items, [{ reason: 'x' }, { name: 'n', reason: 'y' }]), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items).toEqual(items);
    expect(r.value.issues).toEqual([{ reason: 'x' }, { name: 'n', reason: 'y' }]);
    expect(r.value.counts).toEqual(counts);
  });

  it('an index past the body counts is INTERNAL, never clamped', () => {
    const past = { ...dimension, targets: [{ body: 0, kind: 'face', index: 8 }] };
    expect(internalDetail(decodePmiImport(raw([past]), 1))).toMatch(/face 8 is past/);
    const edge = { ...dimension, targets: [{ body: 0, kind: 'edge', index: 16 }] };
    expect(internalDetail(decodePmiImport(raw([edge]), 1))).toMatch(/edge 16/);
    const zero = { ...dimension, targets: [{ body: 0, kind: 'vertex', index: 0 }] };
    expect(internalDetail(decodePmiImport(raw([zero]), 1))).toMatch(/vertex 0/);
    const body = { ...dimension, targets: [{ body: 1, kind: 'face', index: 1 }] };
    expect(internalDetail(decodePmiImport(raw([body]), 1))).toMatch(/body 1/);
    const frac = { ...dimension, targets: [{ body: 0, kind: 'face', index: 1.5 }] };
    expect(internalDetail(decodePmiImport(raw([frac]), 1))).toMatch(/integer/);
  });

  it('counts must cover exactly the returned bodies', () => {
    expect(internalDetail(decodePmiImport(raw([]), 2))).toMatch(/covers 1 bodies/);
    expect(
      internalDetail(decodePmiImport(raw([], [], [{ faces: -1, edges: 0, vertices: 0 }]), 1)),
    ).toMatch(/non-negative/);
  });

  it('rejects malformed items', () => {
    const bad: unknown[] = [
      { ...dimension, type: 'chamfer' },
      { ...dimension, value: Number.NaN },
      { ...dimension, targets: [] },
      { ...dimension, tolerance: { kind: 'fit' } },
      { ...dimension, tolerance: { kind: 'limits' } },
      { ...dimension, presentation: { ...prs, polylines: [[[0, 0, 0]]] } },
      {
        ...dimension,
        presentation: { ...prs, plane: { origin: [0, 0], x: [1, 0, 0], normal: [0, 0, 1] } },
      },
      { kind: 'datum', label: '', targets: dimension.targets },
      {
        kind: 'tolerance',
        type: 'position',
        targets: dimension.targets,
        value: 0.1,
        material: 'X',
      },
      {
        kind: 'tolerance',
        type: 'position',
        targets: dimension.targets,
        value: 0.1,
        datums: [{ label: 'A' }, { label: 'B' }, { label: 'C' }, { label: 'D' }],
      },
      { kind: 'presentationOnly' },
      { kind: 'note' },
      'nope',
    ];
    for (const item of bad) {
      expect(decodePmiImport(raw([item]), 1).ok, JSON.stringify(item)).toBe(false);
    }
    expect(decodePmiImport(null, 1).ok).toBe(false);
    expect(decodePmiImport(raw([], [{ name: 'x' }]), 1).ok).toBe(false);
  });

  it('contract v2: keeps direction, at, qualifier, ordinate, spherical, zone fields, triangles, issue codes', () => {
    const tri = [
      [0, 0, 10],
      [1, 0, 10],
      [0, 1, 10],
    ];
    const items = [
      {
        ...dimension,
        tolerance: undefined,
        direction: [1, 0, 0],
        at: ['self', 'axis'],
        ordinate: true,
      },
      { ...dimension, tolerance: undefined, qualifier: 'basic' },
      {
        kind: 'dimension',
        type: 'linearRadius',
        targets: [{ body: 0, kind: 'face', index: 3 }],
        value: 5,
        spherical: true,
      },
      {
        kind: 'tolerance',
        type: 'position',
        targets: [{ body: 0, kind: 'face', index: 2 }],
        value: 0.1,
        diameter: true,
        spherical: true,
        modifiers: ['freeState', 'combinedZone'],
        projected: 15,
        unequal: 0.05,
        allAround: true,
        presentation: { ...prs, triangles: tri },
      },
    ];
    const issues = [
      { name: 'F1', reason: 'r', code: 'noValue', severity: 'lost' },
      { reason: 'v1 issue' },
    ];
    const r = decodePmiImport(raw(items, issues), 1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.items.map((i) => ({ ...i, presentation: undefined }))).toEqual(
      items.map((i) => {
        const { tolerance: _t, ...rest } = i as Record<string, unknown>;
        return { ...rest, ...(_t === undefined ? {} : { tolerance: _t }), presentation: undefined };
      }),
    );
    const t = r.value.items[3];
    expect(t?.kind === 'tolerance' && t.presentation?.triangles).toEqual(tri);
    expect(r.value.issues).toEqual(issues);
  });

  it('contract v2: malformed fields are INTERNAL', () => {
    const bad: [unknown, RegExp][] = [
      [{ ...dimension, direction: [2, 0, 0] }, /not a unit vector/],
      [{ ...dimension, at: ['self', 'nowhere'] }, /at\[1\]/],
      [{ ...dimension, at: ['self', 'self', 'self'] }, /longer than its targets/],
      [{ ...dimension, qualifier: 'basic' }, /basic and has a tolerance/],
      [{ ...dimension, tolerance: undefined, ordinate: true }, /ordinate without/],
      [{ ...dimension, spherical: true }, /spherical but not a diameter/],
      [
        {
          kind: 'tolerance',
          type: 'flatness',
          targets: [{ body: 0, kind: 'face', index: 2 }],
          value: 0.1,
          spherical: true,
        },
        /spherical without diameter/,
      ],
      [
        {
          kind: 'tolerance',
          type: 'flatness',
          targets: [{ body: 0, kind: 'face', index: 2 }],
          value: 0.1,
          modifiers: ['maximumValue'],
        },
        /modifiers\[0\]/,
      ],
      [
        {
          kind: 'tolerance',
          type: 'position',
          targets: [{ body: 0, kind: 'face', index: 2 }],
          value: 0.1,
          projected: 0,
        },
        /projected is not greater than zero/,
      ],
      [{ ...dimension, presentation: { ...prs, triangles: [[0, 0, 0]] } }, /three points/],
    ];
    for (const [item, why] of bad) {
      expect(internalDetail(decodePmiImport(raw([item]), 1))).toMatch(why);
    }
    expect(
      internalDetail(decodePmiImport(raw([], [{ reason: 'r', severity: 'fatal' }]), 1)),
    ).toMatch(/severity/);
  });

  it('withAnnotationIds gives semantic items an id and leaves presentation-only ones alone', () => {
    const r = decodePmiImport(
      raw([dimension, { kind: 'presentationOnly', presentation: prs }], [{ reason: 'r' }]),
      1,
    );
    if (!r.ok) throw new Error('decode failed');
    const result = withAnnotationIds(r.value, (item, i) => item.name ?? `new-${i}`);
    expect(result.items[0]).toMatchObject({ kind: 'dimension', annotationId: 'A1', name: 'A1' });
    expect(result.items[1]).toEqual({ kind: 'presentationOnly', presentation: prs });
    expect(result.issues).toEqual([{ reason: 'r' }]);
  });
});

describe('decodePmiExportReport', () => {
  it('accepts the report, notes optional', () => {
    const report = {
      exported: 3,
      skipped: [{ annotationId: 'x', reason: 'unresolved target' }],
      notes: [{ annotationId: 'y', note: 'wrote H7, not g6' }],
    };
    expect(decodePmiExportReport(report)).toEqual({ ok: true, value: report });
    expect(decodePmiExportReport({ exported: 0, skipped: [] })).toEqual({
      ok: true,
      value: { exported: 0, skipped: [], notes: [] },
    });
  });

  it('malformed reports are INTERNAL', () => {
    for (const bad of [
      null,
      { exported: -1, skipped: [] },
      { exported: 1.5, skipped: [] },
      { exported: 1 },
      { exported: 1, skipped: [{ annotationId: 'x' }] },
      { exported: 1, skipped: [], notes: [{ note: 'n' }] },
    ]) {
      const r = decodePmiExportReport(bad);
      expect(r.ok, JSON.stringify(bad)).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INTERNAL');
    }
  });
});

describe('encodePmiExportItems', () => {
  it('is the JSON array the façade takes', () => {
    const items: PmiExportItem[] = [
      {
        annotationId: 'a',
        kind: 'datum',
        label: 'A',
        targets: [{ body: 0, kind: 'face', index: 1 }],
      },
    ];
    expect(JSON.parse(encodePmiExportItems(items))).toEqual(items);
  });
});
