/**
 * Cross-window state sync for the presenter → hologram pipeline.
 *
 * Same-origin, same-machine, zero backend: a `BroadcastChannel` carries the
 * shared `ModelState`. The presenter publishes on every change; the hologram
 * follower applies whatever it receives. A `hello` handshake lets a freshly
 * opened (or reopened) follower re-request the current state so it re-syncs.
 *
 * Cross-MACHINE later? Swap the BroadcastChannel for a WebSocket through the
 * Express server (agent/server.js) — keep this publish/subscribe shape so
 * callers don't change.
 */
import type { ModelState } from './modelState';

const CHANNEL = 'clipvis-holo';

type HoloMessage = { kind: 'state'; state: ModelState } | { kind: 'hello' };

export interface PresenterSync {
  /** Broadcast the latest state to any follower windows. */
  publish(state: ModelState): void;
  dispose(): void;
}

export interface FollowerSync {
  dispose(): void;
}

/**
 * Presenter side. Owns the state; re-broadcasts on demand when a follower says
 * `hello` (e.g. it was just opened or reloaded).
 */
export function createPresenterSync(getState: () => ModelState): PresenterSync {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<HoloMessage>) => {
    if (e.data?.kind === 'hello') {
      channel.postMessage({ kind: 'state', state: getState() } satisfies HoloMessage);
    }
  };
  return {
    publish(state: ModelState): void {
      channel.postMessage({ kind: 'state', state } satisfies HoloMessage);
    },
    dispose(): void {
      channel.close();
    },
  };
}

/**
 * Follower side. Pure receiver: applies every state it receives and asks the
 * presenter to re-broadcast once at startup.
 */
export function createFollowerSync(onState: (state: ModelState) => void): FollowerSync {
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (e: MessageEvent<HoloMessage>) => {
    if (e.data?.kind === 'state') onState(e.data.state);
  };
  channel.postMessage({ kind: 'hello' } satisfies HoloMessage);
  return {
    dispose(): void {
      channel.close();
    },
  };
}
