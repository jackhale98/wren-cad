/**
 * ADR-101 (shared building block): what a sketch entity generated in a regen. Given a sketch
 * feature and one of its entities, the faces, edges or vertices each consuming feature made from
 * it, by persistent name (naming.ts), and where each is in the final state of the slot. Used by the
 * STEP PMI export of sketch dimensions (pmi.ts); later by sketch dimensions shown in 3D and by
 * mates on sketch-driven faces.
 *
 * Read from the regen's walk (cause.ts: every ok feature's output containers with their naming
 * maps, merge aliases included) and its final state; no kernel call, nothing in the slot changes.
 * Deterministic, never a guess:
 *
 *  - a curve (line, arc, circle, ellipse, spline) generates the faces `F<feat>:side(S<sk>:e(<id>))`
 *    (with `#k` split pieces) of each feature that swept it (extrude, revolve, sweep, loft: a
 *    plane or cylinder from an extruded line or circle; a cone, cylinder, plane or torus from a
 *    revolved one);
 *  - a point generates the edge each feature swept from it: the edge between two of that
 *    feature's side faces whose curves meet at the point (an end point shared, or joined by a
 *    `coincident` constraint); a point on a revolve axis or a circle's centre sweeps none;
 *  - a hole at a sketch point generates the hole's faces `F<hole>:hole(S<sk>:p(<id>)):<role>`.
 *
 * Each generated name is then followed through the later features: still there (`present`),
 * merged into another sub-shape by a boolean (`merged`, the ADR-078 merge alias: the survivor
 * contains it), cut into pieces (`split`), merged into different sub-shapes by different features
 * (`conflict`), or gone (`removed`: a fillet, chamfer, cut or boolean took it), with the first
 * feature after which it was no longer there. The summary `outcome` is `unique` only when exactly
 * one feature made exactly one sub-shape from the entity and it is present or merged; everything
 * else is its own outcome (generated nothing and why, several consumers, several sub-shapes,
 * removed, split, conflict, not available).
 *
 * Pattern and mirror copies (`F<copy>:inst<k>(…)`, `F<copy>:mirror(…)`) are made by the copy
 * feature, not swept from the entity, and are not counted.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Feature, FeatureStatus, Id, NamingMap, SketchEntity } from '@wren-cad/contracts';
import { SKETCH_ORIGIN, SKETCH_X_AXIS, SKETCH_Y_AXIS } from '@wren-cad/contracts';
import type { WalkContainer } from './cause';
import { baseName, type SubKind } from './resolve';
import { mergeLookup, primaryNaming, type WalkContext } from './state';

/** A sub-shape of a body in the slot's final state. */
export interface GeneratedTarget {
  /** Its current persistent name. */
  name: string;
  kind: SubKind;
  /** The body that owns it (`B…`). */
  owner: string;
  /** 0-based TopExp index in that body's shape. */
  index: number;
}

/** Where a generated sub-shape is in the final state. */
export type GeneratedNow =
  | { state: 'present'; target: GeneratedTarget }
  /** A boolean merged it into `target` (which contains it); `by`: the feature that merged it. */
  | { state: 'merged'; target: GeneratedTarget; by: Id | null }
  /** `by` cut it into `pieces` (name family members). */
  | { state: 'split'; pieces: GeneratedTarget[]; by: Id | null }
  /** Merged into different sub-shapes by different features (`candidates`): not one. */
  | { state: 'conflict'; candidates: string[]; by: Id | null }
  /** Gone after `by` (a fillet, chamfer, cut or boolean); null when no feature can be named. */
  | { state: 'removed'; by: Id | null };

export interface GeneratedSub {
  /** The name the consuming feature gave it (in that feature's own output). */
  name: string;
  kind: SubKind;
  now: GeneratedNow;
}

/** One feature that consumed the entity (a profile, a loft section, a hole point). */
export interface GeneratedConsumer {
  featureId: Id;
  state: FeatureStatus['state'];
  /** What it made from the entity, in its own output order; empty when nothing. */
  made: GeneratedSub[];
}

/** Why an entity generated nothing. */
export type NothingWhy =
  /** Construction geometry (the sketch origin and axes too): never forms profiles. */
  | 'construction'
  /** No feature uses it. */
  | 'unconsumed'
  /** Only a revolve axis or a sweep path uses it: they make no face of their own. */
  | 'axisOrPath'
  /** A point no consuming feature sweeps into an edge (a circle centre, a point on the axis). */
  | 'notSwept'
  /** The consuming features ran but kept nothing made from it (a cut that missed the body). */
  | 'notInResult'
  /** Every consuming feature failed, is blocked, suppressed or after the rollback bar. */
  | 'consumerNotOk';

