// Spike S1: purpose-built rigid-body mate solver (candidate A).
//
// Unknowns: one rigid body per fasten cluster (fastened instances are merged in closed form),
// pose = unit quaternion + pivot position, updated by an incremental rotation vector (no Euler
// angles, no gimbal lock). Each mate is a few residual rows between two frames. Damped
// Gauss-Newton (Levenberg-Marquardt) per connected component, block-sparse Cholesky. DOF and
// redundancy from the rank of the minimal (analysis) rows; conflicts from inconsistent
// dependencies, shrunk to a minimal set by a deletion filter.

import { BlockCholesky } from './blockchol.ts';
import {
  add,
  cross,
  dot,
  norm,
  type Quat,
  qAngle,
  qAxisAngle,
  qExp,
  qFromBasis,
  qIdentity,
  qMul,
  qNormalize,
  qToMat,
  rng,
  scale,
  sub,
  type Transform,
  tApply,
  tCompose,
  tInverse,
  type Vec3,
} from './math.ts';
import { nullSpace, rowRank, smallRank } from './rank.ts';
import {
  type Assembly,
  type ConflictSet,
  type DragRequest,
  type DragResult,
  type InstanceDof,
  MATE_EQUATIONS,
  type Mate,
  type MateFrame,
  type MateReport,
  type MateType,
  type Pose,
  type SolveReport,
} from './types.ts';

// ---------------------------------------------------------------- tolerances (scaled units)
/** Converged when every residual row is below this (rad, or fraction of the model size L). */
export const SOLVE_TOL = 1e-10;
/** A row is dependent when its Gram-Schmidt remainder is below this. */
export const RANK_TOL = 1e-7;
/** A dependency with |y·r| above this is a conflict, below it a consistent redundancy. */
export const CONFLICT_TOL = 1e-6;
/** Kept-row pivots below this mean the pose is close to a singular configuration. */
export const NEAR_SINGULAR = 1e-4;

interface Spec {
  dir: boolean;
  /** dir rows: which axis of A and B is compared (0 = x, 2 = z). */
  d: number;
  /** Which axis of the target frame B' the row is measured along. */
  u: number;
  /** Solve-only row: dependent at the solution, kept for a robust far-field residual. */
  extra: boolean;
}
const P = (u: number, extra = false): Spec => ({ dir: false, d: 0, u, extra });
const D = (d: number, u: number, extra = false): Spec => ({ dir: true, d, u, extra });

const SPECS: Record<MateType, Spec[]> = {
  fasten: [
    P(0),
    P(1),
    P(2),
    D(2, 0),
    D(2, 1),
    D(0, 1),
    D(2, 2, true),
    D(0, 0, true),
    D(0, 2, true),
  ],
  revolute: [P(0), P(1), P(2), D(2, 0), D(2, 1), D(2, 2, true)],
  slider: [P(0), P(1), D(2, 0), D(2, 1), D(0, 1), D(2, 2, true), D(0, 0, true), D(0, 2, true)],
  cylindrical: [P(0), P(1), D(2, 0), D(2, 1), D(2, 2, true)],
  planar: [P(2), D(2, 0), D(2, 1), D(2, 2, true)],
  ball: [P(0), P(1), P(2)],
};

interface LocalFrame {
  /** Origin relative to the body pivot, body coordinates. */
  o: Vec3;
  ax: [Vec3, Vec3, Vec3];
}

interface Body {
  members: string[];
  rel: Map<string, Transform>;
  grounded: boolean;
  pivot: Vec3;
  q: Quat;
  w: Vec3;
  R: Float64Array;
  comp: number;
}

interface SMate {
  mate: Mate;
  index: number;
  a: number;
  b: number;
  fa: LocalFrame;
  fb: LocalFrame;
  specs: Spec[];
  solveRows: number;
}

interface RowBuf {
  val: Float64Array;
  jac: Float64Array;
  ia: Int32Array;
  ib: Int32Array;
  rows: number;
  mateRows: number;
  cost: number;
  maxMate: number;
}

interface Comp {
  bodies: number[];
  localOf: Map<number, number>;
  mates: SMate[];
  chol: BlockCholesky;
  bufs: [RowBuf, RowBuf];
  g: Float64Array;
  /** Mates set aside to pose the rest after a conflict. */
  setAside: SMate[];
}

interface DragTerm {
  body: number;
  grab: Vec3;
  target: Vec3;
  weight: number;
}

interface LmResult {
  converged: boolean;
  iterations: number;
}

const name = (m: Mate): string => m.name ?? m.id;
const frameT = (f: MateFrame): Transform => ({
  q: qFromBasis(f.x, cross(f.z, f.x), f.z),
  p: f.origin,
});
export const offsetT = (m: Mate): Transform => {
  let q = qAxisAngle([0, 0, 1], m.angle ?? 0);
  if (m.flip) q = qMul(q, qAxisAngle([1, 0, 0], Math.PI));
  return { q: qNormalize(q), p: [0, 0, m.offset ?? 0] };
};
/** The frame on B that A's frame must coincide with (offset, angle and flip applied). */
export const targetT = (m: Mate): Transform => tCompose(frameT(m.b.frame), offsetT(m));

