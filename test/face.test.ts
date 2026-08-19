import { describe, expect, it } from 'vitest';
import { applyFace, initials } from '../src/renderer/face';

/**
 * `face.ts` runs in a real renderer, where `document`/`HTMLElement` are the
 * browser's. There is no jsdom in this repo (no new dependencies), so these
 * tests stand up the smallest fake DOM that satisfies what `applyFace`
 * actually calls: `querySelector('img')`, `.remove()`, `document.
 * createElement('img')`, and `.append()`. `face.ts` never touches `document`
 * at import time, so stubbing it here — after the module is already
 * imported — is enough; the stub only has to exist by the time a test
 * invokes `applyFace`.
 */
class FakeElement {
  tagName: string;
  src = '';
  alt = '';
  textContent = '';
  children: FakeElement[] = [];
  parent: FakeElement | null = null;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  querySelector(sel: string): FakeElement | null {
    if (sel !== 'img') throw new Error(`unsupported selector in fake DOM: ${sel}`);
    return this.children.find((c) => c.tagName === 'IMG') ?? null;
  }

  append(child: FakeElement): void {
    child.parent = this;
    this.children.push(child);
  }

  remove(): void {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
}

(globalThis as unknown as { document: Document }).document = {
  createElement: (tag: string) => new FakeElement(tag),
} as unknown as Document;

function avatar(text = ''): HTMLElement {
  const el = new FakeElement('div');
  el.textContent = text;
  return el as unknown as HTMLElement;
}

describe('initials', () => {
  it('takes the first letter of a one-word name', () => {
    expect(initials('Circe')).toBe('C');
  });

  it('takes the first letter of each word for a two-word name', () => {
    expect(initials('Long John')).toBe('LJ');
  });

  it('takes only the first two words of a three-word name', () => {
    expect(initials('Long John Silver')).toBe('LJ');
  });
});

describe('applyFace', () => {
  it('adds an image with the given url', () => {
    const el = avatar('LJ');
    applyFace(el, 'data:image/png;base64,abc');
    const img = (el as unknown as FakeElement).querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.src).toBe('data:image/png;base64,abc');
  });

  it('removes an existing image when called with null, leaving the text intact', () => {
    const el = avatar('LJ');
    applyFace(el, 'data:image/png;base64,abc');
    applyFace(el, null);
    expect((el as unknown as FakeElement).querySelector('img')).toBeNull();
    expect(el.textContent).toBe('LJ');
  });

  it('does not stack a second image when called twice', () => {
    const el = avatar('LJ');
    applyFace(el, 'data:image/png;base64,abc');
    applyFace(el, 'data:image/png;base64,def');
    const fake = el as unknown as FakeElement;
    expect(fake.children.filter((c) => c.tagName === 'IMG')).toHaveLength(1);
    expect(fake.querySelector('img')?.src).toBe('data:image/png;base64,def');
  });
});
