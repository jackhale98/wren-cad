/**
 * M5a (ADR-100): the app's PMI reports and the STEP import step (annotations from the worker's
 * mapped PMI, one undo step, nothing dropped silently).
 */

import type { Annotation, Command, ImportFeature, WrenDoc } from '@wren-cad/contracts';
import type { ImportedPmi } from '@wren-cad/kernel-client';
import { describe, expect, it, vi } from 'vitest';
import {
  annotationLabel,
  exportReportUi,
  importReportUi,
  importStepPmi,
  unreadReportUi,
} from './pmi';
import type { PmiReportUi } from './state';
import type { Workbench } from './workbench';

vi.mock('../doc/drawing-support', () => ({ ensureDrawingSupport: async () => {} }));

const model = { kind: 'model' } as const;
const face = (name: string) => ({ name, kind: 'face' as const });
const dia: Annotation = {
  id: '01JD7A00000000000000000000',
  kind: 'diameter',
  origin: model,
  refs: [face('h')],
};
const datum: Annotation = {
  id: '01JDAT00000000000000000000',
  kind: 'datumFeature',
  origin: model,
  label: 'A',
  refs: [face('b')],
};
const frame: Annotation = {
  id: '01JFCF00000000000000000000',
  kind: 'geometricTolerance',
  origin: model,
  characteristic: 'surfaceProfile',
  zone: { value: '0.1 mm' },
  refs: [face('p')],
};

describe('report labels', () => {
  it('names annotations as the drawing shows them', () => {
    expect(annotationLabel(dia, dia.id, 6)).toBe('Diameter dimension Ø6');
    expect(annotationLabel(datum, datum.id)).toBe('Datum A');
    expect(annotationLabel(frame, frame.id)).toBe('Profile of a surface frame');
    expect(
      annotationLabel(
        { ...dia, kind: 'angle', refs: [face('a'), face('b')] } as Annotation,
        dia.id,
        Math.PI / 4,
      ),
    ).toBe('Angle dimension 45°');
    expect(annotationLabel(undefined, '01JXYZ0000000000000000ABCD')).toBe('Annotation 00ABCD');
  });

  it('export: exported n, every skipped one with its reason, notes', () => {
    const r = exportReportUi(
      [dia, datum, frame],
      { exported: 1, skipped: [{ annotationId: datum.id, reason: 'Needs attention' }] },
      [{ annotationId: dia.id, note: 'Written without a tolerance' }],
      new Map([[dia.id, 6]]),
    );
    expect(r).toMatchObject({
      kind: 'export',
      title: 'Exported 1 annotation as PMI (AP242)',
      summary: '1 not included · 1 note',
      entries: [
        { label: 'Datum A', reason: 'Needs attention', tone: 'skipped' },
        { label: 'Diameter dimension Ø6', reason: 'Written without a tolerance', tone: 'note' },
      ],
    });
    expect(exportReportUi([], { exported: 0, skipped: [] }).title).toBe(
      'No annotations were exported as PMI',
    );
  });

  it('import: imported n, skipped, presentation only and notes', () => {
    const r = importReportUi('ctc.step', [frame], {
      imported: [{ annotationId: frame.id, kind: 'geometricTolerance' }],
      presentationOnly: [{ name: 'Note 1' }],
      skipped: [{ name: 'GT2', reason: 'Value not read' }],
      notes: [{ annotationId: frame.id, note: 'Datum C is not defined' }],
    });
    expect(r.title).toBe('Imported 1 annotation from ctc.step');
    expect(r.summary).toBe('1 not imported · 1 presentation only · 1 to check');
    expect(r.entries.map((e) => [e.label, e.tone])).toEqual([
      ['GT2', 'skipped'],
      ['Note 1', 'skipped'],
      ['Profile of a surface frame', 'note'],
    ]);
  });

  it('a file whose PMI the kernel cannot read says so', () => {
    const r = unreadReportUi('ctc.step', {
      schemas: ['AP242'],
      dimensions: 12,
      tolerances: 6,
      datums: 3,
      presentation: 40,
    });
    expect(r.title).toMatch(/not imported/);
    expect(r.entries[0]?.reason).toMatch(
      /12 dimensions, 6 tolerances, 3 datums, 40 presentation items/,
    );
  });
});

// ---------------------------------------------------------------------------------------------

