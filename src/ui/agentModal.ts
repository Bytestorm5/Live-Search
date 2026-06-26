/**
 * GM-assistant response modal. When the agent decides a sentence warrants a
 * response, this proactively shows the answer in a floating card with a 60 s
 * auto-close countdown (visualized as a depleting progress bar). The countdown
 * PAUSES while the pointer is over the card so a reader isn't rushed. The
 * countdown maths live in {@link CountdownController} (unit-tested); this wires
 * it to the DOM via requestAnimationFrame.
 */
import type { GmAgentResult } from '../agent/gmAgent.ts';
import { CountdownController } from './countdown.ts';
import { el } from './dom.ts';

const KIND_LABEL: Record<GmAgentResult['kind'], string> = {
  question: '❓ Question',
  checking: '💡 Heads up',
};

export class AgentModal {
  private readonly card: HTMLElement;
  private readonly kindEl: HTMLElement;
  private readonly utteranceEl: HTMLElement;
  private readonly answerEl: HTMLElement;
  private readonly sourcesEl: HTMLElement;
  private readonly progressFill: HTMLElement;
  private controller: CountdownController | null = null;
  private raf = 0;
  private mounted = false;

  constructor(private readonly timeoutMs: number) {
    this.kindEl = el('span', { class: 'agent-kind' });
    this.utteranceEl = el('p', { class: 'agent-utterance' });
    this.answerEl = el('div', { class: 'agent-answer' });
    this.sourcesEl = el('div', { class: 'agent-sources' });
    this.progressFill = el('span', { class: 'progress-fill' });

    const close = el(
      'button',
      { class: 'agent-close', type: 'button', 'aria-label': 'Dismiss', onClick: () => this.close() },
      '✕',
    );

    this.card = el(
      'div',
      {
        class: 'agent-modal',
        role: 'dialog',
        'aria-label': 'Game master assistant',
        onMouseenter: () => this.controller?.pause(),
        onMouseleave: () => this.controller?.resume(),
      },
      el('div', { class: 'agent-head' }, this.kindEl, close),
      this.utteranceEl,
      this.answerEl,
      this.sourcesEl,
      el('div', { class: 'progress agent-progress' }, this.progressFill),
    );
  }

  /** Show (or replace) the current response and restart the countdown. */
  show(result: GmAgentResult): void {
    this.kindEl.textContent = KIND_LABEL[result.kind];
    this.utteranceEl.textContent = `“${result.utterance}”`;
    this.answerEl.textContent = result.answer;

    this.sourcesEl.replaceChildren();
    const unique = dedupeSources(result.sources);
    if (unique.length) {
      this.sourcesEl.append(el('span', { class: 'agent-sources-label' }, 'Sources: '));
      unique.forEach((s, i) => {
        if (i > 0) this.sourcesEl.append(document.createTextNode(', '));
        if (s.url) {
          this.sourcesEl.append(el('a', { href: s.url, target: '_blank', rel: 'noopener noreferrer' }, s.title));
        } else {
          this.sourcesEl.append(el('span', {}, s.title));
        }
      });
    }

    this.controller = new CountdownController(this.timeoutMs);
    this.mount();
    this.startLoop();
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf);
    const loop = (now: number) => {
      if (!this.controller) return;
      const fraction = this.controller.tick(now);
      this.progressFill.style.width = `${Math.round(fraction * 100)}%`;
      if (this.controller.done) {
        this.close();
        return;
      }
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  close(): void {
    cancelAnimationFrame(this.raf);
    this.controller = null;
    if (this.mounted) {
      this.card.remove();
      this.mounted = false;
    }
  }

  private mount(): void {
    if (this.mounted) return;
    document.body.append(this.card);
    this.mounted = true;
  }
}

function dedupeSources(sources: Array<{ title: string; url?: string }>): Array<{ title: string; url?: string }> {
  const seen = new Set<string>();
  const out: Array<{ title: string; url?: string }> = [];
  for (const s of sources) {
    const key = s.url ?? s.title;
    if (!seen.has(key)) {
      seen.add(key);
      out.push(s);
    }
  }
  return out;
}
