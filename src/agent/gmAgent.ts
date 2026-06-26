/**
 * Pathfinder 2e GM assistant agent.
 *
 * Runs on each committed sentence (server-transcribed) in two stages:
 *  1. a light classifier decides whether a response is warranted, and the kind:
 *       - 'none'     : miscellaneous talk → no response
 *       - 'checking' : a statement about a relevant PF2e topic → confirm/augment
 *       - 'question' : the speaker is asking / confused → answer
 *  2. if warranted, an answerer responds using the documents already retrieved
 *     for that sentence as grounding context.
 *
 * Prompt construction and parsing are pure/testable; the chat call is injectable.
 */
import type { ChatFn, ChatMessage } from './openaiChat.ts';
import { chatCompletion, extractJsonObject } from './openaiChat.ts';

export type UtteranceKind = 'none' | 'checking' | 'question';

export interface Classification {
  kind: UtteranceKind;
  topic?: string;
}

export interface DocContext {
  title: string;
  url?: string;
  text: string;
}

export interface GmAgentResult {
  kind: Exclude<UtteranceKind, 'none'>;
  utterance: string;
  answer: string;
  sources: Array<{ title: string; url?: string }>;
}

// --- prompt builders (pure) ---

export function buildClassifierMessages(text: string, context: string): ChatMessage[] {
  const system =
    'You classify a single spoken utterance from a live Pathfinder 2e (PF2e) tabletop session ' +
    'to decide whether a GM rules-assistant should respond. Choose exactly one kind:\n' +
    '- "none": small talk, off-topic chatter, or anything that needs no PF2e rules/lore response.\n' +
    '- "checking": a statement about a PF2e rule, monster, item, spell, or mechanic that is worth confirming or augmenting.\n' +
    '- "question": the speaker asks something, is uncertain, or expresses confusion about PF2e.\n' +
    'Respond with ONLY a JSON object: {"kind":"none|checking|question","topic":"<=6 word topic or empty"}.';
  const user = `${context ? `Recent context: ${context}\n\n` : ''}Utterance: "${text}"`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

export function parseClassification(raw: string): Classification {
  const obj = extractJsonObject(raw);
  const kind = obj?.kind;
  if (kind === 'checking' || kind === 'question' || kind === 'none') {
    const topic = typeof obj?.topic === 'string' ? obj.topic.trim() : '';
    return topic ? { kind, topic } : { kind };
  }
  return { kind: 'none' };
}

export function buildAnswererMessages(
  text: string,
  kind: Exclude<UtteranceKind, 'none'>,
  docs: DocContext[],
  context: string,
): ChatMessage[] {
  const system =
    "You are a concise, knowledgeable Pathfinder 2e (PF2e) game master's assistant. " +
    'Answer the question or clarify the rule/lore under discussion using the reference excerpts when relevant. ' +
    'Be brief (2–5 sentences), name the specific rule/item/spell, and prefer the references over memory. ' +
    "If the references don't cover it or you're unsure, say so briefly rather than inventing rules.";
  const refs = docs.length
    ? 'Reference excerpts:\n' +
      docs.map((d, i) => `[${i + 1}] ${d.title}${d.url ? ` (${d.url})` : ''}\n${d.text}`).join('\n\n')
    : 'No reference excerpts were retrieved.';
  const ask =
    kind === 'question'
      ? `The player asked: "${text}"`
      : `The player stated: "${text}" — confirm or augment this with correct PF2e rules.`;
  const user = `${refs}\n\n${context ? `Recent context: ${context}\n\n` : ''}${ask}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// --- agent ---

export interface GmAgentOptions {
  apiKey: string;
  classifierModel: string;
  answererModel: string;
  /** Injectable chat function (defaults to the real OpenAI client). */
  chat?: ChatFn;
}

export class GmAgent {
  private readonly chat: ChatFn;

  constructor(private readonly opts: GmAgentOptions) {
    this.chat = opts.chat ?? chatCompletion;
  }

  /**
   * Classify the utterance and, if warranted, answer it using `docs` as context.
   * Returns null when no response is needed. `signal` aborts in-flight calls.
   */
  async handle(
    text: string,
    context: string,
    docs: DocContext[],
    signal?: AbortSignal,
  ): Promise<GmAgentResult | null> {
    const classRaw = await this.chat({
      apiKey: this.opts.apiKey,
      model: this.opts.classifierModel,
      messages: buildClassifierMessages(text, context),
      responseFormat: { type: 'json_object' },
      ...(signal ? { signal } : {}),
    });
    const classification = parseClassification(classRaw);
    if (classification.kind === 'none') return null;

    const answer = await this.chat({
      apiKey: this.opts.apiKey,
      model: this.opts.answererModel,
      messages: buildAnswererMessages(text, classification.kind, docs, context),
      ...(signal ? { signal } : {}),
    });
    if (!answer.trim()) return null;

    return {
      kind: classification.kind,
      utterance: text,
      answer: answer.trim(),
      sources: docs.map((d) => (d.url ? { title: d.title, url: d.url } : { title: d.title })),
    };
  }
}
