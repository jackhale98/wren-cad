// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * M5a (ADR-100): part annotations → `PmiExportItem`s, the neutral, index-based description the
 * kernel façade turns into XCAF semantic PMI (`XCAFDoc_DimTolTool`). Pure: the worker resolves
 * each ref to a `PmiTarget` with the annotation resolution rules and passes the targets in, so
 * nothing here can guess a reference. Values come from the resolution (`AnnotationResolution.value`
 * is absent unless the state is `ok`, trap T1), tolerances and GD&T semantics from the annotation.
 *
 * An annotation that cannot be written faithfully is skipped with a reason, never approximated:
 * needs attention, suppressed, an unsupported kind, construction geometry, a modifier or a datum
 * form the exchange contract cannot carry. Basic and reference dimensions are written without a
 * tolerance (what they are semantically) and noted, since the contract has no flag for them yet.
 */

import type {
  Annotation,
  AnnotationResolution,
  DimensionAnnotation,
  Expr,
  GeometricCharacteristic,
  GeometricToleranceAnnotation,
  Id,
  PmiDimensionType,
  PmiExportItem,
  PmiExportReport,
  PmiTarget,
  PmiToleranceType,
  Tolerance,
} from '@wren-cad/contracts';

/** Evaluates an annotation `Expr`: lengths in mm, angles in rad; undefined when it fails. */
export type PmiEvaluate = (expr: Expr, kind: 'length' | 'angle') => number | undefined;

/** A ref's exported sub-shape, or why it has none (construction geometry, unresolved). */
export type PmiTargetOrWhy = PmiTarget | { reason: string };

export const isPmiTarget = (t: PmiTargetOrWhy): t is PmiTarget => !('reason' in t);

/** Wren dimension kinds → CAx-IF / `XCAFDimTolObjects_DimensionType` names. */
export const PMI_DIMENSION_TYPES: Readonly<
  Record<'linear' | 'aligned' | 'ordinate' | 'diameter' | 'radius' | 'angle', PmiDimensionType>
> = {
  linear: 'linearDistance',
  aligned: 'linearDistance',
  ordinate: 'linearDistance',
  diameter: 'linearDiameter',
  radius: 'linearRadius',
  angle: 'angular',
};

/** Wren GD&T characteristics → `XCAFDimTolObjects_GeomToleranceType` names (1:1). */
export const PMI_TOLERANCE_TYPES: Readonly<Record<GeometricCharacteristic, PmiToleranceType>> = {
  straightness: 'straightness',
  flatness: 'flatness',
  circularity: 'circularity',
  cylindricity: 'cylindricity',
  lineProfile: 'profileOfLine',
  surfaceProfile: 'profileOfSurface',
  parallelism: 'parallelism',
  perpendicularity: 'perpendicularity',
  angularity: 'angularity',
  position: 'position',
  concentricity: 'concentricity',
  coaxiality: 'coaxiality',
  symmetry: 'symmetry',
  circularRunout: 'circularRunout',
  totalRunout: 'totalRunout',
};

const KIND_NAMES: Readonly<Record<Annotation['kind'], string>> = {
  linear: 'linear dimension',
  aligned: 'aligned dimension',
  ordinate: 'ordinate dimension',
  radius: 'radius dimension',
  diameter: 'diameter dimension',
  angle: 'angle dimension',
  chamfer: 'chamfer callout',
  datumFeature: 'datum feature',
  geometricTolerance: 'feature control frame',
  note: 'note',
  surfaceFinish: 'surface finish symbol',
  holeCallout: 'hole callout',
};

/** Plain-language name of an annotation kind (export and import reports). */
export function annotationKindName(kind: Annotation['kind']): string {
  return KIND_NAMES[kind];
}

/** Why an exported item lost something it cannot carry yet (the report lists it; nothing is dropped). */
export interface PmiExportNote {
  annotationId: Id;
  note: string;
}

export interface PmiExportInput {
  annotation: Annotation;
  /** The latest regen's resolution of it, in the exported configuration. */
  resolution: AnnotationResolution | undefined;
  /** Parallel to `annotation.refs`: each ref's exported sub-shape, or why it has none. */
  targets: readonly PmiTargetOrWhy[];
  /** Every annotation of the part by id (datum letters, `appliesTo`). */
  annotations: ReadonlyMap<Id, Annotation>;
  /** Targets of another annotation's refs (`appliesTo`: the dimension's faces). */
  targetsOf(id: Id): readonly PmiTargetOrWhy[] | undefined;
  evaluate: PmiEvaluate;
}

export type PmiExportDecision =
  | { ok: true; item: PmiExportItem; notes: string[] }
  | { ok: false; reason: string };

const skip = (reason: string): PmiExportDecision => ({ ok: false, reason });

/** Targets of a list of refs, or the first reason one of them has none. */
function allTargets(
  targets: readonly PmiTargetOrWhy[] | undefined,
  what: string,
): PmiTarget[] | { reason: string } {
  if (!targets || targets.length === 0) return { reason: `${what} has no model geometry` };
  const out: PmiTarget[] = [];
  for (const t of targets) {
    if (!isPmiTarget(t)) return { reason: t.reason };
    out.push(t);
  }
  return out;
}

