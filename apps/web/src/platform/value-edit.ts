/**
 * What the review layout (phone) lets you change, from capabilities only (ADR-101): never a tier
 * name. `editValues` allows changing numbers, expressions and the active configuration;
 * structure (add, delete, rename, reorder, re-pick, sketches) stays behind `editFeatures` and
 * `editSketches`.
 */

import type { DeviceCapabilities } from '@wren-cad/contracts';

type Gate = Pick<DeviceCapabilities, 'layout' | 'editValues' | 'editFeatures'>;

/**
 * The Params tab. Parameters have always been fully editable on the phone (PLAN §9.1: "editing is
 * limited to parameters and simple features"; the M2 phone tests add descriptions there), so
 * `editValues` keeps the whole table: Phase 2c adds abilities to the review layout, it removes
 * none. A device with neither capability only views. (`ParamsTable` also has a `values` mode,
 * expressions only, which no layout uses today.)
 */
export function paramsModeFor(caps: Gate): 'edit' | 'values' | 'view' {
  return caps.editFeatures || caps.editValues ? 'edit' : 'view';
}

/**
 * The feature tree's inline "Values": the review layout has no inspector, so it is where a
 * feature's numbers are edited. The full layout edits them in the inspector.
 */
export function inlineFeatureValues(caps: Gate): boolean {
  return caps.layout === 'review' && caps.editValues && !caps.editFeatures;
}
