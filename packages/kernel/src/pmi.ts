/**
 * M5 (ADR-100) STEP AP242 PMI across the façade boundary: the JSON `exportStepPmi` takes and
 * returns, and the `pmi` member of a STEP `importFile` result. Pure (no Wasm), so the worker and
 * the tests share it.
 *
 * Indices: a `PmiTarget.body` is 0-based (into the exported shapes, or into the returned bodies);
 * `index` is 1-based in TopExp::MapShapes order, as in contracts `pmi.ts`.
 *
 * Decoding validates everything the kernel returns. Malformed output, or a target past its body's
 * sub-shape counts, is an INTERNAL error: a target is never clamped or guessed (CLAUDE.md).
 *
 * Identity: the kernel writes the annotation id as the PMI presentation name and reads that name
 * back as `name`. OCCT cannot tell a Wren file from another, so import items carry no
 * `annotationId`; `withAnnotationIds` assigns them (contract proposal: make it optional).
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  Id,
  KernelError,
  PmiDimensionType,
  PmiExportItem,
  PmiExportReport,
  PmiImportItem,
  PmiImportResult,
  PmiPresentation,
  PmiTarget,
  PmiToleranceType,
  Result,
  Vec3,
} from '@wren-cad/contracts';

/** Export report as the façade returns it: the contracts report plus per-item notes. */
export interface KernelPmiExportReport extends PmiExportReport {
  /**
   * Exported, but not exactly as given (e.g. a hole/shaft fit of which STEP holds one class).
   * Not in the contract yet (proposal).
   */
  notes: { annotationId: Id; note: string }[];
}

type WithoutAnnotationId<T> = T extends unknown ? Omit<T, 'annotationId'> : never;

/** An import item before the app gives it an annotation id. `name`: the file's name for it. */
export type KernelPmiImportItem = WithoutAnnotationId<PmiImportItem>;

/** Sub-shape counts of one returned body (the range of its targets' `index`). */
export interface PmiBodyCounts {
  faces: number;
  edges: number;
  vertices: number;
}

export interface KernelPmiImportResult {
  items: KernelPmiImportItem[];
  issues: PmiImportResult['issues'];
  counts: PmiBodyCounts[];
}

const DIMENSION_TYPES: readonly PmiDimensionType[] = [
  'linearDistance',
  'linearDiameter',
  'linearRadius',
  'angular',
  'size',
  'curveLength',
  'other',
];

const TOLERANCE_TYPES: readonly PmiToleranceType[] = [
  'straightness',
  'flatness',
  'circularity',
  'cylindricity',
  'profileOfLine',
  'profileOfSurface',
  'parallelism',
  'perpendicularity',
  'angularity',
  'position',
  'concentricity',
  'coaxiality',
  'symmetry',
  'circularRunout',
  'totalRunout',
];

const KIND_COUNT = { face: 'faces', edge: 'edges', vertex: 'vertices' } as const;

/** `pmiJson` for `exportStepPmi`. */
export function encodePmiExportItems(items: readonly PmiExportItem[]): string {
  return JSON.stringify(items);
}

class DecodeError extends Error {}

function fail(message: string): never {
  throw new DecodeError(message);
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const count = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0;

function obj(v: unknown, what: string): Record<string, unknown> {
  return isObj(v) ? v : fail(`${what} is not an object`);
}

function arr(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? v : fail(`${what} is not an array`);
}

function str(v: unknown, what: string): string {
  return typeof v === 'string' ? v : fail(`${what} is not a string`);
}

function num(v: unknown, what: string): number {
  return finite(v) ? v : fail(`${what} is not a finite number`);
}

function optStr(v: unknown, what: string): string | undefined {
  return v === undefined ? undefined : str(v, what);
}

function vec3(v: unknown, what: string): Vec3 {
  if (!Array.isArray(v) || v.length !== 3 || !v.every(finite)) fail(`${what} is not [x, y, z]`);
  const [x, y, z] = v as number[];
  return [x as number, y as number, z as number];
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], what: string): T {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fail(`${what} '${String(v)}' is not one of ${allowed.join(', ')}`);
}

function material(v: unknown, what: string): 'M' | 'L' | undefined {
  return v === undefined ? undefined : oneOf(v, ['M', 'L'] as const, what);
}