function mulR(R: Float64Array, v: Vec3): Vec3 {
  return [
    R[0] * v[0] + R[1] * v[1] + R[2] * v[2],
    R[3] * v[0] + R[4] * v[1] + R[5] * v[2],
    R[6] * v[0] + R[7] * v[1] + R[8] * v[2],
  ];
}

export interface SolverOptions {
  /** Merge fastened instances into rigid bodies before solving (default true). */
  clusterFasten?: boolean;
}

export class MateSystem {
  readonly asm: Assembly;
  readonly L: number;
  readonly extent: number;
  private readonly bodies: Body[] = [];
  private readonly bodyOf = new Map<string, number>();
  private readonly comps: Comp[] = [];
  private readonly staticMates: SMate[] = [];
  private readonly fastenParent = new Map<string, { parent: string; mate: Mate }>();
  private readonly clusterReports = new Map<string, MateReport>();
  private readonly clusterConflicts: ConflictSet[] = [];
  private readonly instanceName = new Map<string, string>();

  constructor(asm: Assembly, opts: SolverOptions = {}) {
    this.asm = asm;
    for (const i of asm.instances) this.instanceName.set(i.id, i.name ?? i.id);
    const active = asm.mates.filter((m) => !m.suppressed);
    const cluster = opts.clusterFasten ?? true;
    const fastens = cluster ? active.filter((m) => m.type === 'fasten') : [];
    const others = cluster ? active.filter((m) => m.type !== 'fasten') : active;
    this.buildClusters(fastens);

    // Mate frames in body coordinates; pivots at the centroid of each body's frame origins.
    const raw = others.map((m) => {
      const a = this.bodyOf.get(m.a.instance);
      const b = this.bodyOf.get(m.b.instance);
      if (a === undefined || b === undefined) throw new Error(`mate ${m.id}: unknown instance`);
      const ta = tCompose(this.bodies[a].rel.get(m.a.instance) as Transform, frameT(m.a.frame));
      const tb = tCompose(this.bodies[b].rel.get(m.b.instance) as Transform, targetT(m));
      return { m, a, b, ta, tb };
    });
    const sums = this.bodies.map(() => ({ s: [0, 0, 0] as Vec3, n: 0 }));
    for (const r of raw) {
      sums[r.a].s = add(sums[r.a].s, r.ta.p);
      sums[r.a].n++;
      sums[r.b].s = add(sums[r.b].s, r.tb.p);
      sums[r.b].n++;
    }
    this.bodies.forEach((body, i) => {
      body.pivot = sums[i].n ? scale(sums[i].s, 1 / sums[i].n) : [0, 0, 0];
      body.w = add(body.w, mulR(body.R, body.pivot));
    });
    const local = (t: Transform, body: Body): LocalFrame => ({
      o: sub(t.p, body.pivot),
      ax: [tDir(t, [1, 0, 0]), tDir(t, [0, 1, 0]), tDir(t, [0, 0, 1])],
    });
    const smates: SMate[] = raw.map((r) => {
      const specs = SPECS[r.m.type];
      return {
        mate: r.m,
        index: asm.mates.indexOf(r.m),
        a: r.a,
        b: r.b,
        fa: local(r.ta, this.bodies[r.a]),
        fb: local(r.tb, this.bodies[r.b]),
        specs,
        solveRows: specs.length,
      };
    });

    // Characteristic length: RMS lever arm (pivot to mate frame) of the free bodies. Rotation
    // columns are then O(1) next to translation columns; the whole-model extent would make them
    // tiny in long chains and let the damping swamp them (measured: 12 → 6 LM its per drag frame).
    let arm2 = 0;
    let arms = 0;
    for (const sm of smates)
      for (const [bi, f] of [
        [sm.a, sm.fa],
        [sm.b, sm.fb],
      ] as const) {
        if (this.bodies[bi].grounded) continue;
        arm2 += dot(f.o, f.o);
        arms++;
      }
    this.L = arms ? Math.max(1, Math.sqrt(arm2 / arms)) : 1;
    // Model extent (bounding box of the frame origins): bounds the translation of one LM step.
    const lo: Vec3 = [Infinity, Infinity, Infinity];
    const hi: Vec3 = [-Infinity, -Infinity, -Infinity];
    for (const sm of smates)
      for (const [bi, f] of [
        [sm.a, sm.fa],
        [sm.b, sm.fb],
      ] as const) {
        const p = add(this.bodies[bi].w, mulR(this.bodies[bi].R, f.o));
        for (let k = 0; k < 3; k++) {
          lo[k] = Math.min(lo[k], p[k]);
          hi[k] = Math.max(hi[k], p[k]);
        }
      }
    this.extent = smates.length ? Math.max(1, norm(sub(hi, lo))) : 1;

    // Components of free bodies (grounded bodies carry no unknowns, so they do not connect).
    const parent = this.bodies.map((_, i) => i);
    const find = (x: number): number => {
      while (parent[x] !== x) {
        parent[x] = parent[parent[x]];
        x = parent[x];
      }
      return x;
    };
    const dynamic: SMate[] = [];
    for (const sm of smates) {
      const ga = this.bodies[sm.a].grounded;
      const gb = this.bodies[sm.b].grounded;
      if (sm.a === sm.b || (ga && gb)) this.staticMates.push(sm);
      else {
        dynamic.push(sm);
        if (!ga && !gb) parent[find(sm.a)] = find(sm.b);
      }
    }
    const compOf = new Map<number, number>();
    this.bodies.forEach((body, i) => {
      if (body.grounded) return;
      const r = find(i);
      if (!compOf.has(r)) compOf.set(r, compOf.size);
      body.comp = compOf.get(r) as number;
    });
    const groups: { bodies: number[]; mates: SMate[] }[] = Array.from(
      { length: compOf.size },
      () => ({
        bodies: [],
        mates: [],
      }),
    );
    this.bodies.forEach((body, i) => {
      if (!body.grounded) groups[body.comp].bodies.push(i);
    });
    for (const sm of dynamic) {
      const c = this.bodies[sm.a].grounded ? this.bodies[sm.b].comp : this.bodies[sm.a].comp;
      groups[c].mates.push(sm);
    }
    for (const g of groups) this.comps.push(this.makeComp(g.bodies, g.mates));
  }

