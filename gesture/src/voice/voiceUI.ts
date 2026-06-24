/**
 * Presenter command bar (Track A) — the laptop-side voice/text UI.
 *
 * Builds a compact bar (heard line, narration line, text box, Listen button,
 * and a few quick-command chips) and routes every command through VoiceClient,
 * which drives the HologramPresenter. Text + chips always work; the Listen
 * button uses the Web Speech API (best in Edge) when available.
 *
 * Numeric demo hotkeys are intentionally omitted: keys 1–4 already snap views
 * in the gesture KeyboardFallback. The chips are the demo-safe equivalent.
 */
import { VoiceClient, type VoiceStatus } from './voiceClient';

/** Minimal Web Speech surface (not in TS's DOM lib). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}
interface SpeechResultEvent {
  results: ArrayLike<ArrayLike<{ transcript: string }>>;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

const QUICK_COMMANDS: Array<{ label: string; command: string }> = [
  { label: 'Show controller', command: 'Clippy, show me the Xbox controller' },
  { label: 'Surface Pro 11', command: 'Clippy, show me the Surface Pro 11' },
  { label: 'What does it weigh?', command: 'What does it weigh?' },
  { label: 'Compare to SP10', command: 'Compare to the Surface Pro 10' },
  { label: 'Building 7', command: 'Clippy, bring up Building 7' },
  { label: 'Wow! 🎉', command: 'Wow, that looks amazing!' },
];

export function setupVoiceUI(): void {
  const bar = document.getElementById('voicebar');
  if (!bar) return;
  bar.style.display = 'flex';

  const heard = el('div', 'voice-heard');
  const narration = el('div', 'voice-narration');

  const form = document.createElement('form');
  form.className = 'voice-row';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Ask Clippy… e.g. "show the controller"';
  input.className = 'voice-input';
  input.autocomplete = 'off';

  const listen = button('🎙️ Listen', 'voice-listen');
  const send = button('Send', 'voice-send');
  send.type = 'submit';

  form.append(input, send, listen);

  const chips = el('div', 'voice-chips');
  for (const qc of QUICK_COMMANDS) {
    const chip = button(qc.label, 'voice-chip');
    chip.addEventListener('click', () => void run(qc.command));
    chips.append(chip);
  }

  bar.append(narration, heard, form, chips);

  const client = new VoiceClient({
    onHeard: (t) => (heard.textContent = `“${t}”`),
    onResult: (d) => (narration.textContent = d.narration || ''),
    onStatus: (s) => setStatus(bar, s),
  });

  async function run(command: string): Promise<void> {
    await client.send(command);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    void run(text);
  });

  setupListen(listen, heard, run);
}

/** Wire the Listen button to the Web Speech API, or hide it if unsupported. */
function setupListen(
  listen: HTMLButtonElement,
  heard: HTMLElement,
  run: (command: string) => Promise<void>,
): void {
  const ctor =
    (window as unknown as { SpeechRecognition?: SpeechRecognitionCtor }).SpeechRecognition ??
    (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionCtor }).webkitSpeechRecognition;

  if (!ctor) {
    listen.style.display = 'none';
    return;
  }

  const recognition = new ctor();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.maxAlternatives = 1;

  let listening = false;
  recognition.onresult = (e) => {
    const transcript = e.results[0]?.[0]?.transcript ?? '';
    if (transcript) void run(transcript);
  };
  recognition.onend = () => {
    listening = false;
    listen.classList.remove('active');
  };
  recognition.onerror = (e) => {
    listening = false;
    listen.classList.remove('active');
    if (e.error === 'network' || e.error === 'service-not-allowed') {
      heard.textContent = 'Speech blocked (corp net) — use the text box or chips.';
    } else if (e.error === 'not-allowed') {
      heard.textContent = 'Mic blocked — allow it via the 🔒 in the address bar.';
    }
  };

  listen.addEventListener('click', () => {
    if (listening) {
      recognition.stop();
      return;
    }
    try {
      listening = true;
      listen.classList.add('active');
      heard.textContent = 'listening…';
      recognition.start();
    } catch {
      listening = false;
      listen.classList.remove('active');
    }
  });
}

function setStatus(bar: HTMLElement, status: VoiceStatus): void {
  bar.dataset.status = status;
}

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function button(label: string, className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  return b;
}
