/**
 * Time-injected countdown for the agent modal's auto-close. The modal shows a
 * progress bar for the remaining time; the countdown PAUSES while the pointer is
 * over the modal (so a reader isn't rushed). Pure and unit-tested — `tick(now)`
 * is driven by requestAnimationFrame in the UI.
 */
export class CountdownController {
  private remaining: number;
  private last: number | null = null;
  private paused = false;

  constructor(private readonly totalMs: number) {
    this.remaining = totalMs;
  }

  /** Advance using the wall-clock `nowMs`; returns the fraction of time left. */
  tick(nowMs: number): number {
    if (this.last === null) this.last = nowMs;
    const elapsed = nowMs - this.last;
    this.last = nowMs;
    if (!this.paused && elapsed > 0) {
      this.remaining = Math.max(0, this.remaining - elapsed);
    }
    return this.fraction;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  /** Remaining fraction in [0, 1]. */
  get fraction(): number {
    return this.totalMs > 0 ? this.remaining / this.totalMs : 0;
  }

  get remainingMs(): number {
    return this.remaining;
  }

  get done(): boolean {
    return this.remaining <= 0;
  }

  get isPaused(): boolean {
    return this.paused;
  }
}