/**
 * A dimension's tolerance as the contract carries it. `basic` and `reference` have no tolerance
 * (noted); `undefined` value = an expression that does not evaluate.
 */
function dimensionTolerance(
  tol: Tolerance | undefined,
  kind: 'length' | 'angle',
  evaluate: PmiEvaluate,
):
  | {
      ok: true;
      tolerance?: Extract<PmiExportItem, { kind: 'dimension' }>['tolerance'];
      note?: string;
    }
  | { ok: false; reason: string } {
  if (!tol) return { ok: true };
  const ev = (e: Expr, what: string) => {
    const v = evaluate(e, kind);
    return v === undefined || !Number.isFinite(v) ? `The ${what} “${e}” does not evaluate` : v;
  };
  switch (tol.kind) {
    case 'symmetric': {
      const v = ev(tol.value, 'tolerance');
      if (typeof v === 'string') return { ok: false, reason: v };
      return { ok: true, tolerance: { kind: 'deviation', upper: v, lower: -v } };
    }
    case 'bilateral':
    case 'limits': {
      const upper = ev(tol.upper, 'upper deviation');
      if (typeof upper === 'string') return { ok: false, reason: upper };
      const lower = ev(tol.lower, 'lower deviation');
      if (typeof lower === 'string') return { ok: false, reason: lower };
      return {
        ok: true,
        tolerance: { kind: 'deviation', upper, lower },
        ...(tol.kind === 'limits' ? { note: 'Limits are written as deviations' } : {}),
      };
    }
    case 'fit':
      return {
        ok: true,
        tolerance: {
          kind: 'fit',
          ...(tol.hole ? { hole: tol.hole } : {}),
          ...(tol.shaft ? { shaft: tol.shaft } : {}),
        },
      };
    case 'basic':
      return { ok: true, note: 'Written without a tolerance: the exchange has no basic flag yet' };
    case 'reference':
      return {
        ok: true,
        note: 'Written without a tolerance: the exchange has no reference flag yet',
      };
  }
}

function dimensionItem(
  a: DimensionAnnotation,
  input: PmiExportInput,
  value: number,
): PmiExportDecision {
  if (a.kind === 'chamfer') return skip('Chamfer callouts are not exported as PMI yet');
  const targets = allTargets(input.targets, 'The dimension');
  if ('reason' in targets) return skip(targets.reason);
  const unit = a.kind === 'angle' ? 'angle' : 'length';
  const tol = dimensionTolerance(a.tolerance, unit, input.evaluate);
  if (!tol.ok) return skip(tol.reason);
  const notes = tol.note ? [tol.note] : [];
  const item: PmiExportItem = {
    annotationId: a.id,
    kind: 'dimension',
    type: PMI_DIMENSION_TYPES[a.kind],
    targets,
    value,
    ...(tol.tolerance ? { tolerance: tol.tolerance } : {}),
  };
  return { ok: true, item, notes };
}

const MATERIAL = { mmc: 'M', lmc: 'L' } as const;

function datumLabel(input: PmiExportInput, ref: { datum: Id } | { label: string }): string | null {
  if ('label' in ref) return null;
  const d = input.annotations.get(ref.datum);
  return d?.kind === 'datumFeature' ? d.label : null;
}

function toleranceItem(a: GeometricToleranceAnnotation, input: PmiExportInput): PmiExportDecision {
  const z = a.zone;
  const unsupported: string[] = [];
  if (z.shape === 'sphericalDiameter') unsupported.push('a spherical (SØ) zone');
  if (z.modifiers && z.modifiers.length > 0)
    unsupported.push(`zone modifiers (${z.modifiers.join(', ')})`);
  if (z.projected !== undefined) unsupported.push('a projected zone');
  if (z.unequal !== undefined) unsupported.push('an unequally disposed zone');
  if (z.perUnit !== undefined) unsupported.push('a per-unit refinement');
  if (a.allAround) unsupported.push('all around');
  if (a.datums && a.datums.length > 3) unsupported.push('more than three datums');
  if (a.datums?.some((c) => c.datums.length !== 1)) unsupported.push('a common datum (A–B)');
  if (unsupported.length > 0) {
    return skip(`The exchange cannot carry ${unsupported.join(', ')} yet`);
  }
  const value = input.evaluate(z.value, 'length');
  if (value === undefined || !Number.isFinite(value)) {
    return skip(`The tolerance zone “${z.value}” does not evaluate`);
  }
  let targets: PmiTarget[] | { reason: string };
  if (a.appliesTo !== undefined) {
    targets = allTargets(input.targetsOf(a.appliesTo), 'The dimension this frame applies to');
  } else targets = allTargets(input.targets, 'The frame');
  if ('reason' in targets) return skip(targets.reason);
  const datums: { label: string; material?: 'M' | 'L' }[] = [];
  for (const c of a.datums ?? []) {
    const ref = c.datums[0] as { datum: Id } | { label: string };
    const label = datumLabel(input, ref);
    if (label === null) {
      return skip(
        `Datum ${'label' in ref ? ref.label : '?'} is not bound to a datum feature in this part`,
      );
    }
    datums.push(c.material ? { label, material: MATERIAL[c.material] } : { label });
  }
  const item: PmiExportItem = {
    annotationId: a.id,
    kind: 'tolerance',
    type: PMI_TOLERANCE_TYPES[a.characteristic],
    targets,
    value,
    ...(z.shape === 'diameter' ? { diameter: true } : {}),
    ...(z.material ? { material: MATERIAL[z.material] } : {}),
    ...(datums.length > 0 ? { datums } : {}),
  };
  const notes: string[] = [];
  if (a.text?.above || a.text?.below)
    notes.push('Text above or below the frame is in the presentation only');
  return { ok: true, item, notes };
}

