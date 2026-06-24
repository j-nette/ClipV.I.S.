import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { Clippy } from '../src/shared/clippy';

// Skip the network GLB probe — keep the deterministic placeholder mascot.
vi.mock('three/examples/jsm/loaders/GLTFLoader.js', () => ({
  GLTFLoader: class {
    load(
      _url: string,
      _onLoad: unknown,
      _onProgress: unknown,
      onError?: (e: unknown) => void,
    ): void {
      onError?.(new Error('no glb in test'));
    }
  },
}));

/** Read the animated inner group (the one Clippy bobs/rotates/scales). */
function anim(c: Clippy): THREE.Object3D {
  return c.object.children[0];
}

describe('Clippy emote state machine', () => {
  it('builds a placeholder mascot with an animated inner group', () => {
    const c = new Clippy();
    expect(c.object).toBeInstanceOf(THREE.Group);
    expect(anim(c).children.length).toBeGreaterThan(0); // torus + eyes
  });

  it('idle bobs vertically and never yaws', () => {
    const c = new Clippy();
    c.setEmote('idle');
    c.update(0.4, 0.016);
    expect(anim(c).rotation.y).toBe(0);
    expect(Math.abs(anim(c).position.y)).toBeLessThanOrEqual(0.06 + 1e-9);
  });

  it('confused shakes its head (non-zero yaw)', () => {
    const c = new Clippy();
    c.setEmote('confused');
    // Pick a time where sin(t*12) is clearly non-zero.
    c.update(0.1, 0.016);
    expect(Math.abs(anim(c).rotation.y)).toBeGreaterThan(0.05);
  });

  it('celebrating spins progressively and scales up', () => {
    const c = new Clippy();
    c.setEmote('celebrating'); // stateStart anchors to lastElapsed (0)
    c.update(0.2, 0.016);
    const yawEarly = anim(c).rotation.y;
    c.update(0.6, 0.016);
    const yawLate = anim(c).rotation.y;
    expect(yawLate).toBeGreaterThan(yawEarly); // accumulating spin
    expect(anim(c).scale.x).toBeGreaterThanOrEqual(1); // scale pop never shrinks
  });

  it('falls back to idle for unknown emotes', () => {
    const known = new Clippy();
    known.setEmote('idle');
    known.update(0.37, 0.016);

    const unknown = new Clippy();
    unknown.setEmote('banana-dance');
    unknown.update(0.37, 0.016);

    expect(unknown.object.children[0].position.y).toBeCloseTo(
      known.object.children[0].position.y,
      10,
    );
    expect(unknown.object.children[0].rotation.y).toBe(0); // idle never yaws
  });

  it('returns to a neutral pose when leaving a transient emote', () => {
    const c = new Clippy();
    c.setEmote('celebrating');
    c.update(0.5, 0.016);
    expect(anim(c).rotation.y).not.toBe(0);
    c.setEmote('idle');
    c.update(0.5, 0.016);
    expect(anim(c).rotation.y).toBe(0); // no leak from the spin
  });
});
