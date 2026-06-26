import { describe, it, expect, vi } from 'vitest';
import {
  GmAgent,
  buildClassifierMessages,
  parseClassification,
  buildAnswererMessages,
} from '../../src/agent/gmAgent.ts';
import type { ChatFn } from '../../src/agent/openaiChat.ts';

describe('parseClassification', () => {
  it('parses valid kinds and topic', () => {
    expect(parseClassification('{"kind":"question","topic":"flat-footed"}')).toEqual({ kind: 'question', topic: 'flat-footed' });
    expect(parseClassification('{"kind":"none","topic":""}')).toEqual({ kind: 'none' });
  });
  it('extracts JSON from fenced/prefixed output', () => {
    expect(parseClassification('Sure!\n```json\n{"kind":"checking"}\n```')).toEqual({ kind: 'checking' });
  });
  it('falls back to none on garbage', () => {
    expect(parseClassification('not json at all')).toEqual({ kind: 'none' });
    expect(parseClassification('{"kind":"banana"}')).toEqual({ kind: 'none' });
  });
});

describe('prompt builders', () => {
  it('classifier prompt mentions PF2e and the three kinds', () => {
    const [system, user] = buildClassifierMessages('Can I sneak attack?', 'context here');
    expect(system.content).toMatch(/Pathfinder 2e/);
    expect(system.content).toMatch(/none/);
    expect(system.content).toMatch(/checking/);
    expect(system.content).toMatch(/question/);
    expect(user.content).toContain('Can I sneak attack?');
    expect(user.content).toContain('context here');
  });
  it('answerer prompt includes reference excerpts and the utterance', () => {
    const [, user] = buildAnswererMessages('How does flanking work?', 'question', [{ title: 'Flanking', url: 'https://x', text: 'When you and an ally...' }], '');
    expect(user.content).toContain('Flanking');
    expect(user.content).toContain('https://x');
    expect(user.content).toContain('When you and an ally');
    expect(user.content).toContain('How does flanking work?');
  });
});

describe('GmAgent.handle', () => {
  it('returns null for "none" without calling the answerer', async () => {
    const chat = vi.fn<ChatFn>().mockResolvedValueOnce('{"kind":"none"}');
    const agent = new GmAgent({ apiKey: 'k', classifierModel: 'c', answererModel: 'a', chat });
    const result = await agent.handle('nice weather', '', []);
    expect(result).toBeNull();
    expect(chat).toHaveBeenCalledTimes(1); // classifier only
  });

  it('classifies then answers a question, attaching sources', async () => {
    const chat = vi
      .fn<ChatFn>()
      .mockResolvedValueOnce('{"kind":"question","topic":"armor"}')
      .mockResolvedValueOnce('The Armored Coat hides light mail.');
    const agent = new GmAgent({ apiKey: 'k', classifierModel: 'c', answererModel: 'a', chat });
    const result = await agent.handle('What is the Armored Coat?', 'ctx', [
      { title: 'Armored Coat', url: 'https://2e.aonprd.com/Armor.aspx?ID=16', text: 'A coat...' },
    ]);
    expect(result).not.toBeNull();
    expect(result!.kind).toBe('question');
    expect(result!.answer).toContain('Armored Coat');
    expect(result!.sources[0]).toEqual({ title: 'Armored Coat', url: 'https://2e.aonprd.com/Armor.aspx?ID=16' });
    expect(chat).toHaveBeenCalledTimes(2);
    // The classifier requested JSON; the answerer did not.
    expect(chat.mock.calls[0][0].responseFormat).toEqual({ type: 'json_object' });
    expect(chat.mock.calls[1][0].responseFormat).toBeUndefined();
  });
});
