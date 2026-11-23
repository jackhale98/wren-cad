// Spike S1: generated test assemblies. Each model is designed in a "true" closed configuration;
// mate frames are taken from it (so the mates are consistent unless a test breaks them), then
// the instances start from a perturbed pose, as if placed roughly by hand.

import {
  add,
  cross,
  normalize,
  qAxisAngle,
  qFromBasis,
  qIdentity,
  qMul,
  qNormalize,
  qRotate,
  rng,
  sub,
  type Transform,
  tCompose,
  tInverse,
  type Vec3,
} from './math.ts';
import { offsetT } from './solver.ts';
import type { Assembly, Mate, MateFrame, MateType } from './types.ts';

export interface WorldFrame {
  o: Vec3;
  z: Vec3;
  x?: Vec3;
}

const perpendicular = (z: Vec3): Vec3 => {
  const t: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  return normalize(cross(cross(z, t), z));
};

function toFrame(t: Transform): MateFrame {
  return { origin: t.p, x: qRotate(t.q, [1, 0, 0]), z: qRotate(t.q, [0, 0, 1]) };
}

export class Builder {
  private readonly parts: { id: string; truth: Transform; grounded: boolean }[] = [];
  private readonly mates: Mate[] = [];
  private readonly truthOf = new Map<string, Transform>();

  part(id: string, truth: Transform = { q: qIdentity(), p: [0, 0, 0] }, grounded = false): this {
    this.parts.push({ id, truth, grounded });
    this.truthOf.set(id, truth);
    return this;
  }

  mate(
    id: string,
    type: MateType,
    a: string,
    b: string,
    w: WorldFrame,
    opts: { flip?: boolean; offset?: number; angle?: number } = {},
  ): this {
    const z = normalize(w.z);
    const x = w.x ? normalize(w.x) : perpendicular(z);
    const y = cross(z, x);
    // World frame as a transform: columns x, y, z.
    const W: Transform = { q: qFromBasis(x, y, z), p: w.o };
    const m: Mate = {
      id,
      type,
      a: { instance: a, frame: { origin: [0, 0, 0], x: [1, 0, 0], z: [0, 0, 1] } },
      b: { instance: b, frame: { origin: [0, 0, 0], x: [1, 0, 0], z: [0, 0, 1] } },
      ...opts,
    };
    const ta = this.truthOf.get(a);
    const tb = this.truthOf.get(b);
    if (!ta || !tb) throw new Error(`mate ${id}: unknown part`);
    m.a.frame = toFrame(tCompose(tInverse(ta), W));
    // B ∘ offset = W, so B = W ∘ offset⁻¹.
    m.b.frame = toFrame(tCompose(tInverse(tb), tCompose(W, tInverse(offsetT(m)))));
    this.mates.push(m);
    return this;
  }

  /** Assembly with every non-grounded instance moved by up to `pos` mm and `rotDeg` degrees. */
  build(perturb: { pos?: number; rotDeg?: number; seed?: number } = {}): Assembly {
    const rand = rng(perturb.seed ?? 1);
    const pos = perturb.pos ?? 0;
    const rot = ((perturb.rotDeg ?? 0) * Math.PI) / 180;
    return {
      instances: this.parts.map((p) => {
        if (p.grounded || (pos === 0 && rot === 0))
          return { id: p.id, grounded: p.grounded, pose: { q: p.truth.q, p: p.truth.p } };
        const axis: Vec3 = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
        const dq = qAxisAngle(axis, rot * (2 * rand() - 1));
        const dp: Vec3 = [pos * (2 * rand() - 1), pos * (2 * rand() - 1), pos * (2 * rand() - 1)];
        return { id: p.id, pose: { q: qNormalize(qMul(dq, p.truth.q)), p: add(p.truth.p, dp) } };
      }),
      mates: this.mates.map((m) => structuredClone(m)),
    };
  }
}

/** Pose of a link running from p to q in the plane normal to `n` (x along the link). */
export function link(p: Vec3, q: Vec3, n: Vec3 = [0, 0, 1]): Transform {
  const x = normalize(sub(q, p));
  const z = normalize(sub(n, scaleV(x, x[0] * n[0] + x[1] * n[1] + x[2] * n[2])));
  return { q: qFromBasis(x, cross(z, x), z), p };
}
const scaleV = (v: Vec3, s: number): Vec3 => [v[0] * s, v[1] * s, v[2] * s];
const at = (p: Vec3): Transform => ({ q: qIdentity(), p });
const Z: Vec3 = [0, 0, 1];

