// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { buildDocBody, DocSidebar } from '../../src/ui/docSidebar.ts';
import type { DocEntry } from '../../src/retrieval/types.ts';

describe('buildDocBody', () => {
  it('wraps the [start, end) region in a highlight mark', () => {
    const host = document.createElement('div');
    const { fragment, mark } = buildDocBody('The quick brown fox', { start: 4, end: 9 });
    host.append(fragment);
    expect(mark?.textContent).toBe('quick');
    expect(host.querySelector('.doc-highlight')?.textContent).toBe('quick');
    expect(host.textContent).toBe('The quick brown fox');
  });

  it('returns plain text (no mark) for an empty or missing range', () => {
    expect(buildDocBody('hello').mark).toBeNull();
    expect(buildDocBody('hello', { start: 3, end: 3 }).mark).toBeNull();
  });

  it('clamps out-of-range offsets to the text', () => {
    const { mark } = buildDocBody('abc', { start: 1, end: 999 });
    expect(mark?.textContent).toBe('bc');
  });

  it('does not interpret corpus text as markup', () => {
    const host = document.createElement('div');
    host.append(buildDocBody('<img src=x onerror=alert(1)> after', { start: 0, end: 5 }).fragment);
    expect(host.querySelector('img')).toBeNull();
    expect(host.textContent).toContain('<img src=x onerror=alert(1)>');
  });
});

describe('DocSidebar', () => {
  const doc: DocEntry = {
    id: 'd',
    title: 'Armored Coat',
    text: 'A sturdy armored coat. It grants resistance and looks dashing.',
    url: 'https://x/armored-coat',
    meta: { category: 'Item', rarity: 'Common' },
  };

  function mounted(): { host: HTMLElement; sidebar: DocSidebar } {
    const host = document.createElement('div');
    document.body.append(host);
    const sidebar = new DocSidebar();
    sidebar.mount(host);
    return { host, sidebar };
  }

  it('mounts hidden', () => {
    const { host } = mounted();
    const aside = host.querySelector('.doc-sidebar') as HTMLElement;
    expect(aside.hidden).toBe(true);
    expect(host.querySelector('.doc-overlay')).not.toBeNull();
  });

  it('opens with the title, source link, meta, and highlighted body', () => {
    const { host, sidebar } = mounted();
    sidebar.open(doc, { start: 9, end: 22 }); // "armored coat."
    const aside = host.querySelector('.doc-sidebar') as HTMLElement;
    expect(aside.hidden).toBe(false);
    expect(sidebar.opened).toBe(true);
    expect(host.querySelector('.doc-title')?.textContent).toBe('Armored Coat');
    expect((host.querySelector('.doc-link') as HTMLAnchorElement).href).toContain('armored-coat');
    expect(host.querySelector('.doc-highlight')?.textContent).toBe('armored coat.');
    // Meta rendered as a definition list.
    expect(host.querySelectorAll('.doc-meta dt')).toHaveLength(2);
    expect(host.querySelector('.doc-body')?.textContent).toBe(doc.text);
  });

  it('hides the source link for a doc without a url', () => {
    const { host, sidebar } = mounted();
    sidebar.open({ id: 'n', title: 'No URL', text: 'body' });
    expect((host.querySelector('.doc-link') as HTMLElement).hidden).toBe(true);
    expect((host.querySelector('.doc-meta') as HTMLElement).hidden).toBe(true);
  });

  it('closes via the close button and the overlay', () => {
    const { host, sidebar } = mounted();
    sidebar.open(doc);
    (host.querySelector('.doc-close') as HTMLButtonElement).click();
    expect(sidebar.opened).toBe(false);
    expect((host.querySelector('.doc-sidebar') as HTMLElement).hidden).toBe(true);

    sidebar.open(doc);
    (host.querySelector('.doc-overlay') as HTMLElement).click();
    expect(sidebar.opened).toBe(false);
  });
});