  // ------------------------------------------------------------------ fasten clusters
  private buildClusters(fastens: Mate[]): void {
    const ids = this.asm.instances.map((i) => i.id);
    const idx = new Map(ids.map((id, i) => [id, i]));
    const adj: { mate: Mate; other: string }[][] = ids.map(() => []);
    // Spanning forest in document order (Kruskal): a fasten that closes a loop is the one blamed,
    // as in the iterative path where later mates are the dependent ones.
    const uf = ids.map((_, i) => i);
    const find = (x: number): number => {
      while (uf[x] !== x) x = uf[x];
      return x;
    };
    const treeMates = new Set<Mate>();
    for (const m of fastens) {
      const a = idx.get(m.a.instance);
      const b = idx.get(m.b.instance);
      if (a === undefined || b === undefined) throw new Error(`mate ${m.id}: unknown instance`);
      if (find(a) === find(b)) continue;
      uf[find(a)] = find(b);
      treeMates.add(m);
      adj[a].push({ mate: m, other: m.b.instance });
      adj[b].push({ mate: m, other: m.a.instance });
    }
    const seen = new Set<string>();
    const poseOf = new Map(this.asm.instances.map((i) => [i.id, i]));
    // Roots: grounded instances first, so a cluster containing ground is grounded.
    const order = [...this.asm.instances].sort(
      (x, y) => Number(!!y.grounded) - Number(!!x.grounded),
    );
    for (const root of order) {
      if (seen.has(root.id)) continue;
      const rel = new Map<string, Transform>([[root.id, { q: qIdentity(), p: [0, 0, 0] }]]);
      const queue = [root.id];
      seen.add(root.id);
      while (queue.length) {
        const u = queue.shift() as string;
        for (const { mate, other } of adj[idx.get(u) as number]) {
          if (seen.has(other)) continue;
          seen.add(other);
          this.fastenParent.set(other, { parent: u, mate });
          const fa = frameT(mate.a.frame);
          const fb = targetT(mate);
          const ru = rel.get(u) as Transform;
          // Mate: T_a ∘ F_A = T_b ∘ F_B'.
          const ro =
            mate.a.instance === u
              ? tCompose(ru, tCompose(fa, tInverse(fb)))
              : tCompose(ru, tCompose(fb, tInverse(fa)));
          rel.set(other, ro);
          queue.push(other);
        }
      }
      const rp = root.pose;
      const q = qNormalize(rp.q);
      const R = new Float64Array(9);
      qToMat(q, R);
      const body: Body = {
        members: [...rel.keys()],
        rel,
        grounded: !!root.grounded,
        pivot: [0, 0, 0],
        q,
        w: [...rp.p] as Vec3,
        R,
        comp: -1,
      };
      const bi = this.bodies.length;
      this.bodies.push(body);
      for (const id of body.members) this.bodyOf.set(id, bi);
      // A second grounded member must sit where the fasten chain puts it.
      for (const id of body.members) {
        const inst = poseOf.get(id);
        if (id === root.id || !inst?.grounded) continue;
        const derived = tCompose({ q, p: rp.p }, rel.get(id) as Transform);
        const e = tCompose(tInverse(derived), { q: qNormalize(inst.pose.q), p: inst.pose.p });
        if (norm(e.p) > 1e-6 * Math.max(1, norm(rp.p)) || qAngle(e.q) > 1e-9) {
          const path = this.fastenPath(root.id, id);
          this.clusterConflicts.push({
            mates: path.map((m) => m.id),
            message: `${this.instanceName.get(root.id)} and ${this.instanceName.get(id)} are both grounded, but the fasten mates ${path.map((m) => `'${name(m)}'`).join(', ')} put them ${norm(e.p).toFixed(3)} mm and ${((qAngle(e.q) * 180) / Math.PI).toFixed(3)}° apart. Unground one of them or edit a fasten mate.`,
          });
          for (const m of path)
            this.clusterReports.set(m.id, this.report('conflict', 0, [], norm(e.p), qAngle(e.q)));
        }
      }
    }
    // Fasten mates that close a loop inside a cluster: closed-form redundancy or conflict.
    for (const m of fastens) {
      if (treeMates.has(m)) continue;
      const body = this.bodies[this.bodyOf.get(m.a.instance) as number];
      const ta = tCompose(body.rel.get(m.a.instance) as Transform, frameT(m.a.frame));
      const tb = tCompose(body.rel.get(m.b.instance) as Transform, targetT(m));
      const e = tCompose(tInverse(ta), tb);
      const path = this.fastenPath(m.a.instance, m.b.instance);
      const involved = path.map((p) => p.id);
      const pe = norm(e.p);
      const ae = qAngle(e.q);
      if (pe < 1e-6 && ae < 1e-9) {
        this.clusterReports.set(
          m.id,
          this.report('redundant', 6, involved, pe, ae, this.redundantMessage(m, 6, path)),
        );
      } else {
        const set = [m, ...path];
        const msg = this.conflictMessage(set, m, pe, ae);
        this.clusterConflicts.push({ mates: set.map((x) => x.id), message: msg });
        for (const x of set)
          this.clusterReports.set(
            x.id,
            this.report('conflict', 0, [], x === m ? pe : 0, x === m ? ae : 0, msg),
          );
      }
    }
  }

