import { describe, it, expect } from 'vitest';
import { extractCandidateTerms } from '../../src/terms/extract.ts';
import { buildIndex } from '../../src/retrieval/ingest.ts';
import { RetrievalEngine } from '../../src/retrieval/engine.ts';
import { makeConfig } from '../../src/config.ts';
import type { RawDoc } from '../../src/retrieval/types.ts';

describe('rarity-aware term extraction', () => {
  it('treats a capitalized common word as NOT salient, but a rare one as salient', () => {
    const isCommon = (w: string) => w === 'wonderful';
    // "Wonderful" is common -> not a proper noun; it's also a stopword-free
    // content word so it still appears, but "Bralani" (rare) is salient.
    const terms = extractCandidateTerms('Wonderful Bralani azata', { isCommon, includeBigrams: false });
    expect(terms).toContain('Bralani');
    // A SHORT capitalized common word would be dropped entirely (not salient, too short).
    const short = extractCandidateTerms('Ka', { isCommon: () => true, includeBigrams: false });
    expect(short).toEqual([]);
  });
});

describe('proper-noun boosting + rarity vocabulary', () => {
  const docs: RawDoc[] = [
    {
      id: 'armored-coat',
      title: 'Armored Coat',
      text: 'A wonderful lightweight mail hidden in a coat.',
      url: 'https://x/armor/16',
      boostTerms: ['Armored Coat', 'Comfort', 'Flexible'],
    },
    { id: 'a', title: 'A', text: 'A wonderful sword that is wonderful and shiny.' },
    { id: 'b', title: 'B', text: 'A wonderful shield, truly wonderful and sturdy.' },
  ];
  const config = makeConfig({ retrieval: { chunkSizeTokens: 60, chunkOverlapTokens: 10 } });

  it('ranks the doc whose proper-noun name matches first', async () => {
    const engine = new RetrievalEngine({ index: buildIndex(docs, config), config });
    const { correctedTerms } = engine.candidateTerms('Tell me about the Armored Coat');
    const hits = await engine.query({ terms: correctedTerms, transcriptWindow: '', k: 3 });
    expect(hits[0].chunk.docId).toBe('armored-coat');
  });

  it('keeps proper nouns in the vocabulary but drops over-common words', () => {
    const idx = buildIndex(docs, config);
    const norms = new Set(idx.vocabulary.entries.map((e) => e.normalized));
    expect(norms.has('comfort')).toBe(true); // boost term retained
    expect(norms.has('armored coat')).toBe(true); // boost phrase retained
    // "wonderful" appears in all 3 docs (100% > 15%) -> filtered from vocab.
    expect(norms.has('wonderful')).toBe(false);
  });
});
