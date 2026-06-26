import { describe, it, expect } from 'vitest';
import { stripMarkdown, stripHtml, parseDocFile, idFromPath } from '../../src/ingest/loadDocs.ts';

describe('stripMarkdown', () => {
  it('removes markup but keeps prose and code symbols', () => {
    const md = '# Title\n\nUse `getUserMedia` and [the docs](https://x).\n\n- item one\n- item two';
    const out = stripMarkdown(md);
    expect(out).not.toContain('#');
    expect(out).not.toContain('`');
    expect(out).not.toContain('](');
    expect(out).toContain('getUserMedia');
    expect(out).toContain('the docs');
    expect(out).toContain('item one');
  });

  it('keeps the body of fenced code blocks', () => {
    const md = '```js\nconst x = navigator.gpu;\n```';
    expect(stripMarkdown(md)).toContain('navigator.gpu');
  });
});

describe('stripHtml', () => {
  it('removes tags, scripts, and decodes entities', () => {
    const html = '<h1>Hi</h1><script>evil()</script><p>a &amp; b</p>';
    const out = stripHtml(html);
    expect(out).toContain('Hi');
    expect(out).toContain('a & b');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('<');
  });
});

describe('idFromPath', () => {
  it('normalizes separators and leading ./', () => {
    expect(idFromPath('./docs/a.md')).toBe('docs/a.md');
    expect(idFromPath('docs\\b.md')).toBe('docs/b.md');
  });
});

describe('parseDocFile', () => {
  it('parses markdown with a heading title', () => {
    const [doc] = parseDocFile({ path: 'docs/intro.md', content: '# Welcome\n\nHello there.' });
    expect(doc.id).toBe('docs/intro.md');
    expect(doc.title).toBe('Welcome');
    expect(doc.text).toContain('Hello there');
  });

  it('falls back to the filename when there is no heading', () => {
    const [doc] = parseDocFile({ path: 'guide.txt', content: 'plain content here' });
    expect(doc.title).toBe('guide');
    expect(doc.text).toBe('plain content here');
  });

  it('parses HTML with a <title>', () => {
    const [doc] = parseDocFile({ path: 'page.html', content: '<title>My Page</title><p>Body text</p>' });
    expect(doc.title).toBe('My Page');
    expect(doc.text).toContain('Body text');
  });

  it('parses a JSON array of docs', () => {
    const docs = parseDocFile({
      path: 'corpus.json',
      content: JSON.stringify([
        { id: 'a', title: 'A', text: 'alpha' },
        { id: 'b', title: 'B', text: 'beta', url: 'https://x' },
      ]),
    });
    expect(docs).toHaveLength(2);
    expect(docs[1].url).toBe('https://x');
  });

  it('parses a single JSON doc and a { docs: [...] } wrapper', () => {
    expect(parseDocFile({ path: 'one.json', content: JSON.stringify({ id: 'x', title: 'X', text: 'hi' }) })).toHaveLength(1);
    expect(parseDocFile({ path: 'w.json', content: JSON.stringify({ docs: [{ text: 'only text' }] }) })).toHaveLength(1);
  });

  it('skips docs with empty text and malformed JSON', () => {
    expect(parseDocFile({ path: 'empty.md', content: '   ' })).toEqual([]);
    expect(parseDocFile({ path: 'bad.json', content: '{not json' })).toEqual([]);
  });
});
