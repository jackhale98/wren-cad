// Spike S1 tests. Run from the repo root:
//   node --experimental-strip-types --test spikes/mates/test/mates.test.ts
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  add,
  cross,
  dot,
  qAxisAngle,
  qMul,
  qNormalize,
  qRotate,
  sub,
  type Vec3,
} from '../src/math.ts';
import {
  assembly25,
  assembly500,
  chain,
  fastenedStack,
  fourBar,
  P1,
  P2,
  P3,
  shiftFrame,
  single,
  sliderCrank,
  twoRails,
} from '../src/models.ts';
import { MateSystem } from '../src/solver.ts';
import type { Assembly, MateType, Pose } from '../src/types.ts';

const holds = (sys: MateSystem, tolMm = 1e-6) => {
  const e = sys.maxMateError();
  assert.ok(e.pos < tolMm && e.ang < 1e-8, `mates off by ${e.pos} mm, ${e.ang} rad`);
};
const world = (pose: Pose, local: Vec3): Vec3 => add(qRotate(pose.q, local), pose.p);
const solve = (asm: Assembly, cluster = true) => {
  const sys = new MateSystem(asm, { clusterFasten: cluster });
  return { sys, r: sys.solve() };
};

describe('each mate type alone', () => {
  const expected: Record<MateType, [number, number, number]> = {
    fasten: [0, 0, 0],
    revolute: [1, 1, 0],
    slider: [1, 0, 1],
    cylindrical: [2, 1, 1],
    planar: [3, 1, 2],
    ball: [3, 3, 0],
  };
  for (const [type, [total, rot, trans]] of Object.entries(expected) as [MateType, number[]][]) {
    for (const cluster of [true, false]) {
      it(`${type} leaves ${total} DOF (${rot} rotational)${cluster ? '' : ', fasten unclustered'}`, () => {
        const { sys, r } = solve(single(type).build({ pos: 4, rotDeg: 15, seed: 3 }), cluster);
        assert.ok(r.converged);
        holds(sys);
        assert.equal(r.dof, total);
        assert.deepEqual(r.instanceDof.part, { total, rotational: rot, translational: trans });
        assert.equal(r.mates.m.status, 'ok');
      });
    }
  }

  it('flip and offset: planar face to face at a 5 mm gap', () => {
    const asm = single('planar', { flip: true, offset: 5 }).build({ pos: 3, rotDeg: 10, seed: 9 });
    const { r } = solve(asm);
    assert.ok(r.converged);
    const m = asm.mates[0];
    const pa = r.poses.part;
    const za = qRotate(pa.q, m.a.frame.z);
    const oa = world(pa, m.a.frame.origin);
    assert.ok(Math.abs(dot(za, m.b.frame.z) + 1) < 1e-9, 'normals opposed');
    assert.ok(Math.abs(dot(sub(oa, m.b.frame.origin), m.b.frame.z) - 5) < 1e-9, 'gap 5 mm');
  });

  it('starting exactly 180° off (a stationary point) still converges to the aligned branch', () => {
    const asm = single('revolute').build();
    const m = asm.mates[0];
    const inst = asm.instances[1];
    const o = world(inst.pose, m.a.frame.origin);
    const flip = qAxisAngle(qRotate(inst.pose.q, m.a.frame.x), Math.PI);
    inst.pose = {
      q: qNormalize(qMul(flip, inst.pose.q)),
      p: add(o, qRotate(flip, sub(inst.pose.p, o))),
    };
    const { sys, r } = solve(asm);
    assert.ok(r.converged);
    holds(sys);
    assert.ok(dot(qRotate(r.poses.part.q, m.a.frame.z), m.b.frame.z) > 1 - 1e-12);
  });
});

