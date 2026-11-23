/**
 * ADR-101 (shared building block): `sketchGenerated`, what a sketch entity generated in the latest
 * regen, with the real kernel through the worker surface. Extrude, cut-extrude and revolve; a
 * sketch consumed by two features; entities that generated nothing (construction, unconsumed, a
 * circle centre, an axis); generated geometry later merged, removed by a fillet or a cut, or split
 * by a cut. Every outcome is its own; nothing is guessed.
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { BodyResult, Feature, Id, RevolveFeature, WrenDoc } from '@wren-cad/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SketchGenerated } from '../../src/regen/generated';
import {
  type Api,
  built,
  describeFailures,
  edge,
  edgeName,
  extrude,
  fid,
  fillet,
  loadApi,
  makeDoc,
  region,
  Sk,
  side,
  skipNote,
  states,
} from './helpers';

const PART = fid('GPART');

/** A rectangle `p`/`L` with fixed corners. */
function rect(s: Sk, p: string, l: string, x0: number, y0: number, x1: number, y1: number) {
  const r = s.rect(p, l, x0, y0, x1, y1);
  for (const k of ['a', 'b', 'c', 'd']) s.geo({ kind: 'fix', entity: `${p}${k}` });
  return r;
}

function revolve(id: Id, profile: string[], sketch: Id): RevolveFeature {
  return {
    id,
    type: 'revolve',
    name: 'Revolve',
    suppressed: false,
    profile: profile.map((body) => region(sketch, body)),
    axis: { name: 'origin:Z', kind: 'edge' },
    angle: '360 deg',
    direction: 'normal',
    op: 'new',
  };
}

