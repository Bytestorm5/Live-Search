/**
 * Rolling transcript window (architecture spec §3 "short rolling transcript
 * window", §5.5, §6).
 *
 * The pipeline is stateless between utterances except for this bounded window of
 * recent committed text, which is embedded as the semantic query so retrieval
 * has topical context beyond the latest phrase. It is capped by character count
 * so memory and embedding cost stay bounded on a continuously open mic.
 */
export class RollingTranscript {
  private parts: string[] = [];
  private _length = 0;

  constructor(private readonly maxChars: number) {}

  /** Append a committed utterance, evicting the oldest text past the cap. */
  append(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.parts.push(trimmed);
    this._length += trimmed.length + 1; // +1 for the joining space
    while (this._length > this.maxChars && this.parts.length > 1) {
      const removed = this.parts.shift()!;
      this._length -= removed.length + 1;
    }
  }

  /** The current window text (space-joined). */
  get window(): string {
    return this.parts.join(' ');
  }

  /** Approximate character length of the window. */
  get length(): number {
    return this.window.length;
  }

  clear(): void {
    this.parts = [];
    this._length = 0;
  }
}
