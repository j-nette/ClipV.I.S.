import type { GestureEvent } from './types';

type Handler = (e: GestureEvent) => void;

const handlers = new Set<Handler>();

/**
 * Trivial typed event bus. Producers (keyboard fallback now, camera pipeline
 * later) call emit(); consumers subscribe via on(). The bus has no knowledge of
 * who is listening, which is what keeps gesture decoupled from any renderer.
 */
export const gestureBus = {
  emit(e: GestureEvent): void {
    for (const h of handlers) h(e);
  },
  /** Subscribe. Returns an unsubscribe function. */
  on(h: Handler): () => void {
    handlers.add(h);
    return () => handlers.delete(h);
  },
};
