/**
 * UI controller (architecture spec §5.6).
 *
 * Renders the results panel, the live transcript (interim + committed lines),
 * and status indicators for microphone state, the OpenAI connection, speaking
 * activity, and search readiness. Provides controls for the OpenAI API key,
 * transcription model, language, semantic search, noise reduction, and result
 * count.
 */
import { DEFAULT_CONFIG, makeConfig } from '../config.ts';
import type { AppConfig, DeepPartial } from '../config.ts';
import { Orchestrator } from '../pipeline/orchestrator.ts';
import type { PipelineStatus, ResultsInfo } from '../pipeline/orchestrator.ts';
import type { CorpusIndex, SearchHit } from '../retrieval/types.ts';
import type { NoiseReduction, TranscriptionModel } from '../asr/realtimeEvents.ts';
import { el } from './dom.ts';
import { renderResults } from './render.ts';

const KEY_STORAGE = 'live-search.openai-api-key';

export interface AppOptions {
  index: CorpusIndex | null;
  config?: AppConfig;
}

export class App {
  private readonly index: CorpusIndex | null;
  private config: AppConfig;
  private orchestrator: Orchestrator | null = null;
  private listening = false;
  private interim = '';

  private startBtn!: HTMLButtonElement;
  private statusBar!: HTMLElement;
  private resultsHost!: HTMLElement;
  private transcriptLog!: HTMLElement;
  private interimLine!: HTMLElement;
  private errorBanner!: HTMLElement;
  private micMeterFill!: HTMLElement;
  private apiKeyInput!: HTMLInputElement;
  private sourceSelect!: HTMLSelectElement;
  private modelSelect!: HTMLSelectElement;
  private languageInput!: HTMLInputElement;
  private noiseSelect!: HTMLSelectElement;
  private semanticToggle!: HTMLInputElement;
  private resultCount!: HTMLInputElement;

  constructor(opts: AppOptions) {
    this.index = opts.index;
    this.config = opts.config ?? DEFAULT_CONFIG;
  }

  mount(container: HTMLElement): void {
    container.replaceChildren(this.build());
    this.renderStatus(this.blankStatus());
    this.resultsHost.replaceChildren(renderResults([]));
    this.apiKeyInput.value = localStorage.getItem(KEY_STORAGE) ?? '';
  }

  // --- view ---

  private build(): HTMLElement {
    const header = el(
      'header',
      { class: 'app-header' },
      el('h1', {}, 'Live Search'),
      el('p', { class: 'tagline' }, 'Live transcription that surfaces your docs as you speak.'),
      el(
        'span',
        { class: 'privacy-badge', title: 'Audio is streamed to OpenAI for transcription. Document search stays in your browser.' },
        '☁︎ transcription via OpenAI · docs stay local',
      ),
    );

    this.errorBanner = el('div', { class: 'error-banner', hidden: true, role: 'alert' });
    this.statusBar = el('div', { class: 'status-bar' });

    this.startBtn = el(
      'button',
      { class: 'btn-primary', type: 'button', onClick: () => void this.toggle() },
      'Start listening',
    ) as HTMLButtonElement;

    this.micMeterFill = el('span', { class: 'mic-meter-fill' });
    const micMeter = el(
      'div',
      { class: 'mic-meter', title: 'Microphone level — should move when you speak' },
      this.micMeterFill,
    );
    const controls = el('div', { class: 'controls' }, this.startBtn, micMeter, this.buildSettings());

    this.resultsHost = el('div', { class: 'results-host' });
    const results = el('section', { class: 'panel results-panel' }, el('h2', {}, 'Documentation'), this.resultsHost);

    this.transcriptLog = el('div', { class: 'transcript-log', 'aria-live': 'polite' });
    this.interimLine = el('p', { class: 'transcript-line interim' });
    const transcript = el(
      'section',
      { class: 'panel transcript-panel' },
      el('h2', {}, 'Live transcript'),
      el('p', { class: 'hint' }, 'Shown for context only — not persisted.'),
      this.transcriptLog,
      this.interimLine,
    );

    return el('div', { class: 'app' }, header, this.errorBanner, this.statusBar, controls, el('main', { class: 'main' }, results, transcript));
  }