export type GeneratedOutcome =
  | {
      kind: 'unique';
      featureId: Id;
      /** The consuming feature's own name for it. */
      name: string;
      target: GeneratedTarget;
      /** Set when it is there merged into `target` (by feature `by`). */
      merged?: { by: Id | null };
    }
  | {
      kind: 'nothing';
      why: NothingWhy;
      /** `notSwept`: the circle or arc the point is the centre of, when it is one. */
      centreOf?: Id;
      featureIds?: Id[];
    }
  | { kind: 'several'; featureIds: Id[] }
  | { kind: 'multiple'; featureId: Id; names: string[] }
  | { kind: 'removed'; featureId: Id; name: string; by: Id | null }
  | { kind: 'split'; featureId: Id; name: string; by: Id | null; pieces: string[] }
  | { kind: 'conflict'; featureId: Id; name: string; by: Id | null; candidates: string[] }
  | { kind: 'unavailable'; why: 'sketch' | 'entity' };

export interface SketchGenerated {
  sketchId: Id;
  entityId: Id;
  /** The entity's kind (`point` for the sketch origin, `line` for its axes). */
  entity?: SketchEntity['kind'];
  consumers: GeneratedConsumer[];
  outcome: GeneratedOutcome;
}

const isBody = (c: WalkContainer) => !c.id.includes(':');

/** `S<sk>:region(a,b|c)` → its curve ids without split suffixes, or null for another name. */
function regionCurves(name: string, sketchId: Id): Set<string> | null {
  const prefix = `S${sketchId}:region(`;
  if (!name.startsWith(prefix)) return null;
  const close = name.lastIndexOf(')');
  if (close < prefix.length) return null;
  const ids = name
    .slice(prefix.length, close)
    .split(/[,|]/)
    .map((s) => s.replace(/#\d+$/, '').trim())
    .filter(Boolean);
  return new Set(ids);
}

/** End points of a curve (none for closed curves). */
function endPoints(e: SketchEntity): Id[] {
  switch (e.kind) {
    case 'line':
    case 'arc':
    case 'ellipticArc':
      return [e.start, e.end];
    case 'bspline':
      return e.periodic || e.poles.length === 0
        ? []
        : [e.poles[0] as Id, e.poles[e.poles.length - 1] as Id];
    default:
      return [];
  }
}

/** Point ids joined to `point` by `coincident` constraints (transitively), itself included. */
function coincidentClass(f: Extract<Feature, { type: 'sketch' }>, point: Id): Set<Id> {
  const out = new Set<Id>([point]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const c of f.constraints) {
      if (c.kind !== 'coincident') continue;
      if (out.has(c.a) && !out.has(c.b)) {
        out.add(c.b);
        grew = true;
      } else if (out.has(c.b) && !out.has(c.a)) {
        out.add(c.a);
        grew = true;
      }
    }
  }
  return out;
}

/** Top-level components of `edge(a|b)` / `vertex(a|b|c)` (split suffix on the whole dropped). */
function components(name: string, head: 'edge' | 'vertex'): string[] | null {
  const m = new RegExp(`^${head}\\((.*)\\)(?:#\\d+)?$`).exec(name);
  if (!m) return null;
  const inner = m[1] as string;
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      out.push(inner.slice(from, i));
      from = i + 1;
    }
  }
  out.push(inner.slice(from));
  return out;
}

/** Is `name` primary (not only a merge alias) in one of `containers`? */
function primaryIn(containers: Iterable<NamingMap>, name: string, kind: SubKind): boolean {
  for (const naming of containers) {
    for (const n of primaryNaming(naming)) if (n.kind === kind && n.name === name) return true;
  }
  return false;
}

/** Where `name` (primary) is in the final bodies, or null. */
function finalTarget(ctx: WalkContext, name: string, kind: SubKind): GeneratedTarget | null {
  for (const b of ctx.state.bodies.values()) {
    if (b.meshOnly) continue;
    for (const n of primaryNaming(b.naming)) {
      if (n.kind === kind && n.name === name) return { name, kind, owner: b.id, index: n.index };
    }
  }
  return null;
}

/** Other members of `name`'s family (same name up to `#k`) in the final bodies. */
function finalPieces(ctx: WalkContext, name: string, kind: SubKind): GeneratedTarget[] {
  const fam = baseName(name);
  const out: GeneratedTarget[] = [];
  for (const b of ctx.state.bodies.values()) {
    if (b.meshOnly) continue;
    for (const n of primaryNaming(b.naming)) {
      if (n.kind === kind && n.name !== name && baseName(n.name) === fam) {
        out.push({ name: n.name, kind, owner: b.id, index: n.index });
      }
    }
  }
  return out;
}

