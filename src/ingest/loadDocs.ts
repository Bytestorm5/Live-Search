/**
 * Pure document loaders for the ingest CLI (architecture spec §5.5 "Corpus
 * loading"). These take file contents (never touch the filesystem) so they are
 * unit-testable; `scripts/ingest.ts` supplies the bytes.
 *
 * Supported inputs: Markdown, plain text, HTML, and JSON (a single doc, an
 * array, or `{ docs: [...] }`). Markup is reduced to plain text — but code
 * spans/blocks are KEPT, because that's exactly where API symbols and other
 * domain vocabulary live (spec §5.4).
 */
import type { RawDoc } from '../retrieval/types.ts';
import { frontmatterToDoc, parseFrontmatter } from './frontmatter.ts';

/** Reduce Markdown to plain text, preserving code/identifier content. */
export function stripMarkdown(md: string): string {
  let t = md;
  t = t.replace(/```[^\n]*\n([\s\S]*?)```/g, (_, code: string) => code); // keep fenced code body
  t = t.replace(/`([^`]+)`/g, '$1'); // inline code -> content
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1'); // image -> alt
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1'); // link -> text
  t = t.replace(/^#{1,6}\s+/gm, ''); // headings
  t = t.replace(/^\s{0,3}>\s?/gm, ''); // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, ''); // bullet lists
  t = t.replace(/^\s*\d+\.\s+/gm, ''); // numbered lists
  t = t.replace(/(\*\*|__|~~|[*_])(.+?)\1/g, '$2'); // emphasis
  t = t.replace(/^\s*\|(.+)\|\s*$/gm, (_, row: string) => row.replace(/\|/g, ' ')); // tables
  t = t.replace(/^\s*[-:|]+\s*$/gm, ''); // table separators
  t = t.replace(/<[^>]+>/g, ' '); // stray HTML
  t = t.replace(/\n{3,}/g, '\n\n');
  return t.trim();
}

/** Reduce HTML to plain text. */
export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Derive a slug id from a file path. */
export function idFromPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function firstMarkdownHeading(md: string): string | null {
  const m = md.match(/^#{1,6}\s+(.+)$/m);
  return m ? m[1].trim() : null;
}

function htmlTitle(html: string): string | null {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (title) return stripHtml(title[1]);
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  return h1 ? stripHtml(h1[1]) : null;
}

/** Filename without extension, for a fallback title. */
function baseName(path: string): string {
  const file = idFromPath(path).split('/').pop() ?? path;
  return file.replace(/\.[^.]+$/, '');
}

function coerceDoc(value: unknown, fallbackId: string): RawDoc | null {
  if (!value || typeof value !== 'object') return null;
  const o = value as Record<string, unknown>;
  const text = typeof o.text === 'string' ? o.text : '';
  if (!text.trim()) return null;
  const id = typeof o.id === 'string' && o.id ? o.id : fallbackId;
  const title = typeof o.title === 'string' && o.title ? o.title : id;
  const doc: RawDoc = { id, title, text };
  if (typeof o.url === 'string') doc.url = o.url;
  if (o.meta && typeof o.meta === 'object') doc.meta = o.meta as Record<string, string>;
  return doc;
}

export interface SourceFile {
  path: string;
  content: string;
}

/** Parse one source file into one or more {@link RawDoc}s. */
export function parseDocFile(file: SourceFile): RawDoc[] {
  const ext = (file.path.match(/\.([^.]+)$/)?.[1] ?? '').toLowerCase();
  const id = idFromPath(file.path);

  if (ext === 'json') {
    let parsed: unknown;
    try {
      parsed = JSON.parse(file.content);
    } catch {
      return [];
    }
    const arr: unknown[] = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { docs?: unknown[] }).docs)
        ? (parsed as { docs: unknown[] }).docs
        : [parsed];
    return arr.map((v, i) => coerceDoc(v, `${id}#${i}`)).filter((d): d is RawDoc => d !== null);
  }

  if (ext === 'html' || ext === 'htm') {
    const text = stripHtml(file.content);
    if (!text) return [];
    return [{ id, title: htmlTitle(file.content) ?? baseName(file.path), text }];
  }

  // Markdown / text.
  const isMarkdown = ext === 'md' || ext === 'markdown';
  if (isMarkdown) {
    const fm = parseFrontmatter(file.content);
    if (fm) {
      const doc = frontmatterToDoc(fm);
      const body = stripMarkdown(doc.body);
      const text = [doc.lead, body].filter(Boolean).join('\n\n').trim();
      if (!text) return [];
      const raw: RawDoc = {
        id,
        title: doc.title ?? firstMarkdownHeading(doc.body) ?? baseName(file.path),
        text,
      };
      if (doc.url) raw.url = doc.url;
      if (doc.boostTerms.length) raw.boostTerms = doc.boostTerms;
      if (Object.keys(doc.meta).length) raw.meta = doc.meta;
      return [raw];
    }
  }

  const text = isMarkdown ? stripMarkdown(file.content) : file.content.trim();
  if (!text) return [];
  const title = (isMarkdown ? firstMarkdownHeading(file.content) : null) ?? baseName(file.path);
  return [{ id, title, text }];
}

/** File extensions the ingest CLI will read. */
export const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt', '.html', '.htm', '.json'];