  private buildSettings(): HTMLElement {
    this.apiKeyInput = el('input', {
      class: 'setting key-input',
      type: 'password',
      placeholder: 'sk-…',
      autocomplete: 'off',
      spellcheck: 'false',
      title: 'OpenAI API key (kept in this browser only)',
    }) as HTMLInputElement;

    this.sourceSelect = el(
      'select',
      { class: 'setting', title: 'Capture from your mic, or a shared tab/screen (e.g. a Discord call)' },
      el('option', { value: 'microphone' }, 'Microphone'),
      el('option', { value: 'display' }, 'Shared audio (tab/system) — Chromium'),
    ) as HTMLSelectElement;
    this.sourceSelect.value = this.config.audio.source;

    this.modelSelect = el(
      'select',
      { class: 'setting' },
      el('option', { value: 'gpt-4o-mini-transcribe' }, 'gpt-4o-mini-transcribe (fast)'),
      el('option', { value: 'gpt-4o-transcribe' }, 'gpt-4o-transcribe (accurate)'),
      el('option', { value: 'whisper-1' }, 'whisper-1'),
    ) as HTMLSelectElement;
    this.modelSelect.value = this.config.transcription.model;

    this.languageInput = el('input', {
      class: 'setting',
      type: 'text',
      value: this.config.transcription.language,
      size: '4',
      title: 'Language hint (ISO code, blank = auto)',
    }) as HTMLInputElement;

    this.noiseSelect = el(
      'select',
      { class: 'setting' },
      el('option', { value: 'near_field' }, 'Near-field'),
      el('option', { value: 'far_field' }, 'Far-field'),
      el('option', { value: 'none' }, 'No reduction'),
    ) as HTMLSelectElement;
    this.noiseSelect.value = this.config.transcription.noiseReduction;

    this.semanticToggle = el('input', { class: 'setting', type: 'checkbox', title: 'Local semantic search (downloads ~25 MB MiniLM)' }) as HTMLInputElement;
    this.semanticToggle.checked = this.config.retrieval.semantic;

    this.resultCount = el('input', {
      class: 'setting',
      type: 'range',
      min: '1',
      max: '10',
      value: String(this.config.retrieval.topK),
      title: 'Result count',
    }) as HTMLInputElement;

    return el(
      'details',
      { class: 'settings' },
      el('summary', {}, 'Settings'),
      el('label', { class: 'key-label' }, 'OpenAI API key', this.apiKeyInput),
      el('label', {}, 'Audio source', this.sourceSelect),
      el('label', {}, 'Model', this.modelSelect),
      el('label', {}, 'Language', this.languageInput),
      el('label', {}, 'Noise reduction', this.noiseSelect),
      el('label', { class: 'checkbox-label' }, this.semanticToggle, 'Semantic search (extra download)'),
      el('label', {}, 'Results', this.resultCount),
    );
  }

  // --- control ---

  private async toggle(): Promise<void> {
    if (this.listening) await this.stop();
    else await this.start();
  }

  private async start(): Promise<void> {
    this.clearError();
    const apiKey = this.apiKeyInput.value.trim();
    if (!apiKey) {
      this.showError('Enter your OpenAI API key in Settings to start. It stays in this browser.');
      (this.querySettings()).open = true;
      this.apiKeyInput.focus();
      return;
    }
    localStorage.setItem(KEY_STORAGE, apiKey);
    this.config = this.readConfig();
    this.setSettingsDisabled(true);
    this.startBtn.textContent = 'Starting…';
    this.startBtn.disabled = true;
    this.clearTranscript();

    this.orchestrator = new Orchestrator({
      config: this.config,
      index: this.index,
      apiKey,
      callbacks: {
        onStatus: (s) => this.renderStatus(s),
        onTranscript: (e) => this.appendTranscript(e),
        onResults: (hits, info) => this.renderResults(hits, info),
        onMicLevel: (level) => this.setMicLevel(level),
        onError: (m) => this.showError(m),
      },
    });

    await this.orchestrator.start();
    this.listening = true;
    this.startBtn.textContent = 'Stop';
    this.startBtn.disabled = false;
    this.startBtn.classList.add('btn-stop');
  }

