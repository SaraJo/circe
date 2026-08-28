export type ContextPressureLevel = 'normal' | 'warning' | 'critical';

export interface ContextPressure {
  size: number;
  used: number;
  softLimit: number;
  hardLimit: number;
  level: ContextPressureLevel;
  /** Fill against the cost guardrail, not the model's often-huge capacity. */
  meterPercent: number;
}

/**
 * Cost pressure grows long before a million-token model is technically full.
 * The absolute caps keep a huge context window from making 80K look harmless;
 * the proportional caps keep the warning useful for Hermes' smallest (64K)
 * supported models.
 */
export function contextPressure(size: unknown, used: unknown): ContextPressure | null {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return null;
  if (typeof used !== 'number' || !Number.isFinite(used) || used < 0) return null;

  const softLimit = Math.max(1, Math.round(Math.min(60_000, size * 0.6)));
  const hardLimit = Math.max(softLimit, Math.round(Math.min(80_000, size * 0.8)));
  const level: ContextPressureLevel =
    used >= hardLimit ? 'critical' : used >= softLimit ? 'warning' : 'normal';

  return {
    size,
    used,
    softLimit,
    hardLimit,
    level,
    meterPercent: Math.max(0, Math.min(100, (used / hardLimit) * 100)),
  };
}

export function compactTokenCount(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  const thousands = tokens / 1_000;
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace(/\.0$/, '')}K`;
}

export function likelyCompacted(previousUsed: number, nextUsed: number, softLimit: number): boolean {
  return previousUsed >= softLimit && nextUsed < previousUsed * 0.75;
}
