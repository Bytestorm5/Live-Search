/**
 * UI controller (architecture spec §5.6).
 *
 * Renders the results panel, the live transcript (for context and operator
 * trust — not persisted, §7), and status indicators for microphone state, the
 * execution provider in use (WebGPU vs. WASM), model-load progress, and
 * offline/cache state. Provides controls for VAD sensitivity, model selection,
 * and result count.
 */
import { DEFAULT_CONFIG, makeConfig } from '../config.ts';
import type { AppConfig, DeepPartial } from '../config.ts';
import { Orchestrator } from '../pipeline/orchestrator.ts';
import type { PipelineStatus, ResultsInfo, TranscriptEntry } from '../pipeline/orchestrator.ts';
import type { CorpusIndex, SearchHit } from '../retrieval/types.ts';
import { el } from './dom.ts';
import { renderResults } from './render.ts';

export interface AppOptions {
  index: CorpusIndex | null;
  config?: AppConfig;
}

export class App {
  private readonly index: CorpusIndex | null;
  private config: AppConfig;
  private orchestrator: Orchestrator | null = null;
  private listening = false;

  // DOM references populated in mount().
  private startBtn!: HTMLButtonElement;
  private statusBar!: HTMLElement;
  private resultsHost!: HTMLElement;
  private transcriptLog!: HTMLElement;
  private errorBanner!: HTMLElement;
  private modelSelect!: HTMLSelectElement;
  private providerSelect!: HTMLSelectElement;
  private sensitivity!: HTMLInputElement;
  private resultCount!: HTMLInputElement;

  constructor(opts: AppOptions) {
    this.index = opts.index;
    this.config = opts.config ?? DEFAULT_CONFIG;
  }

  mount(container: HTMLElement): void {
    container.replaceChildren(this.build());
    this.renderStatus(this.blankStatus());
    this.resultsHost.replaceChildren(renderResults([]));
    window.addEventListener('online', () => this.renderConnectivity());
    window.addEventListener('offline', () => this.renderConnectivity());
  }

  // --- view ---

  private build(): HTMLElement {
    const header = el(
      'header',
      { class: 'app-header' },
      el('h1', {}, 'Live Search'),
      el('p', { class: 'tagline' }, 'Private, on-device live transcription that surfaces your docs as you speak.'),
      el('span', { class: 'privacy-badge', title: 'No audio or transcript leaves your device.' }, '🔒 on-device only'),
    );

    this.errorBanner = el('div', { class: 'error-banner', hidden: true, role: 'alert' });
    this.statusBar = el('div', { class: 'status-bar' });

    this.startBtn = el(
      'button',
      { class: 'btn-primary', type: 'button', onClick: () => void this.toggle() },
      'Start listening',
    ) as HTMLButtonElement;

    const controls = el(
      'div',
      { class: 'controls' },
      this.startBtn,
      this.buildSettings(),
    );

    this.resultsHost = el('div', { class: 'results-host' });
    const results = el(
      'section',
      { class: 'panel results-panel' },
      el('h2', {}, 'Documentation'),
      this.resultsHost,
    );

    this.transcriptLog = el('div', { class: 'transcript-log', 'aria-live': 'polite' });
    const transcript = el(
      'section',
      { class: 'panel transcript-panel' },
      el('h2', {}, 'Live transcript'),
      el('p', { class: 'hint' }, 'Shown for context only — never saved.'),
      this.transcriptLog,
    );

    return el('div', { class: 'app' }, header, this.errorBanner, this.statusBar, controls, el('main', { class: 'main' }, results, transcript));
  }

