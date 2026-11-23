/**
 * Owner report 2026-11-23: dragging one shape moved sketch lines of a separate shape. Geometry
 * that no constraint links to what is dragged must not move at all.
 */
import type { SketchSolveResult } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { core, pos, rectangle, SketchBuilder } from './helpers';

const corners = (res: SketchSolveResult, r: ReturnType<typeof rectangle>) =>
  [r.p0, r.p1, r.p2, r.p3].map((p) => pos(res, p));

describe('dragging one shape leaves separate shapes where they are', () => {
  for (const what of ['corner', 'line'] as const) {
    it(`two unlinked rectangles: dragging a ${what} of one never moves the other`, async () => {
      const solver = await core();
      const b = new SketchBuilder();
      const a = rectangle(b, 40, 20, [0, 0]);
      const other = rectangle(b, 30, 15, [100, 60]);
      const base = solver.solve(b.input());
      const before = corners(base, other);
      const grabbed = what === 'corner' ? a.p2 : a.top;
      const start =
        what === 'corner' ? pos(base, a.p2) : ([20, pos(base, a.p2)[1]] as [number, number]);
      const { session } = solver.beginDrag(
        { ...b.input(), entities: base.entities },
        grabbed,
        start,
      );
      let worst = 0;
      for (let i = 1; i <= 40; i++) {
        const res = solver.drag(session, [start[0] + i * 3, start[1] + i * 2]);
        expect(res.status).toBe('solved');
        corners(res, other).forEach((p, k) => {
          const q = before[k] as [number, number];
          worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
        });
      }
      const end = solver.endDrag(session);
      corners(end, other).forEach((p, k) => {
        const q = before[k] as [number, number];
        worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
      });
      expect(worst).toBe(0);
    });
  }
});
