// Spike S1: block-sparse Cholesky for the damped normal equations (J^T J + λI) δ = -J^T r.
// One 6×6 block per rigid body; the sparsity pattern is the mate graph. Minimum-degree ordering
// and the fill pattern are computed once per component (prepare), the numeric factor per step.

const B = 6;
const BB = 36;

export class BlockCholesky {
  readonly n: number;
  /** order[k] = node eliminated at step k; pos[node] = k. */
  readonly order: Int32Array;
  readonly pos: Int32Array;
  /** For each position k, the later positions with a nonzero L block (sorted). */
  readonly cols: Int32Array[];
  private readonly offIndex = new Map<number, number>();
  /** For each position k, block offsets of L[cols[k][t], k], parallel to cols[k]. */
  private readonly colBlocks: Int32Array[];
  readonly diag: Float64Array;
  readonly off: Float64Array;
  private readonly tmp = new Float64Array(BB);

  constructor(n: number, edges: ReadonlyArray<readonly [number, number]>) {
    this.n = n;
    const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
    for (const [a, b] of edges) {
      if (a === b) continue;
      adj[a].add(b);
      adj[b].add(a);
    }
    // Greedy minimum degree on the explicit elimination graph (fine for a few thousand bodies).
    const alive = new Uint8Array(n).fill(1);
    const order = new Int32Array(n);
    const nbrsAt: number[][] = [];
    for (let k = 0; k < n; k++) {
      let best = -1;
      let bestDeg = Number.POSITIVE_INFINITY;
      for (let v = 0; v < n; v++) {
        if (alive[v] && adj[v].size < bestDeg) {
          best = v;
          bestDeg = adj[v].size;
        }
      }
      order[k] = best;
      const nb = [...adj[best]];
      nbrsAt.push(nb);
      for (const u of nb) adj[u].delete(best);
      for (let i = 0; i < nb.length; i++)
        for (let j = i + 1; j < nb.length; j++) {
          adj[nb[i]].add(nb[j]);
          adj[nb[j]].add(nb[i]);
        }
      alive[best] = 0;
    }
    this.order = order;
    this.pos = new Int32Array(n);
    for (let k = 0; k < n; k++) this.pos[order[k]] = k;
    this.cols = nbrsAt.map((nb) => Int32Array.from(nb.map((v) => this.pos[v])).sort());
    let count = 0;
    this.colBlocks = this.cols.map((rows, k) => {
      const blocks = new Int32Array(rows.length);
      rows.forEach((i, t) => {
        this.offIndex.set(i * n + k, count);
        blocks[t] = count++;
      });
      return blocks;
    });
    this.diag = new Float64Array(n * BB);
    this.off = new Float64Array(count * BB);
  }

  get fillBlocks(): number {
    return this.off.length / BB;
  }

  zero(): void {
    this.diag.fill(0);
    this.off.fill(0);
  }

  /** Adds λ to every diagonal entry. */
  addIdentity(lambda: number): void {
    for (let k = 0; k < this.n; k++)
      for (let i = 0; i < B; i++) this.diag[k * BB + i * 7] += lambda;
  }

  /**
   * Accumulates one Jacobian row's outer products. ja/jb are 6-vectors for nodes a and b
   * (either may be -1 for a grounded body).
   */
  addRow(
    a: number,
    ja: Float64Array,
    jaOff: number,
    b: number,
    jb: Float64Array,
    jbOff: number,
  ): void {
    if (a >= 0) this.addOuter(this.diag, this.pos[a] * BB, ja, jaOff, ja, jaOff);
    if (b >= 0) this.addOuter(this.diag, this.pos[b] * BB, jb, jbOff, jb, jbOff);
    if (a >= 0 && b >= 0 && a !== b) {
      const pa = this.pos[a];
      const pb = this.pos[b];
      if (pa > pb) this.addOuter(this.off, this.blockOf(pa, pb), ja, jaOff, jb, jbOff);
      else this.addOuter(this.off, this.blockOf(pb, pa), jb, jbOff, ja, jaOff);
    } else if (a >= 0 && a === b) {
      // Both ends on one body: (ja + jb)(ja + jb)^T minus the two diagonal terms already added.
      const d = this.pos[a] * BB;
      for (let i = 0; i < B; i++)
        for (let j = 0; j < B; j++)
          this.diag[d + i * B + j] += ja[jaOff + i] * jb[jbOff + j] + jb[jbOff + i] * ja[jaOff + j];
    }
  }

  private blockOf(i: number, j: number): number {
    const o = this.offIndex.get(i * this.n + j);
    if (o === undefined) throw new Error('block outside the symbolic pattern');
    return o * BB;
  }

