/**
 * M5 (ADR-100) golden tests: STEP AP242 PMI written with `exportStepPmi` and read back with
 * `importFile` (Node, real Wasm). A 40×30×10 plate with a Ø10 through hole carries a linear
 * distance with +0.2/−0.1, a Ø10 H7 diameter, datum A on the bottom face and a position
 * tolerance Ø0.1 Ⓜ relative to A, each with presentation polylines. The round trip must keep
 * counts, types, values, deviations, the fit, datum labels and references, the faces (compared
 * by fingerprint, not by index alone), the names (annotation ids) and the presentation.
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
  type KernelPmiImportItem,
  type KernelPmiImportResult,
  type RawImportResult,
  type RawPmiExportResult,
  type WhittleKernelModule,
} from '../src/index';
import {
  circle,
  err,
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

const SK = '01JSKETCH0000000000000PMI1';
const EX = '01JEXTRUDE000000000000PMI2';
const ID = {
  width: '01JANNWIDTH00000000000PMI3',
  bore: '01JANNBORE000000000000PMI4',
  datumA: '01JANNDATUMA0000000000PMI5',
  position: '01JANNPOSITION00000000PMI6',
  missingFace: '01JANNMISSING000000000PMI7',
  missingDatum: '01JANNNODATUM000000000PMI8',
  other: '01JANNOTHER00000000000PMI9',
};

/** A little stroked "frame" on a plane: a closed box plus one leader. */
function presentation(
  origin: [number, number, number],
  normal: [number, number, number],
): PmiPresentation {
  const [ox, oy, oz] = origin;
  const x: [number, number, number] = normal[2] !== 0 ? [1, 0, 0] : [0, 0, 1];
  // Points in the plane spanned by x and normal × x.
  const y: [number, number, number] = [
    normal[1] * x[2] - normal[2] * x[1],
    normal[2] * x[0] - normal[0] * x[2],
    normal[0] * x[1] - normal[1] * x[0],
  ];
  const at = (u: number, v: number): [number, number, number] => [
    ox + u * x[0] + v * y[0],
    oy + u * x[1] + v * y[1],
    oz + u * x[2] + v * y[2],
  ];
  return {
    plane: { origin, x, normal },
    polylines: [
      [at(0, 0), at(8, 0), at(8, 3), at(0, 3), at(0, 0)],
      [at(8, 1.5), at(12, 4)],
    ],
  };
}

type Fp = ShapeFingerprints['faces'][number];

function expectSameFace(a: Fp | undefined, b: Fp | undefined): void {
  expect(a).toBeDefined();
  expect(b).toBeDefined();
  if (a === undefined || b === undefined) return;
  expect(b.surface).toBe(a.surface);
  expect(b.area).toBeCloseTo(a.area, 6);
  vecClose(b.centroid, a.centroid, 1e-6);
}

function expectSamePresentation(read: PmiPresentation | undefined, written: PmiPresentation): void {
  expect(read).toBeDefined();
  if (read === undefined) return;
  vecClose(read.plane.normal, written.plane.normal, 1e-9);
  vecClose(read.plane.x, written.plane.x, 1e-9);
  vecClose(read.plane.origin, written.plane.origin, 1e-6);
  expect(read.polylines.length).toBe(written.polylines.length);
  // The reader keeps strip order; compare as sets of polylines to stay order-agnostic.
  const key = (line: readonly (readonly number[])[]) =>
    line.map((p) => p.map((c) => c.toFixed(5)).join(',')).join(';');
  expect(read.polylines.map(key).sort()).toEqual(written.polylines.map(key).sort());
}