  private buildSettings(): HTMLElement {
    this.modelSelect = el(
      'select',
      { class: 'setting', title: 'ASR model' },
      el('option', { value: 'moonshine-base' }, 'Moonshine base (recommended)'),
      el('option', { value: 'moonshine-tiny' }, 'Moonshine tiny (fastest)'),
      el('option', { value: 'whisper-base.en' }, 'Whisper base.en'),
    ) as HTMLSelectElement;
    this.modelSelect.value = this.config.asr.model;

    this.providerSelect = el(
      'select',
      { class: 'setting', title: 'Execution provider' },
      el('option', { value: 'webgpu' }, 'WebGPU (fast)'),
      el('option', { value: 'wasm' }, 'WASM (compatible)'),
    ) as HTMLSelectElement;
    this.providerSelect.value = this.config.asr.preferredProvider;

    this.sensitivity = el('input', {
      class: 'setting',
      type: 'range',
      min: '0',
      max: '100',
      value: '50',
      title: 'VAD sensitivity',
    }) as HTMLInputElement;

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
      el('label', {}, 'Model', this.modelSelect),
      el('label', {}, 'Provider', this.providerSelect),
      el('label', {}, 'VAD sensitivity', this.sensitivity),
      el('label', {}, 'Results', this.resultCount),
    );
  }

  // --- control ---

  private async toggle(): Promise<void> {
    if (this.listening) {
      await this.stop();
    } else {
      await this.start();
    }
  }

  private async start(): Promise<void> {
    this.clearError();
    this.config = this.readConfig();
    this.setSettingsDisabled(true);
    this.startBtn.textContent = 'Starting…';
    this.startBtn.disabled = true;

    this.orchestrator = new Orchestrator(this.config, this.index, {
      onStatus: (s) => this.renderStatus(s),
      onTranscript: (e) => this.appendTranscript(e),
      onResults: (hits, info) => this.renderResults(hits, info),
      onError: (m) => this.showError(m),
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

  private readConfig(): AppConfig {
    // Sensitivity slider 0..100 maps to a speech threshold of 0.8..0.2.
    const sens = Number(this.sensitivity.value) / 100;
    const speechThreshold = 0.8 - sens * 0.6;
    const overrides: DeepPartial<AppConfig> = {
      asr: {
        model: this.modelSelect.value as AppConfig['asr']['model'],
        preferredProvider: this.providerSelect.value as AppConfig['asr']['preferredProvider'],
      },
      vad: { speechThreshold, silenceThreshold: Math.max(0.15, speechThreshold - 0.15) },
      retrieval: { topK: Number(this.resultCount.value) },
    };
    return makeConfig(overrides);
  }

  private setSettingsDisabled(disabled: boolean): void {
    for (const c of [this.modelSelect, this.providerSelect, this.sensitivity, this.resultCount]) {
      c.disabled = disabled;
    }
  }

  // --- rendering ---

  private renderResults(hits: SearchHit[], info: ResultsInfo): void {
    this.resultsHost.replaceChildren(renderResults(hits));
    if (info.correctedTerms.length) {
      const corrections = info.correctedTerms
        .map((t, i) => (t !== info.rawTerms[i] ? `${info.rawTerms[i]}→${t}` : null))
        .filter(Boolean);
      if (corrections.length) {
        this.resultsHost.append(
          el('p', { class: 'corrections', title: 'Vocabulary-constrained correction' }, `corrected: ${corrections.join(', ')}`),
        );
      }
    }
  }

  private appendTranscript(entry: TranscriptEntry): void {
    const line = el('p', { class: 'transcript-line', dataset: { reason: entry.reason } }, entry.text);
    this.transcriptLog.append(line);
    this.transcriptLog.scrollTop = this.transcriptLog.scrollHeight;
  }

  private blankStatus(): PipelineStatus {
    return {
      micActive: false,
      speaking: false,
      provider: null,
      asrModel: null,
      asrReady: false,
      vadReady: false,
      retrievalReady: false,
      hasSemantic: false,
      modelProgress: 0,
      fallingBehind: false,
      droppedCount: 0,
    };
  }

  private renderStatus(s: PipelineStatus): void {
    const items: Node[] = [];

    items.push(this.chip(s.micActive ? 'mic on' : 'mic off', s.micActive ? 'ok' : 'idle', s.speaking ? '🎙️ speaking' : '🎙️'));

    if (s.provider) {
      const warn = s.provider === 'wasm';
      items.push(this.chip(`${s.provider.toUpperCase()}${warn ? ' (slow)' : ''}`, warn ? 'warn' : 'ok'));
    }

    if (s.asrModel) items.push(this.chip(s.asrModel, s.asrReady ? 'ok' : 'loading'));

    const loading = (s.micActive || s.modelProgress > 0) && s.modelProgress < 1;
    if (loading) {
      items.push(
        el(
          'span',
          { class: 'chip loading' },
          `loading models ${Math.round(s.modelProgress * 100)}%`,
          el('span', { class: 'progress' }, el('span', { class: 'progress-fill', style: `width:${Math.round(s.modelProgress * 100)}%` })),
        ),
      );
    }

    if (this.index) {
      items.push(this.chip(s.hasSemantic ? 'hybrid search' : 'lexical search', s.retrievalReady ? 'ok' : 'loading'));
    } else {
      items.push(this.chip('no corpus loaded', 'warn'));
    }

    if (s.fallingBehind) items.push(this.chip(`falling behind (${s.droppedCount} dropped)`, 'warn'));

    items.push(this.connectivityChip());

    this.statusBar.replaceChildren(...items);
  }

  private renderConnectivity(): void {
    // Re-render just the connectivity chip in place if present.
    const existing = this.statusBar.querySelector('.chip.connectivity');
    if (existing) existing.replaceWith(this.connectivityChip());
  }

  private connectivityChip(): HTMLElement {
    const online = navigator.onLine;
    const chip = this.chip(online ? 'online' : 'offline (cached)', online ? 'ok' : 'idle');
    chip.classList.add('connectivity');
    return chip;
  }

  private chip(label: string, kind: 'ok' | 'warn' | 'idle' | 'loading', prefix?: string): HTMLElement {
    return el('span', { class: `chip ${kind}` }, prefix ? `${prefix} ` : '', label);
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
