// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * M5a (ADR-100): PMI read from a STEP file → part annotations on the import feature's faces and
 * edges. Pure: the worker maps each `PmiTarget` (body, kind, TopExp index) to the import
 * feature's persistent name first (`EntityRef`, with a fingerprint), so every ref here is exact.
 *
 * Nothing is dropped silently. An item whose type has no Wren equivalent, whose targets did not
 * map, or that is presentation only is listed in the report with the reason. Annotation ids are
 * the PMI names when those are Wren ids not yet used in the part (a Wren round trip keeps
 * identity), otherwise new ids. A frame's datum letters bind to the datums of the same file, then
 * to the part's existing datums; a letter that matches none stays an unbound `{ label }`, which
 * the part shows as needs attention (never bound to a guessed datum).
 */

import type {
  Annotation,
  AnnotationOrigin,
  DatumCompartment,
  DimensionAnnotation,
  EntityRef,
  Expr,
  GeometricCharacteristic,
  Id,
  PmiImportItem,
  PmiImportResult,
  PmiTarget,
  PmiToleranceType,
  Tolerance,
} from '@wren-cad/contracts';
import { PMI_TOLERANCE_TYPES } from './export-map';

/** One semantic or presentation item with its targets mapped to names (parallel to `targets`). */
export interface PmiImportEntry {
  item: PmiImportItem;
  /** Parallel to the item's `targets` (empty for presentation-only items). */
  refs: readonly (EntityRef | { reason: string })[];
}

export interface PmiImportInput {
  entries: readonly PmiImportEntry[];
  /** `PmiImportResult.issues`: what the reader could not read at all. */
  issues: PmiImportResult['issues'];
  /** Provenance of the new annotations (`{ kind: 'import', file }`). */
  origin: AnnotationOrigin;
  /** Annotations the part already has (ids not to reuse, datum letters to bind to). */
  existing: readonly Annotation[];
  newId(): Id;
  /** Is this PMI name a Wren id (a ULID)? Default: the ULID pattern. */
  isId?(name: string): boolean;
}

export interface PmiImportReport {
  /** The annotations made, in file order. */
  imported: { annotationId: Id; name?: string; kind: Annotation['kind'] }[];
  /** Presentation-only items (no semantics): kept for display, not annotations. */
  presentationOnly: { name?: string }[];
  /** Items not imported, and entities the reader could not read, each with the reason. */
  skipped: { name?: string; reason: string }[];
  /** Imported, with something to check (an unbound datum letter). */
  notes: { annotationId: Id; note: string }[];
}

export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** `XCAFDimTolObjects_GeomToleranceType` names → Wren characteristics. */
export const CHARACTERISTICS: Readonly<Record<PmiToleranceType, GeometricCharacteristic>> =
  Object.fromEntries(
    Object.entries(PMI_TOLERANCE_TYPES).map(([k, v]) => [v, k as GeometricCharacteristic]),
  ) as Record<PmiToleranceType, GeometricCharacteristic>;

/** A number as a short, exact-enough expression literal (12 significant digits, no exponent). */
export function numberLiteral(v: number): string {
  if (Object.is(v, -0) || v === 0) return '0';
  const s = Number(v.toPrecision(12)).toString();
  if (!/e/i.test(s)) return s;
  // Tiny or huge values: fixed notation, trailing zeros trimmed.
  return v.toFixed(15).replace(/0+$/, '').replace(/\.$/, '');
}

/** mm → `"12.5 mm"`; rad → `"30 deg"` (the expression engine's units). */
export function valueExpr(v: number, unit: 'length' | 'angle'): Expr {
  return unit === 'angle' ? `${numberLiteral((v * 180) / Math.PI)} deg` : `${numberLiteral(v)} mm`;
}

const SHAFT = /^[a-z]{1,2}(01|[1-9]|1[0-8])$/;
const HOLE = /^[A-Z]{1,2}(01|[1-9]|1[0-8])$/;

const sameTargets = (a: readonly PmiTarget[], b: readonly PmiTarget[]): boolean => {
  if (a.length !== b.length) return false;
  const key = (t: PmiTarget) => `${t.body}/${t.kind}/${t.index}`;
  const ka = a.map(key).sort();
  const kb = b.map(key).sort();
  return ka.every((k, i) => k === kb[i]);
};

const nameOf = (item: PmiImportItem): string | undefined =>
  item.name ?? ('annotationId' in item ? item.annotationId : undefined);

type Semantic = Exclude<PmiImportItem, { kind: 'presentationOnly' }>;

