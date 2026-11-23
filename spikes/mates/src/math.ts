// Spike S1: small vector, quaternion and rigid-transform helpers. Plain arrays; no dependencies.

export type Vec3 = [number, number, number];
/** Unit quaternion [w, x, y, z]. */
export type Quat = [number, number, number, number];
/** Rigid transform: rotate by q, then translate by p. */
export interface Transform {
  q: Quat;
  p: Vec3;
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / norm(a));

export const qIdentity = (): Quat => [1, 0, 0, 0];

export function qMul(a: Quat, b: Quat): Quat {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export const qConj = (q: Quat): Quat => [q[0], -q[1], -q[2], -q[3]];

export function qNormalize(q: Quat): Quat {
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  // Keep w >= 0 so that equal rotations compare equal.
  const s = (q[0] < 0 ? -1 : 1) / n;
  return [q[0] * s, q[1] * s, q[2] * s, q[3] * s];
}

export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const u = normalize(axis);
  const s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), u[0] * s, u[1] * s, u[2] * s];
}

/** Exponential map: rotation vector (axis * angle) to quaternion. */
export function qExp(w: Vec3): Quat {
  const t = norm(w);
  if (t < 1e-12) return qNormalize([1, w[0] / 2, w[1] / 2, w[2] / 2]);
  const s = Math.sin(t / 2) / t;
  return [Math.cos(t / 2), w[0] * s, w[1] * s, w[2] * s];
}

/** Row-major 3x3 rotation matrix of a unit quaternion, written into out[off..off+9]. */
export function qToMat(q: Quat, out: Float64Array, off = 0): void {
  const [w, x, y, z] = q;
  out[off] = 1 - 2 * (y * y + z * z);
  out[off + 1] = 2 * (x * y - w * z);
  out[off + 2] = 2 * (x * z + w * y);
  out[off + 3] = 2 * (x * y + w * z);
  out[off + 4] = 1 - 2 * (x * x + z * z);
  out[off + 5] = 2 * (y * z - w * x);
  out[off + 6] = 2 * (x * z - w * y);
  out[off + 7] = 2 * (y * z + w * x);
  out[off + 8] = 1 - 2 * (x * x + y * y);
}

export function qRotate(q: Quat, v: Vec3): Vec3 {
  const m = new Float64Array(9);
  qToMat(q, m);
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

/** Quaternion from an orthonormal basis given as columns x, y, z (Shepperd's method). */
export function qFromBasis(x: Vec3, y: Vec3, z: Vec3): Quat {
  const m00 = x[0];
  const m11 = y[1];
  const m22 = z[2];
  const tr = m00 + m11 + m22;
  let q: Quat;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    q = [s / 4, (y[2] - z[1]) / s, (z[0] - x[2]) / s, (x[1] - y[0]) / s];
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    q = [(y[2] - z[1]) / s, s / 4, (y[0] + x[1]) / s, (z[0] + x[2]) / s];
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    q = [(z[0] - x[2]) / s, (y[0] + x[1]) / s, s / 4, (z[1] + y[2]) / s];
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    q = [(x[1] - y[0]) / s, (z[0] + x[2]) / s, (z[1] + y[2]) / s, s / 4];
  }
  return qNormalize(q);
}

export const tApply = (t: Transform, v: Vec3): Vec3 => add(qRotate(t.q, v), t.p);
export const tCompose = (a: Transform, b: Transform): Transform => ({
  q: qNormalize(qMul(a.q, b.q)),
  p: tApply(a, b.p),
});
export function tInverse(t: Transform): Transform {
  const qi = qConj(t.q);
  return { q: qi, p: scale(qRotate(qi, t.p), -1) };
}

/** Angle in radians of the rotation part of a transform. */
export const qAngle = (q: Quat): number =>
  2 * Math.atan2(Math.hypot(q[1], q[2], q[3]), Math.abs(q[0]));

/** Deterministic PRNG (mulberry32) for generated models and perturbations. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