for (const { variant } of VARIANTS) {
  describe.skipIf(!variantBuilt(variant))(suiteTitle('STEP AP242 PMI', variant), () => {
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

    const session = () => {
      s = new Session(k);
      return s;
    };

    /** 40×30×10 plate, Ø10 hole at (20, 15). */
    const plate = (ss: Session) => {
      const sk = ss.exec(
        sketch(SK, [...rect(0, 0, 40, 30), ...circle('C1', 20, 15, 5)]),
        sketchInputs(),
      );
      return ss.exec(extrude(EX), {
        values: { '/end/depth': 10 },
        refs: profileRefs(sk.shape, [indexOf(sk, `S${SK}:region(L1,L2,L3,L4|C1)`, 'face')]),
      });
    };

    /** 1-based TopExp face index of the only face matching `pick`. */
    const faceWhere = (fp: ShapeFingerprints, pick: (f: Fp) => boolean): number => {
      const hits = fp.faces.flatMap((f, i) => (pick(f) ? [i + 1] : []));
      expect(hits).toHaveLength(1);
      return hits[0] ?? 0;
    };

    const exportPmi = (
      shapes: unknown[],
      items: PmiExportItem[],
      options: object = { stepSchema: 'AP242' },
    ): { result: RawPmiExportResult; text: string; bytes: Uint8Array } => {
      if (k.exportStepPmi === undefined) throw new Error('kernel build lacks exportStepPmi');
      const result = ok<RawPmiExportResult>(
        k.exportStepPmi(
          JSON.stringify(shapes),
          encodePmiExportItems(items),
          JSON.stringify(options),
        ),
      );
      expect(result.files).toHaveLength(1);
      const bytes = k.FS.readFile(result.path, { encoding: 'binary' }).slice();
      k.FS.unlink(result.path);
      return { result, text: new TextDecoder().decode(bytes), bytes };
    };

    let importCounter = 0;
    const importStep = (bytes: Uint8Array): RawImportResult => {
      const path = `/tmp/test-pmi-${++importCounter}.step`;
      k.FS.writeFile(path, bytes);
      try {
        const r = ok<RawImportResult>(k.importFile(path, 'step'));
        for (const b of r.bodies) s.handles.push(b.shape);
        return r;
      } finally {
        k.FS.unlink(path);
      }
    };

    const decodeImport = (r: RawImportResult): KernelPmiImportResult => {
      const d = decodePmiImport(r.pmi, r.bodies.length);
      if (!d.ok) throw new Error(JSON.stringify(d.error));
      return d.value;
    };

    const byKind = <K extends KernelPmiImportItem['kind']>(items: KernelPmiImportItem[], kind: K) =>
      items.filter((i): i is Extract<KernelPmiImportItem, { kind: K }> => i.kind === kind);

    /** The plate, its fingerprints and the four annotations (plus three that must be skipped). */
    const scenario = (ss: Session) => {
      const body = plate(ss);
      const fp = ss.fingerprints(body.shape);
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
      const face = (pick: (f: Fp) => boolean): PmiTarget => ({
        body: 0,
        kind: 'face',
        index: faceWhere(fp, pick),
      });
      const left = face((f) => f.surface === 'plane' && near(f.centroid[0], 0));
      const right = face((f) => f.surface === 'plane' && near(f.centroid[0], 40));
      const bottom = face((f) => f.surface === 'plane' && near(f.centroid[2], 0));
      const bore = face((f) => f.surface === 'cylinder');
      const prs = {
        width: presentation([0, -10, 10], [0, 0, 1]),
        bore: presentation([20, 15, 12], [0, 0, 1]),
        datumA: presentation([0, -5, 0], [0, -1, 0]),
        position: presentation([25, 20, 10], [0, 0, 1]),
      };
      const items: PmiExportItem[] = [
        {
          annotationId: ID.width,
          kind: 'dimension',
          type: 'linearDistance',
          targets: [left, right],
          value: 40,
          tolerance: { kind: 'deviation', upper: 0.2, lower: -0.1 },
          presentation: prs.width,
        },
        {
          annotationId: ID.bore,
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [bore],
          value: 10,
          tolerance: { kind: 'fit', hole: 'H7' },
          presentation: prs.bore,
        },
        // Listed after the tolerance that uses it: the façade orders datums first itself.
        {
          annotationId: ID.position,
          kind: 'tolerance',
          type: 'position',
          targets: [bore],
          value: 0.1,
          diameter: true,
          material: 'M',
          datums: [{ label: 'A' }],
          presentation: prs.position,
        },
        {
          annotationId: ID.datumA,
          kind: 'datum',
          label: 'A',
          targets: [bottom],
          presentation: prs.datumA,
        },
        {
          annotationId: ID.missingFace,
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [{ body: 0, kind: 'face', index: 999 }],
          value: 10,
        },
        {
          annotationId: ID.missingDatum,
          kind: 'tolerance',
          type: 'perpendicularity',
          targets: [bore],
          value: 0.05,
          datums: [{ label: 'B' }],
        },
        {
          annotationId: ID.other,
          kind: 'dimension',
          type: 'other',
          targets: [left],
          value: 1,
        },
      ];
      return { body, fp, left, right, bottom, bore, prs, items };
    };

    it('exports AP242 semantic + presentation PMI and reports what it skips', () => {
      const ss = session();
      const { body, items } = scenario(ss);
      const { result, text } = exportPmi([{ shape: body.shape, name: 'Plate' }], items);
      const report = decodePmiExportReport(result.pmi);
      expect(report.ok).toBe(true);
      if (!report.ok) return;
      expect(report.value.exported).toBe(4);
      expect(report.value.notes).toEqual([]);
      const reasons = new Map(report.value.skipped.map((x) => [x.annotationId, x.reason]));
      expect([...reasons.keys()].sort()).toEqual(
        [ID.missingDatum, ID.missingFace, ID.other].sort(),
      );
      expect(reasons.get(ID.missingFace)).toMatch(/unresolved target: face 999/);
      expect(reasons.get(ID.missingDatum)).toMatch(/datum B/);
      expect(reasons.get(ID.other)).toMatch(/unsupported dimension type 'other'/);

      expect(text).toMatch(/AP242_MANAGED_MODEL_BASED_3D_ENGINEERING/);
      expect(text).toMatch(/DIMENSIONAL_LOCATION\('linear distance'/);
      expect(text).toMatch(/DIMENSIONAL_SIZE\(#\d+,'diameter'\)/);
      expect(text).toMatch(/POSITION_TOLERANCE/);
      expect(text).toMatch(/DATUM_FEATURE/);
      // ISO grade 7 as such (OCCT 8.0.1 alone would write '9', see fixWrittenFitGrades).
      expect(text).toMatch(/LIMITS_AND_FITS\('H','hole','7',''\)/);
      expect(text).toMatch(/PLUS_MINUS_TOLERANCE/);
      expect(text).toMatch(/TESSELLATED_CURVE_SET/);
      expect(text).toMatch(/ANNOTATION_PLANE/);
      // Annotation ids as entity names (presentation callouts and shape aspects).
      for (const id of [ID.width, ID.bore, ID.datumA, ID.position]) {
        expect(text).toContain(`DRAUGHTING_CALLOUT('${id}'`);
      }
      expect(text).not.toContain(ID.missingFace);
    });

    it('round-trips counts, types, values, deviations, fit, datums, faces, names, presentation', () => {
      const ss = session();
      const sc = scenario(ss);
      const { bytes } = exportPmi([{ shape: sc.body.shape, name: 'Plate' }], sc.items);
      const imported = importStep(bytes);
      expect(imported.bodies).toHaveLength(1);
      expect(imported.bodies[0]?.name).toBe('Plate');
      const pmi = decodeImport(imported);
      expect(pmi.issues).toEqual([]);
      expect(pmi.counts[0]?.faces).toBe(sc.fp.faces.length);

      const dims = byKind(pmi.items, 'dimension');
      const datums = byKind(pmi.items, 'datum');
      const tols = byKind(pmi.items, 'tolerance');
      expect(dims).toHaveLength(2);
      expect(datums).toHaveLength(1);
      expect(tols).toHaveLength(1);
      expect(byKind(pmi.items, 'presentationOnly')).toHaveLength(0);
      expect(pmi.items).toHaveLength(4);

      const fpIn = ss.fingerprints(imported.bodies[0]?.shape ?? 0);
      const sameFaces = (read: PmiTarget[], written: PmiTarget[]) => {
        expect(read).toHaveLength(written.length);
        // Geometry, not index alone: the importer could renumber faces.
        const fps = (t: PmiTarget[], fp: ShapeFingerprints) =>
          t
            .map((x) => fp.faces[x.index - 1])
            .sort((a, b) => (a?.centroid ?? []).join().localeCompare((b?.centroid ?? []).join()));
        const a = fps(written, sc.fp);
        const b = fps(read, fpIn);
        for (let i = 0; i < a.length; i++) expectSameFace(a[i], b[i]);
        for (const t of read) expect(t).toMatchObject({ body: 0, kind: 'face' });
      };

      const width = dims.find((d) => d.type === 'linearDistance');
      expect(width?.name).toBe(ID.width);
      expect(width?.value).toBeCloseTo(40, 9);
      expect(width?.tolerance?.kind).toBe('deviation');
      if (width?.tolerance?.kind === 'deviation') {
        expect(width.tolerance.upper).toBeCloseTo(0.2, 9);
        expect(width.tolerance.lower).toBeCloseTo(-0.1, 9);
      }
      sameFaces(width?.targets ?? [], [sc.left, sc.right]);
      expectSamePresentation(width?.presentation, sc.prs.width);

      const bore = dims.find((d) => d.type === 'linearDiameter');
      expect(bore?.name).toBe(ID.bore);
      expect(bore?.value).toBeCloseTo(10, 9);
      expect(bore?.tolerance).toEqual({ kind: 'fit', hole: 'H7' });
      sameFaces(bore?.targets ?? [], [sc.bore]);
      expectSamePresentation(bore?.presentation, sc.prs.bore);

      const a = datums[0];
      expect(a?.label).toBe('A');
      expect(a?.name).toBe(ID.datumA);
      sameFaces(a?.targets ?? [], [sc.bottom]);
      expectSamePresentation(a?.presentation, sc.prs.datumA);

      const pos = tols[0];
      expect(pos?.type).toBe('position');
      expect(pos?.name).toBe(ID.position);
      expect(pos?.value).toBeCloseTo(0.1, 9);
      expect(pos?.diameter).toBe(true);
      expect(pos?.material).toBe('M');
      expect(pos?.datums).toEqual([{ label: 'A' }]);
      sameFaces(pos?.targets ?? [], [sc.bore]);
      expectSamePresentation(pos?.presentation, sc.prs.position);
    });

    it('angles in radians, shaft and hole+shaft fits, presentation left out', () => {
      const ss = session();
      const sc = scenario(ss);
      const top = faceWhere(
        sc.fp,
        (f) => f.surface === 'plane' && Math.abs(f.centroid[2] - 10) < 1e-6,
      );
      const items: PmiExportItem[] = [
        {
          annotationId: '01JANNANGLE00000000000PMIA',
          kind: 'dimension',
          type: 'angular',
          targets: [sc.left, { body: 0, kind: 'face', index: top }],
          value: Math.PI / 2,
          tolerance: { kind: 'deviation', upper: 0.01, lower: -0.01 },
          presentation: sc.prs.width,
        },
        {
          annotationId: '01JANNFLAT000000000000PMIB',
          kind: 'tolerance',
          type: 'flatness',
          targets: [{ body: 0, kind: 'face', index: top }],
          value: 0.05,
          presentation: sc.prs.position,
        },
        {
          annotationId: '01JANNSHAFT00000000000PMIC',
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [sc.bore],
          value: 10,
          tolerance: { kind: 'fit', shaft: 'js6' },
        },
        {
          annotationId: '01JANNBOTH000000000000PMID',
          kind: 'dimension',
          type: 'linearDiameter',
          targets: [sc.bore],
          value: 10,
          tolerance: { kind: 'fit', hole: 'H8', shaft: 'f7' },
        },
      ];
      const { result, text } = exportPmi([{ shape: sc.body.shape, name: 'Plate' }], items, {
        stepSchema: 'AP242',
        pmi: { presentation: false },
      });
      const report = decodePmiExportReport(result.pmi);
      expect(report.ok && report.value.exported).toBe(4);
      // STEP holds one class per dimension: the bore is a hole, so H8 is kept and that is noted.
      expect(report.ok && report.value.notes).toEqual([
        {
          annotationId: '01JANNBOTH000000000000PMID',
          note: 'STEP holds one class of tolerance per dimension: wrote H8, not f7',
        },
      ]);
      expect(text).not.toMatch(/TESSELLATED_CURVE_SET/);
      expect(text).toMatch(/FLATNESS_TOLERANCE/);
      expect(text).toMatch(/LIMITS_AND_FITS\('js','shaft','6',''\)/);
      expect(text).toMatch(/LIMITS_AND_FITS\('H','hole','8',''\)/);
      const pmi = decodeImport(importStep(new TextEncoder().encode(text)));
      const fits = byKind(pmi.items, 'dimension')
        .filter((d) => d.type === 'linearDiameter')
        .map((d) => d.tolerance);
      expect(fits).toEqual([
        { kind: 'fit', shaft: 'js6' },
        { kind: 'fit', hole: 'H8' },
      ]);
      const angle = byKind(pmi.items, 'dimension').find((d) => d.type === 'angular');
      expect(angle?.type).toBe('angular');
      expect(angle?.value).toBeCloseTo(Math.PI / 2, 9);
      if (angle?.tolerance?.kind === 'deviation') {
        expect(angle.tolerance.upper).toBeCloseTo(0.01, 9);
        expect(angle.tolerance.lower).toBeCloseTo(-0.01, 9);
      } else {
        throw new Error('angular deviation lost');
      }
      expect(angle?.presentation).toBeUndefined();
      const flat = byKind(pmi.items, 'tolerance')[0];
      expect(flat?.type).toBe('flatness');
      expect(flat?.value).toBeCloseTo(0.05, 9);
      expect(flat?.datums).toBeUndefined();
      expect(flat?.presentation).toBeUndefined();
    });

    it('a STEP file without PMI imports without a pmi member; bad input is INVALID_INPUT', () => {
      const ss = session();
      const body = plate(ss);
      const shapes = JSON.stringify([{ shape: body.shape, name: 'Plate' }]);
      const plain = ok<{ path: string }>(k.exportShapes(shapes, 'step', '{"stepSchema":"AP242"}'));
      const bytes = k.FS.readFile(plain.path, { encoding: 'binary' }).slice();
      k.FS.unlink(plain.path);
      expect(importStep(bytes).pmi).toBeUndefined();

      const call = (pmiJson: string, options = '{}') => {
        if (k.exportStepPmi === undefined) throw new Error('kernel build lacks exportStepPmi');
        return k.exportStepPmi(shapes, pmiJson, options);
      };
      expect(err(call('[]', '{"stepSchema":"AP214"}')).code).toBe('INVALID_INPUT');
      expect(err(call('{}')).code).toBe('INVALID_INPUT');
      expect(err(call('not json')).code).toBe('INVALID_INPUT');
      expect(err(call('[{"kind":"datum","label":"A","targets":[]}]')).code).toBe('INVALID_INPUT');
      expect(err(k.exportStepPmi?.('[{"shape":424242,"name":"x"}]', '[]', '{}') ?? '').code).toBe(
        'INVALID_HANDLE',
      );
      // An empty item list still writes AP242 (no schema option needed).
      const empty = ok<RawPmiExportResult>(call('[]'));
      k.FS.unlink(empty.path);
      expect(decodePmiExportReport(empty.pmi)).toEqual({
        ok: true,
        value: { exported: 0, skipped: [], notes: [] },
      });
    });
  });
}