function decodeTarget(v: unknown, counts: readonly PmiBodyCounts[], what: string): PmiTarget {
  const t = obj(v, what);
  const kind = oneOf(t.kind, ['face', 'edge', 'vertex'] as const, `${what}.kind`);
  if (!Number.isInteger(t.body) || !Number.isInteger(t.index)) {
    fail(`${what} needs integer body and index`);
  }
  const body = t.body as number;
  const index = t.index as number;
  const c = counts[body];
  if (body < 0 || c === undefined)
    fail(`${what}: body ${body} is past the ${counts.length} bodies`);
  const max = (c as PmiBodyCounts)[KIND_COUNT[kind]];
  if (index < 1 || index > max)
    fail(`${what}: ${kind} ${index} is past the body's ${max} ${kind}s`);
  return { body, kind, index };
}

function decodeTargets(v: unknown, counts: readonly PmiBodyCounts[], what: string): PmiTarget[] {
  const list = arr(v, `${what}.targets`);
  if (list.length === 0) fail(`${what} has no targets`);
  return list.map((t, i) => decodeTarget(t, counts, `${what}.targets[${i}]`));
}

function decodePresentation(v: unknown, what: string): PmiPresentation {
  const p = obj(v, what);
  const plane = obj(p.plane, `${what}.plane`);
  const polylines = arr(p.polylines, `${what}.polylines`).map((line, i) => {
    const points = arr(line, `${what}.polylines[${i}]`).map((q, j) =>
      vec3(q, `${what}.polylines[${i}][${j}]`),
    );
    if (points.length < 2) fail(`${what}.polylines[${i}] has fewer than two points`);
    return points;
  });
  const out: PmiPresentation = {
    plane: {
      origin: vec3(plane.origin, `${what}.plane.origin`),
      x: vec3(plane.x, `${what}.plane.x`),
      normal: vec3(plane.normal, `${what}.plane.normal`),
    },
    polylines,
  };
  // v2 (ADR-101): filled areas, three points per triangle.
  if (p.triangles !== undefined) {
    const points = arr(p.triangles, `${what}.triangles`).map((q, j) =>
      vec3(q, `${what}.triangles[${j}]`),
    );
    if (points.length % 3 !== 0) fail(`${what}.triangles is not a multiple of three points`);
    if (points.length > 0) out.triangles = points;
  }
  return out;
}

const REFPOINTS = ['self', 'center', 'axis', 'start', 'end', 'mid', 'min', 'max'] as const;
const ZONE_MODIFIERS = [
  'freeState',
  'tangentPlane',
  'statistical',
  'combinedZone',
  'separateZones',
] as const;

function bool(v: unknown, what: string): boolean {
  return typeof v === 'boolean' ? v : fail(`${what} is not a boolean`);
}

/** v2 dimension fields (ADR-101), copied when present. */
function decodeDimensionV2(
  item: Extract<KernelPmiImportItem, { kind: 'dimension' }>,
  raw: Record<string, unknown>,
  what: string,
): void {
  if (raw.direction !== undefined) item.direction = vec3(raw.direction, `${what}.direction`);
  if (raw.at !== undefined) {
    item.at = arr(raw.at, `${what}.at`).map((p, i) => oneOf(p, REFPOINTS, `${what}.at[${i}]`));
  }
  if (raw.qualifier !== undefined) {
    item.qualifier = oneOf(raw.qualifier, ['basic', 'reference'] as const, `${what}.qualifier`);
  }
  if (raw.ordinate !== undefined) item.ordinate = bool(raw.ordinate, `${what}.ordinate`);
  if (raw.spherical !== undefined) item.spherical = bool(raw.spherical, `${what}.spherical`);
}

