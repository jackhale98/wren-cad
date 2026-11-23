/**
 * M5a (ADR-100): STEP AP242 PMI in the kernel worker. Loaded on demand (`import('./pmi')` from the
 * engine), so neither the worker's start nor the app's initial route pays for it.
 *
 * Export: the part's annotations in the latest regen of the `main` slot (the active
 * configuration) → `PmiExportItem`s. Each ref is resolved to its body sub-shape with the
 * annotation rules (`annotationRefTargets`, the same `refGeometry` the resolutions use), never
 * guessed; values come from the resolutions, tolerances and GD&T semantics from the annotations
 * (`@wren-cad/io/pmi`), presentation from the M4 layout (`@wren-cad/drawing/pmi`). Targets are
 * `{ body: index in the exported shapes, kind, index: 1-based TopExp index }`.
 *
 * Sketch refs (ADR-101 phase 1c): a ref to a sketch curve or point (`S…:e(…)`, `S…:p(…)`, the
 * refs of sketch dimensions promoted by "Import model annotations") targets what the entity
 * generated (`sketchEntityGenerated`): a line's planar side face, a circle's or arc's cylinder,
 * a point's swept edge. Only a `unique` outcome is a target (merged into a survivor: exported on
 * it, with a note); anything else (construction, several consumers or sub-shapes, removed or
 * split later) skips the annotation with that outcome's reason.
 *
 * Import: a STEP import feature's PMI (read with its shapes, `RawImport.pmi`) → entries whose
 * targets are the import feature's own persistent names (`importedBodyNaming`), each with its
 * fingerprint, so the app's annotations resolve exactly; what does not map says why.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  Annotation,
  AnnotationResolution,
  EntityRef,
  ExportOptions,
  Expr,
  Id,
  ImportFeature,
  PmiExportItem,
  PmiExportReport,
  PmiImportResult,
  RefPoint,
  Result,
  Vec3,
} from '@wren-cad/contracts';
import { expressionEngine, scopeOf } from '@wren-cad/document';
import { fitToleranceDeviations } from '@wren-cad/document/drawing';
import { annotationPresentations, strokeFont } from '@wren-cad/drawing/pmi';
import {
  type PmiExportNote,
  type PmiImportEntry,
  type PmiTargetOrWhy,
  planPmiExport,
} from '@wren-cad/io/pmi';
import { type AnnotationRefTarget, annotationRefTargets, resolveAnnotations } from './annotations';
import type { EngineCore } from './core';
import { importedBodyNaming } from './exec-import';
import { generatedReason, sketchEntityGenerated } from './generated';
import { kerr } from './helpers';
import { fingerprintOf } from './refs';
import { type BodyState, type PartCache, primaryNaming, type WalkContext } from './state';

export interface PmiExportPlanOutput {
  items: PmiExportItem[];
  report: PmiExportReport;
  /** Exported with something only the presentation carries (or no presentation), per item. */
  notes: PmiExportNote[];
}

/** A context for read-only resolution against a latest regen (nothing in the slot changes). */
function readOnly(final: WalkContext): WalkContext {
  const pc = {
    ...final.pc,
    annotations: new Map(final.pc.annotations),
    lastResolved: new Map(),
    absorbed: new Map(final.pc.absorbed),
  };
  return { ...final, pc, rec: null };
}

/**
 * The export items of the part's annotations in `latest` for the exported `bodies` (in the order
 * the façade gets them), with presentation unless `options.pmi.presentation === false`.
 */
