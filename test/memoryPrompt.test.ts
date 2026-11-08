import { describe, expect, it } from 'vitest';
import { withPersonalContext, originalUserMessage } from '../src/shared/memoryPrompt';

describe('memory context framing', () => {
  it('retains only the original user text for replay, including embedded marker text', () => {
    const text = 'Where should I go?\n🦉';
    const context = 'A saved fact quoting \n\nCurrent user message:\n is still context.';
    expect(originalUserMessage(withPersonalContext(text, context))).toBe(text);
  });
  it('leaves ordinary and malformed user messages intact', () => {
    for (const text of ['Hello', '[circe-personal-context-v1:99]\nshort', '[circe-personal-context-v1:invalid]']) {
      expect(originalUserMessage(text)).toBe(text);
      expect(withPersonalContext(text, '')).toBe(text);
    }
  });
});
