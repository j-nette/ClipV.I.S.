import type { Quat } from './types';

/** Minimal pure quaternion/vector helpers (no three.js) so detection + control
 *  stay framework-free and unit-testable. Quaternions are {x,y,z,w}, w-last. */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const IDENTITY_QUAT: Quat = { x: 0, y: 0, z: 0, w: 1 };

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function length(a: Vec3): number {
  return Math.hypot(a.x, a.y, a.z);
}

export function normalize(a: Vec3): Vec3 {
  const len = length(a);
  if (len < 1e-9) return { x: 0, y: 0, z: 0 };
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

/** Quaternion from an orthonormal right-handed basis (axes are matrix columns). */
export function quatFromBasis(xa: Vec3, ya: Vec3, za: Vec3): Quat {
  const m00 = xa.x, m10 = xa.y, m20 = xa.z;
  const m01 = ya.x, m11 = ya.y, m21 = ya.z;
  const m02 = za.x, m12 = za.y, m22 = za.z;
  const tr = m00 + m11 + m22;
  let x: number, y: number, z: number, w: number;
  if (tr > 0) {
    const s = 0.5 / Math.sqrt(tr + 1);
    w = 0.25 / s;
    x = (m21 - m12) * s;
    y = (m02 - m20) * s;
    z = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }
  return quatNormalize({ x, y, z, w });
}

export function quatNormalize(q: Quat): Quat {
  const len = Math.hypot(q.x, q.y, q.z, q.w);
  if (len < 1e-9) return { ...IDENTITY_QUAT };
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len };
}

export function quatConjugate(q: Quat): Quat {
  return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

/** Hamilton product a*b. */
export function quatMultiply(a: Quat, b: Quat): Quat {
  return {
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  };
}

/** Rotation magnitude of a quaternion, in radians [0, π]. */
export function quatAngle(q: Quat): number {
  const n = quatNormalize(q);
  return 2 * Math.acos(Math.min(1, Math.abs(n.w)));
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const a = normalize(axis);
  const h = angle / 2;
  const s = Math.sin(h);
  return { x: a.x * s, y: a.y * s, z: a.z * s, w: Math.cos(h) };
}

/** Rescale a quaternion's rotation to at most `maxAngle` radians (shortest arc). */
export function quatClampAngle(q: Quat, maxAngle: number): Quat {
  const n = quatNormalize(q);
  // Take the shortest arc (w >= 0).
  const sign = n.w < 0 ? -1 : 1;
  const w = sign * n.w;
  const angle = 2 * Math.acos(Math.min(1, w));
  if (angle <= maxAngle) return n;
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  const axis: Vec3 =
    s < 1e-6 ? { x: 1, y: 0, z: 0 } : { x: (sign * n.x) / s, y: (sign * n.y) / s, z: (sign * n.z) / s };
  return quatFromAxisAngle(axis, maxAngle);
}
