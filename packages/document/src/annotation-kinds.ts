// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * One definition per annotation kind (ADR-101, slice 2d). The facts that used to be repeated in
 * switch statements across packages (names, which kinds are dimensions or carry a value, the
 * expression fields, what refs a kind needs, the undo label) are entries of `ANNOTATION_DEFS`.
 * The mapped type is compile-time complete: a kind added to the contract without an entry here
 * fails typecheck. Per-kind *code* (layout geometry, STEP mapping, inspector forms) stays where it
 * is; this file only holds data and small pure functions.
 */

import type { Annotation, NamedDimension } from '@wren-cad/contracts';
import { isObj, type Obj } from './check';
import type { ExprField } from './features';

type Of<K extends Annotation['kind']> = Extract<Annotation, { kind: K }>;

/** How a resolved value is written: `Ø6`, `R3`, `45°`, `6 mm`. */
export type ValueForm = 'length' | 'angle' | 'diameter' | 'radius';

export interface AnnotationDef<K extends Annotation['kind']> {
  readonly kind: K;
  /** Inspector title (UI): `Linear dimension`, `Radius`. */
  readonly title: string;
  /** Plain-language name in export and import reports: `feature control frame`. */
  readonly exportName: string;
  /** Carries `source`, `nominal`, `tolerance` and `text`. */
  readonly isDimension: boolean;
  /** How the resolved value reads; undefined when the drawing shows no value for the kind. */
  readonly valueForm?: ValueForm;
  /** Undo labels and messages: `Ø diameter dimension`, `datum A`. */
  describe(a: Of<K>): string;
  /** `Expr` fields (JSON pointers inside the annotation) with their dimension. Safe on malformed input. */
  exprFields(a: Of<K>): ExprField[];
  /** What the kind requires of `refs`, or undefined when the list fits. */
  refsProblem(a: Of<K>): string | undefined;
}

const rec = (v: unknown): Obj | undefined => (isObj(v) ? v : undefined);
const has = (v: unknown): boolean => v !== undefined;

function toleranceFields(a: unknown, dim: NamedDimension): ExprField[] {
  const t = rec(rec(a)?.tolerance);
  switch (t?.kind) {
    case 'symmetric':
      return [{ pointer: '/tolerance/value', expected: dim }];
    case 'bilateral':
    case 'limits':
      return [
        { pointer: '/tolerance/upper', expected: dim },
        { pointer: '/tolerance/lower', expected: dim },
      ];
    default:
      return [];
  }
}

function dimensionFields(a: unknown, dim: NamedDimension): ExprField[] {
  const out: ExprField[] = [];
  if (has(rec(a)?.nominal)) out.push({ pointer: '/nominal', expected: dim });
  out.push(...toleranceFields(a, dim));
  return out;
}

const exactly =
  (k: number, what: string) =>
  (a: Annotation): string | undefined => {
    const n = a.refs.length;
    return n === k
      ? undefined
      : `${what} needs ${k === 1 ? 'one reference' : `${k} references`}, not ${n}`;
  };

const dimensionDescribe = (a: Annotation): string => `${a.kind} dimension`;

