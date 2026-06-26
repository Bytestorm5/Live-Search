import { describe, it, expect } from 'vitest';
import { parseFrontmatter, frontmatterToDoc } from '../../src/ingest/frontmatter.ts';
import { parseDocFile } from '../../src/ingest/loadDocs.ts';

const SAMPLE = `---
name: "Armored Coat"
category: "armor"
type: "Item"
rarity: "uncommon"
summary: "A custom, lightweight mail fitted within a coat."
trait: ["Comfort", "Flexible", "Uncommon"]
source: ["Knights of Lastwall"]
url: "https://2e.aonprd.com/Armor.aspx?ID=16"
---

# Armored Coat

This armor hides within clothing.
`;

describe('parseFrontmatter', () => {
  it('parses quoted scalars and JSON arrays', () => {
    const fm = parseFrontmatter(SAMPLE)!;
    expect(fm.fields.name).toBe('Armored Coat');
    expect(fm.fields.trait).toEqual(['Comfort', 'Flexible', 'Uncommon']);
    expect(fm.fields.url).toBe('https://2e.aonprd.com/Armor.aspx?ID=16');
    expect(fm.body).toContain('This armor hides within clothing.');
    expect(fm.body).not.toContain('name:');
  });

  it('returns null when there is no frontmatter', () => {
    expect(parseFrontmatter('# Just markdown')).toBeNull();
  });
});

describe('frontmatterToDoc', () => {
  it('derives title, url, lead, boost terms, and meta', () => {
    const doc = frontmatterToDoc(parseFrontmatter(SAMPLE)!);
    expect(doc.title).toBe('Armored Coat');
    expect(doc.url).toBe('https://2e.aonprd.com/Armor.aspx?ID=16');
    expect(doc.lead).toContain('lightweight mail');
    // Proper-noun fields become boost terms (name + traits + category + type).
    expect(doc.boostTerms).toContain('Armored Coat');
    expect(doc.boostTerms).toContain('Comfort');
    expect(doc.boostTerms).toContain('armor');
    expect(doc.meta.source).toBe('Knights of Lastwall');
  });
});

describe('parseDocFile with frontmatter', () => {
  it('produces a RawDoc using the name as title and url for the link', () => {
    const [doc] = parseDocFile({ path: 'items/armored-coat.md', content: SAMPLE });
    expect(doc.title).toBe('Armored Coat');
    expect(doc.url).toBe('https://2e.aonprd.com/Armor.aspx?ID=16');
    expect(doc.boostTerms).toContain('Armored Coat');
    expect(doc.text).toContain('lightweight mail'); // summary is indexed
    expect(doc.text).toContain('hides within clothing');
  });
});
