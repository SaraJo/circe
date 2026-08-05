import { describe, it, expect } from 'vitest';
import { CASTS, DEFAULT_CAST_ID, findCast, initialFor } from '../../src/shared/casts';

describe('casts', () => {
  it('ships exactly the five casts from §6 Screen 4a', () => {
    expect(CASTS.map((c) => c.id)).toEqual(['startrek', 'hitchhikers', 'greek', 'neutral', 'custom']);
  });

  it('defaults to Neutral — fans opt in to fandoms', () => {
    expect(DEFAULT_CAST_ID).toBe('neutral');
    expect(findCast(DEFAULT_CAST_ID)).toBeDefined();
  });

  it('lists the characters the spec names', () => {
    expect(findCast('startrek')!.characters.map((c) => c.name)).toEqual([
      'Picard', 'Data', 'Troi', 'Geordi', 'Wesley', 'Locutus',
    ]);
    expect(findCast('greek')!.characters.map((c) => c.name)).toEqual([
      'Athena', 'Hermes', 'Circe', 'Prometheus', 'Hecate',
    ]);
    expect(findCast('neutral')!.characters.map((c) => c.name)).toEqual([
      'Alpha', 'Beta', 'Gamma', 'Delta',
    ]);
  });

  it('gives every character a tagline and a two-colour palette', () => {
    for (const cast of CASTS) {
      for (const ch of cast.characters) {
        expect(ch.tagline, `${ch.name} needs a tagline`).toBeTruthy();
        expect(ch.palette.accent).toMatch(/^#[0-9a-f]{6}$/i);
        expect(ch.palette.background).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('gives every character a valid lowercase profile id', () => {
    for (const cast of CASTS) {
      for (const ch of cast.characters) {
        expect(ch.suggestedId).toMatch(/^[a-z0-9][a-z0-9_-]*$/);
        expect(ch.suggestedId.length).toBeLessThanOrEqual(32);
      }
    }
  });

  it('references no image assets anywhere (§4.6, §10.7)', () => {
    const serialised = JSON.stringify(CASTS);
    expect(serialised).not.toMatch(/\.(png|jpe?g|gif|webp|svg)/i);
    expect(serialised).not.toMatch(/https?:/i);
  });

  it('has an empty character list for the custom cast', () => {
    expect(findCast('custom')!.characters).toEqual([]);
  });
});

describe('initialFor', () => {
  it('takes the first letter, uppercased', () => {
    expect(initialFor('athena')).toBe('A');
    expect(initialFor('Deep-Thought')).toBe('D');
  });

  it('falls back to a bullet for an empty name', () => {
    expect(initialFor('')).toBe('•');
  });
});