/**
 * Follows generated `name` from walk position `from` (its consumer) to the final state: where it
 * is, and the first feature after which it was no longer there under its own name.
 */
function follow(ctx: WalkContext, from: number, name: string, kind: SubKind): GeneratedNow {
  const live = new Map<string, NamingMap>();
  let gone: Id | null = null;
  let mergedBy: Id | null = null;
  const entries = ctx.walk.entries;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (!e?.delta) continue;
    for (const id of e.delta.remove) live.delete(id);
    for (const c of e.delta.set) {
      if (!isBody(c)) continue;
      live.set(c.id, c.naming);
      // A merge alias of the name in this feature's output: this feature merged it.
      if (i >= from && mergedBy === null) {
        const alias = c.naming.some((n) => n.kind === kind && n.name === name);
        if (alias && !primaryIn([c.naming], name, kind)) mergedBy = e.id;
      }
    }
    if (i >= from && gone === null && !primaryIn(live.values(), name, kind)) gone = e.id;
  }
  const here = finalTarget(ctx, name, kind);
  if (here) return { state: 'present', target: here };
  const m = mergeLookup(ctx.state, kind, name);
  if (m.conflict) return { state: 'conflict', candidates: m.conflict, by: mergedBy ?? gone };
  for (const into of m.chain) {
    const t = finalTarget(ctx, into, kind);
    if (t) return { state: 'merged', target: t, by: mergedBy ?? gone };
  }
  const pieces = finalPieces(ctx, name, kind);
  if (pieces.length > 0) return { state: 'split', pieces, by: gone };
  return { state: 'removed', by: gone };
}

/** Features that use the entity by definition, and whether only as an axis or path. */
function definitionalUse(
  ctx: WalkContext,
  sketchId: Id,
  entityId: Id,
  isPoint: boolean,
  related: ReadonlySet<Id>,
): { consumers: Id[]; axisOrPath: Id[] } {
  const consumers: Id[] = [];
  const axisOrPath: Id[] = [];
  const own = (n: string) =>
    n === `S${sketchId}:${isPoint ? 'p' : 'e'}(${entityId})` ||
    baseName(n) === `S${sketchId}:${isPoint ? 'p' : 'e'}(${entityId})`;
  const inRegion = (n: string) => {
    const ids = regionCurves(n, sketchId);
    if (!ids) return false;
    if (!isPoint) return ids.has(entityId);
    for (const c of related) if (ids.has(c)) return true;
    return false;
  };
  for (const f of ctx.part.features) {
    let profiles: string[] = [];
    let other: string[] = [];
    switch (f.type) {
      case 'extrude':
        profiles = f.profile.map((r) => r.name);
        break;
      case 'revolve':
        profiles = f.profile.map((r) => r.name);
        other = [f.axis.name];
        break;
      case 'sweep':
        profiles = f.profile.map((r) => r.name);
        other = f.path.map((r) => r.name);
        break;
      case 'loft':
        profiles = f.sections.map((r) => r.name);
        other = (f.guides ?? []).map((r) => r.name);
        break;
      case 'hole':
        profiles = f.points.map((r) => r.name);
        break;
      default:
        continue;
    }
    if (profiles.some((n) => inRegion(n) || (isPoint && own(n)))) consumers.push(f.id);
    else if (other.some(own)) axisOrPath.push(f.id);
  }
  return { consumers, axisOrPath };
}

/**
 * What entity `entityId` of sketch `sketchId` generated in the regen whose final walk context is
 * `ctx` (the latest regen of a slot). Reads the walk and the final state; changes nothing.
 */