/** v2 tolerance fields (ADR-101), copied when present. */
function decodeToleranceV2(
  item: Extract<KernelPmiImportItem, { kind: 'tolerance' }>,
  raw: Record<string, unknown>,
  what: string,
): void {
  if (raw.spherical !== undefined) item.spherical = bool(raw.spherical, `${what}.spherical`);
  if (raw.modifiers !== undefined) {
    item.modifiers = arr(raw.modifiers, `${what}.modifiers`).map((m, i) =>
      oneOf(m, ZONE_MODIFIERS, `${what}.modifiers[${i}]`),
    );
  }
  if (raw.projected !== undefined) item.projected = num(raw.projected, `${what}.projected`);
  if (raw.unequal !== undefined) item.unequal = num(raw.unequal, `${what}.unequal`);
  if (raw.allAround !== undefined) item.allAround = bool(raw.allAround, `${what}.allAround`);
}

/** Copies the optional `name` and `presentation` of an item. */
function decorate<T extends object>(
  item: T,
  raw: Record<string, unknown>,
  what: string,
): T & { name?: string; presentation?: PmiPresentation } {
  const out: T & { name?: string; presentation?: PmiPresentation } = item;
  const name = optStr(raw.name, `${what}.name`);
  if (name !== undefined) out.name = name;
  if (raw.presentation !== undefined) {
    out.presentation = decodePresentation(raw.presentation, `${what}.presentation`);
  }
  return out;
}

function decodeImportItem(
  v: unknown,
  counts: readonly PmiBodyCounts[],
  what: string,
): KernelPmiImportItem {
  const raw = obj(v, what);
  switch (raw.kind) {
    case 'dimension': {
      const item: Extract<KernelPmiImportItem, { kind: 'dimension' }> = {
        kind: 'dimension',
        type: oneOf(raw.type, DIMENSION_TYPES, `${what}.type`),
        targets: decodeTargets(raw.targets, counts, what),
        value: num(raw.value, `${what}.value`),
      };
      if (raw.tolerance !== undefined) {
        const t = obj(raw.tolerance, `${what}.tolerance`);
        if (t.kind === 'deviation') {
          const upper = num(t.upper, `${what}.tolerance.upper`);
          const lower = num(t.lower, `${what}.tolerance.lower`);
          item.tolerance = { kind: 'deviation', upper, lower };
        } else if (t.kind === 'fit') {
          const hole = optStr(t.hole, `${what}.tolerance.hole`);
          const shaft = optStr(t.shaft, `${what}.tolerance.shaft`);
          if (hole === undefined && shaft === undefined) fail(`${what}.tolerance names no class`);
          item.tolerance = {
            kind: 'fit',
            ...(hole === undefined ? {} : { hole }),
            ...(shaft === undefined ? {} : { shaft }),
          };
        } else {
          fail(`${what}.tolerance.kind '${String(t.kind)}' is unknown`);
        }
      }
      decodeDimensionV2(item, raw, what);
      return decorate(item, raw, what);
    }
    case 'datum': {
      const label = str(raw.label, `${what}.label`);
      if (label === '') fail(`${what}.label is empty`);
      return decorate(
        { kind: 'datum', label, targets: decodeTargets(raw.targets, counts, what) },
        raw,
        what,
      );
    }
    case 'tolerance': {
      const item: Extract<KernelPmiImportItem, { kind: 'tolerance' }> = {
        kind: 'tolerance',
        type: oneOf(raw.type, TOLERANCE_TYPES, `${what}.type`),
        targets: decodeTargets(raw.targets, counts, what),
        value: num(raw.value, `${what}.value`),
      };
      if (raw.diameter !== undefined) {
        if (typeof raw.diameter !== 'boolean') fail(`${what}.diameter is not a boolean`);
        item.diameter = raw.diameter as boolean;
      }
      const m = material(raw.material, `${what}.material`);
      if (m !== undefined) item.material = m;
      if (raw.datums !== undefined) {
        const datums = arr(raw.datums, `${what}.datums`);
        if (datums.length > 3) fail(`${what} references more than three datums`);
        item.datums = datums.map((d, i) => {
          const ref = obj(d, `${what}.datums[${i}]`);
          const label = str(ref.label, `${what}.datums[${i}].label`);
          const dm = material(ref.material, `${what}.datums[${i}].material`);
          return dm === undefined ? { label } : { label, material: dm };
        });
      }
      decodeToleranceV2(item, raw, what);
      return decorate(item, raw, what);
    }
    case 'presentationOnly': {
      const name = optStr(raw.name, `${what}.name`);
      const presentation = decodePresentation(raw.presentation, `${what}.presentation`);
      return name === undefined
        ? { kind: 'presentationOnly', presentation }
        : { kind: 'presentationOnly', name, presentation };
    }
    default:
      return fail(`${what}.kind '${String(raw.kind)}' is unknown`);
  }
}

