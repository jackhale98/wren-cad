/**
 * Change preview (ADR-103, slice 2e.2): the exact solid the one feature being edited adds to or
 * removes from the model, evaluated beside the walk with the façade's existing entries.
 *
 * What is evaluated (`PreviewSpec.exec` runs the same feature and resolved inputs with another
 * body op, so the solid is the kernel's own for the current values and end condition):
 * - cut: tool ∩ each body the cut changed, as it was before the cut (the feature with op
 *   `intersect`). That is the material removed, so through-all needs no stand-in depth: the kernel
 *   sizes the tool from the body as it does for the real cut.
 * - intersect: each body before − tool (the feature with op `cut`): the material removed.
 * - add: the tool solid (the feature with op `new`).
 * - new, or an add that found no body and became one: the body the feature made, itself.
 * - a cut that removes nothing: its tool solid where the kernel can make one, so the user sees
 *   where the cut is.
 *
 * Rules that keep the real regen untouched:
 * - It runs after the walk and after the outputs are read, so every handle of the real result is
 *   allocated before any scratch handle. It resolves no reference and writes no model state.
 * - The solids live in one cache entry of their own, keyed by the feature's cache key under a
 *   `preview` tag (same inputs, no recompute). It is kept while the latest regen asked for it and
 *   is a spare entry afterwards, evicted like any other.
 * - A body that is borrowed (op `new`) is never cached here: its handle belongs to the feature's
 *   own entry.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  FeaturePreview,
  FeatureResult,
  MeshBuffers,
  MeshQuality,
  RegenRequest,
  Result,
  ShapeHandle,
} from '@wren-cad/contracts';
import { copyMesh } from './buffers';
import type { EngineCore } from './core';
import { hashKey } from './hash';
import type {
  CacheEntry,
  EntryResult,
  PreviewSolids,
  PreviewSpec,
  PreviewWalk,
  WalkContext,
} from './state';

/** The walk's preview request, or null: nothing is asked for, so nothing extra runs. */
export function previewWalk(request: RegenRequest): PreviewWalk | null {
  const id: unknown = request.preview?.featureId;
  return typeof id === 'string' && id !== '' ? { featureId: id } : null;
}

/** The cache key of a feature's preview entry: the feature's own key under a tag of its own. */
export function previewKey(featureKey: string): string {
  return hashKey({ t: 'preview', feature: featureKey });
}

/**
 * Called by the walk for a feature that ran ok, before its result is applied: remembers what the
 * preview is evaluated from (the bodies it is about to change, as they are now).
 */
export function notePreview(
  ctx: WalkContext,
  featureId: string,
  plan: { key: string; preview?: PreviewSpec },
  r: Extract<EntryResult, { ok: true }>,
): void {
  const want = ctx.preview;
  if (!want || want.featureId !== featureId || !plan.preview) return;
  const before = r.touched.flatMap((id) => {
    const b = ctx.state.bodies.get(id);
    return b && !b.meshOnly ? [b] : [];
  });
  want.source = { spec: plan.preview, key: plan.key, before, set: r.set };
}

type Source = NonNullable<PreviewWalk['source']>;

/** The body a feature made on its own (op `new`, or an add with nothing to add to). */
function ownBody(featureId: string, src: Source): ShapeHandle | null {
  const only = src.set.length === 1 ? src.set[0] : undefined;
  if (!only || only.id !== `B${featureId}` || src.before.length > 0) return null;
  return src.spec.op === 'new' || src.spec.op === 'add' ? only.shape : null;
}

type Built = Pick<PreviewSolids, 'effect' | 'shows'> & { shapes: readonly ShapeHandle[] };

const NONE: Built = { effect: 'add', shows: 'tool', shapes: [] };

/** Evaluates the scratch solids. Everything it keeps is returned; the rest is released. */
async function build(core: EngineCore, src: Source): Promise<Built> {
  const { spec, before } = src;
  const shapes: ShapeHandle[] = [];
  const keep = async (r: Result<FeatureResult>): Promise<void> => {
    if (!r.ok) return;
    for (const extra of r.value.bodies ?? []) {
      if (extra.shape !== r.value.shape) await core.releaseHandle(extra.shape);
    }
    // A boolean that leaves nothing is an empty shape, not an error (a cut of the whole body).
    const b = await core.boundsOf(r.value.shape);
    if (!b || b.faceCount === 0) await core.releaseHandle(r.value.shape);
    else shapes.push(r.value.shape);
  };
  try {
    if (spec.op === 'cut' || spec.op === 'intersect') {
      const part = spec.op === 'cut' ? 'intersect' : 'cut';
      for (const b of before) await keep(await spec.exec(part, b.shape));
      if (shapes.length > 0) return { effect: 'cut', shows: 'removed', shapes };
      if (spec.op === 'intersect') return NONE;
    }
    await keep(await spec.exec('new'));
    return { effect: spec.op === 'cut' ? 'cut' : 'add', shows: 'tool', shapes };
  } catch (e) {
    // What was kept so far has no owner yet: release it, or it leaks in the kernel.
    for (const s of shapes) await core.releaseHandle(s).catch(() => undefined);
    throw e;
  }
}

