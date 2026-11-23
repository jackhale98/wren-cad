// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The small, always-loaded half of the annotation model (M4, ADR-090): kinds, which fields are
 * `Expr`s, which fields a configuration may override, and names for undo labels. Everything that
 * validates or edits annotations lives in the lazily loaded drawing support (`drawing.ts`), so the
 * initial route does not pay for it.
 *
 * Expected-dimension table (mirrored in docs/FILE_FORMAT.md §5.4):
 *
 *   dimensions (linear, aligned, ordinate, radius, diameter, angle, chamfer)
 *                         /nominal                                   angle for `angle`, else length
 *                         /tolerance/value                           (symmetric)  same
 *                         /tolerance/upper, /tolerance/lower         (bilateral, limits)  same
 *   holeCallout           /tolerance/value | /upper | /lower         length
 *   geometricTolerance    /zone/value, /zone/projected, /zone/unequal,
 *                         /zone/perUnit/value, /zone/perUnit/length, /zone/perUnit/width   length
 *   surfaceFinish         /requirements/N/value, /allowance          length
 *
 * Fields that the kind requires are listed even when missing, so validation reports them.
 * `inspection` (a boolean on every dimension) holds no `Expr` and is not configurable, so it has no
 * row here; its one rule (not together with a reference tolerance) is `inspectionRefusal`.
 */

import type { Annotation, AnnotationKind, ConfiguredValue, Id, Part } from '@wren-cad/contracts';
import { ANNOTATION_DEFS, type AnnotationDef } from './annotation-kinds';
import type { Obj } from './check';
import type { ExprField } from './features';

/** ISO 286 classes: one or two letters, then the IT grade (`01` or 1-18). */
export const HOLE_FIT_RE = /^([A-Z]{1,2})(01|[1-9]|1[0-8])$/;
export const SHAFT_FIT_RE = /^([a-z]{1,2})(01|[1-9]|1[0-8])$/;
export const isHoleFitClass = (s: unknown): s is string =>
  typeof s === 'string' && HOLE_FIT_RE.test(s);
export const isShaftFitClass = (s: unknown): s is string =>
  typeof s === 'string' && SHAFT_FIT_RE.test(s);

export const ANNOTATION_KINDS = [
  'linear',
  'aligned',
  'ordinate',
  'radius',
  'diameter',
  'angle',
  'chamfer',
  'datumFeature',
  'geometricTolerance',
  'note',
  'surfaceFinish',
  'holeCallout',
] as const satisfies readonly AnnotationKind[];

type MissingKinds = Exclude<AnnotationKind, (typeof ANNOTATION_KINDS)[number]>;
export const _allAnnotationKindsListed: [MissingKinds] extends [never] ? true : never = true;

/** The kinds that are dimensions (carry `source`, `nominal`, `tolerance`, `text`), from the table. */
export const DIMENSION_KINDS: readonly AnnotationKind[] = ANNOTATION_KINDS.filter(
  (k) => ANNOTATION_DEFS[k].isDimension,
);

export const isDimensionKind = (k: unknown): boolean =>
  (DIMENSION_KINDS as readonly unknown[]).includes(k);

// ---------------------------------------------------------------------------------------------
// Expression fields
// ---------------------------------------------------------------------------------------------

const defOf = (kind: unknown): AnnotationDef<AnnotationKind> | undefined =>
  typeof kind === 'string' && Object.hasOwn(ANNOTATION_DEFS, kind)
    ? (ANNOTATION_DEFS[kind as AnnotationKind] as unknown as AnnotationDef<AnnotationKind>)
    : undefined;

/**
 * Every `Expr` field of an annotation with the dimension it must have (JSON pointers *inside* the
 * annotation). Safe on malformed input: it reports what the declared kind requires and skips
 * optional fields that are absent. The per-kind rules are in `ANNOTATION_DEFS`.
 */
export function annotationExprFields(a: Annotation): ExprField[] {
  const def = defOf((a as unknown as Obj).kind);
  return def ? (def.exprFields as (a: Annotation) => ExprField[])(a) : [];
}

// ---------------------------------------------------------------------------------------------
// Configurable fields
// ---------------------------------------------------------------------------------------------

/** An option (non-`Expr`) field of an annotation a configuration may override. */
export interface AnnotationConfigurableOption {
  /** JSON pointer inside the annotation. */
  pointer: string;
  label: string;
  /** Which values are allowed (the set of fit classes is too large to list). */
  accepts(value: ConfiguredValue): boolean;
  /** What the accepted values look like, for messages. */
  expects: string;
}

/**
 * Option fields a configuration may override, in addition to every annotation `Expr` field
 * (ADR-090): the ISO 286 classes of a fit tolerance (`H7` → `H8` in the loose configuration).
 */
export const ANNOTATION_CONFIGURABLE_OPTIONS: readonly AnnotationConfigurableOption[] = [
  {
    pointer: '/tolerance/hole',
    label: 'Hole fit class',
    accepts: isHoleFitClass,
    expects: 'an ISO 286 hole class like H7',
  },
  {
    pointer: '/tolerance/shaft',
    label: 'Shaft fit class',
    accepts: isShaftFitClass,
    expects: 'an ISO 286 shaft class like g6',
  },
];

export function annotationOptionAt(pointer: string): AnnotationConfigurableOption | undefined {
  return ANNOTATION_CONFIGURABLE_OPTIONS.find((o) => o.pointer === pointer);
}

/** A short human name for undo labels and messages: `Ø diameter dimension`, `datum A`. */
export function describeAnnotation(a: Annotation): string {
  return (ANNOTATION_DEFS[a.kind].describe as (a: Annotation) => string)(a);
}

export const findAnnotation = (part: Part, id: Id): Annotation | undefined =>
  part.annotations?.find((a) => a.id === id);
