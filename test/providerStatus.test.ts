import { describe, expect, it } from 'vitest';
import { parseProviderFromStatus } from '../src/main/hermes/real';

/** Real captured `hermes status` Environment block, with a provider set. */
const WITH_PROVIDER = `◆ Environment
  Project:      /Users/sarachipps/.hermes/hermes-agent
  Python:       3.11.11
  .env file:    ✓ exists
  Model:        claude-opus-4-7
  Provider:     Anthropic
`;

const NO_LINE_AT_ALL = `◆ Environment
  Project:      /Users/sarachipps/.hermes/hermes-agent
  Python:       3.11.11
  .env file:    ✓ exists
  Model:        claude-opus-4-7
`;

describe('parseProviderFromStatus', () => {
  it('extracts the provider from a real captured `hermes status` block', () => {
    expect(parseProviderFromStatus(WITH_PROVIDER)).toBe('Anthropic');
  });

  it.each(['none', 'not set', '-'])(
    'returns null when Provider is the placeholder %j',
    (placeholder) => {
      const out = WITH_PROVIDER.replace('Anthropic', placeholder);
      expect(parseProviderFromStatus(out)).toBeNull();
    },
  );

  it('returns null when there is no Provider line at all', () => {
    expect(parseProviderFromStatus(NO_LINE_AT_ALL)).toBeNull();
  });
});
