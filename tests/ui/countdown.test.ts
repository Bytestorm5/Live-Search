import { describe, it, expect } from 'vitest';
import { CountdownController } from '../../src/ui/countdown.ts';

describe('CountdownController', () => {
  it('counts down across ticks and reports fraction', () => {
    const c = new CountdownController(1000);
    expect(c.tick(0)).toBe(1); // first tick establishes baseline
    expect(c.tick(250)).toBeCloseTo(0.75, 6);
    expect(c.tick(1000)).toBe(0);
    expect(c.done).toBe(true);
  });

  it('pauses (e.g. on mouseover) and resumes', () => {
    const c = new CountdownController(1000);
    c.tick(0);
    c.tick(200); // remaining 800
    c.pause();
    c.tick(5000); // paused -> no change
    expect(c.fraction).toBeCloseTo(0.8, 6);
    c.resume();
    c.tick(5200); // 200 ms more -> remaining 600
    expect(c.fraction).toBeCloseTo(0.6, 6);
    expect(c.isPaused).toBe(false);
  });

  it('never goes negative', () => {
    const c = new CountdownController(500);
    c.tick(0);
    expect(c.tick(10_000)).toBe(0);
    expect(c.remainingMs).toBe(0);
  });
});