  private addOuter(
    dst: Float64Array,
    off: number,
    u: Float64Array,
    uo: number,
    v: Float64Array,
    vo: number,
  ): void {
    for (let i = 0; i < B; i++) {
      const ui = u[uo + i];
      if (ui === 0) continue;
      for (let j = 0; j < B; j++) dst[off + i * B + j] += ui * v[vo + j];
    }
  }

  /** In-place block LL^T. Returns false if a pivot is not positive. */
  factor(): boolean {
    const { diag, off, tmp } = this;
    for (let k = 0; k < this.n; k++) {
      const d = k * BB;
      if (!chol6(diag, d)) return false;
      const rows = this.cols[k];
      const blocks = this.colBlocks[k];
      // L_ik = A_ik L_kk^{-T}: forward substitution on each row of the block.
      for (let t = 0; t < rows.length; t++) {
        const o = blocks[t] * BB;
        for (let r = 0; r < B; r++) {
          for (let c = 0; c < B; c++) {
            let s = off[o + r * B + c];
            for (let m = 0; m < c; m++) s -= off[o + r * B + m] * diag[d + c * B + m];
            off[o + r * B + c] = s / diag[d + c * B + c];
          }
        }
      }
      // Schur update of the trailing blocks.
      for (let t = 0; t < rows.length; t++) {
        const i = rows[t];
        const oi = blocks[t] * BB;
        for (let u = 0; u <= t; u++) {
          const j = rows[u];
          const oj = blocks[u] * BB;
          for (let r = 0; r < B; r++)
            for (let c = 0; c < B; c++) {
              let s = 0;
              for (let m = 0; m < B; m++) s += off[oi + r * B + m] * off[oj + c * B + m];
              tmp[r * B + c] = s;
            }
          if (i === j) {
            const di = i * BB;
            for (let e = 0; e < BB; e++) diag[di + e] -= tmp[e];
          } else {
            const oij = this.blockOf(i, j);
            for (let e = 0; e < BB; e++) off[oij + e] -= tmp[e];
          }
        }
      }
    }
    return true;
  }

  /** Solves (L L^T) x = rhs in place. rhs is indexed by node (6 entries per node). */
  solve(rhs: Float64Array): void {
    const { diag, off, n } = this;
    const y = new Float64Array(n * B);
    for (let k = 0; k < n; k++)
      y.set(rhs.subarray(this.order[k] * B, this.order[k] * B + B), k * B);
    for (let k = 0; k < n; k++) {
      const d = k * BB;
      for (let r = 0; r < B; r++) {
        let s = y[k * B + r];
        for (let m = 0; m < r; m++) s -= diag[d + r * B + m] * y[k * B + m];
        y[k * B + r] = s / diag[d + r * B + r];
      }
      const rows = this.cols[k];
      const blocks = this.colBlocks[k];
      for (let t = 0; t < rows.length; t++) {
        const o = blocks[t] * BB;
        const i = rows[t] * B;
        for (let r = 0; r < B; r++) {
          let s = 0;
          for (let m = 0; m < B; m++) s += off[o + r * B + m] * y[k * B + m];
          y[i + r] -= s;
        }
      }
    }
    for (let k = n - 1; k >= 0; k--) {
      const rows = this.cols[k];
      const blocks = this.colBlocks[k];
      for (let t = 0; t < rows.length; t++) {
        const o = blocks[t] * BB;
        const i = rows[t] * B;
        for (let c = 0; c < B; c++) {
          let s = 0;
          for (let m = 0; m < B; m++) s += off[o + m * B + c] * y[i + m];
          y[k * B + c] -= s;
        }
      }
      const d = k * BB;
      for (let r = B - 1; r >= 0; r--) {
        let s = y[k * B + r];
        for (let m = r + 1; m < B; m++) s -= diag[d + m * B + r] * y[k * B + m];
        y[k * B + r] = s / diag[d + r * B + r];
      }
    }
    for (let k = 0; k < n; k++) rhs.set(y.subarray(k * B, k * B + B), this.order[k] * B);
  }
}

/** Dense 6×6 Cholesky in place (lower triangle holds L). */
function chol6(a: Float64Array, o: number): boolean {
  for (let j = 0; j < B; j++) {
    let s = a[o + j * B + j];
    for (let m = 0; m < j; m++) s -= a[o + j * B + m] * a[o + j * B + m];
    if (!(s > 0)) return false;
    const l = Math.sqrt(s);
    a[o + j * B + j] = l;
    for (let i = j + 1; i < B; i++) {
      let t = a[o + i * B + j];
      for (let m = 0; m < j; m++) t -= a[o + i * B + m] * a[o + j * B + m];
      a[o + i * B + j] = t / l;
    }
    for (let i = 0; i < j; i++) a[o + i * B + j] = 0;
  }
  return true;
}
