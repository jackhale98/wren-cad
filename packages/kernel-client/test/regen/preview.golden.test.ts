/**
 * Regen golden: the change preview of the edited feature (ADR-103, slice 2e.2), on the real
 * kernel. For extrude add / cut / intersect with each end condition, revolve, sweep and loft:
 * the preview solid's exact volume equals the expected one (the material removed is
 * volume(before) − volume(after); a tool solid is the feature made as a new body), and asking for
 * the preview changes nothing else in the regen result.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type {
  EntityRef,
  Feature,
  FeaturePreview,
  LoftFeature,
  PlaneFeature,
  RegenSlot,
  RevolveFeature,
  SweepFeature,
  WrenDoc,
} from '@wren-cad/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RegenOutput } from '../../src/regen/engine';
import {
  type Api,
  built,
  describeFailures,
  edge,
  extrude,
  fid,
  loadApi,
  makeDoc,
  region,
  relClose,
  Sk,
  skipNote,
  states,
  totalVolume,
  withParams,
} from './helpers';

const PART = fid('PART');
/** A second, independent regeneration of the same part (its own cache and state). */
const OTHER = 'version:plain' as const;
const PI = Math.PI;

const BS = fid('PVBS');
const BE = fid('PVBE');
const TS = fid('PVTS');
const TE = fid('PVTE');
const PL = fid('PVPL');

const face = (name: string): EntityRef => ({ name, kind: 'face' });

/** A 40 × 30 × 10 block on origin:XY (z from 0 to 10): volume 12 000. */
function block(): Feature[] {
  const s = new Sk();
  const r = s.rect('p', 'L', 0, 0, 40, 30, '40', '30');
  s.geo({ kind: 'fix', entity: r.a });
  return [s.feature(BS), extrude(BE, [region(BS, 'L1,L2,L3,L4')], '10')];
}
const BLOCK = 40 * 30 * 10;

/** A circle of radius 4 at (20, 15) on origin:XY: under the middle of the block. */
function circleSketch(): Feature {
  const s = new Sk();
  s.circle('C', 20, 15, 4);
  s.geo({ kind: 'fix', entity: 'Cc' });
  s.dim({ kind: 'radius', curve: 'C' }, '4');
  return s.feature(TS);
}
const DISC = PI * 16;

/** A 10 × 10 square at (5..15, 5..15) on origin:XY. */
function squareSketch(): Feature {
  const s = new Sk();
  const r = s.rect('q', 'Q', 5, 5, 15, 15, '10', '10');
  s.geo({ kind: 'fix', entity: r.a });
  return s.feature(TS);
}
const SQUARE = region(TS, 'Q1,Q2,Q3,Q4');

/** An offset plane `h` above origin:XY. */
function plane(): PlaneFeature {
  return {
    id: PL,
    type: 'plane',
    name: 'Stop',
    suppressed: false,
    definition: { kind: 'offset', from: face('origin:XY'), distance: 'h' },
  };
}
const upTo = { end: { kind: 'upTo' as const, target: face(`F${PL}:plane`) } };

/** What must not depend on the preview request: statuses, names, volumes, counts, the meshes. */
function digest(r: RegenOutput) {
  return {
    features: r.features.map((f) => ({
      id: f.featureId,
      state: f.state,
      cached: f.cached,
      error: f.error,
      warnings: f.warnings,
      unresolved: f.unresolved,
      rebound: f.rebound,
    })),
    cache: r.cache,
    bodies: r.bodies.map((b) => ({
      id: b.id,
      faceNames: b.mesh.faceNames,
      edgeNames: b.mesh.edgeNames,
      faces: b.mesh.faceRanges.length / 2,
      edges: b.mesh.edgeRanges.length / 2,
      positions: [...b.mesh.positions],
      indices: [...b.mesh.indices],
      mass: b.massProperties,
    })),
    sketches: r.sketches.map((s) => ({ id: s.featureId, regions: s.regions.map((x) => x.name) })),
  };
}

