/**
 * Sparse LDL^T for the symmetric positive-definite GGA matrix. Up-looking
 * factorisation after T. Davis's LDL. The pattern is analysed once per network,
 * so repeated solves only redo the numeric factorisation.
 */
export class SparseLDL {
  readonly n: number;
  /** perm[newIndex] = oldIndex */
  readonly perm: Int32Array;
  readonly inversePerm: Int32Array;
  private readonly colPtr: Int32Array;
  private readonly rowIdx: Int32Array;
  readonly values: Float64Array;
  private readonly parent: Int32Array;
  private readonly lp: Int32Array;
  private readonly lnz: Int32Array;
  private readonly flag: Int32Array;
  private readonly li: Int32Array;
  private readonly lx: Float64Array;
  private readonly d: Float64Array;
  private readonly y: Float64Array;
  private readonly pattern: Int32Array;
  private readonly work: Float64Array;
  /** Position in `values` of each diagonal, by original node index. */
  readonly diagPos: Int32Array;
  private readonly offPos = new Map<number, number>();

  constructor(n: number, edges: ReadonlyArray<readonly [number, number]>) {
    this.n = n;
    this.perm = minimumDegreeOrder(n, edges);
    this.inversePerm = new Int32Array(n);
    for (let i = 0; i < n; i++) this.inversePerm[this.perm[i]] = i;

    // Upper-triangular pattern in compressed columns, in permuted order.
    const cols: Set<number>[] = Array.from({ length: n }, (_, i) => new Set([i]));
    for (const [a, b] of edges) {
      if (a === b) continue;
      const pa = this.inversePerm[a];
      const pb = this.inversePerm[b];
      cols[Math.max(pa, pb)].add(Math.min(pa, pb));
    }
    this.colPtr = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) this.colPtr[k + 1] = this.colPtr[k] + cols[k].size;
    const nnz = this.colPtr[n];
    this.rowIdx = new Int32Array(nnz);
    this.values = new Float64Array(nnz);
    this.diagPos = new Int32Array(n);
    for (let k = 0; k < n; k++) {
      const rows = [...cols[k]].sort((a, b) => a - b);
      rows.forEach((r, idx) => {
        const pos = this.colPtr[k] + idx;
        this.rowIdx[pos] = r;
        if (r === k) this.diagPos[this.perm[k]] = pos;
        else this.offPos.set(r * n + k, pos);
      });
    }

    this.parent = new Int32Array(n);
    this.lnz = new Int32Array(n);
    this.flag = new Int32Array(n);
    this.lp = new Int32Array(n + 1);
    for (let k = 0; k < n; k++) {
      this.parent[k] = -1;
      this.flag[k] = k;
      this.lnz[k] = 0;
      for (let p = this.colPtr[k]; p < this.colPtr[k + 1]; p++) {
        let i = this.rowIdx[p];
        if (i < k) {
          for (; this.flag[i] !== k; i = this.parent[i]) {
            if (this.parent[i] === -1) this.parent[i] = k;
            this.lnz[i]++;
            this.flag[i] = k;
          }
        }
      }
    }
    for (let k = 0; k < n; k++) this.lp[k + 1] = this.lp[k] + this.lnz[k];
    const lnzTotal = this.lp[n];
    this.li = new Int32Array(lnzTotal);
    this.lx = new Float64Array(lnzTotal);
    this.d = new Float64Array(n);
    this.y = new Float64Array(n);
    this.pattern = new Int32Array(n);
    this.work = new Float64Array(n);
  }

  /** Position of the off-diagonal entry between two original node indices. */
  offDiagonalPosition(a: number, b: number): number {
    const pa = this.inversePerm[a];
    const pb = this.inversePerm[b];
    const pos = this.offPos.get(Math.min(pa, pb) * this.n + Math.max(pa, pb));
    if (pos === undefined) throw new Error('Matrix entry missing from pattern');
    return pos;
  }

  /** Numeric factorisation of `values`. Returns false if a pivot is not positive. */
  factor(): boolean {
    const { n, colPtr, rowIdx, values, parent, lp, lnz, flag, li, lx, d, y, pattern } = this;
    for (let k = 0; k < n; k++) {
      y[k] = 0;
      let top = n;
      flag[k] = k;
      lnz[k] = 0;
      for (let p = colPtr[k]; p < colPtr[k + 1]; p++) {
        let i = rowIdx[p];
        if (i <= k) {
          y[i] += values[p];
          let len = 0;
          for (; flag[i] !== k; i = parent[i]) {
            pattern[len++] = i;
            flag[i] = k;
          }
          while (len > 0) pattern[--top] = pattern[--len];
        }
      }
      d[k] = y[k];
      y[k] = 0;
      for (; top < n; top++) {
        const i = pattern[top];
        const yi = y[i];
        y[i] = 0;
        const end = lp[i] + lnz[i];
        for (let p = lp[i]; p < end; p++) y[li[p]] -= lx[p] * yi;
        const lki = yi / d[i];
        d[k] -= lki * yi;
        li[end] = k;
        lx[end] = lki;
        lnz[i]++;
      }
      if (!(d[k] > 0)) return false;
    }
    return true;
  }

  /** Solves using the last factorisation. `b` and `x` use original node indices. */
  solve(b: Float64Array, x: Float64Array): void {
    const { n, perm, lp, lnz, li, lx, d, work } = this;
    for (let k = 0; k < n; k++) work[k] = b[perm[k]];
    for (let j = 0; j < n; j++) {
      const wj = work[j];
      const end = lp[j] + lnz[j];
      for (let p = lp[j]; p < end; p++) work[li[p]] -= lx[p] * wj;
    }
    for (let j = 0; j < n; j++) work[j] /= d[j];
    for (let j = n - 1; j >= 0; j--) {
      let wj = work[j];
      const end = lp[j] + lnz[j];
      for (let p = lp[j]; p < end; p++) wj -= lx[p] * work[li[p]];
      work[j] = wj;
    }
    for (let k = 0; k < n; k++) x[perm[k]] = work[k];
  }
}

/** Greedy minimum-degree ordering. O(n^2), which is fine at network sizes. */
function minimumDegreeOrder(
  n: number,
  edges: ReadonlyArray<readonly [number, number]>,
): Int32Array {
  const adj: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (const [a, b] of edges) {
    if (a === b) continue;
    adj[a].add(b);
    adj[b].add(a);
  }
  const eliminated = new Uint8Array(n);
  const order = new Int32Array(n);
  for (let step = 0; step < n; step++) {
    let best = -1;
    let bestDegree = Infinity;
    for (let i = 0; i < n; i++) {
      if (!eliminated[i] && adj[i].size < bestDegree) {
        best = i;
        bestDegree = adj[i].size;
      }
    }
    order[step] = best;
    eliminated[best] = 1;
    const neighbours = [...adj[best]];
    for (const u of neighbours) {
      adj[u].delete(best);
      for (const v of neighbours) if (u !== v) adj[u].add(v);
    }
    adj[best].clear();
  }
  return order;
}