describe('four-bar linkage', () => {
  it('has 1 DOF; the closing revolute is 3 equations redundant (planar loop), no conflict', () => {
    const { sys, r } = solve(fourBar().build({ pos: 5, rotDeg: 5, seed: 1 }));
    assert.ok(r.converged);
    holds(sys);
    assert.equal(r.dof, 1);
    for (const id of ['crank', 'coupler', 'rocker']) assert.equal(r.instanceDof[id].total, 1);
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.mates['rev-4'].status, 'redundant');
    assert.equal(r.mates['rev-4'].redundantEquations, 3);
    assert.deepEqual([...r.mates['rev-4'].involved].sort(), ['rev-1', 'rev-2', 'rev-3']);
    for (const id of ['rev-1', 'rev-2', 'rev-3']) assert.equal(r.mates[id].status, 'ok');
  });

  it('drags through its DOF: mates hold every frame, the assembly mode never flips', () => {
    const sys = new MateSystem(fourBar().build({ pos: 2, rotDeg: 2, seed: 2 }));
    sys.solve();
    // Assembly mode: which side of the line crank-pin to rocker-pivot the coupler-rocker pin is on.
    const coupler = Math.hypot(P2[0] - P1[0], P2[1] - P1[1]);
    const branch = () => {
      const p = sys.poses();
      const a = world(p.crank, [40, 0, 0]);
      const b = world(p.coupler, [coupler, 0, 0]);
      return Math.sign(cross(sub(b, a), sub(P3, b))[2]);
    };
    const s0 = branch();
    let worst = 0;
    for (let deg = 60; deg >= 20; deg -= 1) {
      const t = (deg * Math.PI) / 180;
      const res = sys.drag({
        instance: 'crank',
        grab: [40, 0, 0],
        target: [40 * Math.cos(t), 40 * Math.sin(t), 0],
      });
      assert.ok(res.converged, `frame ${deg}`);
      holds(sys);
      worst = Math.max(worst, res.miss);
      assert.equal(branch(), s0, `branch at ${deg}°`);
    }
    assert.ok(worst < 0.05, `crank tracks the pointer (worst miss ${worst} mm)`);
  });

  it('solves far from the origin (1e6 mm) with the same DOF and precision', () => {
    const { sys, r } = solve(fourBar([1e6, -2e6, 5e5]).build({ pos: 5, rotDeg: 5, seed: 4 }));
    assert.ok(r.converged);
    holds(sys, 1e-6);
    assert.equal(r.dof, 1);
  });

  it('a coupler too long to close is a conflict of exactly the four revolutes', () => {
    const b = fourBar();
    const asm = b.build({ pos: 2, rotDeg: 2, seed: 5 });
    shiftFrame(asm.mates[2], 'b', 200, 'x');
    const { r } = solve(asm);
    assert.equal(r.converged, false);
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0].mates, ['rev-1', 'rev-2', 'rev-3', 'rev-4']);
    assert.match(r.conflicts[0].message, /cannot all hold/);
  });
});

describe('slider-crank', () => {
  it('has 1 DOF; dragging past the reach stops at full extension and comes back', () => {
    const sys = new MateSystem(sliderCrank().build({ pos: 3, rotDeg: 3, seed: 6 }));
    const r = sys.solve();
    assert.ok(r.converged);
    assert.equal(r.dof, 1);
    assert.equal(r.conflicts.length, 0);
    for (let i = 0; i < 60; i++) {
      const res = sys.drag({ instance: 'slider', grab: [0, 0, 0], target: [200, 0, 0] });
      assert.ok(res.converged);
      holds(sys);
    }
    const x = sys.poses().slider.p[0];
    assert.ok(x <= 110 + 1e-6 && x > 109, `slider at full stroke (x = ${x})`);
    let miss = 0;
    for (let i = 0; i < 30; i++)
      miss = sys.drag({ instance: 'slider', grab: [0, 0, 0], target: [70, 0, 0] }).miss;
    holds(sys);
    assert.ok(miss < 1e-4, `back to x = 70 (miss ${miss})`);
  });
});

