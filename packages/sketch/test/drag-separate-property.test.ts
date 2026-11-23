/**
 * Property (owner report 2026-11-23): in a scene of several unlinked shapes of mixed kinds, a drag
 * of any entity of one shape leaves every parameter of every other shape bit-identical, through
 * every drag step and the release. Seeded, so a failure reproduces.
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import type { Id, SketchEntity, SketchSolveResult, Vec2 } from '@wren-cad/contracts';
import { describe, expect, it } from 'vitest';
import { interpolate } from '../src/bspline';
import { offsetEntities } from '../src/edit/offset';
import { core, rectangle, SketchBuilder } from './helpers';

/** Mulberry32: a small seeded PRNG. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Shape {
  ids: Id[];
  /** Entities to grab and where. */
  grabs: { id: Id; at: Vec2 }[];
}

type Kind = 'line' | 'rectangle' | 'arc' | 'circle' | 'spline' | 'ellipse';
const KINDS: readonly Kind[] = ['line', 'rectangle', 'arc', 'circle', 'spline', 'ellipse'];

function addShape(b: SketchBuilder, kind: Kind, o: Vec2, r: () => number): Shape {
  const before = new Set(b.entities.map((e) => e.id));
  const grabs: Shape['grabs'] = [];
  const s = 10 + 20 * r();
  switch (kind) {
    case 'line': {
      const l = b.segment(o, [o[0] + s, o[1] + s * (r() - 0.5)]);
      grabs.push({ id: l.start, at: o }, { id: l.line, at: [o[0] + s / 2, o[1]] });
      break;
    }
    case 'rectangle': {
      const q = rectangle(b, s, s / 2, o, 0);
      grabs.push(
        { id: q.p2, at: [o[0] + s, o[1] + s / 2] },
        { id: q.top, at: [o[0] + s / 2, o[1] + s / 2] },
      );
      if (r() < 0.5) b.dim({ kind: 'distance', a: q.p0, b: q.p1 }, s);
      break;
    }
    case 'arc': {
      const c = b.point(o[0], o[1]);
      const a0 = r() * Math.PI;
      const a1 = a0 + 0.5 + 2 * r();
      const p0 = b.point(o[0] + s * Math.cos(a0), o[1] + s * Math.sin(a0));
      const p1 = b.point(o[0] + s * Math.cos(a1), o[1] + s * Math.sin(a1));
      const a = b.arc(c, p0, p1);
      const m = (a0 + a1) / 2;
      grabs.push({ id: a, at: [o[0] + s * Math.cos(m), o[1] + s * Math.sin(m)] }, { id: c, at: o });
      break;
    }
    case 'circle': {
      const c = b.point(o[0], o[1]);
      const k = b.circle(c, s / 2);
      grabs.push({ id: k, at: [o[0] + s / 2, o[1]] }, { id: c, at: o });
      break;
    }
    case 'ellipse': {
      const c = b.point(o[0], o[1]);
      const e = b.ellipse(c, s / 2, s / 3, r());
      grabs.push({ id: c, at: o }, { id: e, at: o });
      break;
    }
    case 'spline': {
      const pts: Vec2[] = [0, 1, 2, 3].map((k) => [
        o[0] + (k * s) / 3,
        o[1] + s * (r() - 0.5) * 0.4,
      ]);
      const it = interpolate(pts, 3, false);
      if (!it) throw new Error('no interpolation');
      const poles = it.poles.map((p) => b.point(p[0], p[1]));
      const id = b.bspline(poles, { knots: it.knots, multiplicities: it.multiplicities });
      grabs.push({ id, at: it.poles[1] as Vec2 }, { id: poles[0] as Id, at: it.poles[0] as Vec2 });
      break;
    }
  }
  return { ids: b.entities.map((e) => e.id).filter((id) => !before.has(id)), grabs };
}

/** Every numeric parameter of an entity, by field name. */
function params(e: SketchEntity): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(e)) if (typeof v === 'number') out[k] = v;
  return out;
}

function snapshot(res: SketchSolveResult, ids: ReadonlySet<Id>): Map<Id, Record<string, number>> {
  return new Map(res.entities.filter((e) => ids.has(e.id)).map((e) => [e.id, params(e)]));
}

/** Ids whose parameters are not bit-identical (Object.is: -0 vs 0 counts too). */
function moved(a: Map<Id, Record<string, number>>, b: Map<Id, Record<string, number>>): string[] {
  const out: string[] = [];
  for (const [id, p] of a) {
    const q = b.get(id);
    for (const [k, v] of Object.entries(p)) if (!q || !Object.is(q[k], v)) out.push(`${id}.${k}`);
  }
  return out;
}