function importTolerance(
  t: Extract<Semantic, { kind: 'dimension' }>['tolerance'],
  unit: 'length' | 'angle',
): Tolerance | { reason: string } | undefined {
  if (!t) return undefined;
  if (t.kind === 'fit') {
    if (!t.hole && !t.shaft) return { reason: 'The fit has neither a hole nor a shaft class' };
    if (t.hole && !HOLE.test(t.hole)) return { reason: `“${t.hole}” is not an ISO 286 hole class` };
    if (t.shaft && !SHAFT.test(t.shaft)) {
      return { reason: `“${t.shaft}” is not an ISO 286 shaft class` };
    }
    return {
      kind: 'fit',
      ...(t.hole ? { hole: t.hole } : {}),
      ...(t.shaft ? { shaft: t.shaft } : {}),
      show: 'symbol',
    };
  }
  if (!Number.isFinite(t.upper) || !Number.isFinite(t.lower)) {
    return { reason: 'The tolerance values are not numbers' };
  }
  if (t.upper < t.lower) return { reason: 'The upper deviation is below the lower one' };
  const scale = Math.max(Math.abs(t.upper), Math.abs(t.lower), 1e-12);
  if (Math.abs(t.upper + t.lower) <= 1e-12 * scale) {
    return { kind: 'symmetric', value: valueExpr(t.upper, unit) };
  }
  return { kind: 'bilateral', upper: valueExpr(t.upper, unit), lower: valueExpr(t.lower, unit) };
}

/**
 * Maps the items to annotations. Two passes: dimensions and datums first (frames and datums bind
 * to them), then frames.
 */
export function annotationsFromPmi(input: PmiImportInput): {
  annotations: Annotation[];
  report: PmiImportReport;
} {
  const isId = input.isId ?? ((s: string) => ULID_PATTERN.test(s));
  const used = new Set(input.existing.map((a) => a.id));
  const report: PmiImportReport = { imported: [], presentationOnly: [], skipped: [], notes: [] };
  for (const i of input.issues) {
    report.skipped.push({ ...(i.name ? { name: i.name } : {}), reason: i.reason });
  }
  const idFor = (item: Semantic): Id => {
    for (const n of [item.annotationId, item.name]) {
      if (n && isId(n) && !used.has(n)) {
        used.add(n);
        return n;
      }
    }
    let id = input.newId();
    while (used.has(id)) id = input.newId();
    used.add(id);
    return id;
  };
  const made = new Map<number, Annotation>();
  /** Dimensions made from this file, with their targets (for `appliesTo`). */
  const dims: { id: Id; targets: readonly PmiTarget[] }[] = [];
  const datumIds = new Map<string, Id>();
  for (const a of input.existing) if (a.kind === 'datumFeature') datumIds.set(a.label, a.id);
  const fileDatums = new Map<string, Id>();

  const refsOf = (e: PmiImportEntry): EntityRef[] | { reason: string } => {
    const item = e.item as Semantic;
    if (item.targets.length === 0) return { reason: 'It is attached to no model geometry' };
    if (e.refs.length !== item.targets.length) {
      return { reason: 'Its model geometry could not be matched to the imported body' };
    }
    const out: EntityRef[] = [];
    for (const r of e.refs) {
      if ('reason' in r) return { reason: r.reason };
      out.push(r);
    }
    return out;
  };
  const skipEntry = (e: PmiImportEntry, reason: string): void => {
    const name = nameOf(e.item);
    report.skipped.push({ ...(name ? { name } : {}), reason });
  };

  const appliesToFor = (targets: readonly PmiTarget[]): Id | undefined =>
    dims.find((d) => sameTargets(d.targets, targets))?.id;

  // Pass 1: dimensions, then datums (a datum on a feature of size binds to its dimension).
  for (const pass of ['dimension', 'datum'] as const) {
    for (const [index, e] of input.entries.entries()) {
      const item = e.item;
      if (item.kind !== pass) continue;
      const refs = refsOf(e);
      if ('reason' in refs) {
        skipEntry(e, refs.reason);
        continue;
      }
      if (item.kind === 'dimension') {
        const a = dimensionAnnotation(item, refs, input.origin);
        if ('reason' in a) {
          skipEntry(e, a.reason);
          continue;
        }
        const id = idFor(item);
        made.set(index, { ...a, id } as DimensionAnnotation);
        dims.push({ id, targets: item.targets });
        continue;
      }
      if (item.kind !== 'datum') continue;
      if (!/^[A-Z]{1,2}$/.test(item.label)) {
        skipEntry(e, `“${item.label}” is not a datum letter`);
        continue;
      }
      if (fileDatums.has(item.label)) {
        skipEntry(e, `Datum ${item.label} is defined twice in the file`);
        continue;
      }
      const id = idFor(item);
      const applies = appliesToFor(item.targets);
      made.set(index, {
        id,
        kind: 'datumFeature',
        origin: input.origin,
        label: item.label,
        ...(applies !== undefined ? { refs: [], appliesTo: applies } : { refs }),
      });
      fileDatums.set(item.label, id);
    }
  }
  for (const [label, id] of fileDatums) datumIds.set(label, id);

  // Pass 2: feature control frames, presentation-only items.
  for (const [index, e] of input.entries.entries()) {
    const item = e.item;
    if (item.kind === 'presentationOnly') {
      report.presentationOnly.push(item.name ? { name: item.name } : {});
      continue;
    }
    if (item.kind !== 'tolerance') continue;
    const refs = refsOf(e);
    if ('reason' in refs) {
      skipEntry(e, refs.reason);
      continue;
    }
    const characteristic = CHARACTERISTICS[item.type];
    if (!characteristic) {
      skipEntry(e, `“${String(item.type)}” is not a known tolerance type`);
      continue;
    }
    if (!Number.isFinite(item.value) || item.value < 0) {
      skipEntry(e, 'The tolerance zone is not a number');
      continue;
    }
    if ((item.datums?.length ?? 0) > 3) {
      skipEntry(e, 'It has more than three datums');
      continue;
    }
    const id = idFor(item);
    const unbound: string[] = [];
    const datums: DatumCompartment[] = (item.datums ?? []).map((d) => {
      const bound = datumIds.get(d.label);
      if (bound === undefined) unbound.push(d.label);
      return {
        datums: [bound !== undefined ? { datum: bound } : { label: d.label }],
        ...(d.material
          ? { material: d.material === 'M' ? ('mmc' as const) : ('lmc' as const) }
          : {}),
      };
    });
    const applies = appliesToFor(item.targets);
    made.set(index, {
      id,
      kind: 'geometricTolerance',
      origin: input.origin,
      characteristic,
      zone: {
        value: valueExpr(item.value, 'length'),
        ...(item.diameter ? { shape: 'diameter' as const } : {}),
        ...(item.material
          ? { material: item.material === 'M' ? ('mmc' as const) : ('lmc' as const) }
          : {}),
      },
      ...(datums.length > 0 ? { datums } : {}),
      ...(applies !== undefined ? { refs: [], appliesTo: applies } : { refs }),
    });
    for (const l of unbound) {
      report.notes.push({
        annotationId: id,
        note: `Datum ${l} is not defined in the file or the part: bind it to a datum`,
      });
    }
  }

  const annotations: Annotation[] = [];
  for (const [index, e] of input.entries.entries()) {
    const a = made.get(index);
    if (!a) continue;
    annotations.push(a);
    const name = nameOf(e.item);
    report.imported.push({ annotationId: a.id, ...(name ? { name } : {}), kind: a.kind });
  }
  return { annotations, report };
}