  /** Fasten mates on the tree path between two instances of one cluster. */
  private fastenPath(u: string, v: string): Mate[] {
    const up = (x: string): { id: string; mate?: Mate }[] => {
      const out: { id: string; mate?: Mate }[] = [{ id: x }];
      let cur = x;
      for (let p = this.fastenParent.get(cur); p; p = this.fastenParent.get(cur)) {
        out[out.length - 1].mate = p.mate;
        out.push({ id: p.parent });
        cur = p.parent;
      }
      return out;
    };
    const pu = up(u);
    const pv = up(v);
    const inV = new Map(pv.map((e, i) => [e.id, i]));
    const path: Mate[] = [];
    for (const e of pu) {
      const j = inV.get(e.id);
      if (j !== undefined) {
        for (let k = 0; k < j; k++) path.push(pv[k].mate as Mate);
        break;
      }
      path.push(e.mate as Mate);
    }
    return path;
  }

  private makeComp(bodies: number[], mates: SMate[]): Comp {
    const localOf = new Map(bodies.map((b, i) => [b, i]));
    const edges: [number, number][] = [];
    for (const sm of mates) {
      const a = localOf.get(sm.a);
      const b = localOf.get(sm.b);
      if (a !== undefined && b !== undefined) edges.push([a, b]);
    }
    const rows = mates.reduce((s, m) => s + m.solveRows, 0) + 3;
    const buf = (): RowBuf => ({
      val: new Float64Array(rows),
      jac: new Float64Array(rows * 12),
      ia: new Int32Array(rows),
      ib: new Int32Array(rows),
      rows: 0,
      mateRows: 0,
      cost: 0,
      maxMate: 0,
    });
    return {
      bodies,
      localOf,
      mates,
      chol: new BlockCholesky(bodies.length, edges),
      bufs: [buf(), buf()],
      g: new Float64Array(bodies.length * 6),
      setAside: [],
    };
  }

  // ------------------------------------------------------------------ residual rows
  private endWorld(bi: number, f: LocalFrame): { r: Vec3; P: Vec3; ax: [Vec3, Vec3, Vec3] } {
    const body = this.bodies[bi];
    const r = mulR(body.R, f.o);
    return {
      r,
      P: add(body.w, r),
      ax: [mulR(body.R, f.ax[0]), mulR(body.R, f.ax[1]), mulR(body.R, f.ax[2])],
    };
  }