export const ANNOTATION_DEFS: { readonly [K in Annotation['kind']]: AnnotationDef<K> } = {
  linear: {
    kind: 'linear',
    title: 'Linear dimension',
    exportName: 'linear dimension',
    isDimension: true,
    valueForm: 'length',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(2, 'A linear dimension'),
  },
  aligned: {
    kind: 'aligned',
    title: 'Aligned dimension',
    exportName: 'aligned dimension',
    isDimension: true,
    valueForm: 'length',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(2, 'A aligned dimension'),
  },
  ordinate: {
    kind: 'ordinate',
    title: 'Ordinate dimension',
    exportName: 'ordinate dimension',
    isDimension: true,
    valueForm: 'length',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(2, 'A ordinate dimension'),
  },
  radius: {
    kind: 'radius',
    title: 'Radius',
    exportName: 'radius dimension',
    isDimension: true,
    valueForm: 'radius',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(1, 'A radius dimension'),
  },
  diameter: {
    kind: 'diameter',
    title: 'Diameter',
    exportName: 'diameter dimension',
    isDimension: true,
    valueForm: 'diameter',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(1, 'A diameter dimension'),
  },
  angle: {
    kind: 'angle',
    title: 'Angle',
    exportName: 'angle dimension',
    isDimension: true,
    valueForm: 'angle',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'angle'),
    refsProblem: exactly(2, 'A angle dimension'),
  },
  chamfer: {
    kind: 'chamfer',
    title: 'Chamfer',
    exportName: 'chamfer callout',
    isDimension: true,
    valueForm: 'length',
    describe: dimensionDescribe,
    exprFields: (a) => dimensionFields(a, 'length'),
    refsProblem: exactly(1, 'A chamfer dimension'),
  },
  datumFeature: {
    kind: 'datumFeature',
    title: 'Datum feature',
    exportName: 'datum feature',
    isDimension: false,
    describe: (a) => (a.label === '' ? 'datum' : `datum ${a.label}`),
    exprFields: () => [],
    refsProblem(a) {
      const n = a.refs.length;
      // A datum on a feature of size names its dimension (`appliesTo`, ADR-094): no refs needed.
      if (n === 1 || (n === 0 && a.appliesTo !== undefined)) return undefined;
      return n === 0
        ? 'A datum feature needs a feature, or a size dimension it applies to'
        : `A datum feature needs one reference, not ${n}`;
    },
  },
  geometricTolerance: {
    kind: 'geometricTolerance',
    title: 'Tolerance frame',
    exportName: 'feature control frame',
    isDimension: false,
    describe: (a) => `${a.characteristic} frame`,
    exprFields(a) {
      const out: ExprField[] = [{ pointer: '/zone/value', expected: 'length' }];
      const z = rec(rec(a)?.zone);
      if (has(z?.projected)) out.push({ pointer: '/zone/projected', expected: 'length' });
      if (has(z?.unequal)) out.push({ pointer: '/zone/unequal', expected: 'length' });
      const p = rec(z?.perUnit);
      if (p) {
        out.push({ pointer: '/zone/perUnit/value', expected: 'length' });
        out.push({ pointer: '/zone/perUnit/length', expected: 'length' });
        if (has(p.width)) out.push({ pointer: '/zone/perUnit/width', expected: 'length' });
      }
      return out;
    },
    refsProblem(a) {
      const n = a.refs.length;
      if (n === 1 || (n === 0 && a.appliesTo !== undefined)) return undefined;
      return n === 0
        ? 'A tolerance frame needs a toleranced feature, or a dimension it applies to'
        : `A tolerance frame needs one reference, not ${n}`;
    },
  },
  note: {
    kind: 'note',
    title: 'Note',
    exportName: 'note',
    isDimension: false,
    describe: () => 'note',
    exprFields: () => [],
    refsProblem: (a) =>
      a.refs.length >= 1 ? undefined : 'A note needs at least one leader target',
  },
  surfaceFinish: {
    kind: 'surfaceFinish',
    title: 'Surface finish',
    exportName: 'surface finish symbol',
    isDimension: false,
    describe: () => 'surface finish',
    exprFields(a) {
      const o = a as unknown as Obj;
      const out: ExprField[] = [];
      if (Array.isArray(o.requirements)) {
        o.requirements.forEach((_, i) => {
          out.push({ pointer: `/requirements/${i}/value`, expected: 'length' });
        });
      }
      if (has(o.allowance)) out.push({ pointer: '/allowance', expected: 'length' });
      return out;
    },
    refsProblem: exactly(1, 'A surface finish symbol'),
  },
  holeCallout: {
    kind: 'holeCallout',
    title: 'Hole callout',
    exportName: 'hole callout',
    isDimension: false,
    valueForm: 'length',
    describe: () => 'hole callout',
    exprFields: (a) => toleranceFields(a, 'length'),
    refsProblem: () => undefined,
  },
};

/** Kinds whose resolved value the drawing shows (dimensions and hole callouts). */
export const isValuedKind = (k: Annotation['kind']): boolean =>
  ANNOTATION_DEFS[k].valueForm !== undefined;