describe('a drag never moves geometry of another, unlinked shape (property)', () => {
  it('40 random scenes of 4 to 7 mixed shapes, 25 drag steps each', async () => {
    const solver = await core();
    for (let seed = 1; seed <= 40; seed++) {
      const r = rng(seed);
      const b = new SketchBuilder();
      const n = 4 + Math.floor(r() * 4);
      const shapes: Shape[] = [];
      for (let i = 0; i < n; i++) {
        const kind = KINDS[Math.floor(r() * KINDS.length)] as Kind;
        shapes.push(addShape(b, kind, [(i % 3) * 80 - 80, Math.floor(i / 3) * 70 - 40], r));
      }
      const base = solver.solve(b.input());
      const which = shapes[Math.floor(r() * shapes.length)] as Shape;
      const grab = which.grabs[Math.floor(r() * which.grabs.length)] as Shape['grabs'][number];
      const others = new Set(shapes.filter((s) => s !== which).flatMap((s) => s.ids));
      const before = snapshot(base, others);
      const { session } = solver.beginDrag(
        { ...b.input(), entities: base.entities },
        grab.id,
        grab.at,
      );
      const dir: Vec2 = [r() * 2 - 1, r() * 2 - 1];
      for (let i = 1; i <= 25; i++) {
        const res = solver.drag(session, [
          grab.at[0] + i * dir[0] * 2,
          grab.at[1] + i * dir[1] * 2,
        ]);
        expect(
          moved(before, snapshot(res, others)),
          `seed ${seed}, step ${i}, grab ${grab.id}`,
        ).toEqual([]);
      }
      const end = solver.endDrag(session);
      expect(moved(before, snapshot(end, others)), `seed ${seed}, release`).toEqual([]);
    }
  });

  for (const off of [1e-9, 1e-6, 5]) {
    it(`a separate shape ${off} mm off its constraints: moved by the drag start's solve only, never by the steps`, async () => {
      // beginDrag solves (and polishes) the input first, as any solve does; `polish` / `refined`
      // then run over every row on each step and must leave the separate shape bit-identical.
      const solver = await core();
      const b = new SketchBuilder();
      const a = rectangle(b, 40, 20, [0, 0], 0);
      const p = b.point(100, 0);
      const q = b.point(130, off);
      const l = b.line(p, q);
      b.geo({ kind: 'horizontal', line: l });
      b.geo({ kind: 'fix', entity: a.p0 });
      const input = b.input();
      const others = new Set([p, q, l]);
      const solved = snapshot(solver.solve(input), others);
      const { session } = solver.beginDrag(input, a.p2, [40, 20]);
      for (let i = 1; i <= 10; i++) {
        const res = solver.drag(session, [40 + i, 20 + i]);
        expect(moved(solved, snapshot(res, others)), `step ${i}`).toEqual([]);
      }
      expect(moved(solved, snapshot(solver.endDrag(session), others))).toEqual([]);
    });
  }
});

describe('offset stages (offsetSplit) do not reach separate shapes', () => {
  it('dragging a shape next to an offset rectangle, or the offset source, moves nothing else', async () => {
    const solver = await core();
    const b = new SketchBuilder();
    const src = rectangle(b, 40, 20, [0, 0], 0);
    const free = b.segment([100, 0], [130, 10]);
    const centre = b.point(-60, 0);
    const circle = b.circle(centre, 8);
    const sides = [src.bottom, src.right, src.top, src.left];
    const off = offsetEntities({ entities: b.entities, constraints: b.constraints }, sides, {
      distance: 3,
      side: 'inside',
    });
    if (!off.ok) throw new Error(off.reason);
    const offset = off.sketch.constraints.find((k) => k.kind === 'offset');
    if (!offset) throw new Error('no offset constraint');
    const input = { ...off.sketch, values: { ...b.values, [offset.id]: -3 } };
    const base = solver.solve(input);
    expect(base.status).toBe('solved');
    const loose = [free.line, free.start, free.end, circle, centre];
    const rectAndOffset = base.entities.map((e) => e.id).filter((id) => !loose.includes(id));
    const cases: { grab: Id; at: Vec2; others: Set<Id> }[] = [
      { grab: free.line, at: [115, 5], others: new Set([...rectAndOffset, circle, centre]) },
      { grab: src.p2, at: [40, 20], others: new Set(loose) },
    ];
    for (const c of cases) {
      const before = snapshot(base, c.others);
      const { session } = solver.beginDrag({ ...input, entities: base.entities }, c.grab, c.at);
      for (let i = 1; i <= 15; i++) {
        const res = solver.drag(session, [c.at[0] + i, c.at[1] + i / 2]);
        expect(moved(before, snapshot(res, c.others)), `${c.grab} step ${i}`).toEqual([]);
      }
      expect(moved(before, snapshot(solver.endDrag(session), c.others))).toEqual([]);
    }
  });
});