describe.skipIf(!built)(
  `sketchGenerated: sketch entity → generated faces and edges${skipNote}`,
  () => {
    let api: Api;
    beforeAll(async () => {
      api = await loadApi();
    }, 60_000);
    afterAll(async () => {
      await api?.closePart(PART);
    });

    async function regen(features: Feature[]): Promise<{ doc: WrenDoc; bodies: BodyResult[] }> {
      const doc = makeDoc({}, features, PART);
      const r = await api.regenerate({ doc, partId: PART, quality: 'coarse' });
      expect(states(r), describeFailures(r)).toEqual(features.map(() => 'ok'));
      return { doc, bodies: r.bodies };
    }
    async function gen(sketchId: Id, entityId: Id): Promise<SketchGenerated> {
      const r = await api.sketchGenerated(PART, sketchId, entityId);
      if (!r.ok) throw new Error(r.error.message);
      return r.value;
    }
    /** Surface (faces) or curve (edges) type of a unique outcome's target, from the kernel. */
    async function geometryOf(
      bodies: BodyResult[],
      g: SketchGenerated,
    ): Promise<string | undefined> {
      if (g.outcome.kind !== 'unique') return undefined;
      const t = g.outcome.target;
      const body = bodies.find((b) => b.id === t.owner);
      if (!body) return undefined;
      const fp = await api.fingerprints(body.shape);
      if (!fp.ok) return undefined;
      return t.kind === 'face' ? fp.value.faces[t.index]?.surface : fp.value.edges[t.index]?.curve;
    }

    it('extrude: a line → its planar side face, a corner point → the edge swept from it', async () => {
      const S = fid('GS1');
      const E = fid('GE1');
      const s = new Sk();
      s.point('o', 0, 0, true);
      rect(s, 'p', 'L', 0, 0, 20, 10);
      s.line('X', 'pa', 'pc', true);
      const { bodies } = await regen([s.feature(S), extrude(E, [region(S, 'L1,L2,L3,L4')], '5')]);

      const line = await gen(S, 'L1');
      expect(line.entity).toBe('line');
      expect(line.outcome).toMatchObject({
        kind: 'unique',
        featureId: E,
        name: side(E, S, 'L1'),
        target: { name: side(E, S, 'L1'), kind: 'face', owner: `B${E}` },
      });
      expect(line.consumers).toEqual([
        {
          featureId: E,
          state: 'ok',
          made: [
            {
              name: side(E, S, 'L1'),
              kind: 'face',
              now: {
                state: 'present',
                target: expect.objectContaining({ name: side(E, S, 'L1') }),
              },
            },
          ],
        },
      ]);
      expect(await geometryOf(bodies, line)).toBe('plane');
      // The target index is the body's TopExp index of that name.
      const body = bodies[0] as BodyResult;
      if (line.outcome.kind === 'unique')
        expect(body.mesh.faceNames[line.outcome.target.index]).toBe(side(E, S, 'L1'));

      const corner = await gen(S, 'pa');
      const swept = edgeName(side(E, S, 'L1'), side(E, S, 'L4'));
      expect(corner.outcome).toMatchObject({
        kind: 'unique',
        featureId: E,
        target: { name: swept, kind: 'edge' },
      });
      expect(await geometryOf(bodies, corner)).toBe('line');

      // Generated nothing: construction geometry and the sketch's own origin and axes.
      for (const id of ['o', 'X', '@origin', '@x']) {
        expect((await gen(S, id)).outcome, id).toEqual({ kind: 'nothing', why: 'construction' });
      }
      // Not there at all.
      expect((await gen(S, 'nope')).outcome).toEqual({ kind: 'unavailable', why: 'entity' });
      expect((await gen(fid('GNONE'), 'L1')).outcome).toEqual({
        kind: 'unavailable',
        why: 'sketch',
      });
      // Deterministic.
      expect(await gen(S, 'pa')).toEqual(corner);
      // Edit upstream (the depth): the same names, the answer follows the new regen.
      await regen([s.feature(S), extrude(E, [region(S, 'L1,L2,L3,L4')], '9')]);
      const again = await gen(S, 'L1');
      expect(again.outcome).toMatchObject({ kind: 'unique', name: side(E, S, 'L1') });
      expect(again.consumers).toEqual(line.consumers);
    });

    it('cut-extrude: a circle → the cylinder it cut; its centre sweeps nothing', async () => {
      const S = fid('GS1');
      const E = fid('GE1');
      const H = fid('GS2');
      const C = fid('GE2');
      const s = new Sk();
      rect(s, 'p', 'L', 0, 0, 20, 10);
      const h = new Sk();
      h.circle('C1', 10, 5, 2);
      h.geo({ kind: 'fix', entity: 'C1c' });
      const { bodies } = await regen([
        s.feature(S),
        extrude(E, [region(S, 'L1,L2,L3,L4')], '5'),
        h.feature(H),
        extrude(C, [region(H, 'C1')], '20', 'cut', 'symmetric'),
      ]);
      const circle = await gen(H, 'C1');
      expect(circle.entity).toBe('circle');
      expect(circle.outcome).toMatchObject({
        kind: 'unique',
        featureId: C,
        target: { name: side(C, H, 'C1'), kind: 'face', owner: `B${E}` },
      });
      expect(await geometryOf(bodies, circle)).toBe('cylinder');
      expect((await gen(H, 'C1c')).outcome).toEqual({
        kind: 'nothing',
        why: 'notSwept',
        centreOf: 'C1',
        featureIds: [C],
      });
    });

    it('revolve: lines → cylinders and planes, a corner → the circle it swept, the axis-free outcome', async () => {
      const S = fid('GS1');
      const R = fid('GR1');
      const s = new Sk();
      rect(s, 'p', 'L', 10, 0, 20, 5);
      const { bodies } = await regen([s.feature(S, 'origin:XZ'), revolve(R, ['L1,L2,L3,L4'], S)]);
      // L2 is the outer vertical line (x = 20): a cylinder; L1 the bottom: a plane.
      const outer = await gen(S, 'L2');
      expect(outer.outcome).toMatchObject({ kind: 'unique', featureId: R, name: side(R, S, 'L2') });
      expect(await geometryOf(bodies, outer)).toBe('cylinder');
      expect(await geometryOf(bodies, await gen(S, 'L1'))).toBe('plane');
      const corner = await gen(S, 'pb');
      expect(corner.outcome).toMatchObject({
        kind: 'unique',
        target: { name: edgeName(side(R, S, 'L1'), side(R, S, 'L2')), kind: 'edge' },
      });
      expect(await geometryOf(bodies, corner)).toBe('circle');
    });

    it('a sketch consumed by two features: shared entities are several, the others unique', async () => {
      const S = fid('GS1');
      const A = fid('GEA');
      const Bx = fid('GEB');
      const s = new Sk();
      rect(s, 'p', 'L', 0, 0, 20, 10);
      rect(s, 'q', 'M', 40, 0, 60, 10);
      await regen([
        s.feature(S),
        extrude(A, [region(S, 'L1,L2,L3,L4'), region(S, 'M1,M2,M3,M4')], '5'),
        extrude(Bx, [region(S, 'L1,L2,L3,L4')], '3', 'new', 'reverse'),
      ]);
      const shared = await gen(S, 'L1');
      expect(shared.outcome).toEqual({ kind: 'several', featureIds: [A, Bx] });
      expect(shared.consumers.map((c) => [c.featureId, c.made.map((m) => m.name)])).toEqual([
        [A, [side(A, S, 'L1')]],
        [Bx, [side(Bx, S, 'L1')]],
      ]);
      expect((await gen(S, 'pa')).outcome).toEqual({ kind: 'several', featureIds: [A, Bx] });
      expect((await gen(S, 'M1')).outcome).toMatchObject({ kind: 'unique', featureId: A });
    });

    it('generated nothing: an unconsumed sketch, an axis', async () => {
      const S = fid('GS1');
      const E = fid('GE1');
      const U = fid('GSU');
      const Q = fid('GSQ');
      const R = fid('GR1');
      const s = new Sk();
      rect(s, 'p', 'L', 0, 0, 20, 10);
      const u = new Sk();
      rect(u, 'p', 'L', 0, 0, 5, 5);
      // A profile beside an axis line drawn in the same sketch.
      const q = new Sk();
      rect(q, 'p', 'L', 30, 0, 40, 5);
      q.point('a0', 0, 0);
      q.point('a1', 0, 5);
      q.geo({ kind: 'fix', entity: 'a0' });
      q.geo({ kind: 'fix', entity: 'a1' });
      q.line('A', 'a0', 'a1');
      await regen([
        s.feature(S),
        extrude(E, [region(S, 'L1,L2,L3,L4')], '5'),
        u.feature(U),
        q.feature(Q, 'origin:XZ'),
        { ...revolve(R, ['L1,L2,L3,L4'], Q), axis: { name: `S${Q}:e(A)`, kind: 'edge' } },
      ]);
      expect((await gen(U, 'L1')).outcome).toEqual({ kind: 'nothing', why: 'unconsumed' });
      expect((await gen(U, 'pa')).outcome).toEqual({ kind: 'nothing', why: 'unconsumed' });
      // A revolve's axis that is a sketch line generates no face of its own.
      expect((await gen(Q, 'A')).outcome).toEqual({
        kind: 'nothing',
        why: 'axisOrPath',
        featureIds: [R],
      });
      expect((await gen(Q, 'L2')).outcome).toMatchObject({ kind: 'unique', featureId: R });
    });

    it('later features: merged by an add, removed by a fillet and a cut, split by a cut', async () => {
      const S = fid('GS1');
      const E = fid('GE1');
      const T = fid('GS2');
      const ADD = fid('GE2');
      const F = fid('GF1');
      const K = fid('GS3');
      const CUT = fid('GE3');
      const N = fid('GS4');
      const NOTCH = fid('GE4');
      const s = new Sk();
      rect(s, 'p', 'L', 0, 0, 20, 10);
      // Flush with the base along y = 0 and y = 10: the add merges its long sides into the base's.
      const t = new Sk();
      rect(t, 'q', 'M', 20, 0, 30, 10);
      // Removes the far end (x = 30) of the added block entirely.
      const k = new Sk();
      rect(k, 'r', 'K', 28, -1, 31, 11);
      // A notch through the front (y = 0) at x 8..12: splits the base's front face in two.
      const n = new Sk();
      rect(n, 'n', 'N', 8, -1, 12, 3);
      await regen([
        s.feature(S),
        extrude(E, [region(S, 'L1,L2,L3,L4')], '5'),
        t.feature(T),
        extrude(ADD, [region(T, 'M1,M2,M3,M4')], '5', 'add'),
        fillet(F, [edge(edgeName(side(E, S, 'L3'), side(E, S, 'L4')))], '1 mm'),
        k.feature(K),
        extrude(CUT, [region(K, 'K1,K2,K3,K4')], '20', 'cut', 'symmetric'),
        n.feature(N),
        extrude(NOTCH, [region(N, 'N1,N2,N3,N4')], '20', 'cut', 'symmetric'),
      ]);

      // Merged: the added block's front side is part of the base's front face now. M1 runs along
      // y = 0 like L1; the notch split L1, so the survivor is one of its pieces or L1 itself.
      const merged = await gen(T, 'M3');
      expect(merged.outcome).toMatchObject({
        kind: 'unique',
        featureId: ADD,
        name: side(ADD, T, 'M3'),
        target: { name: side(E, S, 'L3'), kind: 'face' },
        merged: { by: ADD },
      });
      expect(merged.consumers[0]?.made[0]?.now).toMatchObject({ state: 'merged', by: ADD });

      // Removed by a fillet: the corner edge swept from pd (L3 | L4).
      expect((await gen(S, 'pd')).outcome).toEqual({
        kind: 'removed',
        featureId: E,
        name: edgeName(side(E, S, 'L3'), side(E, S, 'L4')),
        by: F,
      });
      // Removed by a cut: the added block's far end (x = 30).
      expect((await gen(T, 'M2')).outcome).toEqual({
        kind: 'removed',
        featureId: ADD,
        name: side(ADD, T, 'M2'),
        by: CUT,
      });
      // Split by a cut: the base's front face, in two pieces.
      const split = await gen(S, 'L1');
      expect(split.outcome).toMatchObject({
        kind: 'split',
        featureId: E,
        name: side(E, S, 'L1'),
        by: NOTCH,
      });
      if (split.outcome.kind === 'split') {
        expect(split.outcome.pieces.sort()).toEqual([
          `${side(E, S, 'L1')}#0`,
          `${side(E, S, 'L1')}#1`,
        ]);
      }
    });
  },
);
