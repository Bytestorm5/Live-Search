/**
 * A list of common English words used as a rarity signal (architecture spec
 * §5.4). A capitalized token is only treated as a salient proper noun if it is
 * NOT a common word — so "Wonderful" at the start of a sentence is not mistaken
 * for a domain term, while "Bralani" (not common) is. This complements
 * corpus-frequency rarity: corpus frequency catches words common *in this
 * corpus*; this list catches words common *in English* regardless of corpus.
 *
 * Deliberately broad (frequent verbs, adjectives, adverbs, and generic nouns) —
 * over-inclusion only costs a missed proper noun, which BM25/IDF still handles.
 */
const WORDS = `
about above across after again against all almost also always among another any
anyone anything are around back bad because been before being below best better
big both bring came can cannot come comes coming could course did different does
doing done down during each early either else enough even ever every everyone
everything example far few find first found from full further get gets getting give
given goes going gone good got great group had half hand happen happens hard has
have having help her here high him himself his how however huge important interesting
into its itself just keep kept kind knew know known large last later least left less
let life like likely little long look looking looks lot made make makes making many
may maybe mean means might more most much must myself near need needs never new next
nice nothing now number off often old once one only onto open or other others our out
over own part people perhaps place point possible put quite rather real really right
said same say says see seem seems seen several she should show shows side simple since
small some someone something sometimes soon sort still such sure take takes taking tell
than that the their them then there these they thing things think this those though
three through thus time times together too took toward two under until upon use used
uses using usually very want wants was way ways well went were what whatever when where
whether which while who whole whom whose why will with within without won't would yes yet
you your yourself
wonderful great amazing awesome beautiful incredible excellent fantastic terrible
horrible awful nice cool fine okay bad good better best worst huge tiny large small
little big tall short long wide narrow heavy light fast slow quick easy hard simple
difficult strong weak old new young fresh clean dirty bright dark loud quiet warm cold
hot cool dry wet soft hard smooth rough sharp dull full empty rich poor cheap expensive
common rare normal strange weird odd usual special general specific true false correct
wrong real fake actual main major minor important useful useless helpful harmful safe
dangerous happy sad angry scared tired bored excited interested curious lovely pretty
ugly handsome gorgeous stunning shiny sturdy
`;

export const COMMON_WORDS: ReadonlySet<string> = new Set(
  WORDS.split(/\s+/).map((w) => w.trim().toLowerCase()).filter(Boolean),
);

/** True if `lowerToken` is a common English word (not a distinctive term). */
export function isCommonWord(lowerToken: string): boolean {
  return COMMON_WORDS.has(lowerToken);
}
