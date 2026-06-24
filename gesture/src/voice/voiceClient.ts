/**
 * Voice → presenter bridge (Track A).
 *
 * Posts a spoken/typed command to the Express agent (`POST /agent`, proxied to
 * :3000 by vite.config.ts), then drives the HologramPresenter's existing
 * `window.*` hooks so the model swaps in the hologram and Clippy reacts. It
 * never touches the renderer directly — it speaks the same `setModelState` /
 * `setClippyState` contract the presenter already exposes, so the follower
 * window mirrors every change for free via holoSync.
 *
 * TTS plays `/tts` audio when available (pre-rendered clip → ElevenLabs → Azure),
 * else falls back to the browser's SpeechSynthesis so Clippy always has a voice.
 */

/** The agent's strict JSON contract (see agent/systemPrompt.js + mockParser.js). */
export interface AgentResponse {
  intent: 'show_model' | 'lookup_spec' | 'compare' | 'chat' | 'unknown' | string;
  model: string | null;
  compare_to: string | null;
  clippy: string;
  narration: string;
  /** Optional, forward-compatible model-interaction action (explode/view/etc.). */
  action?: string | null;
  _source?: string;
}

export type VoiceStatus = 'idle' | 'thinking' | 'speaking' | 'error';

export interface VoiceClientOptions {
  onStatus?: (status: VoiceStatus) => void;
  onHeard?: (text: string) => void;
  onResult?: (data: AgentResponse) => void;
}

/** Presenter hooks exposed on `window` by HologramPresenter.exposeWindowHooks(). */
declare global {
  interface Window {
    setModelState?: (next: { model: string; compare_to?: string | null }) => void;
    setClippyState?: (action: string) => void;
    setExplode?: (factor: number) => void;
    setRenderMode?: (mode: 'solid' | 'wireframe' | 'xray') => void;
    snapToView?: (name: 'front' | 'iso' | 'top' | 'back') => void;
    setTurntable?: (opts: { on: boolean; speed?: number }) => void;
    focusPart?: (partId: string | null) => void;
  }
}

export class VoiceClient {
  /** Last model shown — context for "what does it weigh" / "compare to …". */
  private currentModel: string | null = null;

  constructor(private readonly opts: VoiceClientOptions = {}) {}

  get model(): string | null {
    return this.currentModel;
  }

  /** Run one command end-to-end: agent → presenter hooks → narration. */
  async send(userText: string): Promise<AgentResponse | null> {
    const text = userText.trim();
    if (!text) return null;
    this.opts.onHeard?.(text);
    this.setStatus('thinking');

    let data: AgentResponse;
    try {
      const res = await fetch('/agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_text: text, current_model: this.currentModel }),
      });
      data = (await res.json()) as AgentResponse;
    } catch (err) {
      console.error('[voice] agent request failed', err);
      this.setStatus('error');
      return null;
    }

    this.apply(data);
    this.opts.onResult?.(data);
    await this.speak(data.narration);
    this.setStatus('idle');
    return data;
  }

  /** Turn an agent response into presenter state changes. */
  private apply(data: AgentResponse): void {
    if (data.model) this.currentModel = data.model;

    // Clippy reacts to every command (emote chosen by the agent).
    window.setClippyState?.(data.clippy || 'idle');

    // Swap the displayed model on show / compare.
    if (data.intent === 'show_model' || data.intent === 'compare') {
      const model = data.model ?? this.currentModel;
      if (model) {
        window.setModelState?.({ model, compare_to: data.compare_to ?? null });
      }
    }

    // Forward-compatible: if the agent grows an `action` field, drive the
    // matching model-interaction hook. No-op for today's contract.
    this.applyAction(data.action ?? null);
  }

  /** Map an optional agent `action` to a presenter feature hook. */
  private applyAction(action: string | null): void {
    if (!action) return;
    switch (action) {
      case 'explode':
        window.setExplode?.(1);
        break;
      case 'collapse':
        window.setExplode?.(0);
        break;
      case 'wireframe':
      case 'xray':
      case 'solid':
        window.setRenderMode?.(action);
        break;
      case 'spin_on':
        window.setTurntable?.({ on: true });
        break;
      case 'spin_off':
        window.setTurntable?.({ on: false });
        break;
      case 'view_front':
      case 'view_back':
      case 'view_top':
      case 'view_iso':
        window.snapToView?.(action.slice('view_'.length) as 'front' | 'back' | 'top' | 'iso');
        break;
      default:
        break;
    }
  }

  /** Speak narration: server TTS first, browser SpeechSynthesis as fallback. */
  private async speak(text: string): Promise<void> {
    if (!text) return;
    this.setStatus('speaking');
    try {
      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (res.status === 200) {
        const url = URL.createObjectURL(await res.blob());
        const audio = new Audio(url);
        try {
          await audio.play();
          await new Promise<void>((resolve) => {
            audio.onended = () => resolve();
            audio.onerror = () => resolve();
          });
        } finally {
          URL.revokeObjectURL(url);
        }
        return;
      }
    } catch {
      /* fall through to browser speech */
    }
    await speakInBrowser(text);
  }

  private setStatus(status: VoiceStatus): void {
    this.opts.onStatus?.(status);
  }
}

/** Browser SpeechSynthesis fallback (corp-net / no-key safe). */
function speakInBrowser(text: string): Promise<void> {
  if (!('speechSynthesis' in window)) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 1.0;
    utter.pitch = 1.05;
    utter.onend = () => resolve();
    utter.onerror = () => resolve();
    speechSynthesis.speak(utter);
  });
}