  private evalRows(c: Comp, mates: SMate[], buf: RowBuf, analysis: boolean, drag?: DragTerm): void {
    const { val, jac, ia, ib } = buf;
    const L = this.L;
    let row = 0;
    let maxMate = 0;
    let cost = 0;
    for (const sm of mates) {
      const ea = this.endWorld(sm.a, sm.fa);
      const eb = this.endWorld(sm.b, sm.fb);
      const la = c.localOf.get(sm.a) ?? -1;
      const lb = c.localOf.get(sm.b) ?? -1;
      for (const s of sm.specs) {
        if (analysis && s.extra) continue;
        const U = eb.ax[s.u];
        const o = row * 12;
        let v: number;
        if (!s.dir) {
          const dl = sub(ea.P, eb.P);
          v = dot(dl, U) / L;
          const ca = cross(ea.r, U);
          const cb = sub(cross(U, dl), cross(eb.r, U));
          for (let k = 0; k < 3; k++) {
            jac[o + k] = ca[k] / L;
            jac[o + 3 + k] = U[k];
            jac[o + 6 + k] = cb[k] / L;
            jac[o + 9 + k] = -U[k];
          }
        } else {
          const Ad = ea.ax[s.d];
          v = dot(sub(Ad, eb.ax[s.d]), U);
          const ca = cross(Ad, U);
          for (let k = 0; k < 3; k++) {
            jac[o + k] = ca[k];
            jac[o + 3 + k] = 0;
            jac[o + 6 + k] = -ca[k];
            jac[o + 9 + k] = 0;
          }
        }
        val[row] = v;
        ia[row] = la;
        ib[row] = lb;
        cost += v * v;
        if (Math.abs(v) > maxMate) maxMate = Math.abs(v);
        row++;
      }
    }
    buf.mateRows = row;
    if (drag) {
      const body = this.bodies[drag.body];
      const r = mulR(body.R, drag.grab);
      const p = add(body.w, r);
      const la = c.localOf.get(drag.body) ?? -1;
      for (let k = 0; k < 3; k++) {
        const e: Vec3 = [0, 0, 0];
        e[k] = 1;
        const ca = cross(r, e);
        const o = row * 12;
        for (let t = 0; t < 3; t++) {
          jac[o + t] = (drag.weight * ca[t]) / L;
          jac[o + 3 + t] = drag.weight * e[t];
          jac[o + 6 + t] = 0;
          jac[o + 9 + t] = 0;
        }
        val[row] = (drag.weight * (p[k] - drag.target[k])) / L;
        ia[row] = la;
        ib[row] = -1;
        cost += val[row] * val[row];
        row++;
      }
    }
    buf.rows = row;
    buf.cost = cost / 2;
    buf.maxMate = maxMate;
  }

  // ------------------------------------------------------------------ Levenberg-Marquardt
  private savePoses(c: Comp): { q: Quat; w: Vec3 }[] {
    return c.bodies.map((b) => ({ q: this.bodies[b].q, w: this.bodies[b].w }));
  }

  private restorePoses(c: Comp, saved: { q: Quat; w: Vec3 }[]): void {
    c.bodies.forEach((b, i) => {
      const body = this.bodies[b];
      body.q = saved[i].q;
      body.w = saved[i].w;
      qToMat(body.q, body.R);
    });
  }

  private lm(
    c: Comp,
    mates: SMate[],
    opts: { drag?: DragTerm; maxIter: number; maxStep: number },
  ): LmResult {
    let [cur, trial] = c.bufs;
    this.evalRows(c, mates, cur, false, opts.drag);
    let lambda = 1e-4;
    const n = c.bodies.length;
    const delta = c.g;
    for (let it = 0; it < opts.maxIter; it++) {
      if (!opts.drag && cur.maxMate < SOLVE_TOL) return { converged: true, iterations: it };
      const H = c.chol;
      H.zero();
      delta.fill(0);
      for (let r = 0; r < cur.rows; r++) {
        const o = r * 12;
        const a = cur.ia[r];
        const b = cur.ib[r];
        H.addRow(a, cur.jac, o, b, cur.jac, o + 6);
        const v = cur.val[r];
        if (a >= 0) for (let k = 0; k < 6; k++) delta[a * 6 + k] -= cur.jac[o + k] * v;
        if (b >= 0) for (let k = 0; k < 6; k++) delta[b * 6 + k] -= cur.jac[o + 6 + k] * v;
      }
      H.addIdentity(lambda);
      if (!H.factor()) {
        lambda *= 10;
        continue;
      }
      H.solve(delta);
      // Step limit: maxStep rad of rotation, maxStep × model extent of translation.
      let big = 0;
      const tScale = this.L / this.extent;
      for (let i = 0; i < n * 6; i++)
        big = Math.max(big, Math.abs(delta[i]) * (i % 6 < 3 ? 1 : tScale));
      const s = big > opts.maxStep ? opts.maxStep / big : 1;
      const saved = this.savePoses(c);
      for (let i = 0; i < n; i++) {
        const body = this.bodies[c.bodies[i]];
        const o = i * 6;
        body.q = qNormalize(qMul(qExp([delta[o] * s, delta[o + 1] * s, delta[o + 2] * s]), body.q));
        body.w = add(body.w, scale([delta[o + 3], delta[o + 4], delta[o + 5]], s * this.L));
        qToMat(body.q, body.R);
      }
      this.evalRows(c, mates, trial, false, opts.drag);
      if (trial.cost < cur.cost) {
        const gain = cur.cost - trial.cost;
        [cur, trial] = [trial, cur];
        lambda = Math.max(lambda * 0.2, 1e-12);
        if (opts.drag && gain < 1e-12 * Math.max(1e-30, cur.cost) + 1e-30) break;
      } else {
        this.restorePoses(c, saved);
        lambda *= 10;
        if (lambda > 1e10) return { converged: cur.maxMate < SOLVE_TOL, iterations: it + 1 };
      }
    }
    return { converged: cur.maxMate < SOLVE_TOL, iterations: opts.maxIter };
  }