export async function planStepPmi(
  core: EngineCore,
  latest: NonNullable<PartCache['latest']>,
  bodies: readonly BodyState[],
  options: ExportOptions,
  loadFont: () => Promise<Uint8Array>,
): Promise<Result<PmiExportPlanOutput>> {
  const ctx = latest.context;
  if (!ctx) {
    return {
      ok: false,
      error: kerr('INVALID_INPUT', 'This part has not been regenerated yet', {
        hint: 'Regenerate the part before exporting.',
      }),
    };
  }
  const annotations: readonly Annotation[] = ctx.part.annotations ?? [];
  const resolved = latest.annotations ?? (await resolveAnnotations(core, readOnly(ctx), null));
  const resolutions = new Map<Id, AnnotationResolution>(resolved.map((r) => [r.annotationId, r]));
  const bodyIndex = new Map(bodies.map((b, i) => [b.id, i]));
  const meshOnly = new Set(bodies.filter((b) => b.meshOnly).map((b) => b.id));

  // Targets, by the annotation rules, for every annotation (a frame reads its dimension's);
  // sketch refs by what their entity generated.
  const targets = new Map<Id, PmiTargetOrWhy[]>();
  const sketchNotes = new Map<Id, string[]>();
  const final = readOnly(ctx);
  for (const a of annotations) {
    if (resolutions.get(a.id)?.state !== 'ok') continue;
    const raw = await annotationRefTargets(core, final, a);
    const out: PmiTargetOrWhy[] = [];
    for (let i = 0; i < raw.length; i++) {
      const ref = a.refs[i] as EntityRef;
      const g = sketchTarget(final, ref, a.at?.[i] ?? 'self');
      const t = g ?? (raw[i] as AnnotationRefTarget);
      if (g && 'note' in g && g.note)
        sketchNotes.set(a.id, [...(sketchNotes.get(a.id) ?? []), g.note]);
      if ('reason' in t) {
        out.push({ reason: t.reason });
        continue;
      }
      const body = bodyIndex.get(t.owner);
      if (body === undefined) out.push({ reason: `${t.name} is on a body that is not exported` });
      else if (meshOnly.has(t.owner)) out.push({ reason: `${t.name} is on a mesh reference body` });
      else out.push({ body, kind: t.kind, index: t.index + 1 });
    }
    targets.set(a.id, out);
  }

  const scope = scopeOf(ctx.doc);
  const evaluate = (expr: Expr, kind: 'length' | 'angle' | 'scalar'): number | undefined => {
    const r = expressionEngine.evaluate(expr, kind, scope);
    return r.ok && Number.isFinite(r.value) ? r.value : undefined;
  };
  const plan = planPmiExport({
    annotations,
    resolutions,
    targets,
    evaluate,
    ...(options.pmi?.annotations ? { only: options.pmi.annotations } : {}),
  });
  for (const item of plan.items) {
    for (const note of sketchNotes.get(item.annotationId) ?? []) {
      plan.notes.push({ annotationId: item.annotationId, note });
    }
  }
  if (options.pmi?.presentation === false || plan.items.length === 0) {
    return { ok: true, value: plan };
  }

  // Presentation from the drawings' layout, else model views.
  let ttf: Uint8Array;
  try {
    ttf = await loadFont();
  } catch (e) {
    return {
      ok: false,
      error: kerr(
        'OPERATION_FAILED',
        'The drawing font for the PMI presentation could not be loaded',
        {
          hint: 'Try again, or export without the presentation.',
          detail: String(e),
        },
      ),
    };
  }
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const b of bodies) {
    const bb = await core.boundsOf(b.shape);
    if (!bb) continue;
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k] as number, bb.bbox.min[k] as number);
      max[k] = Math.max(max[k] as number, bb.bbox.max[k] as number);
    }
  }
  const presentations = annotationPresentations({
    annotations,
    ids: plan.items.map((i) => i.annotationId),
    resolutions,
    configurationId: ctx.part.activeConfigurationId ?? null,
    drawings: ctx.doc.drawings ?? [],
    partId: ctx.part.id,
    bounds: Number.isFinite(min[0]) ? { min, max } : { min: [0, 0, 0], max: [0, 0, 0] },
    evaluate: (e, kind) => evaluate(e, kind === 'ratio' ? 'scalar' : 'angle'),
    evaluateAnnotation: (e, kind) => evaluate(e, kind),
    fitDeviations: fitToleranceDeviations,
    font: strokeFont(ttf),
  });
  const notes = [...plan.notes];
  const items = plan.items.map((item) => {
    const p = presentations.get(item.annotationId);
    if (p?.ok) return { ...item, presentation: p.presentation };
    notes.push({
      annotationId: item.annotationId,
      note: `Semantic PMI only, no presentation: ${p?.reason ?? 'not laid out'}`,
    });
    return item;
  });
  return { ok: true, value: { items, report: plan.report, notes } };
}

/** `S<sketch>:p(<id>)` / `S<sketch>:e(<id>)`. */
const SKETCH_ENTITY = /^S([0-9A-Za-z]+):([pe])\((.+)\)$/;

/**
 * The exported sub-shape of a sketch entity ref (ADR-101): what the entity generated, when that
 * is exactly one face, edge or vertex of a body; a ref at a line's or arc's `start` / `end` is
 * that end point's. Null for refs that are not sketch entities (the annotation rules apply).
 */