describe.skipIf(!built)(`regen golden: change preview${skipNote}`, () => {
  let api: Api;
  beforeAll(async () => {
    api = await loadApi();
  }, 60_000);
  afterAll(async () => {
    await api?.closePart(PART);
  });

  const run = (doc: WrenDoc, featureId?: string, slot: RegenSlot = 'main') =>
    api.regenerate({
      doc,
      partId: PART,
      slot,
      quality: 'coarse',
      massProperties: true,
      ...(featureId === undefined ? {} : { preview: { featureId } }),
    });

  /**
   * Regenerates `doc` with the preview of `featureId` in a fresh part, checks that the same
   * document without the request gives the identical result in another fresh part, and returns
   * the preview with the volume the model lost (before − after, from a rollback of the feature).
   */
  async function preview(
    doc: WrenDoc,
    featureId: string,
    expected: string[] = [],
  ): Promise<{ r: RegenOutput; p: FeaturePreview | undefined; removed: number; tool: number }> {
    await api.closePart(PART);
    const r = await run(doc, featureId);
    const features = doc.parts[0]?.features ?? [];
    expect(states(r), describeFailures(r)).toEqual(
      expected.length > 0 ? expected : features.map(() => 'ok'),
    );
    const plain = await run(doc, undefined, OTHER);
    expect(plain.preview).toBeUndefined();
    expect(digest(r)).toEqual(digest(plain));
    // Before the feature: the same part rolled back to it (a cache rollback).
    const index = features.findIndex((f) => f.id === featureId);
    const rolled = structuredClone(doc);
    (rolled.parts[0] as { rollbackIndex: number }).rollbackIndex = index;
    const before = await run(rolled, undefined, OTHER);
    // The tool solid: the feature made as a new body, alone.
    const alone = structuredClone(doc);
    const f = (alone.parts[0] as { features: Feature[] }).features[index] as Feature & {
      op?: string;
      scope?: unknown;
    };
    let tool = Number.NaN;
    if (!(f.type === 'extrude' && f.end.kind === 'throughAll')) {
      f.op = 'new';
      delete f.scope;
      const t = await run(alone, undefined, OTHER);
      tool = t.bodies.find((b) => b.id === `B${featureId}`)?.massProperties?.volume ?? Number.NaN;
    }
    return {
      r,
      p: r.preview,
      removed: totalVolume(before.bodies) - totalVolume(r.bodies),
      tool,
    };
  }

  const meshIsSound = (p: FeaturePreview) => {
    for (const m of p.meshes) {
      expect(m.indices.length).toBeGreaterThan(0);
      expect(m.faceNames).toEqual([]);
      expect(m.edgeNames).toEqual([]);
      expect(m.edgeRanges.length).toBeGreaterThan(0);
    }
  };

  describe('extrude cut: the material removed, for every end condition', () => {
    const cut = (depth: string | 'throughAll', direction: 'normal' | 'reverse' | 'symmetric') =>
      makeDoc({ d: '4 mm', h: '6 mm' }, [
        ...block(),
        circleSketch(),
        extrude(TE, [region(TS, 'C')], depth, 'cut', direction),
      ]);

    it('blind: a pocket of the depth', async () => {
      const { p, removed, tool } = await preview(cut('d', 'normal'), TE);
      expect(p).toMatchObject({ featureId: TE, effect: 'cut', shows: 'removed' });
      expect(p?.meshes).toHaveLength(1);
      relClose(p?.volume ?? 0, DISC * 4, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
      relClose(tool, DISC * 4, 1e-9); // inside the block, so the tool is the removed material
      meshIsSound(p as FeaturePreview);
    });

    it('through all: the hole, not the over-long tool the kernel cuts with', async () => {
      const { p, removed } = await preview(cut('throughAll', 'normal'), TE);
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(p?.volume ?? 0, DISC * 10, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
      // The mesh stays within the block (the tool itself is more than twice its diagonal long).
      expect(p?.meshes[0]?.bbox.min[2]).toBeCloseTo(0, 6);
      expect(p?.meshes[0]?.bbox.max[2]).toBeCloseTo(10, 6);
    });

    it('symmetric: only the half of the tool inside the body', async () => {
      const { p, removed, tool } = await preview(
        withParams(cut('d', 'symmetric'), { d: '8 mm' }),
        TE,
      );
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(p?.volume ?? 0, DISC * 4, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
      relClose(tool, DISC * 8, 1e-9); // the tool is twice what is removed
    });

    it('up to a plane: the pocket ends on it', async () => {
      const doc = makeDoc({ h: '6 mm' }, [
        ...block(),
        plane(),
        circleSketch(),
        extrude(TE, [region(TS, 'C')], 'throughAll', 'cut', 'normal', upTo),
      ]);
      const { p, removed } = await preview(doc, TE);
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(p?.volume ?? 0, DISC * 6, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
      // The values are the current ones: a new plane height is a new solid.
      const moved = await run(withParams(doc, { h: '2.5 mm' }), TE);
      relClose(moved.preview?.volume ?? 0, DISC * 2.5, 1e-9);
    });

    it('a cut that misses the body shows its tool solid, where the kernel can make one', async () => {
      // Reverse from z = 0: the tool lies below the block.
      const { r, p, removed } = await preview(cut('d', 'reverse'), TE);
      expect(r.features[3]?.warnings?.[0]?.message).toBe('The cut does not touch any body');
      expect(removed).toBeCloseTo(0, 9);
      expect(p).toMatchObject({ effect: 'cut', shows: 'tool' });
      relClose(p?.volume ?? 0, DISC * 4, 1e-9);
      expect(p?.meshes[0]?.bbox.max[2]).toBeCloseTo(0, 6);
      // Through all has no tool without a body to size it by: nothing is shown.
      const none = await preview(cut('throughAll', 'reverse'), TE);
      expect(none.r.features[3]?.state).toBe('ok');
      expect(none.p).toBeUndefined();
    });

    it('a cut through two bodies removes two solids', async () => {
      const second = new Sk();
      const q = second.rect('r', 'R', 0, 0, 40, 30, '40', '30');
      second.geo({ kind: 'fix', entity: q.a });
      const up: PlaneFeature = {
        ...plane(),
        definition: { kind: 'offset', from: face('origin:XY'), distance: '20 mm' },
      };
      const S2 = fid('PVS2');
      const doc = makeDoc({}, [
        ...block(),
        up,
        second.feature(S2, face(`F${PL}:plane`)),
        extrude(fid('PVE2'), [region(S2, 'R1,R2,R3,R4')], '5'),
        circleSketch(),
        extrude(TE, [region(TS, 'C')], 'throughAll', 'cut'),
      ]);
      const { p, removed } = await preview(doc, TE);
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      expect(p?.meshes).toHaveLength(2);
      relClose(p?.volume ?? 0, DISC * 15, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
    });
  });

  describe('extrude add: the tool solid', () => {
    const add = (
      depth: string | 'throughAll',
      direction: 'normal' | 'reverse' | 'symmetric',
      extra: Feature[] = [],
      more = {},
    ) =>
      makeDoc({ d: '15 mm', h: '25 mm' }, [
        ...block(),
        ...extra,
        squareSketch(),
        extrude(TE, [SQUARE], depth, 'add', direction, more),
      ]);

    it('blind: the whole prism, of which only the part outside the body is new', async () => {
      const { r, p, removed, tool } = await preview(add('d', 'normal'), TE);
      expect(p).toMatchObject({ featureId: TE, effect: 'add', shows: 'tool' });
      relClose(p?.volume ?? 0, 100 * 15, 1e-9);
      relClose(p?.volume ?? 0, tool, 1e-9);
      relClose(-removed, 100 * 5, 1e-9); // 10 of the 15 mm lie inside the block
      relClose(totalVolume(r.bodies), BLOCK + 500, 1e-9);
      meshIsSound(p as FeaturePreview);
    });

    it('symmetric and reverse', async () => {
      const sym = await preview(add('d', 'symmetric'), TE);
      relClose(sym.p?.volume ?? 0, sym.tool, 1e-9);
      expect(sym.p?.meshes[0]?.bbox.min[2]).toBeCloseTo(-7.5, 6);
      expect(sym.p?.meshes[0]?.bbox.max[2]).toBeCloseTo(7.5, 6);
      const rev = await preview(add('d', 'reverse'), TE);
      relClose(rev.p?.volume ?? 0, 1500, 1e-9);
      expect(rev.p?.meshes[0]?.bbox.min[2]).toBeCloseTo(-15, 6);
    });

    it('up to a plane', async () => {
      const { p, tool } = await preview(add('throughAll', 'normal', [plane()], upTo), TE);
      expect(p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(p?.volume ?? 0, 100 * 25, 1e-9);
      relClose(p?.volume ?? 0, tool, 1e-9);
    });

    it('through all: no preview (the kernel has no tool without the body)', async () => {
      const { r, p } = await preview(add('throughAll', 'normal'), TE);
      expect(r.features[3]?.state).toBe('ok');
      expect(p).toBeUndefined();
    });

    it('a new body is its own preview', async () => {
      const doc = makeDoc({}, [
        ...block(),
        squareSketch(),
        extrude(TE, [SQUARE], '7', 'new', 'reverse'),
      ]);
      const { r, p } = await preview(doc, TE);
      expect(p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(p?.volume ?? 0, 700, 1e-9);
      expect(r.bodies).toHaveLength(2);
      // The body's own solid: the same triangles as the body.
      const body = r.bodies.find((b) => b.id === `B${TE}`);
      expect([...(p?.meshes[0]?.positions ?? [])]).toEqual([...(body?.mesh.positions ?? [])]);
      expect(p?.meshes[0]?.positions.buffer).not.toBe(body?.mesh.positions.buffer);
    });
  });

  describe('extrude intersect: the material removed, for every end condition', () => {
    /** A 20 × 30 rectangle over the left half of the block. */
    function half(): Feature {
      const s = new Sk();
      const r = s.rect('q', 'Q', 0, 0, 20, 30, '20', '30');
      s.geo({ kind: 'fix', entity: r.a });
      return s.feature(TS);
    }
    const intersect = (depth: string | 'throughAll', extra: Feature[] = [], more = {}) =>
      makeDoc({ d: '6 mm', h: '4 mm' }, [
        ...block(),
        ...extra,
        half(),
        extrude(TE, [SQUARE], depth, 'intersect', 'normal', more),
      ]);

    it('blind', async () => {
      const { r, p, removed } = await preview(intersect('d'), TE);
      expect(p).toMatchObject({ featureId: TE, effect: 'cut', shows: 'removed' });
      relClose(totalVolume(r.bodies), 20 * 30 * 6, 1e-9);
      relClose(p?.volume ?? 0, BLOCK - 20 * 30 * 6, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
      meshIsSound(p as FeaturePreview);
    });

    it('through all', async () => {
      const { p, removed } = await preview(intersect('throughAll'), TE);
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(p?.volume ?? 0, BLOCK / 2, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
    });

    it('up to a plane', async () => {
      const { p, removed } = await preview(intersect('throughAll', [plane()], upTo), TE);
      expect(p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(p?.volume ?? 0, BLOCK - 20 * 30 * 4, 1e-9);
      relClose(p?.volume ?? 0, removed, 1e-9);
    });
  });

  describe('revolve, sweep, loft', () => {
    /** A 4 × 4 square in XZ at x 16..20, z 3..7, revolved about origin:Z. */
    function ring(op: RevolveFeature['op'], angle = '360 deg'): Feature[] {
      const s = new Sk();
      s.rect('p', 'L', 16, 3, 20, 7);
      for (const p of ['pa', 'pb', 'pc', 'pd']) s.geo({ kind: 'fix', entity: p });
      const revolve: RevolveFeature = {
        id: TE,
        type: 'revolve',
        name: 'Revolve',
        suppressed: false,
        profile: [region(TS, 'L1,L2,L3,L4')],
        axis: { name: 'origin:Z', kind: 'edge' },
        angle,
        direction: 'normal',
        op,
      };
      return [s.feature(TS, 'origin:XZ'), revolve];
    }
    const RING = PI * (400 - 256) * 4;

    it('revolve: new is the body, add is the tool, cut is the groove actually removed', async () => {
      const fresh = await preview(makeDoc({}, ring('new', '90 deg')), TE);
      expect(fresh.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(fresh.p?.volume ?? 0, RING / 4, 1e-9);

      const add = await preview(makeDoc({}, [...block(), ...ring('add', '180 deg')]), TE);
      expect(add.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(add.p?.volume ?? 0, RING / 2, 1e-9);
      relClose(add.p?.volume ?? 0, add.tool, 1e-9);

      // The block covers x 0..40, y 0..30: only part of the full ring is inside it.
      const cut = await preview(makeDoc({}, [...block(), ...ring('cut')]), TE);
      expect(cut.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(cut.p?.volume ?? 0, cut.removed, 1e-9);
      expect(cut.p?.volume ?? 0).toBeLessThan(cut.tool);
      expect(cut.p?.volume ?? 0).toBeGreaterThan(0);
      relClose(cut.p?.volume ?? 0, RING / 4, 1e-6); // the quarter in x > 0, y > 0

      const both = await preview(makeDoc({}, [...block(), ...ring('intersect')]), TE);
      expect(both.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(both.p?.volume ?? 0, both.removed, 1e-9);
      relClose(both.p?.volume ?? 0, BLOCK - RING / 4, 1e-6);
    }, 60_000);

    it('sweep: the swept tool, and the part of it a cut removes', async () => {
      const SP = fid('PVSP');
      const SQ = fid('PVSQ');
      const prof = new Sk();
      prof.circle('c', 20, 15, 2);
      const path = new Sk();
      path.point('a', 20, -5);
      path.point('b', 20, 25);
      path.line('l', 'a', 'b');
      const sweep = (op: SweepFeature['op']): SweepFeature => ({
        id: TE,
        type: 'sweep',
        name: 'Sweep',
        suppressed: false,
        profile: [region(SP, 'c')],
        path: [edge(`S${SQ}:e(l)`)],
        orientation: 'followPath',
        op,
      });
      // The profile lies on XY at (20, 15); the path runs along z from -5 to 25 through it.
      const features = (op: SweepFeature['op']) => [
        ...block(),
        prof.feature(SP),
        // origin:XZ with the sketch u = world x, v = world z; the plane y = 0.
        path.feature(SQ, 'origin:XZ'),
        sweep(op),
      ];
      const fresh = await preview(makeDoc({}, features('new')), TE);
      const length = fresh.p?.volume ?? 0;
      expect(fresh.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(length, PI * 4 * 30, 1e-6); // radius 2 along the 30 mm path
      relClose(
        length,
        fresh.r.bodies.find((b) => b.id === `B${TE}`)?.massProperties?.volume ?? 0,
        0,
      );

      const cut = await preview(makeDoc({}, features('cut')), TE);
      relClose(cut.p?.volume ?? 0, PI * 4 * 10, 1e-6); // the 10 mm of the swept rod in the block
      expect(cut.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(cut.p?.volume ?? 0, cut.removed, 1e-9);
      const add = await preview(makeDoc({}, features('add')), TE);
      expect(add.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(add.p?.volume ?? 0, add.tool, 1e-9);
      relClose(add.p?.volume ?? 0, length, 1e-9);
    }, 60_000);

    it('loft: the lofted tool, and the part of it a cut removes', async () => {
      const LA = fid('PVLA');
      const LB = fid('PVLB');
      const a = new Sk();
      a.rect('a', 'A', 10, 5, 30, 25);
      const b = new Sk();
      b.rect('b', 'B', 15, 10, 25, 20);
      const up: PlaneFeature = {
        ...plane(),
        definition: { kind: 'offset', from: face('origin:XY'), distance: '30 mm' },
      };
      const loft = (op: LoftFeature['op']): LoftFeature => ({
        id: TE,
        type: 'loft',
        name: 'Loft',
        suppressed: false,
        sections: [region(LA, 'A1,A2,A3,A4'), region(LB, 'B1,B2,B3,B4')],
        ruled: true,
        closed: false,
        op,
      });
      const features = (op: LoftFeature['op']) => [
        ...block(),
        a.feature(LA),
        up,
        b.feature(LB, face(`F${PL}:plane`)),
        loft(op),
      ];
      const FRUSTUM = (30 / 3) * (400 + 100 + 200);
      const add = await preview(makeDoc({}, features('add')), TE);
      expect(add.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(add.p?.volume ?? 0, FRUSTUM, 1e-6);
      relClose(add.p?.volume ?? 0, add.tool, 1e-9);

      // The frustum's first 10 mm lie in the block: side 20 at z = 0, 50/3 at z = 10.
      const s = 20 - 10 / 3;
      const inside = (10 / 3) * (400 + s * s + 20 * s);
      const cut = await preview(makeDoc({}, features('cut')), TE);
      expect(cut.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(cut.p?.volume ?? 0, inside, 1e-6);
      relClose(cut.p?.volume ?? 0, cut.removed, 1e-9);

      const both = await preview(makeDoc({}, features('intersect')), TE);
      expect(both.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(both.p?.volume ?? 0, BLOCK - inside, 1e-6);
      relClose(both.p?.volume ?? 0, both.removed, 1e-9);
    }, 60_000);
  });

  describe('primitive', () => {
    it('a box cut removes its part inside the body; a box add is its own solid', async () => {
      const box = (op: 'cut' | 'add'): Feature => ({
        id: TE,
        type: 'primitive',
        name: 'Box',
        suppressed: false,
        op,
        shape: 'box',
        dx: '10 mm',
        dy: '10 mm',
        dz: '25 mm',
      });
      const cut = await preview(makeDoc({}, [...block(), box('cut')]), TE);
      expect(cut.p).toMatchObject({ effect: 'cut', shows: 'removed' });
      relClose(cut.p?.volume ?? 0, 10 * 10 * 10, 1e-9);
      relClose(cut.p?.volume ?? 0, cut.removed, 1e-9);
      const add = await preview(makeDoc({}, [...block(), box('add')]), TE);
      expect(add.p).toMatchObject({ effect: 'add', shows: 'tool' });
      relClose(add.p?.volume ?? 0, 10 * 10 * 25, 1e-9);
    });
  });

  describe('failure, other features and the cache', () => {
    const doc = (d: string) =>
      makeDoc({ d }, [...block(), circleSketch(), extrude(TE, [region(TS, 'C')], 'd', 'cut')]);

    it('a feature that errors, is suppressed, rolled back or unknown has no preview', async () => {
      await api.closePart(PART);
      const good = await run(doc('4 mm'), TE);
      expect(good.preview?.featureId).toBe(TE);
      // The depth no longer evaluates: the error state shows, and no earlier preview comes back.
      const bad = await run(doc('nope + 1'), TE);
      expect(bad.features[3]?.state).toBe('error');
      expect(bad.preview).toBeUndefined();
      const zero = await run(doc('0 mm'), TE);
      expect(zero.features[3]?.state).toBe('error');
      expect(zero.preview).toBeUndefined();
      // A draft angle: the kernel has no drafted extrude, so the feature errors.
      const drafted = doc('4 mm');
      (drafted.parts[0]?.features[3] as { draft?: string }).draft = '5 deg';
      const d = await run(drafted, TE);
      expect(d.features[3]?.state).toBe('error');
      expect(d.preview).toBeUndefined();
      // An unresolved profile: needs attention, no preview.
      const lost = doc('4 mm');
      const f = lost.parts[0]?.features[3] as { profile: EntityRef[] };
      f.profile = [region(TS, 'gone')];
      const unresolved = await run(lost, TE);
      expect(unresolved.features[3]?.state).toBe('needsAttention');
      expect(unresolved.preview).toBeUndefined();
      const suppressed = doc('4 mm');
      (suppressed.parts[0]?.features[3] as Feature).suppressed = true;
      expect((await run(suppressed, TE)).preview).toBeUndefined();
      const rolled = doc('4 mm');
      (rolled.parts[0] as { rollbackIndex: number }).rollbackIndex = 3;
      expect((await run(rolled, TE)).preview).toBeUndefined();
      expect((await run(doc('4 mm'), fid('NOSUCH'))).preview).toBeUndefined();
      // A sketch and the block's own sketch-less kinds have none either.
      expect((await run(doc('4 mm'), TS)).preview).toBeUndefined();
      expect((await run(doc('4 mm'), TE)).preview?.volume).toBeCloseTo(DISC * 4, 6);
    });

    it('the same inputs compute nothing again', async () => {
      await api.closePart(PART);
      const first = await run(doc('4 mm'), TE);
      const stats = api.engine.stats(PART);
      const handles = api.liveHandleCount();
      const again = await run(doc('4 mm'), TE);
      expect(again.cache).toEqual({ hits: 4, misses: 0 });
      expect(api.engine.stats(PART)).toEqual(stats);
      expect(api.liveHandleCount()).toBe(handles);
      expect(again.preview?.volume).toBe(first.preview?.volume);
      expect([...(again.preview?.meshes[0]?.positions ?? [])]).toEqual([
        ...(first.preview?.meshes[0]?.positions ?? []),
      ]);
      // A fresh copy every time: the result is transferred.
      expect(again.preview?.meshes[0]?.positions.buffer).not.toBe(
        first.preview?.meshes[0]?.positions.buffer,
      );
      // The fine pass reuses the solid and only meshes it again.
      const fine = await api.regenerate({
        doc: doc('4 mm'),
        partId: PART,
        quality: 'fine',
        preview: { featureId: TE },
      });
      expect(api.liveHandleCount()).toBe(handles);
      expect(fine.preview?.volume).toBe(first.preview?.volume);
      expect(fine.preview?.meshes[0]?.indices.length ?? 0).toBeGreaterThan(
        first.preview?.meshes[0]?.indices.length ?? 0,
      );
      // One entry and one handle more than the same regen without the request.
      await run(doc('4 mm'), undefined, OTHER);
      const plain = api.engine.stats(PART, OTHER);
      expect(stats).toEqual({
        entries: (plain?.entries ?? 0) + 1,
        handles: (plain?.handles ?? 0) + 1,
      });
    });

    it('an edit sequence gives identical results with and without the request', async () => {
      await api.closePart(PART);
      for (const d of ['4 mm', '5 mm', '12 mm', '5 mm', '0 mm', '3 mm']) {
        const withPreview = await run(doc(d), TE);
        const without = await run(doc(d), undefined, OTHER);
        expect(digest(withPreview), d).toEqual(digest(without));
        if (d === '0 mm') expect(withPreview.preview).toBeUndefined();
        else
          relClose(
            withPreview.preview?.volume ?? 0,
            DISC * Math.min(10, Number.parseFloat(d)),
            1e-9,
          );
      }
    });

    it('closing the part releases the scratch solids', async () => {
      await api.closePart(PART);
      const base = api.liveHandleCount();
      for (const d of ['4 mm', '5 mm', '6 mm']) await run(doc(d), TE);
      expect(api.liveHandleCount()).toBeGreaterThan(base);
      await api.closePart(PART);
      expect(api.liveHandleCount()).toBe(base);
      expect(api.engine.memoryStats().ownedHandles).toBe(0);
    });
  });
});