describe('fastened stack', () => {
  for (const cluster of [true, false]) {
    it(`has 0 DOF and lands exactly on the stack${cluster ? '' : ' (unclustered)'}`, () => {
      const { sys, r } = solve(fastenedStack(3).build({ pos: 5, rotDeg: 10, seed: 7 }), cluster);
      assert.ok(r.converged);
      holds(sys);
      assert.equal(r.dof, 0);
      for (let i = 1; i <= 3; i++) {
        const p = r.poses[`plate-${i}`];
        assert.ok(Math.hypot(p.p[0], p.p[1], p.p[2] - 10 * i) < 1e-7);
        assert.equal(r.instanceDof[`plate-${i}`].total, 0);
      }
    });
  }

  for (const cluster of [true, false]) {
    it(`a fasten loop is redundant when it agrees, a minimal conflict when it does not${cluster ? '' : ' (unclustered)'}`, () => {
      const ok = fastenedStack(2).mate('fasten-x', 'fasten', 'plate-2', 'ground', {
        o: [0, 0, 20],
        z: [0, 0, 1],
      });
      const r1 = solve(ok.build({ pos: 2, seed: 8 }), cluster).r;
      assert.ok(r1.converged);
      assert.equal(r1.mates['fasten-x'].status, 'redundant');
      assert.deepEqual([...r1.mates['fasten-x'].involved].sort(), ['fasten-1', 'fasten-2']);
      const asm = ok.build({ pos: 2, seed: 8 });
      shiftFrame(asm.mates[2], 'a', 3);
      const r2 = solve(asm, cluster).r;
      assert.equal(r2.converged, false);
      assert.equal(r2.conflicts.length, 1);
      assert.deepEqual([...r2.conflicts[0].mates].sort(), ['fasten-1', 'fasten-2', 'fasten-x']);
    });
  }
});

describe('mates with no unknowns (inside a fastened cluster, or between grounded instances)', () => {
  it('a revolute between two fastened plates is redundant through the fasten; off by 2 mm it conflicts', () => {
    const b = fastenedStack(2).mate('rev-x', 'revolute', 'plate-2', 'plate-1', {
      o: [5, 5, 15],
      z: [0, 0, 1],
    });
    const r1 = solve(b.build({ pos: 2, seed: 14 })).r;
    assert.ok(r1.converged);
    assert.equal(r1.mates['rev-x'].status, 'redundant');
    assert.deepEqual(r1.mates['rev-x'].involved, ['fasten-2']);
    const asm = b.build({ pos: 2, seed: 14 });
    shiftFrame(asm.mates[2], 'a', 2);
    const r2 = solve(asm).r;
    assert.equal(r2.converged, false);
    assert.deepEqual(r2.conflicts[0].mates, ['rev-x', 'fasten-2']);
  });

  it('a mate between two grounded instances that do not line up is a conflict', () => {
    const asm = twoRails().build();
    asm.instances[1].grounded = true;
    shiftFrame(asm.mates[1], 'a', 1);
    const r = solve(asm).r;
    assert.equal(r.mates['rail-1'].status, 'redundant');
    assert.equal(r.mates['rail-2'].status, 'conflict');
    assert.match(r.conflicts[0].message, /two grounded instances/);
  });
});

describe('redundant and conflicting mates', () => {
  it('a second parallel rail is fully redundant and names the first', () => {
    const { sys, r } = solve(twoRails().build({ pos: 3, rotDeg: 4, seed: 10 }));
    assert.ok(r.converged);
    holds(sys);
    assert.equal(r.dof, 1);
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.mates['rail-1'].status, 'ok');
    assert.equal(r.mates['rail-2'].status, 'redundant');
    assert.equal(r.mates['rail-2'].redundantEquations, 5);
    assert.deepEqual(r.mates['rail-2'].involved, ['rail-1']);
    assert.match(r.mates['rail-2'].message ?? '', /adds nothing beyond 'rail-1'/);
  });

  it('a rail 5 mm out of line is a conflict of the two rails; the rest still solves', () => {
    const asm = twoRails().build({ pos: 3, rotDeg: 4, seed: 10 });
    shiftFrame(asm.mates[1], 'a', 5);
    const { sys, r } = solve(asm);
    assert.equal(r.converged, false);
    assert.equal(r.conflicts.length, 1);
    assert.deepEqual(r.conflicts[0].mates, ['rail-1', 'rail-2']);
    assert.equal(r.mates['rail-1'].status, 'conflict');
    assert.equal(r.mates['rail-2'].status, 'conflict');
    assert.ok(Math.abs(r.mates['rail-2'].positionError - 5) < 1e-6, 'reports the 5 mm');
    assert.match(r.conflicts[0].message, /'rail-1'.*'rail-2'.*5\.000 mm/);
    holds(sys);
    assert.equal(r.dof, 1);
  });
});

