import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Character } from '../src/shared/types';

const { instances } = vi.hoisted(() => ({ instances: [] as any[] }));
vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 2560, height: 1440 } }),
  },
  BrowserWindow: class {
    handlers = new Map<string, (...args: any[]) => void>();
    webContents = { on: vi.fn(), setWindowOpenHandler: vi.fn() };
    loadFile = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    constructor(public options: Record<string, unknown>) { instances.push(this); }
    on(event: string, handler: (...args: any[]) => void) { this.handlers.set(event, handler); }
  },
}));

import { createTileWindow, createWizardWindow } from '../src/main/windows';

const character = { name: 'Example Agent', palette: { bg: '#381827' } } as Character;
beforeEach(() => { instances.length = 0; });

describe('native tile identity', () => {
  it('includes the stable profile id and display name before the window maps', () => {
    createTileWindow(character, 'default');
    expect(instances[0].options.title).toBe('Circe [default] — Example Agent');
  });

  it('keeps different profiles distinguishable even when names match', () => {
    createTileWindow(character, 'default');
    createTileWindow(character, 'research');
    expect(instances[1].options.title).toBe('Circe [research] — Example Agent');
    expect(instances[0].options.title).not.toBe(instances[1].options.title);
  });

  it('prevents the generic renderer title from replacing the native identity', () => {
    createTileWindow(character, 'default');
    const preventDefault = vi.fn();
    instances[0].handlers.get('page-title-updated')?.({ preventDefault }, 'Circe');
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it('does not turn onboarding into an agent tile', () => {
    createWizardWindow();
    expect(instances[0].options.title).toBeUndefined();
    expect(instances[0].handlers.has('page-title-updated')).toBe(false);
  });
});
