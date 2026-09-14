# Native Windows beta

## Goal

Produce an x64 Windows installer for Circe while retaining the existing macOS
experience. First-prompt tab naming ships first and is shared across platforms.

## Scope and decisions

Use the existing Electron/NSIS packaging stack. Detect the current native Hermes
installation under LocalAppData and run its executable directly. Both ACP and
one-shot queries must use the same data home. Normalize Windows watcher paths
before fleet filtering. Use standard Windows frames and opaque backgrounds;
keep macOS presentation unchanged. Hermes remains responsible for installation
and provider setup. WSL support and public-release signing are separate work.

## Acceptance

Automated checks cover installation path resolution, overrides, and Windows
watcher events. Build the installer and provide a Windows CI workflow. A real
Windows smoke test remains necessary before claiming runtime support is verified;
see docs/WINDOWS.md for the checklist.
