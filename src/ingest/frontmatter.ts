/**
 * Parse YAML-style frontmatter from documents (architecture spec §5.4 — domain
 * vocabulary). Many corpora (e.g. Pathfinder 2e item pages) lead with a block
 * like:
 *
 *   ---
 *   name: "Armored Coat"
 *   trait: ["Comfort", "Flexible"]
 *   url: "https://..."
 *   summary: "..."
 *   ---
 *
 * We extract the structured fields, use them for the title/url/summary, and
 * surface the "proper noun" fields (name, traits, category, type, ...) as
 * high-weight boost terms for retrieval.
 */

export interface Frontmatter {
  fields: Record<string, string | string[]>;
  body: string;
}

/** Parse a leading `--- ... ---` block. Returns null if there isn't one. */
export function parseFrontmatter(content: string): Frontmatter | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/);
  if (!m) return null;
  const block = m[1];
  const body = m[2];
  const fields: Record<string, string | string[]> = {};

  for (const raw of block.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const kv = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1];
    const value = kv[2].trim();
    if (value.startsWith('[')) {
      try {
        const arr = JSON.parse(value) as unknown[];
        if (Array.isArray(arr)) {
          fields[key] = arr.map((v) => String(v));
          continue;
        }
      } catch {
        // fall through to string handling
      }
    }
    fields[key] = stripQuotes(value);
  }
  return { fields, body };
}

function stripQuotes(s: string): string {
  return s.replace(/^["']/, '').replace(/["']$/, '');
}

/** Fields treated as proper nouns / strong domain terms, weighted in retrieval. */
const BOOST_FIELDS = ['name', 'title', 'trait', 'traits', 'category', 'type', 'subcategory', 'school', 'tradition'];

export interface FrontmatterDoc {
  title?: string;
  url?: string;
  /** Text to prepend to the body for indexing (e.g. the summary). */
  lead: string;
  boostTerms: string[];
  meta: Record<string, string>;
  body: string;
}

/** Derive title/url/lead/boost terms/meta from a parsed frontmatter block. */
export function frontmatterToDoc(fm: Frontmatter): FrontmatterDoc {
  const get = (k: string): string | undefined => {
    const v = fm.fields[k];
    if (Array.isArray(v)) return v.join(', ');
    return v;
  };

  const boostTerms: string[] = [];
  for (const field of BOOST_FIELDS) {
    const v = fm.fields[field];
    if (Array.isArray(v)) boostTerms.push(...v);
    else if (typeof v === 'string' && v) boostTerms.push(v);
  }

  const meta: Record<string, string> = {};
  for (const [k, v] of Object.entries(fm.fields)) meta[k] = Array.isArray(v) ? v.join(', ') : v;

  const summary = get('summary') ?? get('description') ?? '';

  const result: FrontmatterDoc = {
    lead: summary,
    boostTerms: dedupe(boostTerms.filter(Boolean)),
    meta,
    body: fm.body,
  };
  const title = get('name') ?? get('title');
  if (title) result.title = title;
  const url = get('url');
  if (url) result.url = url;
  return result;
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}
