import type { MeshBuffers } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { colors } from '../../ui/src/tokens';
import { FEATURE_TINT_COLORS, mergedFaceRanges } from '../src/featureTint';
import { buildRegionPrism, liftedPosition } from '../src/prism';

/** A 10 x 10 square with a 4 x 4 hole, on z = 0: 4 quads = 8 triangles. */
function ring(): MeshBuffers {
  const o = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];
  const i = [
    [3, 3],
    [7, 3],
    [7, 7],
    [3, 7],
  ];
  const positions = new Float32Array(
    [...o, ...i].flatMap(([x, y]) => [x as number, y as number, 0]),
  );
  const idx: number[] = [];
  for (let k = 0; k < 4; k++) {
    const n = (k + 1) % 4;
    idx.push(k, n, 4 + n, k, 4 + n, 4 + k);
  }
  return {
    positions,
    normals: new Float32Array(24),
    indices: new Uint32Array(idx),
    faceRanges: new Uint32Array([0, 8]),
    faceNames: ['S1:region'],
    edgePositions: new Float32Array(0),
    edgeRanges: new Uint32Array(0),
    edgeNames: [],
    bbox: { min: [0, 0, 0], max: [10, 10, 0] },
  } as unknown as MeshBuffers;
}

describe('region prism (blind extrude preview)', () => {
  it('a region with a hole gets walls on the outer loop and on the hole', () => {
    const p = buildRegionPrism([ring()]);
    expect(p).not.toBeNull();
    if (!p) return;
    expect(p.capTriangles).toBe(8);
    expect(p.boundary).toHaveLength(8); // 4 outer + 4 inner
    expect(p.wallTriangles).toBe(16);
  });

  it('the cap moves by the depth along the direction; the base stays on the sketch plane', () => {
    const p = buildRegionPrism([ring()]);
    if (!p) throw new Error('no prism');
    for (let v = 0; v < p.lift.length; v++) {
      const [, , z] = liftedPosition(p, v, [0, 0, -1], 7);
      expect(z).toBe(p.lift[v] === 1 ? -7 : 0);
    }
  });

  it('several regions form one prism; nothing to extrude gives null', () => {
    const a = ring();
    const p = buildRegionPrism([a, a]);
    expect(p?.capTriangles).toBe(16);
    expect(buildRegionPrism([])).toBeNull();
  });
});

describe('tinted face ranges', () => {
  // Faces of 2, 3, 1 and 4 triangles in order: face k starts where k - 1 ended.
  const ranges = new Uint32Array([0, 2, 2, 3, 5, 1, 6, 4]);
  it('adjacent faces merge into one draw range', () => {
    expect(mergedFaceRanges(ranges, 10, [0, 1])).toEqual([{ start: 0, count: 15 }]);
    expect(mergedFaceRanges(ranges, 10, [3, 0, 1])).toEqual([
      { start: 0, count: 15 },
      { start: 18, count: 12 },
    ]);
  });
  it('unknown faces and duplicates are ignored', () => {
    expect(mergedFaceRanges(ranges, 10, [9, 1, 1])).toEqual([{ start: 6, count: 9 }]);
    expect(mergedFaceRanges(ranges, 10, [])).toEqual([]);
  });
});

describe('feature tint colours mirror the @wren-cad/ui swatch tokens', () => {
  for (const theme of ['light', 'dark'] as const) {
    it(`${theme}: add and cut are the compare swatches, modify its own token`, () => {
      expect(FEATURE_TINT_COLORS[theme].add).toBe(colors[theme].compareAddedSwatch);
      expect(FEATURE_TINT_COLORS[theme].cut).toBe(colors[theme].compareRemovedSwatch);
      expect(FEATURE_TINT_COLORS[theme].modify).toBe(colors[theme].previewModifySwatch);
    });
  }
});
