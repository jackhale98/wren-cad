/**
 * Change preview (ADR-103, slice 2e.2): the exact solid the feature being edited adds or removes
 * (`RegenResult.preview`), drawn translucent in the 2e.1 effect colour.
 *
 * Three layers per solid, all without depth write, in the section-clipped body root:
 * - a fill that is depth-tested, so the part in front of the model reads at full strength. It is
 *   pulled toward the camera like every coplanar overlay, because an added solid's faces are the
 *   body's new faces and a removed solid's walls are the walls of the hole it left;
 * - the same fill drawn through the model, fainter, so a pocket on the far side or a tool inside
 *   the body is still seen from outside the part;
 * - the solid's edges drawn through the model: the outline of what is removed or added. Removed
 *   material is dashed, as in the compare overlay (a cue that does not depend on colour).
 *
 * Everything is drawn in the group order just below the highlight group, so hover and selection
 * fills and edges land on top. Not in the ID scene: it can never be picked.
 */

import type { FeatureEffect, MeshBuffers } from '@wren-cad/contracts';
import { uniform } from 'three/tsl';
import {
  Color,
  DoubleSide,
  Group,
  LessEqualDepth,
  Mesh,
  MeshBasicNodeMaterial,
} from 'three/webgpu';
import { FEATURE_TINT_COLORS } from './featureTint';
import { edgesToSegments, meshBuffersToGeometry } from './geometry';
import { applyDepthBias, disposeOverlay, makeLines } from './overlays';
import { facetShade } from './preview';
import { requestRender } from './renderLoop';
import type { ViewportImpl } from './viewport';

export interface FeatureSolidSpec {
  /** Picks the colour: material added, material removed (or a reshaping tool). */
  effect: FeatureEffect;
  /** The solids' meshes (the buffers are kept, not copied). */
  meshes: readonly MeshBuffers[];
}

/** Just below the highlight group (20): hover and selection draw over the solid. */
export const SOLID_GROUP_ORDER = 19;
/** The depth-tested fill: what is in front of the model. */
export const SOLID_OPACITY = 0.5;
/** The fill drawn through the model: what the model hides. */
export const SOLID_THROUGH_OPACITY = 0.34;
const EDGE_WIDTH = 1.8;

export interface FeatureSolidEntry {
  spec: FeatureSolidSpec;
  root: Group;
  materials: MeshBasicNodeMaterial[];
  color: ColorUniform;
  triangles: number;
  /** Builds in this viewport's lifetime (tests: the same spec is not rebuilt). */
  builds: number;
}

const colorUniform = (hex: string) => uniform(new Color(hex));
type ColorUniform = ReturnType<typeof colorUniform>;

function fillMaterial(color: ColorUniform, opacity: number, through: boolean) {
  const m = new MeshBasicNodeMaterial({
    transparent: true,
    opacity,
    depthWrite: false,
    side: DoubleSide,
  });
  // Flat facet shading: a translucent solid of one colour still reads as a solid.
  m.colorNode = color.mul(facetShade());
  m.depthTest = !through;
  m.depthFunc = LessEqualDepth;
  return through ? m : applyDepthBias(m);
}

const sameMeshes = (a: readonly MeshBuffers[], b: readonly MeshBuffers[]): boolean =>
  a.length === b.length && a.every((m, i) => m === b[i]);