describe('generated assemblies', () => {
  it('25 parts, 4 loops, mixed mates: 14 DOF, no conflicts, per-instance DOF', () => {
    const asm = assembly25().build({ pos: 5, rotDeg: 5, seed: 11 });
    assert.equal(asm.instances.length, 25);
    const { sys, r } = solve(asm);
    assert.ok(r.converged);
    holds(sys);
    assert.equal(r.conflicts.length, 0);
    assert.equal(r.dof, 14);
    const d = r.instanceDof;
    assert.deepEqual(
      ['a1', 'd2', 'b3', 'c3', 'e2', 'f1', 'f2', 'g2', 'g3', 'h1', 'h3', 'i2'].map(
        (k) => d[k].total,
      ),
      [1, 1, 1, 0, 2, 3, 5, 2, 1, 1, 2, 0],
    );
    // Planar loops built from revolutes: 3 redundant equations each (A, Watt, slider-crank).
    const redundant = Object.values(r.mates).reduce((s, m) => s + m.redundantEquations, 0);
    assert.equal(redundant, 9);
  });

  it('25 parts: drags the six-bar crank with every mate holding', () => {
    const sys = new MateSystem(assembly25().build({ pos: 5, rotDeg: 5, seed: 11 }));
    sys.solve();
    for (let deg = 60; deg >= 40; deg--) {
      const t = (deg * Math.PI) / 180;
      const res = sys.drag({
        instance: 'a1',
        grab: [40, 0, 0],
        target: [40 * Math.cos(t), 40 * Math.sin(t), 0],
      });
      assert.ok(res.converged);
      assert.equal(res.moved.length, 5, 'only the six-bar component moves');
    }
    holds(sys);
  });

  for (const cluster of [true, false]) {
    it(`501 instances (fasteners + revolutes): 100 DOF${cluster ? '' : ' (unclustered)'}`, () => {
      const { sys, r } = solve(assembly500().build({ pos: 2, rotDeg: 3, seed: 12 }), cluster);
      assert.ok(r.converged);
      holds(sys);
      assert.equal(r.dof, 100);
      assert.deepEqual(r.instanceDof['pin-42'], { total: 1, rotational: 1, translational: 0 });
      assert.equal(r.instanceDof['bolt1-42'].total, 0);
    });
  }

  it('a 100-link chain closed to ground 4 times: one component, 92 DOF', () => {
    const { sys, r } = solve(chain(100, 25).build({ pos: 1, rotDeg: 1, seed: 13 }));
    assert.ok(r.converged);
    holds(sys);
    assert.equal(sys.stats.components, 1);
    assert.equal(r.dof, 92);
  });

  it('quaternions stay unit after 2000 drag frames; results are deterministic', () => {
    const run = () => {
      const sys = new MateSystem(sliderCrank().build({ pos: 3, rotDeg: 3, seed: 6 }));
      sys.solve();
      for (let i = 0; i < 2000; i++) {
        const t = i * 0.01;
        sys.drag({
          instance: 'crank',
          grab: [30, 0, 0],
          target: [30 * Math.cos(t), 30 * Math.sin(t), 0],
        });
      }
      return sys.poses();
    };
    const a = run();
    for (const p of Object.values(a)) assert.ok(Math.abs(Math.hypot(...p.q) - 1) < 1e-12);
    assert.deepEqual(run(), a);
  });
});
