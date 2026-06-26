import { describe, it, expect, vi } from 'vitest';
import { buildChatBody, parseChatContent, extractJsonObject, chatCompletion } from '../../src/agent/openaiChat.ts';

describe('buildChatBody', () => {
  it('includes response_format only when given', () => {
    expect(buildChatBody('m', [{ role: 'user', content: 'hi' }])).toEqual({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(buildChatBody('m', [], { type: 'json_object' }).response_format).toEqual({ type: 'json_object' });
  });
});

describe('parseChatContent', () => {
  it('reads choices[0].message.content', () => {
    expect(parseChatContent({ choices: [{ message: { content: 'hello' } }] })).toBe('hello');
    expect(parseChatContent({})).toBe('');
  });
});

describe('extractJsonObject', () => {
  it('parses direct and embedded JSON', () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(extractJsonObject('prefix {"a":1} suffix')).toEqual({ a: 1 });
    expect(extractJsonObject('nope')).toBeNull();
  });
});

describe('chatCompletion', () => {
  it('POSTs with auth and returns content', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { status: 200 }));
    const out = await chatCompletion({ apiKey: 'sk', model: 'm', messages: [{ role: 'user', content: 'hi' }], fetchImpl });
    expect(out).toBe('ok');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer sk');
  });

  it('throws the API error message on non-2xx', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'bad model' } }), { status: 400 }));
    await expect(chatCompletion({ apiKey: 'sk', model: 'm', messages: [], fetchImpl })).rejects.toThrow('bad model');
  });
});
