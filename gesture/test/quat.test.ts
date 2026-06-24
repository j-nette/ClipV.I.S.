import { describe, it, expect } from 'vitest';
import {
  quatFromAxisAngle,
  quatMultiply,
  quatConjugate,
  quatAngle,
  quatClampAngle,
  quatFromBasis,
  IDENTITY_QUAT,
} from '../src/quat';

describe('quat', () => {
  it('axis-angle round-trips to the expected angle', () => {
    const q = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, 0.5);
    expect(quatAngle(q)).toBeCloseTo(0.5, 6);
  });

  it('q * conjugate(q) is identity (zero rotation)', () => {
    const q = quatFromAxisAngle({ x: 1, y: 2, z: 3 }, 1.1);
    const delta = quatMultiply(q, quatConjugate(q));
    expect(quatAngle(delta)).toBeCloseTo(0, 6);
  });

  it('composes rotations about the same axis additively', () => {
    const a = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.3);
    const b = quatFromAxisAngle({ x: 0, y: 0, z: 1 }, 0.4);
    expect(quatAngle(quatMultiply(a, b))).toBeCloseTo(0.7, 6);
  });

  it('clamps rotation angle to the maximum', () => {
    const big = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 1.0);
    expect(quatAngle(quatClampAngle(big, 0.3))).toBeCloseTo(0.3, 6);
    const small = quatFromAxisAngle({ x: 1, y: 0, z: 0 }, 0.1);
    expect(quatAngle(quatClampAngle(small, 0.3))).toBeCloseTo(0.1, 6);
  });

  it('identity basis yields the identity quaternion', () => {
    const q = quatFromBasis({ x: 1, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 0, z: 1 });
    expect(q.x).toBeCloseTo(IDENTITY_QUAT.x, 6);
    expect(q.y).toBeCloseTo(IDENTITY_QUAT.y, 6);
    expect(q.z).toBeCloseTo(IDENTITY_QUAT.z, 6);
    expect(Math.abs(q.w)).toBeCloseTo(1, 6);
  });
});
