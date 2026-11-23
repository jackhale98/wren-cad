// Spike S1 timings. Run from the repo root:
//   node --experimental-strip-types spikes/mates/bench/bench.ts
import { cpus } from 'node:os';
import { performance } from 'node:perf_hooks';
import { add, qRotate, scale, type Vec3 } from '../src/math.ts';
import { assembly25, assembly500, type Builder, chain } from '../src/models.ts';
import { MateSystem } from '../src/solver.ts';
import type { DragRequest } from '../src/types.ts';

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { median: q(0.5), p95: q(0.95), max: s[s.length - 1] };
};
const fmt = (x: number) => (x < 0.1 ? x.toFixed(3) : x < 10 ? x.toFixed(2) : x.toFixed(1));
const rows: string[] = [];
const row = (name: string, n: number, xs: number[], note = '') => {
  const s = stats(xs);
  rows.push(`| ${name} | ${n} | ${fmt(s.median)} | ${fmt(s.p95)} | ${fmt(s.max)} | ${note} |`);
};

function scratch(
  name: string,
  b: Builder,
  runs: number,
  opts: { cluster?: boolean; analyse?: boolean } = {},
) {
  const asms = Array.from({ length: runs + 10 }, (_, i) =>
    b.build({ pos: 5, rotDeg: 5, seed: 100 + i }),
  );
  const times: number[] = [];
  let its = 0;
  let dof = -1;
  asms.forEach((asm, i) => {
    const t0 = performance.now();
    const sys = new MateSystem(asm, { clusterFasten: opts.cluster ?? true });
    const r = sys.solve({ analyse: opts.analyse ?? true });
    const dt = performance.now() - t0;
    if (!r.converged) throw new Error(`${name}: did not converge`);
    if (i >= 10) times.push(dt);
    its += r.iterations;
    dof = r.dof;
    if (i === 0) Object.assign(scratch, { stats: sys.stats });
  });
  const st = (scratch as unknown as { stats: MateSystem['stats'] }).stats;
  const analysed = opts.analyse ?? true;
  row(
    name,
    runs,
    times,
    `${st.bodies} bodies, ${st.components} comps (largest ${st.largest}); ${(its / asms.length).toFixed(0)} LM its total${analysed ? `; DOF ${dof}` : '; no DOF analysis'}`,
  );
}

type Offset = (i: number) => Vec3;
function drag(
  name: string,
  b: Builder,
  frames: number,
  instance: string,
  grab: Vec3,
  offset: Offset,
  opts: { cluster?: boolean; full?: boolean } = {},
) {
  const sys = new MateSystem(b.build({ pos: 5, rotDeg: 5, seed: 7 }), {
    clusterFasten: opts.cluster ?? true,
  });
  sys.solve({ analyse: false });
  const p0 = sys.poses()[instance];
  const base = add(qRotate(p0.q, grab), p0.p);
  const times: number[] = [];
  let its = 0;
  for (let i = 0; i < frames + 50; i++) {
    const req: DragRequest = { instance, grab, target: add(base, offset(i)) };
    const t0 = performance.now();
    const r = sys.drag(req);
    if (opts.full) sys.solve({ analyse: false });
    const dt = performance.now() - t0;
    if (!r.converged) throw new Error(`${name}: drag frame ${i} did not converge`);
    if (i >= 50) {
      times.push(dt);
      its += r.iterations;
    }
  }
  const e = sys.maxMateError();
  row(
    name,
    frames,
    times,
    `${(its / frames).toFixed(1)} LM its/frame; mates within ${e.pos.toExponential(0)} mm`,
  );
}

/** A slow back-and-forth sweep of a few cm (pointer motion), in the plane spanned by u and v. */
const sweep =
  (amp: number, period: number, u: Vec3, v: Vec3): Offset =>
  (i) => {
    const t = (2 * Math.PI * i) / period;
    return add(scale(u, amp * Math.sin(t)), scale(v, amp * (1 - Math.cos(t)) * 0.5));
  };
const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
const Zv: Vec3 = [0, 0, 1];

scratch('25 parts, from scratch (poses + DOF + statuses)', assembly25(), 300);
scratch('25 parts, from scratch, poses only', assembly25(), 300, { analyse: false });
scratch('25 parts, from scratch, fasten not clustered', assembly25(), 300, { cluster: false });
drag(
  '25 parts, drag frame (six-bar crank)',
  assembly25(),
  2000,
  'a1',
  [40, 0, 0],
  sweep(15, 240, X, Y),
);
drag(
  '25 parts, drag frame + re-solve all components',
  assembly25(),
  2000,
  'a1',
  [40, 0, 0],
  sweep(15, 240, X, Y),
  { full: true },
);
drag(
  '25 parts, drag frame, fasten not clustered',
  assembly25(),
  2000,
  'a1',
  [40, 0, 0],
  sweep(15, 240, X, Y),
  { cluster: false },
);
drag(
  '25 parts, drag frame (spatial RSSR coupler)',
  assembly25(),
  2000,
  'g2',
  [40, 0, 0],
  sweep(20, 240, Y, Zv),
);
scratch('501 instances, from scratch (poses + DOF)', assembly500(), 50);
scratch('501 instances, from scratch, fasten not clustered', assembly500(), 20, { cluster: false });
drag(
  '501 instances, drag frame (one lever)',
  assembly500(),
  2000,
  'lever-42',
  [40, 0, 0],
  sweep(20, 240, Y, Zv),
);
drag(
  '501 instances, drag frame + re-solve all components',
  assembly500(),
  500,
  'lever-42',
  [40, 0, 0],
  sweep(20, 240, Y, Zv),
  { full: true },
);
scratch('chain of 100 (one component), from scratch (poses + DOF)', chain(100, 25), 20);
scratch('chain of 500 (one component), from scratch, poses only', chain(500, 50), 20, {
  analyse: false,
});
drag(
  'chain of 500 (one component), drag frame (mid-span link)',
  chain(500, 50),
  200,
  'l475',
  [10, 0, 0],
  sweep(10, 240, Y, X),
);

console.log(`CPU: ${cpus()[0].model} (${cpus().length} logical), Node ${process.version}`);
console.log('| Case | Runs | Median ms | p95 ms | Max ms | Notes |');
console.log('| --- | --- | --- | --- | --- | --- |');
for (const r of rows) console.log(r);
