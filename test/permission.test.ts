import { describe, expect, it } from 'vitest';
import { commandPreview, permissionOutcomeLabel } from '../src/renderer/tile/permission';

describe('permission card copy', () => {
  it('limits long commands without losing the overflow count', () => {
    const command = Array.from({ length: 13 }, (_, index) => `line ${index + 1}`).join('\n');
    expect(commandPreview(command)).toEqual({
      lines: Array.from({ length: 10 }, (_, index) => `line ${index + 1}`),
      overflow: 3,
    });
  });

  it('distinguishes a timeout from a user denial', () => {
    expect(permissionOutcomeLabel('deny')).toBe('Denied');
    expect(permissionOutcomeLabel('expired')).toBe('Expired; the agent stopped waiting');
  });
});
