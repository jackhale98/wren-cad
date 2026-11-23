// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Feature introspection shared by the evaluator, the store and validation:
 *  - which fields of a feature are `Expr`s, and what dimension each must have;
 *  - which `EntityRef`s a feature holds, and which other features those refs point into.
 *
 * Expected-dimension table (the single source of truth, mirrored in docs/FILE_FORMAT.md):
 *
 *   primitive box          /dx /dy /dz                         length
 *   primitive cylinder     /radius /height                     length
 *   primitive sphere       /radius                             length
 *   sketch                 /constraints/N/value                length (distance, hDistance, vDistance,
 *                                                              length, radius, diameter) or angle (angle);
 *                                                              driven (reference) dimensions are not evaluated
 *   extrude                /end/depth (blind)                  length;  /draft  angle
 *   revolve                /angle                              angle
 *   fillet                 /radius                             length
 *   chamfer                /mode/distance                      length;  /mode/angle (distanceAngle)  angle
 *   pushPull               /distance                           length
 *   plane (offset)         /definition/distance                length
 *   any feature, PMI       /annotations/N/value, /tolerance/upper, /tolerance/lower
 *                                                              angle for `angle` annotations, else length
 *                          /annotations/N/gdt/zone             length
 */

import type { EntityRef, Feature, Id, NamedDimension } from '@wren-cad/contracts';
import { featureDef } from './feature-kinds';

export const FEATURE_TYPES = [
  'primitive',
  'sketch',
  'extrude',
  'revolve',
  'fillet',
  'chamfer',
  'boolean',
  'pushPull',
  'plane',
  'import',
] as const satisfies readonly Feature['type'][];

/**
 * Every feature type the format knows, for validation. `FEATURE_TYPES` above is the original
 * M0–M2 list that tests use as "the types the reference fixture covers"; this one is complete,
 * and the type check below fails the build when a new feature type is not listed.
 */
export const KNOWN_FEATURE_TYPES = [
  ...FEATURE_TYPES,
  'axis',
  'point',
  'shell',
  'draft',
  'sweep',
  'loft',
  'mirror',
  'linearPattern',
  'circularPattern',
  'hole',
  'thread',
] as const satisfies readonly Feature['type'][];

type MissingFeatureTypes = Exclude<Feature['type'], (typeof KNOWN_FEATURE_TYPES)[number]>;
export const _allFeatureTypesListed: [MissingFeatureTypes] extends [never] ? true : never = true;

export interface ExprField {
  /** JSON pointer into the feature, e.g. `/constraints/3/value`. */
  pointer: string;
  expected: NamedDimension;
  /** Set for sketch dimension constraints. */
  constraintId?: Id;
  /** A reference (driven) dimension: measured after solving, so its `Expr` is not evaluated. */
  driven?: boolean;
}

/** Every `Expr` field of a feature with the dimension it must have (per kind: `FEATURE_DEFS`). */
export function exprFields(feature: Feature): ExprField[] {
  // Annotations are part-level from v4 (ADR-090); their fields are `annotationExprFields`.
  return featureDef(feature).exprFields(feature);
}

/** Every persistent topology reference held by a feature (per kind: `FEATURE_DEFS`). */
export function entityRefs(f: Feature): EntityRef[] {
  return featureDef(f).refs(f);
}

/** Does `name` (a persistent name) point into the feature with id `id`? Tags: `F<id>:`, `S<id>:`, `B<id>`. */
export function nameTouchesFeature(name: string, id: Id): boolean {
  if (name.includes(`F${id}:`) || name.includes(`S${id}:`)) return true;
  let from = 0;
  const tag = `B${id}`;
  for (;;) {
    const at = name.indexOf(tag, from);
    if (at < 0) return false;
    const after = name[at + tag.length];
    if (after === undefined || !/[0-9A-Za-z]/.test(after)) return true;
    from = at + 1;
  }
}

/** Does feature `f` reference geometry produced by the feature with id `id`? */
export function featureReferences(f: Feature, id: Id): boolean {
  return entityRefs(f).some((r) => nameTouchesFeature(r.name, id));
}
