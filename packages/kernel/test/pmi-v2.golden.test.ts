/**
 * PMI contract v2 (ADR-101) golden tests: each v2 field written with `exportStepPmi` and read back
 * with `importFile` (Node, real Wasm). A 40×30×10 plate with a Ø10 through hole, and an Ø20 ball
 * beside it for the spherical fields. Fields STEP or OCCT 8.0.1 cannot hold are written without
 * them and noted in the export report (ADR-100 amendment, 2026-11-23); import issues carry a code
 * and a severity.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  PmiExportItem,
  PmiPresentation,
  PmiTarget,
  ShapeFingerprints,
} from '@wren-cad/contracts';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePmiExportReport,
  decodePmiImport,
  encodePmiExportItems,
  type KernelPmiExportReport,
  type KernelPmiImportItem,
  type KernelPmiImportResult,
  type RawImportResult,
  type RawPmiExportResult,
  type WhittleKernelModule,
} from '../src/index';
import {
  circle,
  extrude,
  indexOf,
  loadVariant,
  ok,
  profileRefs,
  rect,
  Session,
  sketch,
  sketchInputs,
  suiteTitle,
  VARIANTS,
  variantBuilt,
  vecClose,
} from './helpers';

const SK = '01JSKETCH0000000000000PV21';
const EX = '01JEXTRUDE000000000000PV22';
const BALL = '01JBALL000000000000000PV23';

/** Ids: one annotation per field under test. */
const ID = {
  direction: '01JV2DIRECTION0000000000A1',
  aligned: '01JV2ALIGNED000000000000A2',
  at: '01JV2AT00000000000000000A3',
  basic: '01JV2BASIC00000000000000A4',
  reference: '01JV2REFERENCE0000000000A5',
  ordinate: '01JV2ORDINATE00000000000A6',
  sphereDiameter: '01JV2SPHEREDIAMETER00000A7',
  sphereRadius: '01JV2SPHERERADIUS0000000A8',
  datumA: '01JV2DATUMA0000000000000A9',
  sphereZone: '01JV2SPHEREZONE000000000B1',
  modifiers: '01JV2MODIFIERS0000000000B2',
  separate: '01JV2SEPARATE00000000000B3',
  projected: '01JV2PROJECTED0000000000B4',
  unequal: '01JV2UNEQUAL000000000000B5',
  allAround: '01JV2ALLAROUND0000000000B6',
  triangles: '01JV2TRIANGLES0000000000B7',
};

/** A small frame on the plane z = `z` at (x, y). */
function presentation(x: number, y: number, z: number): PmiPresentation {
  return {
    plane: { origin: [x, y, z], x: [1, 0, 0], normal: [0, 0, 1] },
    polylines: [
      [
        [x, y, z],
        [x + 8, y, z],
        [x + 8, y + 3, z],
        [x, y + 3, z],
        [x, y, z],
      ],
    ],
  };
}

type Fp = ShapeFingerprints['faces'][number];

