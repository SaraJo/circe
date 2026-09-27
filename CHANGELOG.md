# Release notes

Changes that matter to people using Circe. **Unreleased** changes are in the
repository but are not yet included in a published installer. Download released
builds from [GitHub Releases](https://github.com/SaraJo/circe/releases).

## Unreleased

No changes yet.

## 0.2.12 — 2026-09-26

**macOS beta and Windows experimental beta.** [Downloads and full release notes](https://github.com/SaraJo/circe/releases/tag/v0.2.12).

### Added

- Choose **YOLO this task** on a tool approval to approve subsequent actions in
  that conversation automatically. A visible indicator stays on until the task
  finishes, fails, disconnects, or you send a new message. Consent is never saved
  for another task or conversation.

### Fixed

- Opening a conversation with **+** or **Cmd/Ctrl-T** focuses the message box so
  you can start typing immediately.
- Agent tiles keep stable native window titles containing their profile and
  character names, making them easier to identify in window tools.
- Linux menu bars stay hidden until requested when running from source. Linux
  does not have a supported public installer.

- Installers include only production build output, excluding leftover local
  preview and media-editing files.

### Documentation

- Refreshed the README with a captioned workflow demo, download buttons, and
  navigation links.
- Added dedicated installation and onboarding guides.
- Started this changelog to distinguish upcoming changes from shipped builds.

## 0.2.11 — 2026-09-22

**macOS beta.** [Download and full release notes](https://github.com/SaraJo/circe/releases/tag/v0.2.11).
Windows users should use the installer attached to 0.2.10.

- New conversations appear immediately with a “Starting…” label. Messages typed
  during startup wait for that conversation; failed startup restores the previous
  tab and identifies unsent messages.
- Follow-up messages interrupt the active turn before starting the replacement.
  Rapid corrections and image attachments are preserved while other conversations
  continue independently.
- Circe no longer expires approval cards after 60 seconds. Cards close when their
  work is interrupted, the turn ends, or the connection closes. Some Hermes
  versions still impose their own timeout.
- Added conversation image attachments and synchronized renamed agent identities
  with Hermes personas.
- Added session-creation timing logs for troubleshooting.

Hermes is installed separately. Interrupting a running tool may take time.
This Mac beta is unsigned and unnotarized.

## Earlier releases

See [0.2.10](https://github.com/SaraJo/circe/releases/tag/v0.2.10) for its release
notes and the Windows beta installer.
