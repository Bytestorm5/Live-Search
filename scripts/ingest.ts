/**
 * Documentation ingest CLI (architecture spec §5.4, §5.5).
 *
 *   npm run ingest [-- <docs-dir>] [--out <file>]
 *
 * Reads Markdown / text / HTML / JSON docs from <docs-dir> (default
 * `docs-corpus/`), chunks them, builds the BM25 index and the known vocabulary,
 * and STREAM-WRITES `public/corpus.index.ndjson` (one JSON record per line) so
 * arbitrarily large corpora never overflow the JS engine's max string length.
 */
import { createWriteStream } from 'node:fs';
import { readdir, readFile, mkdir } from 'node:fs/promises';
import { once } from 'node:events';
import { join, dirname } from 'node:path';
import { buildIndex } from '../src/retrieval/ingest.ts';
import { encodeIndexLines } from '../src/retrieval/indexFormat.ts';
import { parseDocFile, SUPPORTED_EXTENSIONS } from '../src/ingest/loadDocs.ts';
import { makeConfig } from '../src/config.ts';
import type { CorpusIndex, RawDoc } from '../src/retrieval/types.ts';

function parseArgs(argv: string[]): { dir: string; out: string } {
  let dir = 'docs-corpus';
  let out = 'public/corpus.index.ndjson';
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') out = argv[++i];
    else if (!a.startsWith('--')) dir = a;
  }
  return { dir, out };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (SUPPORTED_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) out.push(full);
  }
  return out;
}

/** Stream the index to disk one ~1 MB buffer at a time (never a giant string). */
async function writeIndex(out: string, index: CorpusIndex): Promise<number> {
  await mkdir(dirname(out), { recursive: true });
  const stream = createWriteStream(out);
  let pending = '';
  let bytes = 0;
  const flush = async () => {
    if (!pending) return;
    bytes += Buffer.byteLength(pending);
    if (!stream.write(pending)) await once(stream, 'drain');
    pending = '';
  };
  for (const line of encodeIndexLines(index)) {
    pending += line + '\n';
    if (pending.length >= 1 << 20) await flush();
  }
  await flush();
  stream.end();
  await once(stream, 'finish');
  return bytes;
}

async function main(): Promise<void> {
  const { dir, out } = parseArgs(process.argv.slice(2));
  const files = await walk(dir);
  if (files.length === 0) {
    console.error(`No supported documents found in "${dir}/". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}`);
    process.exit(1);
  }

  const docs: RawDoc[] = [];
  for (const path of files.sort()) {
    const content = await readFile(path, 'utf8');
    docs.push(...parseDocFile({ path, content }));
  }
  console.log(`Loaded ${docs.length} document(s) from ${files.length} file(s) in "${dir}/".`);

  const config = makeConfig();
  const index = buildIndex(docs, config);
  console.log(`Built index: ${index.chunks.length} chunks, ${index.vocabulary.entries.length} vocabulary terms.`);

  const bytes = await writeIndex(out, index);
  console.log(`Wrote ${out} (${(bytes / (1024 * 1024)).toFixed(1)} MiB, streamed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
