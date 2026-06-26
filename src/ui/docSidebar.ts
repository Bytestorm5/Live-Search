/**
 * Full-document sidebar viewer (architecture spec §5.6).
 *
 * Clicking a result opens its *parent* document in a right-hand drawer, scrolled
 * to — and highlighting — the matched chunk so the surrounding context is one
 * glance away. All document text is inserted via text nodes (never innerHTML),
 * so a malicious corpus cannot inject markup. The body-building is split into a
 * pure {@link buildDocBody} helper so it can be unit-tested without a layout.
 */
import type { DocEntry } from '../retrieval/types.ts';
import { el } from './dom.ts';

export interface DocHighlight {
  /** Character offset of the matched region within the document text. */
  start: number;
  /** Character offset one past the end of the matched region. */
  end: number;
}

export interface DocBody {
  fragment: DocumentFragment;
  /** The <mark> wrapping the matched region, or null when nothing is highlighted. */
  mark: HTMLElement | null;
}

/**
 * Render a document's full text, wrapping `[start, end)` in a
 * `<mark class="doc-highlight">`. Offsets are clamped to the text, and an empty
 * or absent range yields the plain text with no mark.
 */
export function buildDocBody(text: string, highlight?: DocHighlight): DocBody {
  const frag = document.createDocumentFragment();
  const start = highlight ? clamp(highlight.start, 0, text.length) : 0;
  const end = highlight ? clamp(highlight.end, start, text.length) : 0;
  if (!highlight || end <= start) {
    frag.append(document.createTextNode(text));
    return { fragment: frag, mark: null };
  }
  if (start > 0) frag.append(document.createTextNode(text.slice(0, start)));
  const mark = document.createElement('mark');
  mark.className = 'doc-highlight';
  mark.textContent = text.slice(start, end);
  frag.append(mark);
  if (end < text.length) frag.append(document.createTextNode(text.slice(end)));
  return { fragment: frag, mark };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export class DocSidebar {
  private root!: HTMLElement;
  private overlay!: HTMLElement;
  private titleEl!: HTMLElement;
  private linkEl!: HTMLAnchorElement;
  private metaEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private isOpen = false;
  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') this.close();
  };

  /** Build the DOM and attach it (hidden) to `parent`. */
  mount(parent: HTMLElement): void {
    this.titleEl = el('h2', { class: 'doc-title' });
    this.linkEl = el('a', {
      class: 'doc-link',
      target: '_blank',
      rel: 'noopener noreferrer',
      hidden: true,
    }, 'View source ↗') as HTMLAnchorElement;
    this.metaEl = el('dl', { class: 'doc-meta', hidden: true });
    this.bodyEl = el('div', { class: 'doc-body' });

    const closeBtn = el(
      'button',
      { class: 'doc-close', type: 'button', 'aria-label': 'Close document', title: 'Close', onClick: () => this.close() },
      '✕',
    );
    const head = el('div', { class: 'doc-head' }, this.titleEl, closeBtn);

    this.root = el(
      'aside',
      { class: 'doc-sidebar', hidden: true, role: 'complementary', 'aria-label': 'Document viewer' },
      head,
      this.linkEl,
      this.metaEl,
      this.bodyEl,
    );
    this.overlay = el('div', { class: 'doc-overlay', hidden: true, onClick: () => this.close() });
    parent.append(this.overlay, this.root);
  }

  /** Open `doc`, scrolled to and highlighting the `[highlight.start, end)` region. */
  open(doc: DocEntry, highlight?: DocHighlight): void {
    this.titleEl.textContent = doc.title;

    if (doc.url) {
      this.linkEl.href = doc.url;
      this.linkEl.hidden = false;
    } else {
      this.linkEl.removeAttribute('href');
      this.linkEl.hidden = true;
    }

    this.renderMeta(doc.meta);

    const { fragment, mark } = buildDocBody(doc.text, highlight);
    this.bodyEl.replaceChildren(fragment);

    this.root.hidden = false;
    this.overlay.hidden = false;
    if (!this.isOpen) document.addEventListener('keydown', this.onKeydown);
    this.isOpen = true;

    // Scroll the match into view once laid out; plain `scrollTop` reset otherwise.
    if (mark && typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => mark.scrollIntoView?.({ block: 'center' }));
    } else {
      this.bodyEl.scrollTop = 0;
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    this.overlay.hidden = true;
    document.removeEventListener('keydown', this.onKeydown);
  }

  get opened(): boolean {
    return this.isOpen;
  }

  private renderMeta(meta?: Record<string, string>): void {
    this.metaEl.replaceChildren();
    const keys = meta ? Object.keys(meta) : [];
    if (!keys.length) {
      this.metaEl.hidden = true;
      return;
    }
    this.metaEl.hidden = false;
    for (const key of keys) {
      this.metaEl.append(el('dt', {}, key), el('dd', {}, meta![key]));
    }
  }
}
