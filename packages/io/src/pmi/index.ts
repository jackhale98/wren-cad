// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * `@wren-cad/io/pmi` (M5a, ADR-100): the pure mappings between part annotations and the STEP
 * AP242 PMI exchange contract (`packages/contracts/src/pmi.ts`), both directions. Worker-safe and
 * lazy: nothing on the app's initial route imports it.
 */
export { hasStepPmi, type StepPmiCensus, stepPmiCensus } from './census';
export {
  annotationKindName,
  isPmiTarget,
  PMI_DIMENSION_TYPES,
  PMI_TOLERANCE_TYPES,
  type PmiEvaluate,
  type PmiExportDecision,
  type PmiExportInput,
  type PmiExportNote,
  type PmiExportPlan,
  type PmiExportPlanInput,
  type PmiTargetOrWhy,
  planPmiExport,
  pmiExportItem,
} from './export-map';
export {
  annotationsFromPmi,
  CHARACTERISTICS,
  numberLiteral,
  type PmiImportEntry,
  type PmiImportInput,
  type PmiImportReport,
  ULID_PATTERN,
  valueExpr,
} from './import-map';
