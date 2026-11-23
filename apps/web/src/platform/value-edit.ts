/**
 * What the review layout (phone) lets you change, from capabilities only (ADR-101): never a tier
 * name. `editValues` allows changing numbers, expressions and the active configuration;
 * structure (add, delete, rename, reorder, re-pick, sketches) stays behind `editFeatures` and
 * `editSketches`.
 */

import type { DeviceCapabilities } from '@wren-cad/contracts';

type Gate = Pick<DeviceCapabilities, 'layout' | 'editValues' | 'editFeatures'>;

/** The Params tab: everything with the full editor, expressions only with `editValues`, else none. */
export function paramsModeFor(caps: Gate): 'edit' | 'values' | 'view' {
  if (caps.editFeatures) return 'edit';
  return caps.editValues ? 'values' : 'view';
}

/**
 * The feature tree's inline "Values": the review layout has no inspector, so it is where a
 * feature's numbers are edited. The full layout edits them in the inspector.
 */
export function inlineFeatureValues(caps: Gate): boolean {
  return caps.layout === 'review' && caps.editValues && !caps.editFeatures;
}
