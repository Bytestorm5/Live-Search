# Retrieval and Vocabulary Correction

Before querying, candidate terms are extracted from each committed utterance and
fuzzy-matched against the documentation's known vocabulary using edit distance and
phonetic similarity. A mistranscribed term close to a known doc term is corrected
to it.

Retrieval is hybrid: a lexical BM25 inverted index gives precision on exact terms,
and an optional semantic vector index (MiniLM) catches paraphrased topics. The two
lists are merged with reciprocal rank fusion.
