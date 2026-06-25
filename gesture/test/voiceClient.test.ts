import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoiceClient, type AgentResponse } from '../src/voice/voiceClient';

/**
 * Track A mapping: agent JSON → presenter window hooks. Runs in node, so we
 * point `window` at globalThis and stub the hooks + fetch. /tts returns 204 so
 * speak() takes the browser path, which is a no-op without `speechSynthesis`.
 */

interface Hooks {
  setModelState: ReturnType<typeof vi.fn>;
  setClippyState: ReturnType<typeof vi.fn>;
}

function stubAgent(response: AgentResponse): void {
  globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
    if (String(url).includes('/agent')) {
      return { status: 200, json: async () => response } as unknown as Response;
    }
    return { status: 204 } as unknown as Response; // /tts → browser fallback
  }) as typeof fetch;
}

function hooks(): Hooks {
  const w = window as Window;
  return {
    setModelState: w.setModelState as ReturnType<typeof vi.fn>,
    setClippyState: w.setClippyState as ReturnType<typeof vi.fn>,
  };
}

beforeEach(() => {
  (globalThis as { window?: unknown }).window = globalThis;
  window.setModelState = vi.fn();
  window.setClippyState = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as { window?: unknown }).window;
});

describe('VoiceClient → presenter mapping', () => {
  it('show_model swaps the model and reacts', async () => {
    stubAgent({
      intent: 'show_model',
      model: 'xbox_controller',
      compare_to: null,
      clippy: 'presenting',
      narration: "Here's the Xbox controller.",
    });
    const client = new VoiceClient();
    await client.send('show controller');

    expect(hooks().setModelState).toHaveBeenCalledWith({
      model: 'xbox_controller',
      compare_to: null,
    });
    expect(hooks().setClippyState).toHaveBeenCalledWith('presenting');
    expect(client.model).toBe('xbox_controller');
  });

  it('compare passes compare_to through', async () => {
    stubAgent({
      intent: 'compare',
      model: 'surface_pro_11',
      compare_to: 'surface_pro_10',
      clippy: 'presenting',
      narration: 'Comparing the Surface Pro 10.',
    });
    await new VoiceClient().send('compare to the surface pro 10');

    expect(hooks().setModelState).toHaveBeenCalledWith({
      model: 'surface_pro_11',
      compare_to: 'surface_pro_10',
    });
  });

  it('chat reacts but never swaps the model', async () => {
    stubAgent({
      intent: 'chat',
      model: null,
      compare_to: null,
      clippy: 'wave',
      narration: 'Hi there!',
    });
    await new VoiceClient().send('hi');

    expect(hooks().setClippyState).toHaveBeenCalledWith('wave');
    expect(hooks().setModelState).not.toHaveBeenCalled();
  });

  it('forwards an optional action to a feature hook', async () => {
    window.setExplode = vi.fn();
    stubAgent({
      intent: 'show_model',
      model: 'xbox_controller',
      compare_to: null,
      clippy: 'presenting',
      narration: 'Exploding the controller.',
      action: 'explode',
    });
    await new VoiceClient().send('explode the controller');

    expect((window.setExplode as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(1);
  });

  it('maps manipulate actions to the right hooks without swapping the model', async () => {
    window.nudgeZoom = vi.fn();
    window.setTurntable = vi.fn();
    window.snapToView = vi.fn();
    window.setRenderMode = vi.fn();
    window.resetView = vi.fn();

    const cases: Array<[string, () => void]> = [
      ['zoom_in', () => expect(window.nudgeZoom).toHaveBeenCalledWith(0.3)],
      ['zoom_out', () => expect(window.nudgeZoom).toHaveBeenCalledWith(-0.3)],
      ['spin_on', () => expect(window.setTurntable).toHaveBeenCalledWith({ on: true })],
      ['spin_off', () => expect(window.setTurntable).toHaveBeenCalledWith({ on: false })],
      ['view_back', () => expect(window.snapToView).toHaveBeenCalledWith('back')],
      ['wireframe', () => expect(window.setRenderMode).toHaveBeenCalledWith('wireframe')],
      ['reset', () => expect(window.resetView).toHaveBeenCalled()],
    ];

    for (const [action, assert] of cases) {
      stubAgent({
        intent: 'manipulate',
        model: null,
        compare_to: null,
        clippy: 'presenting',
        narration: action,
        action,
      });
      await new VoiceClient().send(action);
      assert();
    }

    // Manipulation never swaps the displayed model.
    expect(hooks().setModelState).not.toHaveBeenCalled();
  });
});
