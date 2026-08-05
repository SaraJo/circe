import { describe, it, expect } from 'vitest';
import { parseDeviceCode, PROVIDERS } from '../../src/main/hermes/provider';

describe('PROVIDERS', () => {
  it('lists exactly what `hermes login --provider` accepts', () => {
    expect(PROVIDERS.map((p) => p.id)).toEqual(['nous', 'openai-codex', 'xai-oauth']);
  });

  it('gives each provider a human label', () => {
    for (const p of PROVIDERS) expect(p.label).toBeTruthy();
  });
});

describe('parseDeviceCode', () => {
  it('extracts a URL and a code from typical device-flow output', () => {
    const out = [
      'Starting device authorization…',
      'Visit https://portal.nousresearch.com/device to continue.',
      'Enter code: ABCD-1234',
    ].join('\n');
    expect(parseDeviceCode(out)).toEqual({
      url: 'https://portal.nousresearch.com/device',
      code: 'ABCD-1234',
    });
  });

  it('handles the url and code on one line', () => {
    expect(parseDeviceCode('Open https://example.com/activate and enter WXYZ-9876')).toEqual({
      url: 'https://example.com/activate',
      code: 'WXYZ-9876',
    });
  });

  it('returns null when no code is present yet', () => {
    expect(parseDeviceCode('Starting device authorization…')).toBeNull();
  });

  it('returns null when no URL is present', () => {
    expect(parseDeviceCode('Enter code: ABCD-1234')).toBeNull();
  });

  it('ignores a trailing period on the URL', () => {
    const r = parseDeviceCode('Visit https://example.com/device. Code: ABCD-1234');
    expect(r!.url).toBe('https://example.com/device');
  });
});