function sketchTarget(
  final: WalkContext,
  ref: EntityRef,
  at: RefPoint,
):
  | AnnotationRefTarget
  | (Extract<AnnotationRefTarget, { owner: string }> & { note?: string })
  | null {
  const m = SKETCH_ENTITY.exec(ref.name);
  if (!m) return null;
  const sketchId = m[1] as Id;
  let entityId = m[3] as Id;
  let name = ref.name;
  if (at !== 'self') {
    const e = final.state.sketches.get(sketchId)?.entities.find((x) => x.id === entityId);
    const ends = e?.kind === 'line' || e?.kind === 'arc' || e?.kind === 'ellipticArc';
    if (!ends || (at !== 'start' && at !== 'end')) {
      return { reason: `${ref.name} at its ${at} has no face or edge of its own in the solid` };
    }
    entityId = at === 'start' ? e.start : e.end;
    name = `S${sketchId}:p(${entityId})`;
  }
  const g = sketchEntityGenerated(final, sketchId, entityId);
  const o = g.outcome;
  if (o.kind !== 'unique') {
    return { reason: generatedReason(final, name, g) ?? `${name} generated nothing` };
  }
  const t = {
    owner: o.target.owner,
    kind: o.target.kind,
    index: o.target.index,
    name: o.target.name,
  };
  if (!o.merged) return t;
  const i = o.merged.by === null ? undefined : final.index.get(o.merged.by);
  const by = i === undefined ? undefined : final.part.features[i];
  return {
    ...t,
    note: `${name}: exported on ${o.target.name}, which ${by ? `‘${by.name}’` : 'a boolean'} merged its ${o.target.kind} ${o.name} into`,
  };
}

// ---------------------------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------------------------

/** What `ModelingWorkerApi.importedPmi` returns for one STEP import feature. */
export interface ImportedPmi {
  featureId: Id;
  /** The imported file's name, for the report and `origin.file`. */
  file: string;
  /** False: the kernel build reads no PMI (the app says so instead of "no PMI in the file"). */
  supported: boolean;
  /** Semantic and presentation items with their targets mapped to the feature's names. */
  entries: PmiImportEntry[];
  /** Entities the reader could not read at all. */
  issues: PmiImportResult['issues'];
}

/** The PMI of import feature `featureId` in the latest regen, on the feature's names. */
export async function importedPmi(
  core: EngineCore,
  final: WalkContext,
  featureId: Id,
): Promise<Result<ImportedPmi>> {
  const f = final.part.features.find((x) => x.id === featureId);
  if (f?.type !== 'import') {
    return { ok: false, error: kerr('INVALID_INPUT', 'That feature is not an import') };
  }
  const feature = f as ImportFeature;
  const file = feature.source.fileName || feature.source.path;
  const base: ImportedPmi = { featureId, file, supported: true, entries: [], issues: [] };
  if (feature.source.format !== 'step') return { ok: true, value: { ...base, supported: false } };
  const raw = final.pc.imports.get(feature.source.sha256.toLowerCase());
  if (!raw) {
    return {
      ok: false,
      error: kerr('INVALID_INPUT', 'The imported file is not loaded', {
        hint: 'Regenerate the part first.',
      }),
    };
  }
  if (!raw.pmi) return { ok: true, value: { ...base, supported: false } };

  // Names per (body, kind, 1-based index), one kernel naming run per body the PMI uses.
  const names = new Map<number, Result<Map<string, EntityRef>>>();
  const namesOf = async (body: number): Promise<Result<Map<string, EntityRef>>> => {
    const known = names.get(body);
    if (known) return known;
    const r = await importedBodyNaming(core, feature, raw, body);
    let out: Result<Map<string, EntityRef>>;
    if (!r.ok) out = r;
    else {
      const m = new Map<string, EntityRef>();
      for (const n of primaryNaming(r.value.naming)) {
        const ref: EntityRef = { name: n.name, kind: n.kind };
        const fp = r.value.fingerprints
          ? fingerprintOf(r.value.fingerprints, n.kind, n.index)
          : undefined;
        if (fp) ref.fingerprint = fp;
        m.set(`${n.kind}/${n.index + 1}`, ref);
      }
      out = { ok: true, value: m };
    }
    names.set(body, out);
    return out;
  };
  const entries: PmiImportEntry[] = [];
  for (const item of raw.pmi.items) {
    if (item.kind === 'presentationOnly') {
      entries.push({ item, refs: [] });
      continue;
    }
    const refs: PmiImportEntry['refs'][number][] = [];
    for (const t of item.targets) {
      const m = await namesOf(t.body);
      if (!m.ok) {
        refs.push({ reason: m.error.message });
        continue;
      }
      const ref = m.value.get(`${t.kind}/${t.index}`);
      refs.push(
        ref ?? {
          reason: `${t.kind} ${t.index} of body ${t.body + 1} is not in the imported shape`,
        },
      );
    }
    entries.push({ item, refs });
  }
  return { ok: true, value: { ...base, entries, issues: raw.pmi.issues } };
}
