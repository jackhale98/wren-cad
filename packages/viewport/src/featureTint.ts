/**
 * Change preview (slice 2e.1, ADR-103): what the feature being edited made, tinted by effect, and
 * the swept volume of a blind extrude drawn from its profile before the kernel answers.
 *
 * Both are viewport-local (no contract change): `setFeatureTint` draws translucent fills over the
 * faces the app names (they follow the body buffers and the theme, like highlights, and draw
 * beneath selection and hover so those still read on top); `setRegionPrism` reuses the push/pull
 * prism (`prism.ts`, `preview.ts`) on sketch-region meshes.
 */

import type { FeatureEffect, FeatureTint, MeshBuffers, RegionPrismSpec } from '@wren-cad/contracts';
import { BufferGeometry } from 'three/webgpu';
import { COMPARE_COLORS } from './compare';
import { faceDrawRange } from './ids';
import { makeFill } from './overlays';
import { PrismPreview } from './preview';
import { buildRegionPrism } from './prism';
import { requestRender } from './renderLoop';
import type { ViewportImpl } from './viewport';

// The types are the contract's (folded in with slice 2e.2); re-exported for existing imports.
export type { FeatureEffect, FeatureTint, RegionPrismSpec };

/**
 * Add and cut are the compare overlay's green and vermillion (the same words: material added,
 * material removed); modify is a violet no other overlay uses (selection and hover are blue,
 * errors red, warnings amber). Mirrored by `@wren-cad/ui` swatch tokens (unit-tested for parity).
 */
export const FEATURE_TINT_COLORS: Readonly<
  Record<'light' | 'dark', Record<FeatureEffect, string>>
> = {
  light: {
    add: COMPARE_COLORS.light.added,
    cut: COMPARE_COLORS.light.removed,
    modify: '#7c3aed',
  },
  dark: {
    add: COMPARE_COLORS.dark.added,
    cut: COMPARE_COLORS.dark.removed,
    modify: '#b794ff',
  },
};

/** Beneath hover (21) and selection (22) fills. */
export const TINT_ORDER = 19;
export const TINT_OPACITY = 0.5;

/** Draw ranges (triangle index start, count) of a face set, adjacent faces merged into one. */
export function mergedFaceRanges(
  faceRanges: Uint32Array,
  triangles: number,
  faces: readonly number[],
): Array<{ start: number; count: number }> {
  const ranges: Array<{ start: number; count: number }> = [];
  for (const f of new Set(faces)) {
    const r = faceDrawRange(faceRanges, f, triangles);
    if (r) ranges.push(r);
  }
  ranges.sort((a, b) => a.start - b.start);
  const out: Array<{ start: number; count: number }> = [];
  for (const r of ranges) {
    const last = out[out.length - 1];
    if (last && last.start + last.count >= r.start) {
      last.count = Math.max(last.count, r.start + r.count - last.start);
    } else out.push({ ...r });
  }
  return out;
}

/**
 * Part of `rebuildHighlights`: the tint fills, drawn first so highlights land on top. The caller
 * rebuilds the highlight group after `setFeatureTint` (it also does on body and theme changes).
 */
export function addTintObjects(vp: ViewportImpl): void {
  const tint = vp.tint;
  if (!tint) return;
  const color = FEATURE_TINT_COLORS[vp.theme][tint.effect];
  for (const { bodyId, faces } of tint.faces) {
    const e = vp.bodies.get(bodyId);
    if (!e) continue;
    for (const r of mergedFaceRanges(e.buffers.faceRanges, e.triangles, faces)) {
      const g = new BufferGeometry();
      g.setAttribute('position', e.geometry.getAttribute('position'));
      g.setIndex(e.geometry.index);
      g.setDrawRange(r.start, r.count);
      vp.highlightGroup.add(makeFill(g, color, TINT_OPACITY, false, TINT_ORDER));
    }
  }
}

export function setFeatureTint(vp: ViewportImpl, tint: FeatureTint | null): void {
  if (vp.disposed) return;
  vp.tint = tint && tint.faces.some((f) => f.faces.length > 0) ? tint : null;
  requestRender(vp);
}

/** Face ordinals drawn tinted right now (tests, probes). */
export function tintStats(vp: ViewportImpl): {
  effect: FeatureEffect | null;
  faces: number;
  prism: { effect: 'add' | 'cut'; distance: number; builds: number } | null;
} {
  const prism = vp.regionPrism;
  return {
    effect: vp.tint?.effect ?? null,
    faces: vp.tint?.faces.reduce((n, f) => n + f.faces.length, 0) ?? 0,
    prism: prism
      ? { effect: prism.spec.effect, distance: prism.spec.distance, builds: prism.builds }
      : null,
  };
}

export interface RegionPrismEntry {
  view: PrismPreview;
  regions: readonly MeshBuffers[];
  spec: RegionPrismSpec;
  /** Geometry builds of this entry's lifetime (a distance-only update must not add one). */
  builds: number;
}

function tintPair(vp: ViewportImpl): { add: string; cut: string } {
  const c = FEATURE_TINT_COLORS[vp.theme];
  return { add: c.add, cut: c.cut };
}

const sameRegions = (a: readonly MeshBuffers[], b: readonly MeshBuffers[]): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i]);

/**
 * The swept volume of a profile. Same distance/direction updates are uniform writes; the geometry
 * is built only when the set of regions changes.
 */
export function setRegionPrism(vp: ViewportImpl, spec: RegionPrismSpec | null): void {
  if (vp.disposed) return;
  const prev = vp.regionPrism;
  if (!spec || !(spec.distance > 0) || spec.regions.length === 0) {
    if (prev) clearRegionPrism(vp);
    requestRender(vp);
    return;
  }
  if (prev && sameRegions(prev.regions, spec.regions)) {
    prev.spec = spec;
    prev.view.update(spec.direction, spec.distance, spec.offset ?? 0, spec.effect);
    vp.previewDirty = true;
    requestRender(vp);
    return;
  }
  if (prev) clearRegionPrism(vp);
  const prism = buildRegionPrism(spec.regions);
  if (!prism) return;
  const view = new PrismPreview(prism, tintPair(vp));
  view.update(spec.direction, spec.distance, spec.offset ?? 0, spec.effect);
  vp.scene.add(view.mesh);
  vp.regionPrism = { view, regions: [...spec.regions], spec, builds: (prev?.builds ?? 0) + 1 };
  vp.previewDirty = true;
  requestRender(vp);
}

export function clearRegionPrism(vp: ViewportImpl): void {
  const p = vp.regionPrism;
  if (!p) return;
  vp.scene.remove(p.view.mesh);
  p.view.dispose();
  vp.regionPrism = null;
}

/** Theme change: the prism takes the new palette. */
export function recolorRegionPrism(vp: ViewportImpl): void {
  vp.regionPrism?.view.setColors(tintPair(vp));
}