  /** LM with restarts: a pose exactly 180° off is a stationary point of the axis residual. */
  private solveMates(c: Comp, mates: SMate[], restarts = 3): LmResult {
    let total = 0;
    const rand = rng(7);
    for (let attempt = 0; ; attempt++) {
      const r = this.lm(c, mates, { maxIter: 100, maxStep: 0.5 });
      total += r.iterations;
      if (r.converged || attempt >= restarts) return { converged: r.converged, iterations: total };
      for (const b of c.bodies) {
        const body = this.bodies[b];
        const axis: Vec3 = [rand() - 0.5, rand() - 0.5, rand() - 0.5];
        body.q = qNormalize(qMul(qAxisAngle(axis, 0.05), body.q));
        qToMat(body.q, body.R);
      }
    }
  }

  /** Can these mates hold together? Solves them alone from the current pose, then restores it. */
  private consistent(mates: SMate[]): boolean {
    const bodies = [...new Set(mates.flatMap((m) => [m.a, m.b]))].filter(
      (b) => !this.bodies[b].grounded,
    );
    const part = this.makeComp(bodies, mates);
    const saved = this.savePoses(part);
    const ok = this.solveMates(part, mates, 1).converged;
    this.restorePoses(part, saved);
    return ok;
  }

  // ------------------------------------------------------------------ analysis
  private analyse(c: Comp, mates: SMate[], tol = RANK_TOL) {
    const buf = c.bufs[0];
    this.evalRows(c, mates, buf, true);
    const n = c.bodies.length * 6;
    const m = buf.mateRows;
    const J = new Float64Array(m * n);
    const rowMate = new Int32Array(m);
    let r = 0;
    mates.forEach((sm, mi) => {
      const rows = sm.specs.filter((s) => !s.extra).length;
      for (let k = 0; k < rows; k++) rowMate[r + k] = mi;
      r += rows;
    });
    for (let i = 0; i < m; i++) {
      const o = i * 12;
      const a = buf.ia[i];
      const b = buf.ib[i];
      if (a >= 0) for (let k = 0; k < 6; k++) J[i * n + a * 6 + k] += buf.jac[o + k];
      if (b >= 0) for (let k = 0; k < 6; k++) J[i * n + b * 6 + k] += buf.jac[o + 6 + k];
    }
    const res = rowRank(J, m, n, buf.val.subarray(0, m), tol);
    return { ...res, n, rowMate };
  }

