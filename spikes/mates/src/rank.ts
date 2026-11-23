// Spike S1: rank, dependency circuits and null space of a (scaled) mate Jacobian.
//
// Rows are processed in mate order with modified Gram-Schmidt (two passes). A row whose remainder
// is below `tol` is dependent; its exact combination of earlier *kept* rows is recovered from the
// triangular provenance matrix T (q_k = Σ T[k][l] row_l). Because kept rows are independent, that
// combination is unique, so its support is the one minimal set of earlier rows that implies the
// dependent row (a circuit). For y = e_dep - Σ β_l e_l, J^T y = 0; y·r ≠ 0 means the linearised
// equations are inconsistent (a conflict), y·r ≈ 0 means a consistent redundancy.

export interface Dependency {
  row: number;
  /** Kept rows and coefficients with row ≈ Σ c·row_l. */
  support: { row: number; c: number }[];
  /** y·r: zero for a consistent redundancy. */
  inconsistency: number;
}

export interface RankResult {
  rank: number;
  kept: Uint8Array;
  dependencies: Dependency[];
  /** Smallest remainder norm among kept rows: near the tolerance means a near-singular pose. */
  minPivot: number;
  /** Orthonormal basis of the row space, rank × n, row-major. */
  q: Float64Array;
}

export function rowRank(
  j: Float64Array,
  m: number,
  n: number,
  r: Float64Array,
  tol: number,
): RankResult {
  const q = new Float64Array(Math.min(m, n) * n);
  const t: Float64Array[] = []; // provenance rows, indexed by basis index, over kept-row slots
  const keptRows: number[] = [];
  const kept = new Uint8Array(m);
  const dependencies: Dependency[] = [];
  const w = new Float64Array(n);
  const c = new Float64Array(Math.min(m, n));
  let rank = 0;
  let minPivot = Number.POSITIVE_INFINITY;
  for (let i = 0; i < m; i++) {
    for (let k = 0; k < n; k++) w[k] = j[i * n + k];
    c.fill(0, 0, rank);
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < rank; b++) {
        let s = 0;
        const o = b * n;
        for (let k = 0; k < n; k++) s += w[k] * q[o + k];
        if (s === 0) continue;
        c[b] += s;
        for (let k = 0; k < n; k++) w[k] -= s * q[o + k];
      }
    }
    let nw = 0;
    for (let k = 0; k < n; k++) nw += w[k] * w[k];
    nw = Math.sqrt(nw);
    if (nw > tol && rank < n) {
      // New basis vector q = (row - Σ c_b q_b) / nw; provenance T[rank] = (e_new - Σ c_b T[b]) / nw.
      const o = rank * n;
      for (let k = 0; k < n; k++) q[o + k] = w[k] / nw;
      const tr = new Float64Array(rank + 1);
      for (let b = 0; b < rank; b++) {
        const cb = c[b];
        if (cb === 0) continue;
        const tb = t[b];
        for (let l = 0; l < tb.length; l++) tr[l] -= cb * tb[l];
      }
      tr[rank] = 1;
      for (let l = 0; l <= rank; l++) tr[l] /= nw;
      t.push(tr);
      keptRows.push(i);
      kept[i] = 1;
      rank++;
      if (nw < minPivot) minPivot = nw;
    } else {
      const beta = new Float64Array(rank);
      for (let b = 0; b < rank; b++) {
        const cb = c[b];
        if (cb === 0) continue;
        const tb = t[b];
        for (let l = 0; l < tb.length; l++) beta[l] += cb * tb[l];
      }
      let bmax = 0;
      for (let l = 0; l < rank; l++) bmax = Math.max(bmax, Math.abs(beta[l]));
      const support: { row: number; c: number }[] = [];
      let inconsistency = r[i];
      for (let l = 0; l < rank; l++) {
        if (Math.abs(beta[l]) > 1e-7 * Math.max(1, bmax))
          support.push({ row: keptRows[l], c: beta[l] });
        inconsistency -= beta[l] * r[keptRows[l]];
      }
      dependencies.push({ row: i, support, inconsistency });
    }
  }
  return { rank, kept, dependencies, minPivot, q };
}

/**
 * Orthonormal basis of the null space (n × d, stored as d rows of length n), by greedy pivoting
 * on the diagonal of the projector I - Q^T Q.
 */
export function nullSpace(q: Float64Array, rank: number, n: number): Float64Array[] {
  const d = n - rank;
  const out: Float64Array[] = [];
  const remain = new Float64Array(n).fill(1);
  for (let b = 0; b < rank; b++) for (let k = 0; k < n; k++) remain[k] -= q[b * n + k] ** 2;
  for (let s = 0; s < d; s++) {
    let best = 0;
    for (let k = 1; k < n; k++) if (remain[k] > remain[best]) best = k;
    const v = new Float64Array(n);
    v[best] = 1;
    for (let pass = 0; pass < 2; pass++) {
      for (let b = 0; b < rank; b++) {
        const qb = q.subarray(b * n, b * n + n);
        let p = 0;
        for (let k = 0; k < n; k++) p += v[k] * qb[k];
        for (let k = 0; k < n; k++) v[k] -= p * qb[k];
      }
      for (const u of out) {
        let p = 0;
        for (let k = 0; k < n; k++) p += v[k] * u[k];
        for (let k = 0; k < n; k++) v[k] -= p * u[k];
      }
    }
    let nv = 0;
    for (let k = 0; k < n; k++) nv += v[k] * v[k];
    nv = Math.sqrt(nv);
    for (let k = 0; k < n; k++) v[k] /= nv;
    for (let k = 0; k < n; k++) remain[k] -= v[k] * v[k];
    out.push(v);
  }
  return out;
}

/** Rank of a small set of vectors (rows), Gram-Schmidt with an absolute tolerance. */
export function smallRank(rows: number[][], tol: number): number {
  const basis: number[][] = [];
  for (const r0 of rows) {
    const r = r0.slice();
    for (let pass = 0; pass < 2; pass++)
      for (const b of basis) {
        let p = 0;
        for (let k = 0; k < r.length; k++) p += r[k] * b[k];
        for (let k = 0; k < r.length; k++) r[k] -= p * b[k];
      }
    const nr = Math.hypot(...r);
    if (nr > tol) basis.push(r.map((x) => x / nr));
  }
  return basis.length;
}
