import { describe, expect, it } from 'vitest';
import {
  compactTokenCount,
  contextPressure,
  likelyCompacted,
} from '../src/renderer/tile/contextPressure';

describe('contextPressure', () => {
  it('warns on absolute cost pressure long before a 1M model is full', () => {
    expect(contextPressure(1_000_000, 59_999)?.level).toBe('normal');
    expect(contextPressure(1_000_000, 60_000)?.level).toBe('warning');
    expect(contextPressure(1_000_000, 80_000)?.level).toBe('critical');
  });

  it('scales the guardrails down for a 64K model', () => {
    const pressure = contextPressure(64_000, 51_200)!;
    expect(pressure.softLimit).toBe(38_400);
    expect(pressure.hardLimit).toBe(51_200);
    expect(pressure.level).toBe('critical');
  });

  it('rejects malformed ACP usage updates', () => {
    expect(contextPressure(0, 10)).toBeNull();
    expect(contextPressure(1_000_000, -1)).toBeNull();
    expect(contextPressure('1000000', 10)).toBeNull();
  });

  it('fills against the cost guardrail rather than model capacity', () => {
    expect(contextPressure(1_000_000, 40_000)?.meterPercent).toBe(50);
    expect(contextPressure(1_000_000, 100_000)?.meterPercent).toBe(100);
  });
});

describe('context pressure presentation', () => {
  it('formats token counts compactly', () => {
    expect(compactTokenCount(999)).toBe('999');
    expect(compactTokenCount(1_500)).toBe('1.5K');
    expect(compactTokenCount(80_412)).toBe('80K');
  });

  it('recognises a meaningful post-threshold drop as compaction', () => {
    expect(likelyCompacted(100_000, 54_000, 60_000)).toBe(true);
    expect(likelyCompacted(50_000, 20_000, 60_000)).toBe(false);
    expect(likelyCompacted(100_000, 80_000, 60_000)).toBe(false);
  });
});