  // ------------------------------------------------------------------ public API
  /** Solve from the current poses. `analyse: false` skips DOF and redundancy (poses only). */
  solve(opts: { analyse?: boolean } = {}): SolveReport {
    const report: SolveReport = {
      converged: true,
      iterations: 0,
      poses: {},
      dof: 0,
      instanceDof: {},
      mates: {},
      conflicts: [...this.clusterConflicts],
      warnings: [],
    };
    for (const m of this.asm.mates) {
      report.mates[m.id] = m.suppressed
        ? this.report('ok', 0, [], 0, 0, 'suppressed')
        : (this.clusterReports.get(m.id) ?? this.report('ok', 0, [], 0, 0));
    }
    if (this.clusterConflicts.length) report.converged = false;
    for (const sm of this.staticMates) this.checkStatic(sm, report);

    for (const c of this.comps) {
      c.setAside = [];
      let active = c.mates;
      let res = this.solveMates(c, active);
      report.iterations += res.iterations;
      // Conflicts: find a minimal set, set its last mate aside, pose the rest, repeat.
      for (let guard = 0; !res.converged && guard < 8; guard++) {
        report.converged = false;
        const set = this.minimalConflict(active);
        const last = set[set.length - 1];
        c.setAside.push(last);
        active = active.filter((s) => s !== last);
        res = this.solveMates(c, active);
        report.iterations += res.iterations;
        const errs = this.mateErrors(last);
        const msg = this.conflictMessage(
          set.map((s) => s.mate),
          last.mate,
          errs.pos,
          errs.ang,
        );
        report.conflicts.push({ mates: set.map((s) => s.mate.id), message: msg });
        for (const s of set) report.mates[s.mate.id] = this.report('conflict', 0, [], 0, 0, msg);
      }
      if (opts.analyse === false) continue;
      const ana = this.analyse(c, active);
      report.dof += ana.n - ana.rank;
      if (ana.minPivot < NEAR_SINGULAR)
        report.warnings.push(
          `near-singular pose (pivot ${ana.minPivot.toExponential(1)}): DOF may change with a small move`,
        );
      // Redundancy per mate.
      const deps = new Map<number, { count: number; involved: Set<number> }>();
      for (const d of ana.dependencies) {
        const mi = ana.rowMate[d.row];
        const e = deps.get(mi) ?? { count: 0, involved: new Set<number>() };
        e.count++;
        for (const s of d.support)
          if (ana.rowMate[s.row] !== mi) e.involved.add(ana.rowMate[s.row]);
        deps.set(mi, e);
      }
      active.forEach((sm, mi) => {
        const errs = this.mateErrors(sm);
        const prev = report.mates[sm.mate.id];
        if (prev.status === 'conflict') {
          prev.positionError = errs.pos;
          prev.angleError = errs.ang;
          return;
        }
        const d = deps.get(mi);
        const involved = d ? [...d.involved].map((k) => active[k].mate) : [];
        report.mates[sm.mate.id] = d
          ? this.report(
              'redundant',
              d.count,
              involved.map((x) => x.id),
              errs.pos,
              errs.ang,
              this.redundantMessage(sm.mate, d.count, involved),
            )
          : this.report(res.converged ? 'ok' : 'unsolved', 0, [], errs.pos, errs.ang);
      });
      for (const sm of c.setAside) {
        const errs = this.mateErrors(sm);
        report.mates[sm.mate.id].positionError = errs.pos;
        report.mates[sm.mate.id].angleError = errs.ang;
      }
      // DOF per body from the null space.
      const ns = nullSpace(ana.q, ana.rank, ana.n);
      c.bodies.forEach((b, i) => {
        const total = smallRank(
          ns.map((v) => Array.from(v.subarray(i * 6, i * 6 + 6))),
          1e-6,
        );
        const rotational = smallRank(
          ns.map((v) => Array.from(v.subarray(i * 6, i * 6 + 3))),
          1e-6,
        );
        const dof: InstanceDof = { total, rotational, translational: total - rotational };
        for (const id of this.bodies[b].members) report.instanceDof[id] = dof;
      });
    }
    for (const body of this.bodies)
      if (body.grounded)
        for (const id of body.members)
          report.instanceDof[id] = { total: 0, rotational: 0, translational: 0 };
    report.poses = this.poses();
    return report;
  }

  /** One drag frame: pull the grabbed point toward the target, then project back onto the mates. */
  drag(req: DragRequest): DragResult {
    const bi = this.bodyOf.get(req.instance);
    if (bi === undefined) throw new Error(`unknown instance ${req.instance}`);
    const body = this.bodies[bi];
    const grab = sub(tApply(body.rel.get(req.instance) as Transform, req.grab), body.pivot);
    const missOf = () => norm(sub(add(body.w, mulR(body.R, grab)), req.target));
    if (body.grounded) return { converged: true, iterations: 0, miss: missOf(), moved: [] };
    const c = this.comps[body.comp];
    const mates = c.mates.filter((m) => !c.setAside.includes(m));
    const term: DragTerm = { body: bi, grab, target: req.target, weight: 0.1 };
    const a = this.lm(c, mates, { drag: term, maxIter: 4, maxStep: 0.2 });
    const b = this.lm(c, mates, { maxIter: 12, maxStep: 0.2 });
    return {
      converged: b.converged,
      iterations: a.iterations + b.iterations,
      miss: missOf(),
      moved: c.bodies.flatMap((x) => this.bodies[x].members),
    };
  }

  poses(): Record<string, Pose> {
    const out: Record<string, Pose> = {};
    for (const body of this.bodies) {
      const root: Transform = { q: body.q, p: sub(body.w, mulR(body.R, body.pivot)) };
      for (const id of body.members) {
        const t = tCompose(root, body.rel.get(id) as Transform);
        out[id] = { q: t.q, p: t.p };
      }
    }
    return out;
  }

  /** Largest residual over all active mates, in mm and radians (for tests). */
  maxMateError(): { pos: number; ang: number } {
    let pos = 0;
    let ang = 0;
    for (const c of this.comps)
      for (const sm of c.mates) {
        if (c.setAside.includes(sm)) continue;
        const e = this.mateErrors(sm);
        pos = Math.max(pos, e.pos);
        ang = Math.max(ang, (e.ang * Math.PI) / 180);
      }
    return { pos, ang };
  }

  get stats(): { bodies: number; components: number; largest: number; fillBlocks: number } {
    return {
      bodies: this.bodies.length,
      components: this.comps.length,
      largest: Math.max(0, ...this.comps.map((c) => c.bodies.length)),
      fillBlocks: this.comps.reduce((s, c) => s + c.chol.fillBlocks, 0),
    };
  }