for (const { variant } of VARIANTS) {
  describe.skipIf(!variantBuilt(variant))(suiteTitle('STEP AP242 PMI contract v2', variant), () => {
    let k: WhittleKernelModule;
    let s: Session;
    let baseline = 0;

    beforeAll(async () => {
      k = await loadVariant(variant);
      baseline = k.liveHandleCount();
    }, 60_000);

    afterEach(() => {
      s?.releaseAll();
      expect(k.liveHandleCount()).toBe(baseline);
    });

    afterAll(() => {
      if (k) expect(k.liveHandleCount()).toBe(baseline);
    });

    /** Plate (body 0) and ball (body 1) with the targets the tests use. */
    const scene = () => {
      s = new Session(k);
      const sk = s.exec(
        sketch(SK, [...rect(0, 0, 40, 30), ...circle('C1', 20, 15, 5)]),
        sketchInputs(),
      );
      const plate = s.exec(extrude(EX), {
        values: { '/end/depth': 10 },
        refs: profileRefs(sk.shape, [indexOf(sk, `S${SK}:region(L1,L2,L3,L4|C1)`, 'face')]),
      });
      const ball = s.exec(
        {
          id: BALL,
          name: 'Ball',
          suppressed: false,
          type: 'primitive',
          op: 'new',
          shape: 'sphere',
          radius: '10',
        },
        { values: { '/radius': 10 } },
      );
      const fp = s.fingerprints(plate.shape);
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      const face = (pick: (f: Fp) => boolean): PmiTarget => {
        const hits = fp.faces.flatMap((f, i) => (pick(f) ? [i + 1] : []));
        expect(hits).toHaveLength(1);
        return { body: 0, kind: 'face', index: hits[0] ?? 0 };
      };
      const ballFaces = s.fingerprints(ball.shape).faces;
      expect(ballFaces).toHaveLength(1);
      return {
        shapes: [
          { shape: plate.shape, name: 'Plate' },
          { shape: ball.shape, name: 'Ball' },
        ],
        left: face((f) => f.surface === 'plane' && near(f.centroid[0], 0)),
        right: face((f) => f.surface === 'plane' && near(f.centroid[0], 40)),
        bottom: face((f) => f.surface === 'plane' && near(f.centroid[2], 0)),
        top: face((f) => f.surface === 'plane' && near(f.centroid[2], 10)),
        front: face((f) => f.surface === 'plane' && near(f.centroid[1], 0)),
        bore: face((f) => f.surface === 'cylinder'),
        sphere: { body: 1, kind: 'face', index: 1 } as PmiTarget,
      };
    };

    let counter = 0;
    /** Export → import; returns the report, the STEP text (unwrapped) and the decoded PMI. */
    const roundTrip = (
      shapes: unknown[],
      items: PmiExportItem[],
    ): { report: KernelPmiExportReport; text: string; pmi: KernelPmiImportResult } => {
      if (k.exportStepPmi === undefined) throw new Error('kernel build lacks exportStepPmi');
      const written = ok<RawPmiExportResult>(
        k.exportStepPmi(
          JSON.stringify(shapes),
          encodePmiExportItems(items),
          '{"stepSchema":"AP242"}',
        ),
      );
      const bytes = k.FS.readFile(written.path, { encoding: 'binary' }).slice();
      k.FS.unlink(written.path);
      const report = decodePmiExportReport(written.pmi);
      if (!report.ok) throw new Error(JSON.stringify(report.error));
      const path = `/tmp/test-pmi-v2-${++counter}.step`;
      k.FS.writeFile(path, bytes);
      let imported: RawImportResult;
      try {
        imported = ok<RawImportResult>(k.importFile(path, 'step'));
      } finally {
        k.FS.unlink(path);
      }
      for (const b of imported.bodies) s.handles.push(b.shape);
      const pmi = decodePmiImport(imported.pmi, imported.bodies.length);
      if (!pmi.ok) throw new Error(JSON.stringify(pmi.error));
      // The writer wraps long records; match entities on the text without line breaks.
      const text = new TextDecoder().decode(bytes).replace(/\s*\r?\n\s*/g, '');
      return { report: report.value, text, pmi: pmi.value };
    };

    const named = (pmi: KernelPmiImportResult, id: string): KernelPmiImportItem => {
      const hits = pmi.items.filter((i) => i.name === id);
      expect(hits, id).toHaveLength(1);
      const item = hits[0];
      if (item === undefined) throw new Error(`${id} not imported`);
      return item;
    };
    const dimension = (pmi: KernelPmiImportResult, id: string) => {
      const item = named(pmi, id);
      if (item.kind !== 'dimension') throw new Error(`${id} is a ${item.kind}`);
      return item;
    };
    const tolerance = (pmi: KernelPmiImportResult, id: string) => {
      const item = named(pmi, id);
      if (item.kind !== 'tolerance') throw new Error(`${id} is a ${item.kind}`);
      return item;
    };
    /** The unit entity a length measure of `value` refers to, as written (simple or complex). */
    const unitOf = (text: string, value: number): string | undefined => {
      for (const m of text.matchAll(/MEASURE_WITH_UNIT\(LENGTH_MEASURE\(([^)]*)\),#(\d+)\)/g)) {
        if (Math.abs(Number.parseFloat(m[1] ?? '') - value) < 1e-12) {
          return text.match(new RegExp(`#${m[2]}\\s*=\\s*([^;]*);`))?.[1];
        }
      }
      return undefined;
    };
    const notesFor = (report: KernelPmiExportReport, id: string) =>
      report.notes.filter((n) => n.annotationId === id).map((n) => n.note);

    it('dimension direction: CAx-IF orientation on a linear distance, read back', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.direction,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.right],
          value: 40,
          direction: [1, 0, 0],
          presentation: presentation(0, -10, 10),
        },
        // Same faces, no direction: the link to the STEP entity must not cross over.
        {
          annotationId: ID.aligned,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.right],
          value: 40,
          presentation: presentation(0, -20, 10),
        },
      ]);
      expect(report.exported).toBe(2);
      expect(report.notes).toEqual([]);
      expect(text).toMatch(/AXIS2_PLACEMENT_3D\('orientation'/);
      expect(text).not.toMatch(/DIMENSIONAL_LOCATION\('',/);
      const d = dimension(pmi, ID.direction);
      expect(d.type).toBe('linearDistance');
      vecClose(d.direction ?? [], [1, 0, 0], 1e-12);
      expect(dimension(pmi, ID.aligned).direction).toBeUndefined();
      expect(pmi.issues).toEqual([]);
    });

    it('dimension at: measured points as a Wren description, with an export note', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.at,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.bore],
          value: 20,
          direction: [1, 0, 0],
          at: ['self', 'axis'],
          presentation: presentation(0, -10, 10),
        },
      ]);
      expect(notesFor(report, ID.at)).toEqual([
        expect.stringMatching(/no point qualifiers OCCT can write/),
      ]);
      expect(text).toMatch(/DESCRIPTIVE_REPRESENTATION_ITEM\('wren measured points','self,axis'\)/);
      const d = dimension(pmi, ID.at);
      expect(d.at).toEqual(['self', 'axis']);
      vecClose(d.direction ?? [], [1, 0, 0], 1e-12);
      expect(pmi.issues).toEqual([]);
    });

    it('dimension qualifier: basic and reference as the CAx-IF dimensional note', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.basic,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.right],
          value: 40,
          qualifier: 'basic',
          presentation: presentation(0, -10, 10),
        },
        {
          annotationId: ID.reference,
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [sc.bore],
          value: 10,
          qualifier: 'reference',
          // A reference dimension has no tolerance: not written, noted.
          tolerance: { kind: 'deviation', upper: 0.1, lower: -0.1 },
          presentation: presentation(20, 15, 12),
        },
      ]);
      expect(report.exported).toBe(2);
      expect(notesFor(report, ID.basic)).toEqual([]);
      expect(notesFor(report, ID.reference)).toEqual([
        'a reference dimension has no tolerance: the tolerance is not written',
      ]);
      expect(text).toMatch(/DESCRIPTIVE_REPRESENTATION_ITEM\('dimensional note','theoretical'\)/);
      expect(text).toMatch(/DESCRIPTIVE_REPRESENTATION_ITEM\('dimensional note','auxiliary'\)/);
      expect(text).not.toMatch(/PLUS_MINUS_TOLERANCE/);
      const basic = dimension(pmi, ID.basic);
      expect(basic.qualifier).toBe('basic');
      expect(basic.tolerance).toBeUndefined();
      const reference = dimension(pmi, ID.reference);
      expect(reference.qualifier).toBe('reference');
      expect(reference.tolerance).toBeUndefined();
      expect(pmi.issues).toEqual([]);
    });

    it('dimension ordinate: a linear distance with a Wren description, read back as ordinate', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.ordinate,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.right],
          value: 40,
          direction: [1, 0, 0],
          ordinate: true,
          presentation: presentation(0, -10, 10),
        },
      ]);
      expect(notesFor(report, ID.ordinate)).toEqual([
        expect.stringMatching(/STEP has no ordinate dimension/),
      ]);
      expect(text).toMatch(/DIMENSIONAL_LOCATION\('linear distance'/);
      expect(text).toMatch(/DESCRIPTIVE_REPRESENTATION_ITEM\('wren dimension form','ordinate'\)/);
      const d = dimension(pmi, ID.ordinate);
      expect(d.type).toBe('linearDistance');
      expect(d.ordinate).toBe(true);
      vecClose(d.direction ?? [], [1, 0, 0], 1e-12);
      expect(pmi.issues).toEqual([]);
    });

    it('dimension spherical: SØ and SR as spherical diameter and radius', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.sphereDiameter,
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [sc.sphere],
          value: 20,
          spherical: true,
          presentation: presentation(0, 0, 12),
        },
        {
          annotationId: ID.sphereRadius,
          kind: 'dimension',
          type: 'linearRadius',
          targets: [sc.sphere],
          value: 10,
          spherical: true,
          presentation: presentation(0, 5, 12),
        },
      ]);
      expect(report.exported).toBe(2);
      expect(report.notes).toEqual([]);
      expect(text).toMatch(/DIMENSIONAL_SIZE\(#\d+,'spherical diameter'\)/);
      expect(text).toMatch(/DIMENSIONAL_SIZE\(#\d+,'spherical radius'\)/);
      const d = dimension(pmi, ID.sphereDiameter);
      expect(d).toMatchObject({ type: 'linearDiameter', spherical: true, targets: [sc.sphere] });
      expect(dimension(pmi, ID.sphereRadius)).toMatchObject({
        type: 'linearRadius',
        spherical: true,
      });
      expect(pmi.issues).toEqual([]);
    });

    it('tolerance spherical: an SØ zone', () => {
      const sc = scene();
      const { pmi, text } = roundTrip(sc.shapes, [
        {
          annotationId: ID.datumA,
          kind: 'datum',
          label: 'A',
          targets: [sc.bottom],
          presentation: presentation(0, -5, 0),
        },
        {
          annotationId: ID.sphereZone,
          kind: 'tolerance',
          type: 'position',
          targets: [sc.sphere],
          value: 0.2,
          diameter: true,
          spherical: true,
          datums: [{ label: 'A' }],
          presentation: presentation(0, 0, 12),
        },
      ]);
      expect(text).toMatch(/TOLERANCE_ZONE_FORM\('spherical'\)/);
      expect(tolerance(pmi, ID.sphereZone)).toMatchObject({ diameter: true, spherical: true });
      expect(tolerance(pmi, ID.sphereZone).value).toBeCloseTo(0.2, 12);
      expect(pmi.issues).toEqual([]);
    });

    it('tolerance modifiers: free state, tangent plane, statistical, combined zone; SZ approximated', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.modifiers,
          kind: 'tolerance',
          type: 'flatness',
          targets: [sc.top],
          value: 0.05,
          modifiers: ['freeState', 'tangentPlane', 'statistical', 'combinedZone'],
          presentation: presentation(5, 5, 10),
        },
        {
          annotationId: ID.separate,
          kind: 'tolerance',
          type: 'flatness',
          targets: [sc.bottom],
          value: 0.05,
          modifiers: ['separateZones'],
          presentation: presentation(5, 5, 0),
        },
      ]);
      // Frames with presentation and no dimension in the file: OCCT 8.0.1 left the draughting
      // model without a context and the write failed (geometry only); the façade supplies it.
      expect(report.exported).toBe(2);
      expect(report.skipped).toEqual([]);
      expect(notesFor(report, ID.modifiers)).toEqual([]);
      expect(notesFor(report, ID.separate)).toEqual([
        expect.stringMatching(/separate requirement/),
      ]);
      expect(tolerance(pmi, ID.modifiers).modifiers?.slice().sort()).toEqual(
        ['combinedZone', 'freeState', 'statistical', 'tangentPlane'].sort(),
      );
      expect(tolerance(pmi, ID.separate).modifiers).toEqual(['separateZones']);
      // No dimension in the export: OCCT 8.0.1 tagged these mm values SI_UNIT(.METRE.).
      expect(unitOf(text, 0.05)).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
      expect(tolerance(pmi, ID.modifiers).value).toBeCloseTo(0.05, 12);
      expect(pmi.issues).toEqual([
        expect.objectContaining({
          name: ID.separate,
          code: 'separateRequirement',
          severity: 'approximated',
        }),
      ]);
    });

    it('tolerance projected: a projected_zone_definition, read back with its height', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.datumA,
          kind: 'datum',
          label: 'A',
          targets: [sc.bottom],
          presentation: presentation(0, -5, 0),
        },
        {
          annotationId: ID.projected,
          kind: 'tolerance',
          type: 'position',
          targets: [sc.bore],
          value: 0.1,
          diameter: true,
          projected: 15,
          datums: [{ label: 'A' }],
          presentation: presentation(25, 20, 10),
        },
      ]);
      expect(report.notes).toEqual([]);
      expect(text).toMatch(/PROJECTED_ZONE_DEFINITION/);
      expect(tolerance(pmi, ID.projected).projected).toBeCloseTo(15, 9);
      expect(tolerance(pmi, ID.projected).value).toBeCloseTo(0.1, 12);
      expect(pmi.issues).toEqual([]);
    });

    it('tolerance unequal: not writable by OCCT 8.0.1, written without it with a note', () => {
      const sc = scene();
      const { report, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.unequal,
          kind: 'tolerance',
          type: 'profileOfSurface',
          targets: [sc.front],
          value: 0.2,
          unequal: 0.05,
          presentation: presentation(5, 0, 5),
        },
      ]);
      expect(report.exported).toBe(1);
      expect(notesFor(report, ID.unequal)).toEqual([
        'OCCT 8.0.1 cannot write an unequally disposed zone: written without it (UZ 0.05)',
      ]);
      expect(tolerance(pmi, ID.unequal).unequal).toBeUndefined();
      expect(tolerance(pmi, ID.unequal).value).toBeCloseTo(0.2, 12);
    });

    it('tolerance all around: an all_around_shape_aspect, read back', () => {
      const sc = scene();
      const { report, text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.allAround,
          kind: 'tolerance',
          type: 'profileOfSurface',
          targets: [sc.left, sc.front, sc.right],
          value: 0.2,
          allAround: true,
          presentation: presentation(5, 0, 5),
        },
      ]);
      expect(report.notes).toEqual([]);
      expect(text).toMatch(/ALL_AROUND_SHAPE_ASPECT/);
      const t = tolerance(pmi, ID.allAround);
      expect(t.allAround).toBe(true);
      expect(t.targets).toHaveLength(3);
      expect(pmi.issues).toEqual([]);
    });

    it('presentation triangles: filled areas as complex_triangulated_surface_set', () => {
      const sc = scene();
      const prs = presentation(0, -10, 10);
      const triangles: PmiPresentation['triangles'] = [
        [0, -10, 10],
        [2, -10, 10],
        [1, -8, 10],
        [4, -10, 10],
        [6, -10, 10],
        [5, -8, 10],
      ];
      const { text, pmi } = roundTrip(sc.shapes, [
        {
          annotationId: ID.triangles,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [sc.left, sc.right],
          value: 40,
          presentation: { ...prs, triangles },
        },
      ]);
      expect(text).toMatch(/COMPLEX_TRIANGULATED_SURFACE_SET/);
      const read = dimension(pmi, ID.triangles).presentation;
      expect(read?.polylines).toHaveLength(1);
      expect(read?.triangles).toHaveLength(6);
      const key = (p: readonly number[]) => p.map((c) => c.toFixed(6)).join(',');
      // One triangle per three points; compare as sets of triangles (order-agnostic).
      const tris = (pts: readonly (readonly number[])[]) =>
        [0, 3]
          .map((i) =>
            pts
              .slice(i, i + 3)
              .map(key)
              .sort()
              .join(';'),
          )
          .sort();
      expect(tris(read?.triangles ?? [])).toEqual(tris(triangles));
      expect(pmi.issues).toEqual([]);
    });
  });
}
