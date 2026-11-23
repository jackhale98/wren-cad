/**
 * NIST MBE PMI test models through the real façade (`importFile` STEP, Node, real Wasm): imported
 * dimension, tolerance and datum counts, every issue by code and severity, and each item the
 * STEP-model reading recovers beyond OCCT 8.0.1's XCAF reader (ADR-100 amendment, 2026-11-23).
 * Recovered datums are checked against the faces of the annotation the file ties them to, not
 * against bare indices. Fixtures: packages/test-fixtures/step/nist (licence in its README).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import type { PmiTarget } from '@wren-cad/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  decodePmiImport,
  type KernelPmiImportItem,
  type KernelPmiImportResult,
  type RawImportResult,
  type WhittleKernelModule,
} from '../src/index';
import { loadVariant, ok, suiteTitle, VARIANTS, variantBuilt } from './helpers';

const fixtures = fileURLToPath(new URL('../../test-fixtures/step/nist/', import.meta.url));

const MODELS = {
  ctc01: 'nist_ctc_01_asme1_ap242-e1.stp.gz',
  ctc03: 'nist_ctc_03_asme1_ap242-e2.stp.gz',
  ctc05: 'nist_ctc_05_asme1_ap242-e1.stp.gz',
  stc06: 'nist_stc_06_asme1_ap242-e3.stp.gz',
} as const;

type Model = keyof typeof MODELS;

const key = (targets: readonly PmiTarget[]) =>
  targets
    .map((t) => `${t.body}:${t.kind}:${t.index}`)
    .sort()
    .join(' ');

for (const { variant } of VARIANTS) {
  describe.skipIf(!variantBuilt(variant))(suiteTitle('NIST PMI models', variant), () => {
    let k: WhittleKernelModule;
    let baseline = 0;
    const read = new Map<Model, KernelPmiImportResult>();

    beforeAll(async () => {
      k = await loadVariant(variant);
      baseline = k.liveHandleCount();
      for (const model of Object.keys(MODELS) as Model[]) {
        const path = `/tmp/nist-${model}.stp`;
        k.FS.writeFile(path, gunzipSync(readFileSync(`${fixtures}${MODELS[model]}`)));
        try {
          const r = ok<RawImportResult>(k.importFile(path, 'step'));
          const pmi = decodePmiImport(r.pmi, r.bodies.length);
          if (!pmi.ok) throw new Error(JSON.stringify(pmi.error));
          read.set(model, pmi.value);
          for (const b of r.bodies) k.release(b.shape);
        } finally {
          k.FS.unlink(path);
        }
      }
    }, 120_000);

    afterAll(() => {
      if (k) expect(k.liveHandleCount()).toBe(baseline);
    });

    const pmiOf = (model: Model): KernelPmiImportResult => {
      const pmi = read.get(model);
      if (pmi === undefined) throw new Error(`${model} not read`);
      return pmi;
    };
    const counts = (pmi: KernelPmiImportResult) => ({
      dimensions: pmi.items.filter((i) => i.kind === 'dimension').length,
      tolerances: pmi.items.filter((i) => i.kind === 'tolerance').length,
      datums: pmi.items.filter((i) => i.kind === 'datum').length,
    });
    /** Issues as `code severity name`, sorted. */
    const issues = (pmi: KernelPmiImportResult) =>
      pmi.issues.map((i) => `${i.code} ${i.severity} ${i.name ?? ''}`.trim()).sort();
    /** The semantic item of that name (presentation-only items may share it). */
    const item = (pmi: KernelPmiImportResult, name: string): KernelPmiImportItem => {
      const hits = pmi.items.filter((i) => i.name === name && i.kind !== 'presentationOnly');
      expect(hits, name).toHaveLength(1);
      const hit = hits[0];
      if (hit === undefined) throw new Error(`${name} not imported`);
      return hit;
    };
    const datum = (pmi: KernelPmiImportResult, label: string) => {
      const hits = pmi.items.filter(
        (i): i is Extract<KernelPmiImportItem, { kind: 'datum' }> =>
          i.kind === 'datum' && i.label === label,
      );
      expect(hits, `datum ${label}`).toHaveLength(1);
      const hit = hits[0];
      if (hit === undefined) throw new Error(`datum ${label} not imported`);
      return hit;
    };
    const targetsOf = (i: KernelPmiImportItem) => (i.kind === 'presentationOnly' ? [] : i.targets);

    it('every issue has a code and a severity; filled areas come in as triangles', () => {
      for (const model of Object.keys(MODELS) as Model[]) {
        const pmi = pmiOf(model);
        for (const i of pmi.issues) {
          expect(i.code, `${model}: ${i.reason}`).toMatch(/^[a-z][A-Za-z]+$/);
          expect(['lost', 'approximated', 'cosmetic']).toContain(i.severity);
        }
        expect(pmi.issues.some((i) => i.code === 'filledPresentation')).toBe(false);
      }
      // The first model draws its arrowheads and text filled.
      const filled = pmiOf('ctc01').items.filter(
        (i) =>
          (i.kind === 'presentationOnly' ||
            i.kind === 'datum' ||
            i.kind === 'dimension' ||
            i.kind === 'tolerance') &&
          (i.presentation?.triangles?.length ?? 0) > 0,
      );
      expect(filled.length).toBeGreaterThan(20);
      for (const i of filled) expect((i.presentation?.triangles?.length ?? 0) % 3).toBe(0);
    });

    it(`${MODELS.ctc01}: 8 dimensions, 6 tolerances, 3 datums; 4 dimensions without a value`, () => {
      const pmi = pmiOf('ctc01');
      expect(counts(pmi)).toEqual({ dimensions: 8, tolerances: 6, datums: 3 });
      expect(pmi.items.filter((i) => i.kind === 'presentationOnly')).toHaveLength(9);
      expect(issues(pmi)).toEqual([
        'noValue lost Linear Size.10',
        'noValue lost Linear Size.11',
        'noValue lost Linear Size.5',
        'noValue lost Linear Size.6',
      ]);
      // Datums B and C: their datum features name the faces through an
      // item_identified_representation_usage of a SET_REPRESENTATION_ITEM (OCCT drops it); they
      // are the bores Linear Size.1 and .2 dimension.
      expect(key(datum(pmi, 'B').targets)).toBe(key(targetsOf(item(pmi, 'Linear Size.1'))));
      expect(key(datum(pmi, 'C').targets)).toBe(key(targetsOf(item(pmi, 'Linear Size.2'))));
      expect(datum(pmi, 'B').name).toBe('Simple Datum.2');
      expect(datum(pmi, 'B').presentation?.polylines.length).toBeGreaterThan(0);
      expect(key(datum(pmi, 'A').targets)).toBe(key(targetsOf(item(pmi, 'Flatness.1'))));
      // All around (ALL_AROUND_SHAPE_ASPECT), formerly an unread modifier.
      const profile = item(pmi, 'Position surfacic profile.2');
      expect(profile).toMatchObject({
        kind: 'tolerance',
        type: 'profileOfSurface',
        allAround: true,
      });
      expect(targetsOf(profile)).toHaveLength(6);
    });

    it(`${MODELS.ctc03}: 9 dimensions, 13 tolerances, 6 datums; datums by usage, presentation and attachment`, () => {
      const pmi = pmiOf('ctc03');
      expect(counts(pmi)).toEqual({ dimensions: 9, tolerances: 13, datums: 6 });
      expect(issues(pmi)).toEqual([
        'noValue lost Linear Size.10',
        'unsupportedEntity approximated Flatness.1',
      ]);
      // A, B, C, F: the datum feature's own usage (a SET_REPRESENTATION_ITEM).
      expect(key(datum(pmi, 'A').targets)).toBe(
        key(targetsOf(item(pmi, 'Profile tolerance of any surface.2'))),
      );
      expect(key(datum(pmi, 'B').targets)).toBe(key(targetsOf(item(pmi, 'Linear Size.1'))));
      expect(key(datum(pmi, 'C').targets)).toBe(key(targetsOf(item(pmi, 'Linear Size.2'))));
      // F is referenced by no tolerance: read from the file alone, presentation included.
      const f = datum(pmi, 'F');
      expect(key(f.targets)).toBe(key(targetsOf(item(pmi, 'Linear Size.3'))));
      expect(f.name).toBe('Simple Datum.6');
      expect(f.presentation?.polylines.length).toBeGreaterThan(0);
      // D and E have no geometry of their own: the symbol is attached to a frame
      // (DRAUGHTING_CALLOUT_RELATIONSHIP) and a 'DATUM' shape aspect on its callout agrees.
      expect(key(datum(pmi, 'D').targets)).toBe(
        key(targetsOf(item(pmi, 'Position surfacic profile.1'))),
      );
      expect(key(datum(pmi, 'E').targets)).toBe(
        key(targetsOf(item(pmi, 'Position surfacic profile.2'))),
      );
      expect(datum(pmi, 'E').presentation?.polylines.length).toBeGreaterThan(0);
      // A reference dimension (dimensional note 'auxiliary').
      expect(item(pmi, 'Linear Size.11')).toMatchObject({
        kind: 'dimension',
        qualifier: 'reference',
      });
      // The per-unit-area flatness is a complex entity OCCT has no class for: read from the
      // entity (0.005 in), approximated without its per-unit refinement.
      const flatness = item(pmi, 'Flatness.1');
      expect(flatness).toMatchObject({ kind: 'tolerance', type: 'flatness' });
      if (flatness.kind === 'tolerance') expect(flatness.value).toBeCloseTo(0.127, 12);
      expect(key(targetsOf(flatness))).toBe(key(targetsOf(item(pmi, 'Angularity.1'))));
      expect(pmi.issues.find((i) => i.name === 'Flatness.1')?.reason).toMatch(
        /^flatness tolerance read from the STEP entity without its defined area unit/,
      );
    });

    it(`${MODELS.ctc05}: 2 dimensions, 9 tolerances, 2 datums; supplemental geometry and datum targets stay lost`, () => {
      const pmi = pmiOf('ctc05');
      expect(counts(pmi)).toEqual({ dimensions: 2, tolerances: 9, datums: 2 });
      expect(issues(pmi)).toEqual([
        'datumTarget lost C',
        'datumTarget lost D',
        'dimensionModifier approximated Horizontal Dimension (8)',
        'supplementalGeometry lost Feature Control Frame (11)',
        'supplementalGeometry lost Horizontal Dimension (35)',
        'supplementalGeometry lost Horizontal Dimension (39)',
        'supplementalGeometry lost Vertical Dimension (37)',
        'supplementalGeometry lost Vertical Dimension (41)',
      ]);
      // The lines these apply to are a GEOMETRIC_CURVE_SET beside the solid, not its edges.
      for (const i of pmi.issues.filter((x) => x.code === 'supplementalGeometry')) {
        expect(i.reason).toMatch(/applies to supplemental geometry \(an edge /);
      }
      // The statistical modifier sits in a COMPOUND_REPRESENTATION_ITEM whose typed set OCCT drops.
      expect(pmi.issues.find((i) => i.name === 'Horizontal Dimension (8)')?.reason).toBe(
        'dimension modifiers not imported: statistical',
      );
      expect(pmi.issues.find((i) => i.name === 'C')?.reason).toBe(
        'datum C not imported: it is defined by datum targets (C1), which need their own annotation kind',
      );
      // Frames referencing C and D keep the letters (the app binds or flags them).
      const refs = pmi.items.flatMap((i) => (i.kind === 'tolerance' ? (i.datums ?? []) : []));
      expect(refs.map((r) => r.label)).toEqual(expect.arrayContaining(['C', 'D']));
    });

    it(`${MODELS.stc06}: 17 dimensions, 25 tolerances, 6 datums, nothing lost; spherical sizes and zone`, () => {
      const pmi = pmiOf('stc06');
      expect(counts(pmi)).toEqual({ dimensions: 17, tolerances: 25, datums: 6 });
      expect(issues(pmi)).toEqual(['dimensionModifier approximated Radial Dimension (8)']);
      expect(pmi.issues[0]?.reason).toBe('dimension modifiers not imported: controlled radius');
      expect(item(pmi, 'Radial Dimension (5)')).toMatchObject({
        type: 'linearRadius',
        spherical: true,
        qualifier: 'reference',
      });
      expect(item(pmi, 'Diameter Dimension (10)')).toMatchObject({
        type: 'linearDiameter',
        spherical: true,
      });
      expect(item(pmi, 'Feature Control Frame (19)')).toMatchObject({
        type: 'position',
        diameter: true,
        spherical: true,
      });
    });
  });
}