  // ------------------------------------------------------------------ conflicts
  private minimalConflict(active: SMate[]): SMate[] {
    const bodies = [...new Set(active.flatMap((m) => [m.a, m.b]))].filter(
      (b) => !this.bodies[b].grounded,
    );
    const c = this.makeComp(bodies, active);
    let cand: SMate[] = [];
    for (const tol of [RANK_TOL, 1e-4, 1e-2]) {
      const ana = this.analyse(c, active, tol);
      const set = new Set<number>();
      for (const d of ana.dependencies) {
        if (Math.abs(d.inconsistency) <= CONFLICT_TOL) continue;
        set.add(ana.rowMate[d.row]);
        for (const s of d.support) set.add(ana.rowMate[s.row]);
      }
      if (set.size) {
        cand = [...set].sort((x, y) => x - y).map((k) => active[k]);
        if (this.consistent(cand)) cand = [];
        else break;
      }
    }
    if (!cand.length) cand = [...active];
    // Deletion filter: drop every mate whose removal keeps the set inconsistent.
    let set = [...cand];
    for (const m of cand) {
      const without = set.filter((x) => x !== m);
      if (without.length && !this.consistent(without)) set = without;
    }
    return set.sort((x, y) => x.index - y.index);
  }

  private checkStatic(sm: SMate, report: SolveReport): void {
    const e = this.mateErrors(sm);
    const same = sm.a === sm.b;
    const path = same ? this.fastenPath(sm.mate.a.instance, sm.mate.b.instance) : [];
    if (e.pos < 1e-6 && e.ang < 1e-7) {
      const msg = same
        ? this.redundantMessage(sm.mate, MATE_EQUATIONS[sm.mate.type], path)
        : `'${name(sm.mate)}' joins two grounded instances; it holds and adds nothing.`;
      report.mates[sm.mate.id] = this.report(
        'redundant',
        MATE_EQUATIONS[sm.mate.type],
        path.map((m) => m.id),
        e.pos,
        e.ang,
        msg,
      );
      return;
    }
    const set = [sm.mate, ...path];
    const msg = same
      ? this.conflictMessage(set, sm.mate, e.pos, e.ang)
      : `'${name(sm.mate)}' joins two grounded instances that are ${e.pos.toFixed(3)} mm and ${e.ang.toFixed(3)}° out. Unground one, or suppress or edit the mate.`;
    report.conflicts.push({ mates: set.map((m) => m.id), message: msg });
    report.converged = false;
    for (const m of set) report.mates[m.id] = this.report('conflict', 0, [], e.pos, e.ang, msg);
  }

  /** Distance (mm) and angle (degrees) a mate is off by at the current pose. */
  private mateErrors(sm: SMate): { pos: number; ang: number } {
    const ea = this.endWorld(sm.a, sm.fa);
    const eb = this.endWorld(sm.b, sm.fb);
    let p2 = 0;
    const dirs = new Map<number, number>();
    for (const s of sm.specs) {
      if (!s.dir) p2 += dot(sub(ea.P, eb.P), eb.ax[s.u]) ** 2;
      else dirs.set(s.d, (dirs.get(s.d) ?? 0) + dot(sub(ea.ax[s.d], eb.ax[s.d]), eb.ax[s.u]) ** 2);
    }
    let ang = 0;
    for (const v of dirs.values())
      ang = Math.max(ang, 2 * Math.asin(Math.min(1, Math.sqrt(v) / 2)));
    return { pos: Math.sqrt(p2), ang: (ang * 180) / Math.PI };
  }

  // ------------------------------------------------------------------ messages
  private report(
    status: MateReport['status'],
    redundantEquations: number,
    involved: string[],
    positionError: number,
    angleError: number,
    message?: string,
  ): MateReport {
    return { status, redundantEquations, involved, positionError, angleError, message };
  }

  private describe(m: Mate): string {
    return `'${name(m)}' (${m.type}, ${this.instanceName.get(m.a.instance)} to ${this.instanceName.get(m.b.instance)})`;
  }

  private redundantMessage(m: Mate, count: number, involved: Mate[]): string {
    const total = MATE_EQUATIONS[m.type];
    const by = involved.length ? involved.map((x) => `'${name(x)}'`).join(', ') : 'the other mates';
    const what =
      count >= total
        ? 'adds nothing beyond'
        : `has ${count} of its ${total} conditions already set by`;
    return `${this.describe(m)} ${what} ${by}. It holds now, but if one of these values changes they will conflict. Consider suppressing it or using a mate that removes fewer degrees of freedom.`;
  }

  private conflictMessage(set: Mate[], worst: Mate, pos: number, angDeg: number): string {
    const list = set.map((m) => this.describe(m)).join('; ');
    const off = [
      pos > 1e-6 ? `${pos.toFixed(3)} mm` : '',
      angDeg > 1e-6 ? `${angDeg.toFixed(3)}°` : '',
    ]
      .filter(Boolean)
      .join(' and ');
    return `These ${set.length} mates cannot all hold: ${list}. Without '${name(worst)}' the rest solve; with it, it is ${off || 'slightly'} off. Suppress or edit any one of them.`;
  }
}

const tDir = (t: Transform, d: Vec3): Vec3 => sub(tApply(t, d), t.p);
