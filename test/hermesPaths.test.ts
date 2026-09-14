import { describe, expect, it } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hermesPaths } from '../src/main/hermes/runtime';

describe('Hermes installation paths', () => {
  it('keeps the existing macOS defaults', () => {
    expect(hermesPaths({}, 'darwin')).toEqual({
      bin: join(homedir(), '.local', 'bin', 'hermes'),
      home: join(homedir(), '.hermes'),
    });
  });

  it('finds the native Windows launcher and data in LocalAppData', () => {
    expect(hermesPaths({ LOCALAPPDATA: 'C:\\Users\\Test User\\AppData\\Local' }, 'win32')).toEqual({
      bin: 'C:\\Users\\Test User\\AppData\\Local\\hermes\\bin\\hermes.exe',
      home: 'C:\\Users\\Test User\\AppData\\Local\\hermes',
    });
  });

  it('respects a custom data home without relocating the installed executable', () => {
    expect(hermesPaths({ LOCALAPPDATA: 'C:\\Local', HERMES_HOME: 'D:\\Agents' }, 'win32')).toEqual({
      bin: 'C:\\Local\\hermes\\bin\\hermes.exe', home: 'D:\\Agents',
    });
    expect(hermesPaths({ CIRCE_HERMES_BIN: 'D:\\Tools\\hermes.exe', HERMES_HOME: 'D:\\Agents' }, 'win32')).toEqual({
      bin: 'D:\\Tools\\hermes.exe', home: 'D:\\Agents',
    });
  });

  it('falls back to the user profile if LocalAppData is unavailable', () => {
    expect(hermesPaths({ USERPROFILE: 'C:\\Users\\Test' }, 'win32').home)
      .toBe('C:\\Users\\Test\\AppData\\Local\\hermes');
  });
});