/** Shift one end's frame origin by `d` along that frame's own y axis (breaks a mate on purpose). */
export function shiftFrame(m: Mate, end: 'a' | 'b', d: number, along: 'x' | 'y' = 'y'): void {
  const f = m[end].frame;
  const dir = along === 'x' ? f.x : cross(f.z, f.x);
  f.origin = add(f.origin, scaleV(dir, d));
}

// ------------------------------------------------------------------ models

export const P0: Vec3 = [0, 0, 0];
export const P1: Vec3 = [20, 20 * Math.sqrt(3), 0];
export const P2: Vec3 = [90, 60, 0];
export const P3: Vec3 = [100, 0, 0];

/** Planar four-bar, four revolutes: 1 DOF, 3 redundant (out-of-plane) equations. */
export function fourBar(origin: Vec3 = [0, 0, 0]): Builder {
  const o = (v: Vec3) => add(v, origin);
  return new Builder()
    .part('ground', at(origin), true)
    .part('crank', link(o(P0), o(P1)))
    .part('coupler', link(o(P1), o(P2)))
    .part('rocker', link(o(P2), o(P3)))
    .mate('rev-1', 'revolute', 'crank', 'ground', { o: o(P0), z: Z })
    .mate('rev-2', 'revolute', 'coupler', 'crank', { o: o(P1), z: Z })
    .mate('rev-3', 'revolute', 'rocker', 'coupler', { o: o(P2), z: Z })
    .mate('rev-4', 'revolute', 'rocker', 'ground', { o: o(P3), z: Z });
}

/** Slider-crank: crank 30, rod 80, slider on the x axis. 1 DOF. */
export function sliderCrank(origin: Vec3 = [0, 0, 0], angleDeg = 50): Builder {
  const o = (v: Vec3) => add(v, origin);
  const t = (angleDeg * Math.PI) / 180;
  const c: Vec3 = [30 * Math.cos(t), 30 * Math.sin(t), 0];
  const s: Vec3 = [c[0] + Math.sqrt(80 ** 2 - c[1] ** 2), 0, 0];
  return new Builder()
    .part('ground', at(origin), true)
    .part('crank', link(o(P0), o(c)))
    .part('rod', link(o(c), o(s)))
    .part('slider', at(o(s)))
    .mate('crank-pivot', 'revolute', 'crank', 'ground', { o: o(P0), z: Z })
    .mate('crank-pin', 'revolute', 'rod', 'crank', { o: o(c), z: Z })
    .mate('wrist-pin', 'revolute', 'slider', 'rod', { o: o(s), z: Z })
    .mate('slide', 'slider', 'slider', 'ground', { o: o(s), z: [1, 0, 0], x: [0, 0, 1] });
}

/** Plates stacked face to face with fasten mates (flipped normals). 0 DOF. */
export function fastenedStack(n = 3): Builder {
  const b = new Builder().part('ground', at([0, 0, 0]), true);
  for (let i = 1; i <= n; i++) b.part(`plate-${i}`, at([0, 0, 10 * i]));
  for (let i = 1; i <= n; i++)
    b.mate(
      `fasten-${i}`,
      'fasten',
      `plate-${i}`,
      i === 1 ? 'ground' : `plate-${i - 1}`,
      {
        o: [0, 0, 10 * i],
        z: [0, 0, -1],
        x: [1, 0, 0],
      },
      { flip: true },
    );
  return b;
}

/** A carriage on two parallel rails: the second slider mate is fully redundant. */
export function twoRails(): Builder {
  return new Builder()
    .part('base', at([0, 0, 0]), true)
    .part('carriage', at([10, 25, 5]))
    .mate('rail-1', 'slider', 'carriage', 'base', { o: [10, 0, 5], z: [1, 0, 0], x: [0, 0, 1] })
    .mate('rail-2', 'slider', 'carriage', 'base', { o: [10, 50, 5], z: [1, 0, 0], x: [0, 0, 1] });
}