const feature: ImportFeature = {
  id: '01JIMP00000000000000000000',
  type: 'import',
  name: 'Import',
  suppressed: false,
  source: { path: 'imports/x.step', format: 'step', sha256: 'ab', fileName: 'x.step' },
  op: 'new',
};

function stubWb(pmi: ImportedPmi | null, existing: Annotation[] = []) {
  const applied: Command[] = [];
  let report: PmiReportUi | null = null;
  let commits = 0;
  const doc = { parts: [{ id: 'P', annotations: existing }] } as unknown as WrenDoc;
  const wb = {
    doc,
    whenLive: async () => true,
    modeling: {
      port: pmi ? { importedPmi: async () => ({ ok: true as const, value: pmi }) } : {},
    },
    apply: (c: Command) => {
      applied.push(c);
      return true;
    },
    commit: () => {
      commits++;
    },
    patchUi: (p: { pmiReport: PmiReportUi | null }) => {
      report = p.pmiReport;
    },
  } as unknown as Workbench;
  return { wb, applied, report: () => report, commits: () => commits };
}

const STEP_WITH_PMI = new TextEncoder().encode(
  "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#5=DIMENSIONAL_SIZE(#4,'diameter');\n#7=FLATNESS_TOLERANCE('',$,#8,#9);\n#9=DRAUGHTING_CALLOUT('',(#10));\nENDSEC;\n",
);
const STEP_PLAIN = new TextEncoder().encode(
  'ISO-10303-21;\nDATA;\n#1=CARTESIAN_POINT();\nENDSEC;\n',
);

describe('importing a STEP file’s PMI', () => {
  it('adds the annotations in one step, with origin import, and reports', async () => {
    const s = stubWb({
      featureId: feature.id,
      file: 'x.step',
      supported: true,
      entries: [
        {
          item: {
            annotationId: '01JD7A00000000000000000000',
            kind: 'dimension',
            type: 'linearDiameter',
            targets: [{ body: 0, kind: 'face', index: 3 }],
            value: 6,
          },
          refs: [{ name: `F${feature.id}:face#2`, kind: 'face' }],
        },
        {
          item: {
            annotationId: 'GT1',
            name: 'GT1',
            kind: 'tolerance',
            type: 'flatness',
            targets: [{ body: 0, kind: 'face', index: 9 }],
            value: 0.1,
          },
          refs: [{ reason: 'face 9 of body 1 is not in the imported shape' }],
        },
      ],
      issues: [{ name: 'DIM4', reason: 'Its value could not be read' }],
    });
    await importStepPmi(s.wb, 'P', feature, STEP_WITH_PMI);
    expect(s.applied).toEqual([
      {
        kind: 'addAnnotation',
        partId: 'P',
        annotation: {
          id: '01JD7A00000000000000000000',
          kind: 'diameter',
          origin: { kind: 'import', file: 'imports/x.step' },
          refs: [{ name: `F${feature.id}:face#2`, kind: 'face' }],
          nominal: '6 mm',
        },
      },
    ]);
    expect(s.commits()).toBe(1);
    expect(s.report()).toMatchObject({
      kind: 'import',
      title: 'Imported 1 annotation from x.step',
      entries: [
        { label: 'DIM4', reason: 'Its value could not be read', tone: 'skipped' },
        { label: 'GT1', reason: 'face 9 of body 1 is not in the imported shape', tone: 'skipped' },
      ],
    });
  });

  it('a kernel that reads no PMI: reports the file’s PMI, adds nothing', async () => {
    const s = stubWb({
      featureId: feature.id,
      file: 'x.step',
      supported: false,
      entries: [],
      issues: [],
    });
    await importStepPmi(s.wb, 'P', feature, STEP_WITH_PMI);
    expect(s.applied).toEqual([]);
    expect(s.report()?.title).toBe(
      'x.step has model dimensions and tolerances (PMI) that were not imported',
    );
    // Without the worker call at all (the main-thread fake engine), the same.
    const t = stubWb(null);
    await importStepPmi(t.wb, 'P', feature, STEP_WITH_PMI);
    expect(t.report()?.kind).toBe('import');
  });

  it('a file without PMI: no report', async () => {
    const s = stubWb({
      featureId: feature.id,
      file: 'x.step',
      supported: false,
      entries: [],
      issues: [],
    });
    await importStepPmi(s.wb, 'P', feature, STEP_PLAIN);
    expect(s.report()).toBeNull();
    expect(s.applied).toEqual([]);
  });
});
