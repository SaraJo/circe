import { describe, expect, it } from 'vitest';
import { parseSoulHeading, renderSoulHeading, withSoulHeading, writeSoul } from '../src/main/soul';
import { FakeHermes, INSTALLED_EMPTY, INSTALLED_WITH_AGENTS } from './fake/hermes';

describe('parseSoulHeading', () => {
  it('splits a name from an em-dash tagline', () => {
    expect(parseSoulHeading('# Trillian — Central Coordinator\n')).toEqual({
      name: 'Trillian',
      tagline: 'Central Coordinator',
    });
  });

  it('accepts a plain hyphen separator', () => {
    expect(parseSoulHeading('# Ford - career')).toEqual({ name: 'Ford', tagline: 'career' });
  });

  it('returns a null tagline when there is no separator', () => {
    expect(parseSoulHeading('# Zaphod')).toEqual({ name: 'Zaphod', tagline: null });
  });

  it('returns null for prose with no heading', () => {
    expect(parseSoulHeading('You are Hermes.\n')).toBeNull();
  });

  it('returns null for an H2', () => {
    expect(parseSoulHeading('## Zaphod')).toBeNull();
  });
});

describe('renderSoulHeading', () => {
  it('always writes the canonical em dash', () => {
    expect(renderSoulHeading({ name: 'Ford', tagline: 'career' })).toBe('# Ford — career');
  });

  it('omits the separator when there is no tagline', () => {
    expect(renderSoulHeading({ name: 'Ford', tagline: null })).toBe('# Ford');
  });
});

describe('withSoulHeading', () => {
  it('preserves the body byte-for-byte when replacing a heading', () => {
    const body = '# Old — thing\n\nBody the user wrote.\nSecond line.\n';
    const out = withSoulHeading(body, { name: 'New', tagline: 'role' });
    expect(out).toBe('# New — role\n\nBody the user wrote.\nSecond line.\n');
  });

  it('prepends a heading to prose that has none', () => {
    const out = withSoulHeading('You are Hermes.\n', { name: 'New', tagline: null });
    expect(out).toBe('# New\n\nYou are Hermes.\n');
  });

  it('replaces an ATX heading behind front matter in place, keeping the front matter intact', () => {
    const body = '---\ntitle: Trillian\n---\n# Trillian — Central Coordinator\n\nprose\n';
    const out = withSoulHeading(body, { name: 'New', tagline: 'role' });
    expect(out).toBe('---\ntitle: Trillian\n---\n# New — role\n\nprose\n');
  });

  it('collapses a setext heading to the canonical ATX form, with the underline gone', () => {
    const body = 'Trillian\n========\n\nprose\n';
    const out = withSoulHeading(body, { name: 'New', tagline: 'role' });
    expect(out).toBe('# New — role\n\nprose\n');
  });
});

describe('writeSoul', () => {
  it('writes without a backup when nothing was there', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const result = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Trillian — coordinator\n',
      now: new Date('2026-08-14T09:30:00Z'),
    });
    expect(result.backedUpTo).toBeNull();
    expect(await h.readHomeFile('SOUL.md')).toBe('# Trillian — coordinator\n');
  });

  it('backs up a persona the user wrote before overwriting it', async () => {
    const h = new FakeHermes(INSTALLED_WITH_AGENTS);
    const original = await h.readHomeFile('SOUL.md');
    const result = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Athena — coordinator\n',
      now: new Date('2026-08-14T09:30:00Z'),
    });
    expect(result.backedUpTo).toBe('SOUL.md.bak-20260814-093000');
    expect(await h.readHomeFile('SOUL.md.bak-20260814-093000')).toBe(original);
    expect(await h.readHomeFile('SOUL.md')).toBe('# Athena — coordinator\n');
  });

  it('does not back up an untouched scaffold', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    const result = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Athena — coordinator\n',
      now: new Date('2026-08-14T09:30:00Z'),
    });
    expect(result.backedUpTo).toBeNull();
  });

  it('disambiguates when a backup for the same second already exists', async () => {
    const h = new FakeHermes(INSTALLED_WITH_AGENTS);
    const original = await h.readHomeFile('SOUL.md');
    const now = new Date('2026-08-14T09:30:00Z');

    const first = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Athena — coordinator\n',
      now,
    });
    const second = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Zaphod — coordinator\n',
      now,
    });

    expect(first.backedUpTo).toBe('SOUL.md.bak-20260814-093000');
    expect(second.backedUpTo).toBe('SOUL.md.bak-20260814-093000-2');
    // The first backup still holds the user's original hand-written persona,
    // byte-for-byte — the second write must not have clobbered it.
    expect(await h.readHomeFile('SOUL.md.bak-20260814-093000')).toBe(original);
    expect(await h.readHomeFile('SOUL.md.bak-20260814-093000-2')).toBe(
      '# Athena — coordinator\n',
    );
    expect(await h.readHomeFile('SOUL.md')).toBe('# Zaphod — coordinator\n');
  });

  it('keeps climbing the counter on a third collision in the same second', async () => {
    const h = new FakeHermes(INSTALLED_WITH_AGENTS);
    const now = new Date('2026-08-14T09:30:00Z');

    await writeSoul({ hermes: h, profileId: 'default', contents: '# Athena — coordinator\n', now });
    await writeSoul({ hermes: h, profileId: 'default', contents: '# Zaphod — coordinator\n', now });
    const third = await writeSoul({
      hermes: h,
      profileId: 'default',
      contents: '# Ford — coordinator\n',
      now,
    });

    expect(third.backedUpTo).toBe('SOUL.md.bak-20260814-093000-3');
    expect(await h.readHomeFile('SOUL.md.bak-20260814-093000-3')).toBe(
      '# Zaphod — coordinator\n',
    );
  });
});
