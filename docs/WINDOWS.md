# Windows beta

Circe's Windows build targets Windows 10/11 x64 with **native Windows Hermes**.
WSL-hosted profiles are not supported by this build. Hermes must already be
installed and connected to a model; Circe does not install Hermes or providers.

Follow the [Hermes native Windows guide](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native)
to install and run `hermes setup`, then run the Circe installer. The installer
supports installation for the current user and lets you choose a destination.

## Paths

Circe defaults to `%LOCALAPPDATA%\hermes\bin\hermes.exe` for the launcher and
`%LOCALAPPDATA%\hermes` for profile data. It launches the executable directly,
without a command shell, and passes the same home to CLI queries and ACP.

For a custom installation, set `CIRCE_HERMES_BIN` to your `hermes.exe` and
`HERMES_HOME` to the native Hermes data directory before opening Circe.
The binary override must be an executable, not a `.cmd` or `.bat` wrapper.
Existing installations with only a `hermes.cmd` shim should update Hermes.

## Build

On Windows with Node.js 22 and npm:

```powershell
npm ci
npm run typecheck
npm test
npm run dist:win
```

The installer is `dist/Circe-<version>-windows-x64-setup.exe`.
`.github/workflows/windows.yml` performs these checks on a Windows runner and
uploads the installer as a workflow artifact. It runs on pull requests, pushes
to main, or manual dispatch once the workflow is pushed to GitHub.

Cross-building on macOS can also produce the installer; electron-builder
fetches its Windows packaging tools as needed. Cross-building does not verify
Windows runtime behavior.

## Validation before sharing broadly

The beta is unsigned. Windows may show an unknown-publisher or SmartScreen
prompt. Public distribution still needs code signing and Windows testing.

On a Windows test machine:

1. Install Circe as a regular user, including a destination with spaces.
2. Verify missing-Hermes and missing-provider guidance on an isolated account.
3. Adopt a native Hermes fleet and confirm the expected agents and avatars.
4. Send a prompt, verify streaming and the prompt-based tab name, then switch
   tabs and restart Circe to verify restoration.
5. Exercise allow-once, allow-for-session, and deny with a real permission request.
6. Create another Hermes profile and verify its tile appears automatically.
7. Check close/minimize/maximize, menu access, Ctrl shortcuts, multiple monitors,
   and display scaling.
8. Install an update and uninstall Circe; confirm Hermes profiles and
   conversations remain intact.

Windows uses standard window controls and opaque tile backgrounds. macOS's
Vision face detector is unavailable; the existing avatar crop fallback applies.