  private async stop(): Promise<void> {
    await this.orchestrator?.stop();
    this.orchestrator = null;
    this.listening = false;
    this.startBtn.textContent = 'Start listening';
    this.startBtn.classList.remove('btn-stop');
    this.setSettingsDisabled(false);
  }

  private querySettings(): HTMLDetailsElement {
    return this.apiKeyInput.closest('details') as HTMLDetailsElement;
  }

  private readConfig(): AppConfig {
    const overrides: DeepPartial<AppConfig> = {
      audio: { source: this.sourceSelect.value as AppConfig['audio']['source'] },
      transcription: {
        model: this.modelSelect.value as TranscriptionModel,
        language: this.languageInput.value.trim(),
        noiseReduction: this.noiseSelect.value as NoiseReduction,
      },
      retrieval: {
        topK: Number(this.resultCount.value),
        semantic: this.semanticToggle.checked,
      },
    };
    return makeConfig(overrides);
  }

  private setSettingsDisabled(disabled: boolean): void {
    for (const c of [this.apiKeyInput, this.sourceSelect, this.modelSelect, this.languageInput, this.noiseSelect, this.semanticToggle, this.resultCount]) {
      c.disabled = disabled;
    }
  }

  // --- rendering ---

  private renderResults(hits: SearchHit[], info: ResultsInfo): void {
    this.resultsHost.replaceChildren(renderResults(hits));
    const corrections = info.correctedTerms
      .map((t, i) => (t !== info.rawTerms[i] ? `${info.rawTerms[i]}→${t}` : null))
      .filter(Boolean);
    if (corrections.length) {
      this.resultsHost.append(
        el('p', { class: 'corrections', title: 'Vocabulary-constrained correction' }, `corrected: ${corrections.join(', ')}`),
      );
    }
  }

  private appendTranscript(entry: { text: string; isFinal: boolean }): void {
    if (entry.isFinal) {
      this.interim = '';
      this.interimLine.textContent = '';
      this.transcriptLog.append(el('p', { class: 'transcript-line' }, entry.text));
    } else {
      this.interim += entry.text;
      this.interimLine.textContent = this.interim;
    }
    this.transcriptLog.scrollTop = this.transcriptLog.scrollHeight;
  }

  private clearTranscript(): void {
    this.interim = '';
    this.interimLine.textContent = '';
    this.transcriptLog.replaceChildren();
  }

  private setMicLevel(level: number): void {
    this.micMeterFill.style.width = `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%`;
    this.micMeterFill.classList.toggle('active', level > 0.02);
  }

  private blankStatus(): PipelineStatus {
    return { micActive: false, connection: 'idle', speaking: false, searchReady: false, hasSemantic: false, semanticLoading: false };
  }

  private renderStatus(s: PipelineStatus): void {
    const items: Node[] = [];

    items.push(this.chip(s.micActive ? (s.speaking ? '🎙️ speaking' : '🎙️ mic on') : '🎙️ mic off', s.micActive ? 'ok' : 'idle'));

    const conn: Record<PipelineStatus['connection'], [string, 'ok' | 'warn' | 'idle' | 'loading']> = {
      idle: ['idle', 'idle'],
      connecting: ['connecting…', 'loading'],
      live: ['live', 'ok'],
      error: ['connection error', 'warn'],
    };
    const [label, kind] = conn[s.connection];
    items.push(this.chip(`OpenAI: ${label}`, kind));

    if (this.index) {
      if (s.semanticLoading) items.push(this.chip('loading search model…', 'loading'));
      else items.push(this.chip(s.hasSemantic ? 'hybrid search' : 'lexical search', s.searchReady ? 'ok' : 'loading'));
    } else {
      items.push(this.chip('no corpus loaded', 'warn'));
    }

    this.statusBar.replaceChildren(...items);
  }

  private chip(label: string, kind: 'ok' | 'warn' | 'idle' | 'loading'): HTMLElement {
    return el('span', { class: `chip ${kind}` }, label);
  }

  // --- errors ---

  private showError(message: string): void {
    this.errorBanner.textContent = message;
    this.errorBanner.hidden = false;
  }

  private clearError(): void {
    this.errorBanner.textContent = '';
    this.errorBanner.hidden = true;
  }
}
