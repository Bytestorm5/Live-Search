# Retrieval and Vocabulary Correction

Before querying, candidate terms are extracted from each committed utterance and
fuzzy-matched against the documentation's known vocabulary using edit distance
and phonetic similarity. A mistranscribed term close to a known doc term is
corrected to it. Correction is constrained to terms that exist in the corpus, so
the retrieval trigger tolerates ASR errors without inventing spurious matches.
The verbatim transcript shown to the operator stays uncorrected.

Retrieval is hybrid. A lexical BM25 inverted index gives precision on exact
domain terms such as a specific API name. A semantic vector index embeds chunks
with a MiniLM-class sentence encoder (~25 MB) and compares them by cosine
similarity, catching topic matches when the exact term was not spoken. The two
result lists are merged with reciprocal rank fusion into a single ranking.

The documentation corpus is loaded locally and chunked at build time. No query
ever leaves the device. Results are de-duplicated against what is already on
screen, then the top k are shown with matched snippets and relevance scores.
