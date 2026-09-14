import { readFile, writeFile, access } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { generateAvatar } from '../src/main/generatedAvatar';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';
import type { Character } from '../src/shared/types';

const character = { name: 'Data', fullName: 'Data', fandom: 'Star Trek', tagline: 'Android officer' } as Character;
const png = new Uint8Array([1, 2, 3]);

function outputPath(prompt: string): string {
  return JSON.parse(/Save the generated image bytes to ("[^"\n]+")./.exec(prompt)![1]!);
}

describe('generated avatars', () => {
  it('reads only the staged output, converts it, and removes temporary files', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    let output = '';
    let reference = '';
    h.query = async (_profile, prompt) => {
      output = outputPath(prompt);
      reference = JSON.parse(/reference image at ("[^"\n]+")/.exec(prompt)![1]!);
      expect(new Uint8Array(await readFile(reference))).toEqual(png);
      await writeFile(output, png);
      return 'Done';
    };
    const result = await generateAvatar(h, character, {
      bytes: png, contentType: 'image/png', source: 'wikipedia', title: 'Data',
      articleUrl: 'article', imageUrl: 'image', license: 'commons',
    }, (bytes) => { expect(bytes).toEqual(png); return bytes; });
    expect(result).toMatchObject({ source: 'generated', treatment: 'retro-rpg-portrait', imageUrl: 'image', license: 'unknown' });
    await expect(access(output)).rejects.toThrow();
    await expect(access(reference)).rejects.toThrow();
  });

  it('does not trust a completion claim without an actual generated file', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    h.query = async () => 'Done';
    expect(await generateAvatar(h, character, null, () => png)).toBeNull();
  });

  it('rejects unreadable generated images', async () => {
    const h = new FakeHermes(INSTALLED_EMPTY);
    h.query = async (_profile, prompt) => {
      await writeFile(outputPath(prompt), 'not an image');
      return 'Done';
    };
    expect(await generateAvatar(h, character, null, () => null)).toBeNull();
  });
});
