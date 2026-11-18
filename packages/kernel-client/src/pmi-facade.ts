/**
 * M5a (ADR-100): the one adapter between the kernel worker and the kernel façade's STEP AP242 PMI
 * entry points, which the kernel-engineer builds in parallel. Everything that names them is here,
 * so wiring the final names is a change to this file only.
 *
 * Assumed façade API (packages/kernel, `whittle_bindings.cpp` / facade.ts), JSON across the
 * boundary like every other entry point:
 *  - **Export:** `exportStepPmi(shapesJson, itemsJson, optionsJson): string`. `shapesJson` is
 *    `ExportShape[]` exactly as for `exportShapes`; `itemsJson` is `PmiExportItem[]`, whose
 *    `PmiTarget.body` is the 0-based index into that shapes array and `index` the 1-based
 *    `TopExp::MapShapes` index of the sub-shape in that shape; `optionsJson` is contracts
 *    `ExportOptions` with `stepSchema: 'AP242'` and `pmi` set. It builds the XCAF document, the
 *    `XCAFDoc_DimTolTool` entities named by `annotationId`, the presentations, and writes with
 *    `STEPCAFControl_Writer`. Returns `Result<RawExportResult>` JSON (the MEMFS files to read
 *    and unlink, as `exportShapes`).
 *  - **Import:** the existing `importFile(path, 'step')` is extended: its `Result<RawImportResult>`
 *    value gains `pmi?: PmiImportResult` (read with `STEPCAFControl_Reader`), whose targets use the
 *    same conventions on `bodies` (body = index in `bodies`, file order; 1-based TopExp index).
 *    A build without PMI support leaves `pmi` out.
 * A build without `exportStepPmi` gives `UNSUPPORTED_FEATURE` (detail `exportStepPmi`), so the app
 * can say "this kernel cannot write PMI yet" instead of writing a STEP file without it.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ExportOptions, PmiExportItem, PmiImportResult, PmiTarget } from '@wren-cad/contracts';
import type { ExportShape, RawImportResult } from '@wren-cad/kernel';

/** The façade entry point names (the only place they are spelled). */
export const PMI_FACADE = {
  /** Module function writing AP242 with PMI. */
  exportFunction: 'exportStepPmi',
  /** Field of `importFile`'s STEP result carrying the read PMI. */
  importField: 'pmi',
} as const;

/** The façade functions M5a needs, as optional members of the Emscripten module. */
export interface PmiKernelModule {
  exportStepPmi?(shapesJson: string, itemsJson: string, optionsJson: string): string;
}

/** `importFile`'s value with the extended STEP result. */
export type RawImportWithPmi = RawImportResult & { pmi?: PmiImportResult };

/** Does this kernel build write PMI? */
export function canExportPmi(k: object): boolean {
  return typeof (k as PmiKernelModule)[PMI_FACADE.exportFunction] === 'function';
}

/**
 * Calls the façade's PMI export. The caller parses the `Result<RawExportResult>` JSON and reads
 * the files (kernel-api.ts, the same path as `exportShapes`). Throws what the façade throws
 * (the caller converts it to a `KernelError`).
 */
export function callExportStepPmi(
  k: object,
  shapes: readonly ExportShape[],
  items: readonly PmiExportItem[],
  options: ExportOptions,
): string | null {
  const fn = (k as PmiKernelModule)[PMI_FACADE.exportFunction];
  if (typeof fn !== 'function') return null;
  return fn.call(k, JSON.stringify(shapes), JSON.stringify(items), JSON.stringify(options));
}

const isTarget = (t: unknown): t is PmiTarget => {
  if (typeof t !== 'object' || t === null) return false;
  const x = t as Record<string, unknown>;
  return (
    Number.isInteger(x.body) &&
    (x.kind === 'face' || x.kind === 'edge' || x.kind === 'vertex') &&
    Number.isInteger(x.index) &&
    (x.index as number) >= 1
  );
};

/**
 * The PMI of an `importFile` STEP result, checked: a malformed item becomes an issue (never a
 * silent drop, never a crash in the worker). `undefined` when the build reads no PMI.
 */
export function importedPmiOf(raw: RawImportWithPmi): PmiImportResult | undefined {
  const pmi = (raw as unknown as Record<string, unknown>)[PMI_FACADE.importField];
  if (pmi === undefined || pmi === null) return undefined;
  const out: PmiImportResult = { items: [], issues: [] };
  if (typeof pmi !== 'object') {
    out.issues.push({ reason: 'The kernel returned PMI in a form Wren does not understand' });
    return out;
  }
  const p = pmi as { items?: unknown; issues?: unknown };
  for (const i of Array.isArray(p.issues) ? p.issues : []) {
    const x = i as { name?: unknown; reason?: unknown };
    out.issues.push({
      ...(typeof x?.name === 'string' ? { name: x.name } : {}),
      reason: typeof x?.reason === 'string' ? x.reason : 'Unreadable entity',
    });
  }
  for (const i of Array.isArray(p.items) ? p.items : []) {
    const x = i as PmiImportResult['items'][number] & { targets?: unknown };
    const name = typeof x?.name === 'string' ? x.name : undefined;
    const bad = (reason: string) => out.issues.push({ ...(name ? { name } : {}), reason });
    if (typeof x !== 'object' || x === null) {
      bad('Unreadable PMI item');
      continue;
    }
    if (x.kind === 'presentationOnly') {
      if (!x.presentation || !Array.isArray(x.presentation.polylines)) {
        bad('Presentation without geometry');
        continue;
      }
      out.items.push(x);
      continue;
    }
    if (x.kind !== 'dimension' && x.kind !== 'datum' && x.kind !== 'tolerance') {
      bad(`Unknown PMI kind ${JSON.stringify((x as { kind?: unknown }).kind)}`);
      continue;
    }
    if (!Array.isArray(x.targets) || !x.targets.every(isTarget)) {
      bad('Its model geometry is not given as body sub-shapes');
      continue;
    }
    out.items.push(x);
  }
  return out;
}
