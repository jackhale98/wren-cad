/**
 * M5a (ADR-100): the one adapter between the kernel worker and the kernel façade's STEP AP242 PMI
 * entry points (packages/kernel `facade.ts` and `pmi.ts`, merged from the kernel workstream).
 * Everything that names them is here.
 *
 * Façade API (JSON across the boundary like every other entry point):
 *  - **Export:** `exportStepPmi(shapesJson, pmiJson, optionsJson): string`. `shapesJson` is
 *    `ExportShape[]` exactly as for `exportShapes`; `pmiJson` is `PmiExportItem[]`
 *    (`encodePmiExportItems`), whose `PmiTarget.body` is the 0-based index into the shapes and
 *    `index` the 1-based `TopExp::MapShapes` index; `optionsJson` is contracts `ExportOptions`
 *    (AP242). Returns `Result<RawPmiExportResult>` JSON: the MEMFS files, as `exportShapes`, plus
 *    the kernel's own `pmi` report (`exported`, `skipped`, `notes`; `decodePmiExportReport`).
 *  - **Import:** STEP `importFile(path, 'step')` returns `pmi: { items, issues, counts }` beside
 *    the bodies when the file has GD&T (`decodePmiImport(pmi, bodies.length)`: every target is
 *    checked against its body's sub-shape counts, never clamped). Items carry no `annotationId`;
 *    `name` is what the file holds, the annotation id for a file Wren wrote with presentation.
 * A build without `exportStepPmi` gives `UNSUPPORTED_FEATURE` (kernel-api.ts).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { ExportOptions, PmiExportItem, PmiImportResult } from '@wren-cad/contracts';
import {
  decodePmiExportReport,
  decodePmiImport,
  type ExportShape,
  encodePmiExportItems,
  type KernelPmiExportReport,
  type RawImportResult,
} from '@wren-cad/kernel';

/** The façade entry point names (the only place they are spelled). */
export const PMI_FACADE = {
  /** Module function writing AP242 with PMI. */
  exportFunction: 'exportStepPmi',
  /** Field of `importFile`'s STEP result carrying the read PMI. */
  importField: 'pmi',
} as const;

/** The façade functions M5a needs, as optional members of the Emscripten module. */
export interface PmiKernelModule {
  exportStepPmi?(shapesJson: string, pmiJson: string, optionsJson: string): string;
}

/** `importFile`'s value with the extended STEP result. */
export type RawImportWithPmi = RawImportResult;

export type { KernelPmiExportReport };

/** Does this kernel build write PMI? */
export function canExportPmi(k: object): boolean {
  return typeof (k as PmiKernelModule)[PMI_FACADE.exportFunction] === 'function';
}

/**
 * Calls the façade's PMI export; the caller parses the `Result<RawPmiExportResult>` JSON and
 * reads the files (kernel-api.ts, the same path as `exportShapes`). Null when the build lacks it.
 * Throws what the façade throws (the caller converts it to a `KernelError`).
 */
export function callExportStepPmi(
  k: object,
  shapes: readonly ExportShape[],
  items: readonly PmiExportItem[],
  options: ExportOptions,
): string | null {
  const fn = (k as PmiKernelModule)[PMI_FACADE.exportFunction];
  if (typeof fn !== 'function') return null;
  return fn.call(k, JSON.stringify(shapes), encodePmiExportItems(items), JSON.stringify(options));
}

/** The kernel's export report, checked (a malformed one is an error, never a guess). */
export const exportReportOf = (raw: unknown) =>
  decodePmiExportReport((raw as Record<string, unknown> | null)?.[PMI_FACADE.importField]);

/** A Wren annotation id (ULID) in a PMI name, when the file came from Wren. */
const WREN_ID = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The PMI of an `importFile` STEP result as contracts `PmiImportResult` on the returned bodies'
 * indices. `annotationId` is set from `name` when it is a Wren id. Malformed kernel output is one
 * issue (nothing is read from it, and nothing is dropped silently). `undefined` when the file has
 * no PMI (or the build reads none).
 */
export function importedPmiOf(raw: RawImportWithPmi): PmiImportResult | undefined {
  const pmi = (raw as unknown as Record<string, unknown>)[PMI_FACADE.importField];
  if (pmi === undefined || pmi === null) return undefined;
  const d = decodePmiImport(pmi, raw.bodies.length);
  if (!d.ok) {
    return {
      items: [],
      issues: [
        {
          reason: `${d.error.message}${d.error.detail ? ` (${d.error.detail})` : ''}: no PMI was read from this file`,
        },
      ],
    };
  }
  return {
    items: d.value.items.map((item) =>
      item.kind !== 'presentationOnly' && item.name && WREN_ID.test(item.name)
        ? { ...item, annotationId: item.name }
        : item,
    ),
    issues: d.value.issues,
  };
}
