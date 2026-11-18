/**
 * M5a (ADR-100): STEP AP242 PMI in the app. Lazy (loaded after a PMI export or a STEP import),
 * so nothing here is on the initial route.
 *
 * - After an export with PMI: the report (exported n, each one left out with its reason) as the
 *   non-modal `PmiReport` in the viewport.
 * - After a STEP import: the PMI the kernel read, mapped by the worker to the import feature's
 *   face and edge names (`importedPmi`), becomes part annotations (`origin: import`) in one undo
 *   step, and the report lists what was not imported. When the kernel build reads no PMI but the
 *   file has some (`stepPmiCensus`), the report says so: nothing is dropped silently.
 */

import type {
  Annotation,
  Id,
  ImportFeature,
  PmiExportReport,
  RegenResult,
} from '@wren-cad/contracts';
import { ulid } from '@wren-cad/document';
import {
  annotationKindName,
  annotationsFromPmi,
  hasStepPmi,
  type PmiImportReport,
  type StepPmiCensus,
  stepPmiCensus,
} from '@wren-cad/io/pmi';
import { ensureDrawingSupport } from '../doc/drawing-support';
import type { PmiReportUi } from './state';
import type { Workbench } from './workbench';

let seq = 0;

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const CHARACTERISTIC: Record<string, string> = {
  lineProfile: 'profile of a line',
  surfaceProfile: 'profile of a surface',
  circularRunout: 'circular runout',
  totalRunout: 'total runout',
};

/** "Linear dimension 80", "Diameter dimension Ø6", "Datum A", "Position frame". */
export function annotationLabel(a: Annotation | undefined, id: Id, value?: number): string {
  if (!a) return `Annotation ${id.slice(-6)}`;
  if (a.kind === 'datumFeature') return `Datum ${a.label}`;
  if (a.kind === 'geometricTolerance') {
    return `${capital(CHARACTERISTIC[a.characteristic] ?? a.characteristic)} frame`;
  }
  const name = capital(annotationKindName(a.kind));
  if (value === undefined || !Number.isFinite(value)) return name;
  if (a.kind === 'angle') return `${name} ${Number(((value * 180) / Math.PI).toFixed(2))}°`;
  const n = Number(value.toFixed(3));
  if (a.kind === 'diameter') return `${name} Ø${n}`;
  if (a.kind === 'radius') return `${name} R${n}`;
  return `${name} ${n}`;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The export report as the overlay shows it. */
export function exportReportUi(
  annotations: readonly Annotation[],
  report: PmiExportReport,
  notes: readonly { annotationId: Id; note: string }[] = [],
  values: ReadonlyMap<Id, number> = new Map(),
): PmiReportUi {
  const byId = new Map(annotations.map((a) => [a.id, a]));
  const label = (id: Id) => annotationLabel(byId.get(id), id, values.get(id));
  const parts = [
    report.skipped.length > 0 ? `${report.skipped.length} not included` : null,
    notes.length > 0 ? `${plural(notes.length, 'note')}` : null,
  ].filter((x): x is string => x !== null);
  return {
    id: ++seq,
    kind: 'export',
    title:
      report.exported === 0
        ? 'No annotations were exported as PMI'
        : `Exported ${plural(report.exported, 'annotation')} as PMI (AP242)`,
    ...(parts.length > 0 ? { summary: parts.join(' · ') } : {}),
    entries: [
      ...report.skipped.map((s) => ({
        label: label(s.annotationId),
        reason: s.reason,
        tone: 'skipped' as const,
      })),
      ...notes.map((n) => ({
        label: label(n.annotationId),
        reason: n.note,
        tone: 'note' as const,
      })),
    ],
  };
}

/** The import report as the overlay shows it. */
export function importReportUi(
  file: string,
  annotations: readonly Annotation[],
  report: PmiImportReport,
): PmiReportUi {
  const byId = new Map(annotations.map((a) => [a.id, a]));
  const parts = [
    report.skipped.length > 0 ? `${report.skipped.length} not imported` : null,
    report.presentationOnly.length > 0
      ? `${report.presentationOnly.length} presentation only`
      : null,
    report.notes.length > 0 ? plural(report.notes.length, 'to check', 'to check') : null,
  ].filter((x): x is string => x !== null);
  return {
    id: ++seq,
    kind: 'import',
    title:
      report.imported.length === 0
        ? `No annotations were imported from ${file}`
        : `Imported ${plural(report.imported.length, 'annotation')} from ${file}`,
    ...(parts.length > 0 ? { summary: parts.join(' · ') } : {}),
    entries: [
      ...report.skipped.map((s) => ({
        label: s.name ?? 'Unnamed entity',
        reason: s.reason,
        tone: 'skipped' as const,
      })),
      ...report.presentationOnly.map((p) => ({
        label: p.name ?? 'Unnamed annotation',
        reason: 'Presentation only (no semantics): shown in 3D once MBD display lands (M5b)',
        tone: 'skipped' as const,
      })),
      ...report.notes.map((n) => ({
        label: annotationLabel(byId.get(n.annotationId), n.annotationId),
        reason: n.note,
        tone: 'note' as const,
      })),
    ],
  };
}

/** A file with PMI that this kernel build cannot read: say so, with what the file has. */
export function unreadReportUi(file: string, c: StepPmiCensus): PmiReportUi {
  const what = [
    c.dimensions > 0 ? plural(c.dimensions, 'dimension') : null,
    c.tolerances > 0 ? plural(c.tolerances, 'tolerance') : null,
    c.datums > 0 ? plural(c.datums, 'datum') : null,
    c.presentation > 0 ? plural(c.presentation, 'presentation item') : null,
  ].filter((x): x is string => x !== null);
  return {
    id: ++seq,
    kind: 'import',
    title: `${file} has model dimensions and tolerances (PMI) that were not imported`,
    summary: 'The geometry was imported.',
    entries: [
      {
        label: 'PMI in the file',
        reason: `${what.join(', ')} (STEP entities). This version of Wren's geometry kernel cannot read PMI yet.`,
        tone: 'skipped',
      },
    ],
  };
}

/** The values the latest regen shows, for report labels. */
export function resolutionValues(result: RegenResult | undefined): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const r of result?.annotations ?? [])
    if (r.value !== undefined) out.set(r.annotationId, r.value);
  return out;
}