function dimensionAnnotation(
  item: Extract<Semantic, { kind: 'dimension' }>,
  refs: EntityRef[],
  origin: AnnotationOrigin,
): Omit<DimensionAnnotation, 'id'> | { reason: string } {
  if (!Number.isFinite(item.value)) return { reason: 'The dimension value is not a number' };
  const unit = item.type === 'angular' ? 'angle' : 'length';
  const tol = importTolerance(item.tolerance, unit);
  if (tol && 'reason' in tol) return tol;
  const base = {
    origin,
    refs,
    nominal: valueExpr(item.value, unit),
    ...(tol ? { tolerance: tol } : {}),
  };
  switch (item.type) {
    case 'linearDistance':
      if (refs.length !== 2) {
        return { reason: `A distance on ${refs.length} entities has no Wren equivalent` };
      }
      return { ...base, kind: 'linear' };
    case 'size':
      if (refs.length !== 2) {
        return { reason: 'A size dimension on one entity has no Wren equivalent yet' };
      }
      return { ...base, kind: 'linear' };
    case 'linearDiameter':
    case 'linearRadius':
      if (refs.length !== 1) {
        return {
          reason: `A ${item.type === 'linearDiameter' ? 'diameter' : 'radius'} on ${refs.length} entities has no Wren equivalent`,
        };
      }
      return { ...base, kind: item.type === 'linearDiameter' ? 'diameter' : 'radius' };
    case 'angular':
      if (refs.length !== 2) {
        return { reason: `An angle on ${refs.length} entities has no Wren equivalent` };
      }
      return { ...base, kind: 'angle' };
    case 'curveLength':
      return { reason: 'Curve length dimensions have no Wren equivalent yet' };
    case 'other':
      return { reason: 'The dimension type is not one Wren knows' };
  }
}