export function sketchEntityGenerated(
  ctx: WalkContext,
  sketchId: Id,
  entityId: Id,
): SketchGenerated {
  const base = { sketchId, entityId };
  const i = ctx.index.get(sketchId);
  const f = i === undefined ? undefined : ctx.part.features[i];
  const s = ctx.state.sketches.get(sketchId);
  if (f?.type !== 'sketch' || !s || ctx.walk.byId.get(sketchId)?.state !== 'ok') {
    return { ...base, consumers: [], outcome: { kind: 'unavailable', why: 'sketch' } };
  }
  if (entityId === SKETCH_ORIGIN || entityId === SKETCH_X_AXIS || entityId === SKETCH_Y_AXIS) {
    return {
      ...base,
      entity: entityId === SKETCH_ORIGIN ? 'point' : 'line',
      consumers: [],
      outcome: { kind: 'nothing', why: 'construction' },
    };
  }
  const entity = s.entities.find((e) => e.id === entityId);
  if (!entity) {
    return { ...base, consumers: [], outcome: { kind: 'unavailable', why: 'entity' } };
  }
  const withKind = { ...base, entity: entity.kind };
  if (entity.construction) {
    return { ...withKind, consumers: [], outcome: { kind: 'nothing', why: 'construction' } };
  }
  const isPoint = entity.kind === 'point';
  const byId = new Map(s.entities.map((e) => [e.id, e]));

  // A point: the profile curves whose end points are it (or coincident with it).
  const curvesThrough = new Set<Id>();
  let centreOf: Id | undefined;
  if (isPoint) {
    const same = coincidentClass(f, entityId);
    for (const e of s.entities) {
      if (e.construction) continue;
      if (endPoints(e).some((p) => same.has(p))) curvesThrough.add(e.id);
      if (
        centreOf === undefined &&
        (e.kind === 'circle' || e.kind === 'arc') &&
        same.has(e.center)
      ) {
        centreOf = e.id;
      }
    }
  }

  // What each walk entry made from it, in walk order.
  const sk = `S${sketchId}`;
  const made = new Map<Id, { pos: number; names: { name: string; kind: SubKind }[] }>();
  ctx.walk.entries.forEach((e, pos) => {
    if (e.state !== 'ok' || !e.delta) return;
    const tag = `F${e.id}:`;
    const sides = new Set(
      [...curvesThrough].filter((c) => byId.has(c)).map((c) => `${tag}side(${sk}:e(${c}))`),
    );
    const want = `${tag}side(${sk}:e(${entityId}))`;
    const hole = `${tag}hole(${sk}:p(${entityId})):`;
    const names: { name: string; kind: SubKind }[] = [];
    const seen = new Set<string>();
    for (const c of e.delta.set) {
      if (!isBody(c)) continue;
      for (const n of c.naming) {
        const key = `${n.kind}|${n.name}`;
        if (seen.has(key)) continue;
        let hit = false;
        if (!isPoint) hit = n.kind === 'face' && baseName(n.name) === want;
        else if (n.kind === 'face') hit = n.name.startsWith(hole);
        else if (n.kind === 'edge') {
          const parts = components(n.name, 'edge');
          if (parts && parts.length === 2) {
            const [a, b] = parts.map(baseName) as [string, string];
            hit = a !== b && sides.has(a) && sides.has(b);
          }
        }
        if (hit) {
          seen.add(key);
          names.push({ name: n.name, kind: n.kind });
        }
      }
    }
    if (names.length > 0) made.set(e.id, { pos, names });
  });

  // A point is used by the features whose profiles have a curve it ends or centres.
  const related = new Set(curvesThrough);
  if (isPoint) {
    const same = coincidentClass(f, entityId);
    for (const e of s.entities) {
      if ((e.kind === 'circle' || e.kind === 'arc') && same.has(e.center)) related.add(e.id);
    }
  }
  const use = definitionalUse(ctx, sketchId, entityId, isPoint, related);
  const ids = [...new Set([...use.consumers, ...made.keys()])].sort(
    (a, b) => (ctx.index.get(a) ?? 0) - (ctx.index.get(b) ?? 0),
  );
  const consumers: GeneratedConsumer[] = ids.map((id) => {
    const m = made.get(id);
    return {
      featureId: id,
      state: ctx.walk.byId.get(id)?.state ?? 'rolledBack',
      made: m ? m.names.map((n) => ({ ...n, now: follow(ctx, m.pos, n.name, n.kind) })) : [],
    };
  });

  const makers = consumers.filter((c) => c.made.length > 0);
  if (makers.length === 0) {
    const nothing = (why: NothingWhy, extra: { featureIds?: Id[]; centreOf?: Id } = {}) => ({
      ...withKind,
      consumers,
      outcome: { kind: 'nothing' as const, why, ...extra },
    });
    if (consumers.length === 0) {
      return use.axisOrPath.length > 0
        ? nothing('axisOrPath', { featureIds: use.axisOrPath })
        : nothing('unconsumed');
    }
    const featureIds = consumers.map((c) => c.featureId);
    if (consumers.every((c) => c.state !== 'ok')) return nothing('consumerNotOk', { featureIds });
    // A point that is no profile curve's end (a centre, a free point) sweeps no edge.
    const hole = consumers.some((c) => {
      const k = ctx.index.get(c.featureId);
      return k !== undefined && ctx.part.features[k]?.type === 'hole';
    });
    if (isPoint && !hole) {
      return nothing('notSwept', { featureIds, ...(centreOf ? { centreOf } : {}) });
    }
    return nothing('notInResult', { featureIds });
  }
  if (makers.length > 1) {
    return {
      ...withKind,
      consumers,
      outcome: { kind: 'several', featureIds: makers.map((c) => c.featureId) },
    };
  }
  const c = makers[0] as GeneratedConsumer;
  if (c.made.length > 1) {
    return {
      ...withKind,
      consumers,
      outcome: { kind: 'multiple', featureId: c.featureId, names: c.made.map((m) => m.name) },
    };
  }
  const sub = c.made[0] as GeneratedSub;
  const at = { featureId: c.featureId, name: sub.name };
  let outcome: GeneratedOutcome;
  switch (sub.now.state) {
    case 'present':
      outcome = { kind: 'unique', ...at, target: sub.now.target };
      break;
    case 'merged':
      outcome = { kind: 'unique', ...at, target: sub.now.target, merged: { by: sub.now.by } };
      break;
    case 'split':
      outcome = {
        kind: 'split',
        ...at,
        by: sub.now.by,
        pieces: sub.now.pieces.map((p) => p.name),
      };
      break;
    case 'conflict':
      outcome = { kind: 'conflict', ...at, by: sub.now.by, candidates: sub.now.candidates };
      break;
    case 'removed':
      outcome = { kind: 'removed', ...at, by: sub.now.by };
      break;
  }
  return { ...withKind, consumers, outcome };
}

