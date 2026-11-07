/**
 * Fixed-window, in-memory rate limiter. Per instance: good enough to stop bursts;
 * the daily per-user quota in the database is the hard limit.
 */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();

  constructor(private windowMs = 60_000) {}

  /** Returns true when the call is allowed. */
  allow(key: string, max: number, now = Date.now()): boolean {
    const entry = this.hits.get(key);
    if (!entry || entry.reset <= now) {
      this.hits.set(key, { count: 1, reset: now + this.windowMs });
      if (this.hits.size > 20_000) this.sweep(now);
      return true;
    }
    entry.count++;
    return entry.count <= max;
  }

  private sweep(now: number) {
    for (const [k, v] of this.hits) if (v.reset <= now) this.hits.delete(k);
  }
}
