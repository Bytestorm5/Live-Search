/**
 * Minimal OpenAI Chat Completions client for the GM assistant. Uses the user's
 * API key directly from the browser (same key as the realtime transcription; CSP
 * already allows api.openai.com). Request building and response parsing are pure
 * so they can be unit-tested; the fetch wrapper is injectable.
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatOptions {
  apiKey: string;
  model: string;
  messages: ChatMessage[];
  /** e.g. { type: 'json_object' } to request JSON (used by the classifier). */
  responseFormat?: { type: string };
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  baseUrl?: string;
}

export type ChatFn = (opts: ChatOptions) => Promise<string>;

const DEFAULT_BASE = 'https://api.openai.com';

/** Build the request body (kept minimal for broad model compatibility). */
export function buildChatBody(
  model: string,
  messages: ChatMessage[],
  responseFormat?: { type: string },
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages };
  if (responseFormat) body.response_format = responseFormat;
  return body;
}

/** Extract the assistant message text from a chat completion response. */
export function parseChatContent(json: unknown): string {
  const choice = (json as { choices?: Array<{ message?: { content?: string } }> })?.choices?.[0];
  return choice?.message?.content ?? '';
}

export async function chatCompletion(opts: ChatOptions): Promise<string> {
  const doFetch = opts.fetchImpl ?? fetch;
  const res = await doFetch(`${opts.baseUrl ?? DEFAULT_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildChatBody(opts.model, opts.messages, opts.responseFormat)),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  if (!res.ok) {
    let message = `OpenAI chat error: HTTP ${res.status}`;
    try {
      const err = (await res.json()) as { error?: { message?: string } };
      if (err?.error?.message) message = err.error.message;
    } catch {
      // keep the HTTP status message
    }
    throw new Error(message);
  }
  const json = await res.json();
  return parseChatContent(json);
}

/** Best-effort extraction of a JSON object from model output (may be fenced/prefixed). */
export function extractJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
      } catch {
        return null;
      }
    }
    return null;
  }
}
