/**
 * Connected pieces (ADR-087 amendment, 2026-11-23): which constraints link two shapes that don't
 * touch, and which links carry a drag from one shape to another.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import {
  type Id,
  SKETCH_ORIGIN,
  SKETCH_X_AXIS,
  type SketchConstraint,
  type SketchEntity,
} from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { ConnectedPieces, crossPieceLinks, PieceLinks } from '../src/pieces';
import { core, pos, rectangle, SketchBuilder } from './helpers';

function scene() {
  const b = new SketchBuilder();
  const r = rectangle(b, 40, 40, [-60, -30], 0);
  const s = rectangle(b, 30, 40, [20, -30], 0);
  const c = b.point(100, 0);
  const circle = b.circle(c, 5);
  return { b, r, s, circle, c };
}

const added = (b: SketchBuilder, n: number): SketchConstraint[] => b.constraints.slice(-n);

describe('ConnectedPieces', () => {
  it('shared points make one piece; separate rectangles are two', () => {
    const { b, r, s } = scene();
    const p = new ConnectedPieces(b.entities, b.constraints);
    expect(p.same(r.p0, r.top)).toBe(true);
    expect(p.same(r.left, r.right)).toBe(true);
    expect(p.same(r.p0, s.p0)).toBe(false);
    // A rectangle's own H/V link nothing.
    expect(crossPieceLinks(b, b.constraints)).toEqual([]);
  });

  for (const kind of [
    'horizontalPoints',
    'verticalPoints',
    'parallel',
    'perpendicular',
    'equal',
  ] as const) {
    it(`${kind} between two shapes is a link; within one shape it is not`, () => {
      const { b, r, s } = scene();
      const pts = kind.endsWith('Points');
      b.geo({ kind, a: pts ? r.p1 : r.top, b: pts ? s.p1 : s.top });
      b.geo({ kind, a: pts ? r.p0 : r.top, b: pts ? r.p2 : r.bottom });
      const [across, within] = added(b, 2) as [SketchConstraint, SketchConstraint];
      expect(crossPieceLinks(b, [across, within]).map((c) => c.id)).toEqual([across.id]);
    });
  }

  it('relations to the origin, an axis, fixed or linked geometry link nothing', () => {
    const { b, r, s } = scene();
    b.geo({ kind: 'fix', entity: s.p1 });
    const linked = b.segment([0, 80], [10, 90]);
    b.geo({ kind: 'horizontalPoints', a: r.p1, b: s.p1 });
    b.geo({ kind: 'horizontalPoints', a: r.p2, b: SKETCH_ORIGIN });
    b.geo({ kind: 'parallel', a: r.top, b: SKETCH_X_AXIS });
    b.geo({ kind: 'parallel', a: r.left, b: linked.line });
    const entities = b.entities.map(
      (e): SketchEntity =>
        e.id === linked.line ? { ...e, source: { ref: { featureId: 'f' } } as never } : e,
    );
    expect(crossPieceLinks({ entities, constraints: b.constraints }, added(b, 4))).toEqual([]);
  });

  for (const touch of ['coincident', 'pointOn', 'tangent', 'midpoint'] as const) {
    it(`a ${touch} joins two shapes into one piece, so it and later relations link nothing`, () => {
      const { b, r, s, circle } = scene();
      if (touch === 'coincident') b.geo({ kind: 'coincident', a: r.p1, b: s.p0 });
      if (touch === 'pointOn') b.geo({ kind: 'pointOn', point: r.p1, on: s.left });
      if (touch === 'tangent') b.geo({ kind: 'tangent', a: r.right, b: circle });
      if (touch === 'midpoint') b.geo({ kind: 'midpoint', point: r.p2, line: s.left });
      const other = touch === 'tangent' ? circle : s.top;
      b.geo({ kind: touch === 'tangent' ? 'equal' : 'parallel', a: r.top, b: other });
      const p = new ConnectedPieces(b.entities, b.constraints);
      expect(p.same(r.p0, other)).toBe(true);
      expect(crossPieceLinks(b, added(b, 2))).toEqual([]);
    });
  }

  it('the origin and the axes join nothing: two shapes on one axis stay separate', () => {
    const { b, r, s } = scene();
    b.geo({ kind: 'pointOn', point: r.p0, on: SKETCH_X_AXIS });
    b.geo({ kind: 'pointOn', point: s.p0, on: SKETCH_X_AXIS });
    const p = new ConnectedPieces(b.entities, b.constraints);
    expect(p.same(r.p0, s.p0)).toBe(false);
  });

  it('a distance dimension between two shapes is a link too', () => {
    const { b, r, s } = scene();
    b.dim({ kind: 'distance', a: r.p1, b: s.p0 }, 40);
    expect(crossPieceLinks(b, added(b, 1))).toHaveLength(1);
  });
});

describe('PieceLinks.carriers', () => {
  it('names the links on the path from the dragged shape to each shape that moved', () => {
    const { b, r, s, circle } = scene();
    const rs = b.geo({ kind: 'horizontalPoints', a: r.p2, b: s.p3 });
    const sc = b.geo({ kind: 'equal', a: s.top, b: circle });
    const links = new PieceLinks(b);
    expect(links.carriers(r.p2, [s.p3])).toEqual([rs]);
    expect(links.carriers(r.p2, [circle]).sort()).toEqual([rs, sc].sort());
    expect(links.carriers(r.p2, [r.p1])).toEqual([]); // its own shape
    expect(new PieceLinks(scene().b).empty).toBe(true);
  });

  it('a real drag: the region moves through the link, and only that link carries it', async () => {
    const solver = await core();
    const { b, r, s } = scene();
    const link = b.geo({ kind: 'horizontalPoints', a: r.p2, b: s.p3 });
    const base = solver.solve(b.input());
    const links = new PieceLinks({ entities: base.entities, constraints: b.constraints });
    const { session } = solver.beginDrag(
      { ...b.input(), entities: base.entities },
      s.top,
      [35, 10],
    );
    const res = solver.drag(session, [35, 25]);
    solver.endDrag(session);
    const moved: Id[] = [r.p0, r.p1, r.p2, r.p3].filter(
      (id) => pos(res, id)[1] !== pos(base, id)[1],
    );
    expect(moved.length).toBeGreaterThan(0);
    expect(links.carriers(s.top, moved)).toEqual([link]);
  });
});