export function setFeatureSolid(vp: ViewportImpl, spec: FeatureSolidSpec | null): void {
  if (vp.disposed) return;
  const prev = vp.featureSolid;
  const meshes = spec?.meshes.filter((m) => m.indices.length > 0) ?? [];
  if (!spec || meshes.length === 0) {
    if (prev) clearFeatureSolid(vp);
    requestRender(vp);
    return;
  }
  if (prev && sameMeshes(prev.spec.meshes, meshes)) {
    // The same solid (a regen result shown again): at most its colour changes.
    if (prev.spec.effect !== spec.effect) {
      prev.spec = { effect: spec.effect, meshes };
      prev.color.value.set(FEATURE_TINT_COLORS[vp.theme][spec.effect]);
      rebuildEdges(vp, prev);
    }
    requestRender(vp);
    return;
  }
  const builds = (prev?.builds ?? vp.featureSolidBuilds) + 1;
  if (prev) clearFeatureSolid(vp);
  const color = colorUniform(FEATURE_TINT_COLORS[vp.theme][spec.effect]);
  const front = fillMaterial(color, SOLID_OPACITY, false);
  const through = fillMaterial(color, SOLID_THROUGH_OPACITY, true);
  const root = new Group();
  root.renderOrder = SOLID_GROUP_ORDER;
  let triangles = 0;
  for (const m of meshes) {
    const geometry = meshBuffersToGeometry(m);
    triangles += m.indices.length / 3;
    // Through first, then the depth-tested fill over it where the solid is in front.
    for (const [material, order] of [
      [through, 0],
      [front, 1],
    ] as const) {
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      root.add(mesh);
    }
  }
  const entry: FeatureSolidEntry = {
    spec: { effect: spec.effect, meshes },
    root,
    materials: [front, through],
    color,
    triangles,
    builds,
  };
  vp.featureSolid = entry;
  vp.featureSolidBuilds = builds;
  rebuildEdges(vp, entry);
  vp.bodyRoot.add(root); // clipped by sections like the bodies
  requestRender(vp);
}

const EDGES = 'wrenFeatureSolidEdges';

/** The outline: rebuilt when the effect or the theme changes (line materials are shared by style). */
function rebuildEdges(vp: ViewportImpl, e: FeatureSolidEntry): void {
  for (const child of [...e.root.children]) {
    if (!child.userData[EDGES]) continue;
    e.root.remove(child);
    disposeOverlay(child);
  }
  const color = FEATURE_TINT_COLORS[vp.theme][e.spec.effect];
  const dash = Math.max(vp.sceneRadius * 0.025, 1e-3);
  for (const m of e.spec.meshes) {
    const segs = edgesToSegments(m.edgePositions, m.edgeRanges);
    if (segs.length === 0) continue;
    const lines = makeLines(segs, {
      color,
      width: EDGE_WIDTH,
      dashed: e.spec.effect === 'cut',
      dash,
      onTop: true,
      renderOrder: 2,
    });
    lines.userData[EDGES] = true;
    e.root.add(lines);
  }
}

export function clearFeatureSolid(vp: ViewportImpl): void {
  const e = vp.featureSolid;
  if (!e) return;
  vp.bodyRoot.remove(e.root);
  const seen = new Set<unknown>();
  for (const child of e.root.children) {
    if (child.userData[EDGES]) disposeOverlay(child);
    else {
      const g = (child as Mesh).geometry;
      if (!seen.has(g)) g.dispose();
      seen.add(g);
    }
  }
  for (const m of e.materials) m.dispose();
  vp.featureSolid = null;
}

/** Theme change: the solid takes the new palette. */
export function recolorFeatureSolid(vp: ViewportImpl): void {
  const e = vp.featureSolid;
  if (!e) return;
  e.color.value.set(FEATURE_TINT_COLORS[vp.theme][e.spec.effect]);
  rebuildEdges(vp, e);
}

/** What is drawn right now (tests, probes). */
export function featureSolidStats(vp: ViewportImpl): {
  effect: FeatureEffect;
  meshes: number;
  triangles: number;
  builds: number;
  /** In the section-clipped root (cut by an active section like the bodies). */
  clipped: boolean;
} | null {
  const e = vp.featureSolid;
  if (!e) return null;
  return {
    effect: e.spec.effect,
    meshes: e.spec.meshes.length,
    triangles: e.triangles,
    builds: e.builds,
    clipped: e.root.parent === vp.bodyRoot,
  };
}
