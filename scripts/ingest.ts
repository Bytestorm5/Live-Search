/**
 * Documentation ingest CLI (architecture spec §5.4, §5.5).
 *
 *   npm run ingest [-- <docs-dir>] [--embed] [--out <file>]
 *
 * Reads Markdown / text / HTML / JSON docs from <docs-dir> (default
 * `docs-corpus/`), chunks them, builds the BM25 index and the known vocabulary,
 * and writes `public/corpus.index.json` for the app to load. With `--embed` it
 * also precomputes MiniLM embeddings (downloads the model the first time);
 * otherwise embeddings are computed in-browser at load.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { buildIndex, withEmbeddings } from '../src/retrieval/ingest.ts';
import { embedChunks } from '../src/retrieval/embedding.ts';
import { parseDocFile, SUPPORTED_EXTENSIONS } from '../src/ingest/loadDocs.ts';
import { makeConfig } from '../src/config.ts';
import type { RawDoc } from '../src/retrieval/types.ts';

function parseArgs(argv: string[]): { dir: string; out: string; embed: boolean } {
  let dir = 'docs-corpus';
  let out = 'public/corpus.index.json';
  let embed = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--embed') embed = true;
    else if (a === '--out') out = argv[++i];
    else if (!a.startsWith('--')) dir = a;
  }
  return { dir, out, embed };
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

async function main(): Promise<void> {
  const { dir, out, embed } = parseArgs(process.argv.slice(2));
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
  let index = buildIndex(docs, config);
  console.log(`Built index: ${index.chunks.length} chunks, ${index.vocabulary.entries.length} vocabulary terms.`);

  if (embed) {
    console.log('Embedding chunks with MiniLM (first run downloads the model)…');
    const { MiniLmEmbedder } = await import('../src/retrieval/minilmEmbedder.ts');
    const model = new MiniLmEmbedder('wasm');
    await model.load();
    const embeddings = await embedChunks(index.chunks, model);
    index = withEmbeddings(index, embeddings);
    console.log(`Embedded ${embeddings.vectors.length} chunks (dim ${embeddings.dim}).`);
  }

  await mkdir(dirname(out), { recursive: true });
  const json = JSON.stringify(index);
  await writeFile(out, json);
  console.log(`Wrote ${out} (${(json.length / 1024).toFixed(1)} KiB)${embed ? ' with embeddings' : ''}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
