import { systemClock, type Clock } from "../../types/context.js";

/**
 * In-memory sliding-window rate limiter.
 *
 * Protects the chat from abuse and caps Claude API spend. State is per
 * server instance: with several instances behind a load balancer the
 * effective limit multiplies, so a shared store (e.g. Redis) is needed
 * before scaling out — see docs/website-chat.md.
 */

export interface RateRule {
  name: string;
  limit: number;
  windowMs: number;
}

export interface RateDecision {
  allowed: boolean;
  /** Which rule refused the request. */
  rule: string | null;
  retryAfterSeconds: number;
}

export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock = systemClock,
    private readonly maxKeys = 50_000,
  ) {}

  /**
   * Checks every (rule, key) pair; records a hit only if all allow it, so a
   * refused request does not consume quota.
   */
  check(entries: { rule: RateRule; key: string }[]): RateDecision {
    const now = this.clock().getTime();
    for (const { rule, key } of entries) {
      const recent = this.recent(`${rule.name}:${key}`, rule.windowMs, now);
      if (recent.length >= rule.limit) {
        const retryAfterMs = recent[0]! + rule.windowMs - now;
        return { allowed: false, rule: rule.name, retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)) };
      }
    }
    for (const { rule, key } of entries) {
      const id = `${rule.name}:${key}`;
      this.hits.set(id, [...this.recent(id, rule.windowMs, now), now]);
    }
    this.evictIfNeeded();
    return { allowed: true, rule: null, retryAfterSeconds: 0 };
  }

  private recent(id: string, windowMs: number, now: number): number[] {
    return (this.hits.get(id) ?? []).filter((t) => now - t < windowMs);
  }

  private evictIfNeeded() {
    if (this.hits.size <= this.maxKeys) return;
    // Drop the oldest keys (Map preserves insertion order).
    for (const key of [...this.hits.keys()].slice(0, this.hits.size - this.maxKeys)) this.hits.delete(key);
  }
}