const internal = (message: string, detail: string): { ok: false; error: KernelError } => ({
  ok: false,
  error: { code: 'INTERNAL', message, detail },
});

/**
 * Validates the `pmi` member of a STEP import value. `bodyCount`: the number of bodies the same
 * result returned (the counts must cover exactly those).
 */
export function decodePmiImport(value: unknown, bodyCount: number): Result<KernelPmiImportResult> {
  try {
    const v = obj(value, 'pmi');
    const counts = arr(v.counts, 'pmi.counts').map((c, i) => {
      const o = obj(c, `pmi.counts[${i}]`);
      if (!count(o.faces) || !count(o.edges) || !count(o.vertices)) {
        fail(`pmi.counts[${i}] needs non-negative integer faces, edges and vertices`);
      }
      return { faces: o.faces as number, edges: o.edges as number, vertices: o.vertices as number };
    });
    if (counts.length !== bodyCount) {
      fail(`pmi.counts covers ${counts.length} bodies, the result has ${bodyCount}`);
    }
    const items = arr(v.items, 'pmi.items').map((item, i) =>
      decodeImportItem(item, counts, `pmi.items[${i}]`),
    );
    const issues = arr(v.issues, 'pmi.issues').map((issue, i) => {
      const o = obj(issue, `pmi.issues[${i}]`);
      const reason = str(o.reason, `pmi.issues[${i}].reason`);
      const name = optStr(o.name, `pmi.issues[${i}].name`);
      const code = optStr(o.code, `pmi.issues[${i}].code`);
      const severity =
        o.severity === undefined
          ? undefined
          : oneOf(
              o.severity,
              ['lost', 'approximated', 'cosmetic'] as const,
              `pmi.issues[${i}].severity`,
            );
      return {
        ...(name === undefined ? {} : { name }),
        reason,
        ...(code === undefined ? {} : { code }),
        ...(severity === undefined ? {} : { severity }),
      };
    });
    return { ok: true, value: { items, issues, counts } };
  } catch (e) {
    if (e instanceof DecodeError) {
      return internal('The geometry kernel returned malformed PMI', e.message);
    }
    throw e;
  }
}

/** Validates the `pmi` report of an `exportStepPmi` value. */
export function decodePmiExportReport(value: unknown): Result<KernelPmiExportReport> {
  try {
    const v = obj(value, 'pmi');
    if (!count(v.exported)) fail('pmi.exported is not a non-negative integer');
    const pairs = (list: unknown, key: 'reason' | 'note', what: string) =>
      arr(list, what).map((s, i) => {
        const o = obj(s, `${what}[${i}]`);
        return {
          annotationId: str(o.annotationId, `${what}[${i}].annotationId`),
          text: str(o[key], `${what}[${i}].${key}`),
        };
      });
    const skipped = pairs(v.skipped, 'reason', 'pmi.skipped').map((s) => ({
      annotationId: s.annotationId,
      reason: s.text,
    }));
    const notes =
      v.notes === undefined
        ? []
        : pairs(v.notes, 'note', 'pmi.notes').map((n) => ({
            annotationId: n.annotationId,
            note: n.text,
          }));
    return { ok: true, value: { exported: v.exported as number, skipped, notes } };
  } catch (e) {
    if (e instanceof DecodeError) {
      return internal('The geometry kernel returned a malformed PMI export report', e.message);
    }
    throw e;
  }
}

/**
 * Gives every import item an annotation id (contracts `PmiImportResult`). `assign` sees the item
 * (its `name` is the annotation id when the file came from Wren) and its position.
 */
export function withAnnotationIds(
  result: KernelPmiImportResult,
  assign: (item: KernelPmiImportItem, index: number) => Id,
): PmiImportResult {
  return {
    items: result.items.map((item, i): PmiImportItem => {
      if (item.kind === 'presentationOnly') return item;
      return { ...item, annotationId: assign(item, i) } as PmiImportItem;
    }),
    issues: result.issues,
  };
}