/**
 * After a STEP file was imported as `feature` (and committed): once the regen has it, read its
 * PMI into part annotations and show the report. Does nothing for files without PMI.
 */
export async function importStepPmi(
  wb: Workbench,
  partId: Id,
  feature: ImportFeature,
  bytes: Uint8Array,
): Promise<void> {
  const file = feature.source.fileName || feature.source.path;
  const census = stepPmiCensus(bytes);
  const live = await wb.whenLive();
  const port = wb.modeling?.port;
  if (!live || !port) return;
  const read = port.importedPmi
    ? await port.importedPmi(partId, feature.id).catch(() => null)
    : null;
  if (!read?.ok) {
    if (hasStepPmi(census)) wb.patchUi({ pmiReport: unreadReportUi(file, census) });
    return;
  }
  const pmi = read.value;
  if (!pmi.supported) {
    if (hasStepPmi(census)) wb.patchUi({ pmiReport: unreadReportUi(file, census) });
    return;
  }
  if (pmi.entries.length === 0 && pmi.issues.length === 0) {
    if (hasStepPmi(census)) {
      wb.patchUi({
        pmiReport: {
          ...unreadReportUi(file, census),
          entries: [
            {
              label: 'PMI in the file',
              reason:
                'The kernel read no PMI from it. Check the file in the NIST STEP File Analyzer.',
              tone: 'skipped',
            },
          ],
        },
      });
    }
    return;
  }
  await ensureDrawingSupport();
  const part = wb.doc.parts.find((p) => p.id === partId);
  if (!part) return;
  const { annotations, report } = annotationsFromPmi({
    entries: pmi.entries,
    issues: pmi.issues,
    origin: { kind: 'import', file: feature.source.path },
    existing: part.annotations ?? [],
    newId: ulid,
  });
  const added: Annotation[] = [];
  for (const a of annotations) {
    if (wb.apply({ kind: 'addAnnotation', partId, annotation: a }, `Import PMI from ${file}`)) {
      added.push(a);
    } else {
      const i = report.imported.findIndex((x) => x.annotationId === a.id);
      const [gone] = i >= 0 ? report.imported.splice(i, 1) : [];
      report.skipped.push({
        ...(gone?.name ? { name: gone.name } : {}),
        reason: 'The part refused this annotation',
      });
    }
  }
  if (added.length > 0) wb.commit();
  wb.patchUi({ pmiReport: importReportUi(file, added, report) });
}
