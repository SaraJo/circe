import { describe, expect, it } from 'vitest';
import { replaceAvatarFromUpload } from '../src/main/avatarReplacement';
import { avatarProvenancePath, readProvenance } from '../src/main/avatarStore';
import { FakeHermes, INSTALLED_EMPTY } from './fake/hermes';

const OLD = new Uint8Array([1, 2, 3]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 4, 5, 6]);

describe('replaceAvatarFromUpload', () => {
  it('stores the processed face and private, user-upload provenance', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    const ok = await replaceAvatarFromUpload(
      hermes,
      'ford',
      new Uint8Array([9, 9]),
      '/Users/someone/Private Photos/ford.jpg',
      () => PNG,
    );

    expect(ok).toBe(true);
    expect(await hermes.readHomeFileBytes('profiles/ford/avatar.png')).toEqual(PNG);
    const provenance = await readProvenance(hermes, 'ford');
    expect(provenance).toMatchObject({
      source: 'upload',
      title: 'ford.jpg',
      articleUrl: '',
      imageUrl: '',
      license: 'unknown',
      treatment: 'pixel-art-32',
    });
    expect(await hermes.readHomeFile(avatarProvenancePath('ford'))).not.toContain('Private Photos');
  });

  it('leaves an existing avatar untouched when the image cannot be processed', async () => {
    const hermes = new FakeHermes(INSTALLED_EMPTY);
    hermes.bytes.set('avatar.png', OLD);

    const ok = await replaceAvatarFromUpload(
      hermes,
      'default',
      new Uint8Array([9, 9]),
      '/tmp/not-an-image.jpg',
      () => null,
    );

    expect(ok).toBe(false);
    expect(await hermes.readHomeFileBytes('avatar.png')).toEqual(OLD);
    expect(await hermes.readHomeFile(avatarProvenancePath('default'))).toBeNull();
  });
});
