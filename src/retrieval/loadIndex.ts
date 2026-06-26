/**
 * Browser-side streaming loader for the NDJSON corpus index. Reads the fetch
 * response body as a stream and parses it line-by-line so a multi-hundred-MB
 * index never has to exist as a single string (which would exceed the JS engine
 * max string length). Returns null if there is no usable index (missing file or
 * a static host's HTML SPA fallback).
 */
import { IndexAssembler, splitLines } from './indexFormat.ts';
import type { CorpusIndex } from './types.ts';

export interface LoadProgress {
  bytes: number;
  lines: number;
}

export async function loadCorpusIndex(
  url: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<CorpusIndex | null> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    return null;
  }
  if (!res.ok || !res.body) return null;

  // Reject an HTML SPA fallback up front so we don't try to JSON-parse markup.
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const assembler = new IndexAssembler();
  let buffer = '';
  let bytes = 0;
  let lineCount = 0;
  let firstLineChecked = false;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });

      const [lines, remainder] = splitLines(buffer);
      buffer = remainder;
      for (const line of lines) {
        if (!line) continue;
        if (!firstLineChecked) {
          firstLineChecked = true;
          // The first non-empty line must be our manifest, not e.g. "<!doctype html>".
          if (!line.trimStart().startsWith('{')) return null;
        }
        assembler.addLine(line);
        lineCount++;
      }
      onProgress?.({ bytes, lines: lineCount });
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      assembler.addLine(buffer);
      lineCount++;
    }
    onProgress?.({ bytes, lines: lineCount });
    return assembler.finish();
  } catch {
    return null;
  }
}