/** One part mated to ground by a single mate of each type, on a skew frame. */
export function single(type: MateType, opts: { flip?: boolean; offset?: number } = {}): Builder {
  return new Builder()
    .part('ground', at([0, 0, 0]), true)
    .part('part', { q: qNormalize(qAxisAngle([1, 1, 0], 0.4)), p: [5, 15, 25] })
    .mate('m', type, 'part', 'ground', { o: [10, 20, 30], z: [1, 2, 3], x: [-2, 1, 0] }, opts);
}

/** 25 parts: Watt six-bar, slider-crank, fastened stack, piston, puck with ball, RSSR, slide-and-hinge, bolts. 14 DOF, 4 loops. */
export function assembly25(): Builder {
  const b = new Builder().part('base', at([0, 0, 0]), true);
  // Watt six-bar (two planar loops), z = 0 plane.
  const Q1: Vec3 = [130, 50, 0];
  const Q2: Vec3 = [170, 70, 0];
  const Q3: Vec3 = [180, 0, 0];
  b.part('a1', link(P0, P1)).part('a2', link(P1, P2)).part('a3', link(P2, P3));
  b.part('d1', link(Q1, Q2)).part('d2', link(Q2, Q3));
  b.mate('A-r1', 'revolute', 'a1', 'base', { o: P0, z: Z })
    .mate('A-r2', 'revolute', 'a2', 'a1', { o: P1, z: Z })
    .mate('A-r3', 'revolute', 'a3', 'a2', { o: P2, z: Z })
    .mate('A-r4', 'revolute', 'a3', 'base', { o: P3, z: Z })
    .mate('D-r1', 'revolute', 'd1', 'a3', { o: Q1, z: Z })
    .mate('D-r2', 'revolute', 'd2', 'd1', { o: Q2, z: Z })
    .mate('D-r3', 'revolute', 'd2', 'base', { o: Q3, z: Z });
  // Slider-crank at y = 200.
  const B0: Vec3 = [0, 200, 0];
  const t = (50 * Math.PI) / 180;
  const Bc: Vec3 = [30 * Math.cos(t), 200 + 30 * Math.sin(t), 0];
  const Bs: Vec3 = [Bc[0] + Math.sqrt(80 ** 2 - (Bc[1] - 200) ** 2), 200, 0];
  b.part('b1', link(B0, Bc)).part('b2', link(Bc, Bs)).part('b3', at(Bs));
  b.mate('B-r1', 'revolute', 'b1', 'base', { o: B0, z: Z })
    .mate('B-r2', 'revolute', 'b2', 'b1', { o: Bc, z: Z })
    .mate('B-r3', 'revolute', 'b3', 'b2', { o: Bs, z: Z })
    .mate('B-slide', 'slider', 'b3', 'base', { o: Bs, z: [1, 0, 0], x: [0, 0, 1] });
  // Fastened stack.
  for (let i = 1; i <= 3; i++) {
    b.part(`c${i}`, at([300, 0, 10 * i]));
    b.mate(
      `C-f${i}`,
      'fasten',
      `c${i}`,
      i === 1 ? 'base' : `c${i - 1}`,
      { o: [300, 0, 10 * i], z: [0, 0, -1] },
      {
        flip: true,
      },
    );
  }
  // Piston in a bore (cylindrical) with a fastened collar.
  b.part('e1', at([300, 200, 10])).part('e2', at([300, 200, 30]));
  b.mate('E-cyl', 'cylindrical', 'e1', 'base', { o: [300, 200, 0], z: Z }).mate(
    'E-f',
    'fasten',
    'e2',
    'e1',
    { o: [300, 200, 30], z: Z },
  );
  // Puck on a plane (planar, face to face) carrying a ball joint.
  b.part('f1', at([0, 400, 0])).part('f2', at([0, 400, 20]));
  b.mate('F-plane', 'planar', 'f1', 'base', { o: [0, 400, 0], z: [0, 0, -1] }, { flip: true }).mate(
    'F-ball',
    'ball',
    'f2',
    'f1',
    { o: [0, 400, 20], z: Z },
  );
  // Spatial RSSR loop: crank about z, rocker about y, coupler with two balls.
  const G0: Vec3 = [400, 0, 0];
  const G1: Vec3 = [420, 15, 10];
  const G2: Vec3 = [500, 20, 40];
  const G3: Vec3 = [500, 0, 0];
  b.part('g1', link(G0, G1))
    .part('g2', link(G1, G2))
    .part('g3', link(G3, G2, [0, 1, 0]));
  b.mate('G-r1', 'revolute', 'g1', 'base', { o: G0, z: Z })
    .mate('G-s1', 'ball', 'g2', 'g1', { o: G1, z: Z })
    .mate('G-s2', 'ball', 'g2', 'g3', { o: G2, z: Z })
    .mate('G-r2', 'revolute', 'g3', 'base', { o: G3, z: [0, 1, 0] });
  // Slide with a hinge and a fastened arm.
  b.part('h1', at([400, 200, 0]))
    .part('h2', at([400, 200, 20]))
    .part('h3', at([420, 200, 20]));
  b.mate('H-slide', 'slider', 'h1', 'base', { o: [400, 200, 0], z: [0, 1, 0], x: [0, 0, 1] })
    .mate('H-hinge', 'revolute', 'h2', 'h1', { o: [400, 200, 20], z: [1, 0, 0] })
    .mate('H-f', 'fasten', 'h3', 'h2', { o: [420, 200, 20], z: [1, 0, 0] });
  // Bolts.
  for (let i = 1; i <= 3; i++) {
    b.part(`i${i}`, at([600, 50 * (i - 1), 0]));
    b.mate(`I-f${i}`, 'fasten', `i${i}`, 'base', { o: [600, 50 * (i - 1), 0], z: Z });
  }
  return b;
}

