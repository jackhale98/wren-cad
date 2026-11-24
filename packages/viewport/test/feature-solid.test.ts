/**
 * Change preview, slice 2e.2 (ADR-103): the scene objects of the edited feature's exact solid.
 * Pixels are checked in e2e/change-preview.spec.ts; here the object graph: what is built, when it
 * is rebuilt, and that clearing leaves nothing behind.
 */
import type { MeshBuffers } from '@wren-cad/contracts';
import { boxMesh } from '@wren-cad/test-fixtures';
import { Group, type Mesh } from 'three/webgpu';
import { describe, expect, it } from 'vitest';
import {
  clearFeatureSolid,
  featureSolidStats,
  recolorFeatureSolid,
  SOLID_GROUP_ORDER,
  SOLID_OPACITY,
  SOLID_THROUGH_OPACITY,
  setFeatureSolid,
} from '../src/featureSolid';
import { FEATURE_TINT_COLORS, TINT_OPACITY } from '../src/featureTint';
import type { ViewportImpl } from '../src/viewport';

function fakeViewport(): ViewportImpl {
  return {
    disposed: false,
    theme: 'light',
    sceneRadius: 50,
    bodyRoot: new Group(),
    featureSolid: null,
    featureSolidBuilds: 0,
    dirty: false,
    raf: 1, // a frame is already scheduled: nothing asks for an animation frame in Node
  } as unknown as ViewportImpl;
}

const hex = (c: { getHexString(): string }) => `#${c.getHexString()}`;

describe('feature solid', () => {
  it('draws each solid through the model, then depth-tested, then its edges on top', () => {
    const vp = fakeViewport();
    const meshes = [boxMesh(4, 4, 4), boxMesh(2, 2, 2, { origin: [10, 0, 0] })];
    setFeatureSolid(vp, { effect: 'cut', meshes });
    const e = vp.featureSolid;
    if (!e) throw new Error('no solid');
    expect(e.root.parent).toBe(vp.bodyRoot); // inside the section-clipped root
    expect(e.root.renderOrder).toBe(SOLID_GROUP_ORDER);
    const fills = e.root.children.filter(
      (c) => (c as Mesh).isMesh && !c.userData.wrenFeatureSolidEdges,
    );
    expect(fills).toHaveLength(4);
    const [through, front] = fills as Mesh[];
    const tm = through?.material as { depthTest: boolean; depthWrite: boolean; opacity: number };
    const fm = front?.material as { depthTest: boolean; depthWrite: boolean; opacity: number };
    expect(tm).toMatchObject({
      depthTest: false,
      depthWrite: false,
      opacity: SOLID_THROUGH_OPACITY,
    });
    expect(fm).toMatchObject({ depthTest: true, depthWrite: false, opacity: SOLID_OPACITY });
    expect(through?.renderOrder).toBeLessThan(front?.renderOrder ?? 0);
    expect(through?.geometry).toBe(front?.geometry); // one geometry per solid
    const edges = e.root.children.filter((c) => c.userData.wrenFeatureSolidEdges);
    expect(edges).toHaveLength(2);
    expect(featureSolidStats(vp)).toEqual({
      effect: 'cut',
      meshes: 2,
      triangles: 24,
      builds: 1,
      clipped: true,
    });
    expect(vp.dirty).toBe(true);
  });

  it('sits below the highlight group and is no stronger than the tint', () => {
    expect(SOLID_GROUP_ORDER).toBeLessThan(20); // viewport.ts: highlightGroup.renderOrder
    expect(SOLID_OPACITY).toBeLessThanOrEqual(TINT_OPACITY);
    expect(SOLID_THROUGH_OPACITY).toBeLessThan(SOLID_OPACITY);
  });

  it('takes the 2e.1 effect colour of the theme, and follows a theme change', () => {
    const vp = fakeViewport();
    setFeatureSolid(vp, { effect: 'cut', meshes: [boxMesh(1, 1, 1)] });
    expect(hex(vp.featureSolid?.color.value as never)).toBe(FEATURE_TINT_COLORS.light.cut);
    vp.theme = 'dark';
    recolorFeatureSolid(vp);
    expect(hex(vp.featureSolid?.color.value as never)).toBe(FEATURE_TINT_COLORS.dark.cut);
    expect(featureSolidStats(vp)?.builds).toBe(1);
  });

  it('the same buffers are not rebuilt; new buffers replace the solid', () => {
    const vp = fakeViewport();
    const meshes = [boxMesh(4, 4, 4)];
    setFeatureSolid(vp, { effect: 'cut', meshes });
    const first = vp.featureSolid;
    setFeatureSolid(vp, { effect: 'cut', meshes: [...meshes] });
    expect(vp.featureSolid).toBe(first);
    setFeatureSolid(vp, { effect: 'add', meshes });
    expect(vp.featureSolid).toBe(first);
    expect(featureSolidStats(vp)).toMatchObject({ effect: 'add', builds: 1 });
    expect(hex(vp.featureSolid?.color.value as never)).toBe(FEATURE_TINT_COLORS.light.add);
    setFeatureSolid(vp, { effect: 'add', meshes: [boxMesh(4, 4, 5)] });
    expect(vp.featureSolid).not.toBe(first);
    expect(featureSolidStats(vp)?.builds).toBe(2);
    expect(vp.bodyRoot.children).toHaveLength(1);
  });

  it('null, no meshes or an empty mesh clear it and leave nothing in the scene', () => {
    const vp = fakeViewport();
    const empty = { ...boxMesh(1, 1, 1), indices: new Uint32Array(0) } as MeshBuffers;
    for (const clear of [
      null,
      { effect: 'cut' as const, meshes: [] },
      { effect: 'cut' as const, meshes: [empty] },
    ]) {
      setFeatureSolid(vp, { effect: 'cut', meshes: [boxMesh(4, 4, 4)] });
      expect(vp.bodyRoot.children).toHaveLength(1);
      setFeatureSolid(vp, clear);
      expect(vp.featureSolid).toBeNull();
      expect(vp.bodyRoot.children).toHaveLength(0);
      expect(featureSolidStats(vp)).toBeNull();
    }
    clearFeatureSolid(vp); // idempotent
  });

  it('does nothing on a disposed viewport', () => {
    const vp = fakeViewport();
    vp.disposed = true;
    setFeatureSolid(vp, { effect: 'cut', meshes: [boxMesh(1, 1, 1)] });
    expect(vp.featureSolid).toBeNull();
  });
});