// ---------------------------------------------------------------------------------------------
// Plain-language reasons (reports)
// ---------------------------------------------------------------------------------------------

/** `‘Fillet 1’`, or the id when the feature is not in the part. */
function label(ctx: WalkContext, id: Id | null | undefined): string {
  if (!id) return 'a later feature';
  const i = ctx.index.get(id);
  const f = i === undefined ? undefined : ctx.part.features[i];
  return f ? `‘${f.name}’` : id;
}

const WHAT: Partial<Record<SketchEntity['kind'], string>> = { point: 'edge' };

/**
 * Why `g` is not one sub-shape, in a sentence naming the entity (`ref`, its persistent name) and
 * the features involved; null for a `unique` outcome.
 */
export function generatedReason(ctx: WalkContext, ref: string, g: SketchGenerated): string | null {
  const o = g.outcome;
  const what = (g.entity && WHAT[g.entity]) ?? 'face';
  switch (o.kind) {
    case 'unique':
      return null;
    case 'unavailable':
      return o.why === 'sketch'
        ? `${ref}: its sketch is not in the model`
        : `${ref} is not in its sketch`;
    case 'nothing':
      switch (o.why) {
        case 'construction':
          return `${ref} is construction geometry: it generated no face or edge`;
        case 'unconsumed':
          return `${ref} is used by no feature: it generated no face or edge`;
        case 'axisOrPath':
          return `${ref} is only an axis or a path (${o.featureIds?.map((id) => label(ctx, id)).join(', ')}): it generated no face or edge`;
        case 'notSwept':
          return o.centreOf
            ? `${ref} is the centre of S${g.sketchId}:e(${o.centreOf}): it sweeps no edge`
            : `${ref} is not the end of a profile curve: it sweeps no edge`;
        case 'notInResult':
          return `${o.featureIds?.map((id) => label(ctx, id)).join(', ')} kept nothing made from ${ref}`;
        case 'consumerNotOk':
          return `${o.featureIds?.map((id) => label(ctx, id)).join(', ')}, which uses ${ref}, did not regenerate`;
      }
      return `${ref} generated nothing`;
    case 'several':
      return `${ref} generated a ${what} in each of ${o.featureIds.map((id) => label(ctx, id)).join(', ')}: not one ${what}`;
    case 'multiple':
      return `${ref} generated ${o.names.length} ${what}s in ${label(ctx, o.featureId)}: not one ${what}`;
    case 'removed':
      return `The ${what} ${label(ctx, o.featureId)} made from ${ref} was removed by ${label(ctx, o.by)}`;
    case 'split':
      return `The ${what} ${label(ctx, o.featureId)} made from ${ref} was split into ${o.pieces.length} by ${label(ctx, o.by)}`;
    case 'conflict':
      return `The ${what} ${label(ctx, o.featureId)} made from ${ref} was merged into ${o.candidates.length} different ${what}s`;
  }
}