async function volumeOf(core: EngineCore, shapes: readonly ShapeHandle[]): Promise<number | null> {
  let volume = 0;
  for (const s of shapes) {
    const mp = await core.massOf(s);
    if (!mp) return null;
    volume += mp.volume;
  }
  return volume;
}

/** The largest extent (mm) of the bodies' bounding boxes; undefined when there is none. */
async function extentOf(
  core: EngineCore,
  bodies: readonly { shape: ShapeHandle }[],
): Promise<number | undefined> {
  let extent = 0;
  for (const b of bodies) {
    const bb = await core.boundsOf(b.shape);
    if (!bb) continue;
    for (let k = 0; k < 3; k++) {
      extent = Math.max(extent, (bb.bbox.max[k] as number) - (bb.bbox.min[k] as number));
    }
  }
  return extent > 0 ? extent : undefined;
}

/**
 * The preview of the walk's edited feature, or undefined: none was asked for, the feature did not
 * run ok, its kind has none, or the kernel could not make the solid. Call after the walk and
 * before eviction; when an entry is used its key is returned too, to be kept with the latest regen.
 */
export async function featurePreview(
  core: EngineCore,
  ctx: WalkContext,
  quality: MeshQuality,
): Promise<{ preview?: FeaturePreview; key?: string }> {
  const want = ctx.preview;
  const src = want?.source;
  if (!want || !src) return {};
  let solids: PreviewSolids;
  let key: string | undefined;
  const own = ownBody(want.featureId, src);
  if (own !== null) {
    const volume = await volumeOf(core, [own]);
    if (volume === null) return {};
    solids = { effect: 'add', shows: 'tool', shapes: [own], volume };
  } else {
    key = previewKey(src.key);
    let e: CacheEntry | undefined = ctx.pc.entries.get(key);
    if (!e?.result.ok || !e.result.preview) {
      let built: Built;
      try {
        built = await build(core, src);
      } catch {
        built = NONE;
      }
      let volume = await volumeOf(core, built.shapes);
      if (volume === null) {
        for (const s of built.shapes) await core.releaseHandle(s);
        built = NONE;
        volume = 0;
      }
      const preview: PreviewSolids = { ...built, shapes: [...built.shapes], volume };
      e = {
        key,
        owned: [...preview.shapes],
        result: { ok: true, set: [], remove: [], touched: [], preview, warnings: [] },
        lastUsed: ctx.pc.tick,
      };
      for (const h of e.owned) core.ownedHandles.add(h);
      ctx.pc.entries.set(key, e);
    }
    e.lastUsed = ctx.pc.tick;
    solids = (e.result as { preview: PreviewSolids }).preview;
  }
  if (solids.shapes.length === 0) return key === undefined ? {} : { key };
  const meshes: MeshBuffers[] = [];
  // Never finer than a body it may share faces with (see `EngineCore.meshOf`): the bodies the
  // feature acted on and made, and the final ones, which later features may have grown or merged.
  // A mesh-only body has no B-rep to share. Coarser than a small body's own mesh costs that body
  // one face at its next mesh; finer than a body's costs the whole body.
  const extent = await extentOf(core, [
    ...src.before,
    ...src.set,
    ...[...ctx.state.bodies.values()].filter((b) => !b.meshOnly),
  ]);
  for (const s of solids.shapes) {
    // The feature's own body is a real shape of the model (a final body, or the state a rollback
    // shows): it is meshed exactly as bodies are, relative to itself, because `meshOf` keeps one
    // mesh per shape and quality and a later rollback would otherwise show this one, coarser.
    const m = await core.meshOf(s, quality, own !== null ? undefined : extent);
    if (!m) return key === undefined ? {} : { key };
    // A fresh copy to transfer; a scratch solid has no persistent names to offer.
    const copy = copyMesh(m);
    copy.faceNames = [];
    copy.edgeNames = [];
    meshes.push(copy);
  }
  const preview: FeaturePreview = {
    featureId: want.featureId,
    effect: solids.effect,
    shows: solids.shows,
    meshes,
    volume: solids.volume,
  };
  return key === undefined ? { preview } : { preview, key };
}
