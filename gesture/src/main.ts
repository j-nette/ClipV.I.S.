import { gestureBus } from './eventBus';
import { KeyboardFallback } from './keyboardFallback';
import { StandaloneScene } from './consumers/standaloneScene';
import type { Consumer } from './types';

/**
 * Phase 0 bootstrap: pick a consumer, log every event, start the keyboard
 * fallback. No camera yet — that arrives in Phase 1 as another producer on the
 * same bus.
 */
function main(): void {
  const container = document.getElementById('scene');
  if (!container) throw new Error('#scene container not found');

  // Consumer selection. Default is the laptop-screen StandaloneScene.
  // `?consumer=hologram` will select HologramAdapter once Phase 5 exists.
  const which = new URLSearchParams(location.search).get('consumer');
  const consumer: Consumer = which === 'hologram'
    ? createHologramAdapterStub()
    : new StandaloneScene(container);

  // Wire consumer to the bus.
  gestureBus.on((e) => consumer.handle(e));

  // Dev visibility: mirror the README standalone test ("PINCH START" in console).
  gestureBus.on((e) => {
    if (e.type === 'pinch_start') console.log('PINCH START', e.ndc);
    if (e.type === 'pinch_end') console.log('PINCH END');
    if (e.type === 'point') console.log('POINT', e.ndc);
  });

  // Start the always-on keyboard producer.
  new KeyboardFallback().start();

  console.info(
    '[gesture] Phase 0 ready. Controls: P = point (hold), G = pinch (toggle), arrows = move cursor.',
  );
}

/** Placeholder until Phase 5 — keeps the consumer switch type-safe. */
function createHologramAdapterStub(): Consumer {
  console.warn('[gesture] HologramAdapter not implemented yet — falling back to no-op consumer.');
  return { handle: () => {} };
}

main();
