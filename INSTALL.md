# Install Circe

[← Back to the README](README.md)

The installers include the Circe app; you do not need to clone this repository
or install Node.js separately to run Circe. Both platforms require Hermes and a
configured model provider before you open the app.

### macOS (Apple Silicon)

1. Open **Terminal** (Applications → Utilities → Terminal). Install the Hermes
   command-line runtime using the command from its
   [installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation):

   ```bash
   curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
   ```

   When installation finishes, make Hermes available in the current Terminal
   window and connect a model provider:

   ```bash
   export PATH="$HOME/.local/bin:$PATH"
   hermes setup
   ```

   If Hermes is already installed, skip the install command and run
   `hermes setup` if you still need to configure a provider.
2. Open [Circe releases](https://github.com/SaraJo/circe/releases) and download
   `Circe-<version>-arm64.dmg` from the release's **Assets**.
3. Open the disk image and drag **Circe** into **Applications**. Quit an existing
   Circe instance before replacing it with an update.
4. Open **Circe** from Applications. This beta is unsigned and unnotarized. If
   macOS blocks it as an unidentified developer, and you trust the download,
   open **System Settings → Privacy & Security → Open Anyway**, then confirm.
   See [Apple's instructions](https://support.apple.com/en-us/102445).
   You can also launch the installed app from Terminal:

   ```bash
   open /Applications/Circe.app
   ```

   If macOS says **“Circe is damaged and can't be opened”**, follow the
   [Terminal workaround below](#circe-is-damaged-and-cant-be-opened).
5. Follow onboarding to choose your agents, their identities, and a coordinator.

The provided Mac installer targets Apple Silicon; an Intel Mac installer is
not currently supplied.

#### “Circe is damaged and can't be opened”

The unsigned, unnotarized Mac beta can trigger this message after a browser
download. It does not by itself establish that the disk image is corrupted.
If you downloaded Circe from this repository's GitHub release and trust it,
first copy it into **Applications**, then run this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Circe.app
```

This removes the download quarantine from Circe only, bypassing its Gatekeeper
download check. Open Circe again. If it still fails, compare the downloaded
DMG's checksum with `SHA256SUMS.txt` from the same release:

```bash
shasum -a 256 ~/Downloads/Circe-0.2.12-arm64.dmg
```

Use the filename for your downloaded version. If the checksum differs,
download the installer again. If it matches and Circe still fails, report the
Circe version, macOS version, Mac chip, and exact error message.

Developer ID signing and Apple notarization are still needed for a release
that does not require this beta workaround.

### Windows (Windows 10/11 x64 beta)

1. Install **native Windows Hermes** using its
   [Windows guide](https://hermes-agent.nousresearch.com/docs/user-guide/windows-native).
   Open a new PowerShell window and run `hermes setup` to connect a model provider.
   Circe's Windows build does not use WSL-hosted Hermes profiles.
2. Open the [Windows beta release](https://github.com/SaraJo/circe/releases/tag/v0.2.12) and download
   `Circe-0.2.12-windows-x64-setup.exe` from **Assets**.
3. Run the installer and choose your installation location. If SmartScreen
   shows an unrecognized-app warning, verify that you downloaded it from this
   repository; for a download you trust, choose **More info → Run anyway** if
   that option is available. The beta is unsigned.
4. Launch **Circe** from the Start menu and follow onboarding.

For custom Hermes paths and Windows-specific limitations, see
[Windows beta setup](docs/WINDOWS.md). For newer builds not yet attached to a
release, download the **Circe-windows-x64** artifact from a successful
[Windows installer workflow](https://github.com/SaraJo/circe/actions/workflows/windows.yml)
(GitHub sign-in required), extract the ZIP, and run the installer inside.

For the authoritative implementation status and near-term roadmap, see
[docs/CURRENT_BUILD.md](docs/CURRENT_BUILD.md). Dated plans and specs are
historical records, not an implementation backlog.

For a small trusted test, use the guided [beta checklist](docs/BETA_TEST.md).
