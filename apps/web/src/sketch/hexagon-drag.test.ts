/**
 * Owner report 2026-11-23: "a hexagon that I drew next to a multiline region" moved with it. The
 * scene is drawn with the real drawing state machine (inference included), then dragged with the
 * real solver: whatever moves in the other shape must be explained by a stored constraint that
 * links the two.
 */

import type { Id, SketchConstraint, SketchEntity, Vec2 } from '@wren-cad/contracts';
import { ConnectedPieces, constraintRefs } from '@wren-cad/sketch';
import { createSketchSolverCore } from '@wren-cad/sketch/core';
import { describe, expect, it } from 'vitest';
import { click, type DrawState, move, type SketchData, startDraw } from './draw';

const TOL = 1.2;

function draw(data: SketchData, state: DrawState, pts: readonly Vec2[]): Id[] {
  let s = state;
  const created: Id[] = [];
  for (const p of pts) {
    s = move(s, data, p, TOL);
    const r = click(s, data);
    s = r.state;
    if (r.edit) {
      (data.entities as SketchEntity[]).push(...r.edit.entities);
      (data.constraints as SketchConstraint[]).push(...r.edit.constraints);
      created.push(...r.edit.entities.map((e) => e.id));
    }
  }
  return created;
}

function scene(hexagon: readonly Vec2[]) {
  const data: SketchData = { entities: [], constraints: [] };
  // A closed region drawn with the line tool, a little off level as a hand draws it.
  const region = draw(data, startDraw('line'), [
    [-60, -30],
    [-20, -29.6],
    [-19.6, 10.3],
    [-60.2, 9.8],
    [-60, -30],
  ]);
  const before = data.constraints.length;
  const hex = draw(data, startDraw('polygon'), hexagon);
  return {
    data,
    region: new Set(region),
    hex: new Set(hex),
    hexConstraints: data.constraints.slice(before),
  };
}

describe('a hexagon drawn next to a line-tool region (owner report 2026-11-23)', () => {
  // Centre level with the region's top-right corner, first vertex level with its bottom corner.
  const cases: Record<string, Vec2[]> = {
    'away from everything': [
      [40, 60],
      [55, 61],
    ],
    'centre level with a corner': [
      [40, 10.6],
      [55, 30],
    ],
    'vertex level with a corner': [
      [40, 0],
      [55, -29.4],
    ],
  };
  const expected: Record<string, string[]> = {
    'away from everything': [],
    'centre level with a corner': ['horizontalPoints'],
    'vertex level with a corner': ['horizontalPoints'],
  };
  for (const [name, clicks] of Object.entries(cases)) {
    it(`${name}: only constraints that link the shapes make the region move`, async () => {
      const { data, region, hex, hexConstraints } = scene(clicks);
      const linking = hexConstraints.filter((c) => {
        const refs = constraintRefs(c);
        return refs.some((r) => region.has(r)) && refs.some((r) => hex.has(r));
      });
      // The polygon tool's own constraints: six vertices on its construction circle, five sides
      // equal to the first; plus what the two clicks inferred.
      const own = hexConstraints
        .filter((c) => !linking.includes(c) && !constraintRefs(c).some((r) => r.startsWith('@')))
        .map((c) => c.kind);
      expect(own.filter((k) => k === 'pointOn' || k === 'equal')).toHaveLength(11);
      expect(linking.map((c) => c.kind)).toEqual(expected[name]);
      const pieces = new ConnectedPieces(data.entities, data.constraints);
      const solver = await createSketchSolverCore();
      const base = solver.solve({
        entities: [...data.entities],
        constraints: [...data.constraints],
        values: {},
      });
      const pos = (es: readonly SketchEntity[]) =>
        new Map(
          es
            .filter((e) => e.kind === 'point' && region.has(e.id))
            .map((e) => [e.id, e.kind === 'point' ? [e.x, e.y] : []]),
        );
      const hexEntities = base.entities.filter((e) => hex.has(e.id));
      const centre = hexEntities.find((e) => e.kind === 'point' && e.construction);
      const vertex = hexEntities.find((e) => e.kind === 'point' && !e.construction);
      const edge = hexEntities.find((e) => e.kind === 'line');
      for (const grab of [centre, vertex, edge]) {
        if (!grab) throw new Error('hexagon entity missing');
        const at = (() => {
          if (grab.kind === 'point') return [grab.x, grab.y] as Vec2;
          if (grab.kind !== 'line') throw new Error('unexpected');
          const p = (id: Id) =>
            base.entities.find((e) => e.id === id) as Extract<SketchEntity, { kind: 'point' }>;
          return [
            (p(grab.start).x + p(grab.end).x) / 2,
            (p(grab.start).y + p(grab.end).y) / 2,
          ] as Vec2;
        })();
        const before = pos(base.entities);
        const { session } = solver.beginDrag(
          { entities: base.entities, constraints: [...data.constraints], values: {} },
          grab.id,
          at,
        );
        let res = base;
        for (let i = 1; i <= 20; i++) res = solver.drag(session, [at[0] + i, at[1] + i * 1.5]);
        solver.endDrag(session);
        const after = pos(res.entities);
        const movedIds = [...before].filter(([id, p]) => {
          const q = after.get(id);
          return !q || q[0] !== p[0] || q[1] !== p[1];
        });
        // Something of the region moved: a stored constraint must link the two shapes.
        if (movedIds.length > 0)
          expect(linking.length, `${name}: ${grab.kind} drag moved the region`).toBeGreaterThan(0);
        // Without such a constraint the two are separate pieces and nothing of the region moves.
        if (linking.length === 0) {
          expect(movedIds).toEqual([]);
          expect(pieces.same([...region][0] as Id, grab.id)).toBe(false);
        }
      }
    });
  }
});