/** One annotation → one export item, or why it is skipped. */
export function pmiExportItem(input: PmiExportInput): PmiExportDecision {
  const a = input.annotation;
  const r = input.resolution;
  if (a.suppressed || r?.state === 'suppressed') return skip('Suppressed in this configuration');
  if (!r) return skip('Not resolved in the latest regeneration');
  if (r.state === 'needsAttention') {
    return skip(`Needs attention${r.error?.message ? `: ${r.error.message}` : ''}`);
  }
  switch (a.kind) {
    case 'linear':
    case 'aligned':
    case 'ordinate':
    case 'radius':
    case 'diameter':
    case 'angle':
    case 'chamfer': {
      if (r.value === undefined || !Number.isFinite(r.value))
        return skip('The dimension has no value');
      return dimensionItem(a, input, r.value);
    }
    case 'datumFeature': {
      const targets =
        a.appliesTo !== undefined
          ? allTargets(input.targetsOf(a.appliesTo), 'The dimension this datum applies to')
          : allTargets(input.targets, 'The datum');
      if ('reason' in targets) return skip(targets.reason);
      return {
        ok: true,
        item: { annotationId: a.id, kind: 'datum', label: a.label, targets },
        notes: [],
      };
    }
    case 'geometricTolerance':
      return toleranceItem(a, input);
    case 'note':
      return skip('Notes are not exported as PMI yet');
    case 'surfaceFinish':
      return skip('Surface finish symbols are not exported as PMI yet');
    case 'holeCallout':
      return skip('Hole callouts are not exported as PMI yet');
  }
}

export interface PmiExportPlanInput {
  annotations: readonly Annotation[];
  resolutions: ReadonlyMap<Id, AnnotationResolution>;
  /** Parallel to each annotation's refs (by annotation id). */
  targets: ReadonlyMap<Id, readonly PmiTargetOrWhy[]>;
  evaluate: PmiEvaluate;
  /** `ExportOptions.pmi.annotations`: only these (others are not reported). */
  only?: readonly Id[];
}

export interface PmiExportPlan {
  /** Sorted by annotation id (deterministic files). */
  items: PmiExportItem[];
  report: PmiExportReport;
  /** Exported, but something is in the presentation only (the UI lists it with the report). */
  notes: PmiExportNote[];
}

/**
 * Every annotation of the part → export items plus the report. A frame whose datum is skipped is
 * skipped too (its datum reference would point at nothing in the file).
 */
export function planPmiExport(input: PmiExportPlanInput): PmiExportPlan {
  const byId = new Map(input.annotations.map((a) => [a.id, a]));
  const only = input.only ? new Set(input.only) : undefined;
  const chosen = [...input.annotations]
    .filter((a) => !only || only.has(a.id))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  const decisions = new Map<Id, PmiExportDecision>();
  const decide = (a: Annotation): PmiExportDecision => {
    const known = decisions.get(a.id);
    if (known) return known;
    const d = pmiExportItem({
      annotation: a,
      resolution: input.resolutions.get(a.id),
      targets: input.targets.get(a.id) ?? a.refs.map(() => ({ reason: 'Not resolved' })),
      annotations: byId,
      targetsOf: (id) => input.targets.get(id),
      evaluate: input.evaluate,
    });
    decisions.set(a.id, d);
    return d;
  };
  const items: PmiExportItem[] = [];
  const skipped: PmiExportReport['skipped'] = [];
  const notes: PmiExportNote[] = [];
  const exportedDatums = new Set<string>();
  for (const a of chosen) {
    if (a.kind !== 'datumFeature') continue;
    const d = decide(a);
    if (d.ok) exportedDatums.add(a.label);
  }
  for (const a of chosen) {
    let d = decide(a);
    if (d.ok && d.item.kind === 'tolerance') {
      const missing = (d.item.datums ?? []).find((x) => !exportedDatums.has(x.label));
      if (missing) {
        d = skip(`Its datum ${missing.label} is not exported`);
      }
    }
    if (d.ok) {
      items.push(d.item);
      for (const note of d.notes) notes.push({ annotationId: a.id, note });
    } else skipped.push({ annotationId: a.id, reason: d.reason });
  }
  return { items, report: { exported: items.length, skipped }, notes };
}