/** 1 grounded plate + 100 modules of 5 (bracket, 2 bolts, lever, pin): 501 instances, 100 DOF. */
export function assembly500(modules = 100): Builder {
  const b = new Builder().part('plate', at([0, 0, 0]), true);
  const side = Math.ceil(Math.sqrt(modules));
  for (let k = 0; k < modules; k++) {
    const x = 100 * (k % side);
    const y = 100 * Math.floor(k / side);
    const id = (s: string) => `${s}-${k}`;
    b.part(id('bracket'), at([x, y, 0]));
    b.part(id('bolt1'), at([x - 20, y, 5])).part(id('bolt2'), at([x + 20, y, 5]));
    b.part(id('lever'), link([x, y, 30], [x, y + 40, 30], [1, 0, 0]));
    b.part(id('pin'), at([x, y + 30, 30]));
    b.mate(
      id('F-bracket'),
      'fasten',
      id('bracket'),
      'plate',
      { o: [x, y, 0], z: [0, 0, -1] },
      { flip: true },
    )
      .mate(id('F-bolt1'), 'fasten', id('bolt1'), id('bracket'), { o: [x - 20, y, 5], z: Z })
      .mate(id('F-bolt2'), 'fasten', id('bolt2'), id('bracket'), { o: [x + 20, y, 5], z: Z })
      .mate(id('R-lever'), 'revolute', id('lever'), id('bracket'), { o: [x, y, 30], z: [1, 0, 0] })
      .mate(id('F-pin'), 'fasten', id('pin'), id('lever'), { o: [x, y + 30, 30], z: [1, 0, 0] });
  }
  return b;
}

/**
 * One large component: a planar chain of `n` links joined by revolutes, closed to ground by a
 * ball every `closeEvery` links (each closure removes 2 DOF and adds 1 redundant equation).
 */
export function chain(n: number, closeEvery = 50): Builder {
  const b = new Builder().part('ground', at([0, 0, 0]), true);
  const pt = (k: number): Vec3 => [20 * k, 8 * Math.sin(k * 0.7), 0];
  for (let k = 0; k < n; k++) b.part(`l${k}`, link(pt(k), pt(k + 1)));
  b.mate('r0', 'revolute', 'l0', 'ground', { o: pt(0), z: Z });
  for (let k = 1; k < n; k++) b.mate(`r${k}`, 'revolute', `l${k}`, `l${k - 1}`, { o: pt(k), z: Z });
  for (let k = closeEvery - 1; k < n; k += closeEvery)
    b.mate(`s${k}`, 'ball', `l${k}`, 'ground', { o: pt(k + 1), z: Z });
  return b;
}
