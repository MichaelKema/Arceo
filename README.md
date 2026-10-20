# Arceo

A calmer space for your best work. A Rust-powered website and desktop app blocker for macOS and Windows, with a black workspace and colorful accents inspired by the supplied [Arc CRM reference](https://uiarc.dev/templates/arc-crm/live).

## Run it

Install a current stable Rust toolchain, Node.js 24 or later, and the [Tauri desktop prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (Xcode Command Line Tools on macOS; Visual Studio C++ Build Tools and WebView2 on Windows).

```sh
npm install
npm run tauri dev
```

For the browser interface and timer preview:

```sh
npm run dev
```

Open **http://127.0.0.1:1437**. Browser preview and desktop data are separate. Browsers cannot block native applications or change system website rules. Preview mode never claims to do so.

## Features

- Focus timer, from 1 minute to 24 hours, with 25 / 45 / 60 minute presets.
- Editable Social media, Gaming, Entertainment, and Shopping block lists, plus custom lists.
- Custom website domains, including automatic `www` rules and IPv4 / IPv6 entries.
- Native application selection. macOS scans `/Applications`, `~/Applications`, and running apps. Windows lists running applications; Browse lets you select any installed `.exe`, even if it isn't running. Presets include websites; pick the desktop apps installed on your own device.
- Repeating schedules on selected weekdays, including overnight blocks. Times follow the device's local timezone and daylight-saving changes. Overlapping timers and schedules combine their lists, so ending a timer does not unblock another active schedule.
- Local session history, a daily focus goal, and a seven-day chart. Statistics measure timer sessions; they do not measure browsing activity or scheduled-block duration.
- Keyboard search with Command/Ctrl + K, accessible dialogs and controls, and responsive layouts.
- Local JSON persistence. No accounts, analytics, servers, or cloud storage.

## Offline operation

The installed desktop app works fully offline. Timers, recurring schedules, custom website rules, installed-app discovery and blocking, session history, goals, and settings all run on this device. Fonts, icons, frontend code, and preset lists are embedded in the application; there are no CDN requests, sign-ins, license checks, cloud services, or remote configuration. Adding a website parses its domain locally, without contacting the site or looking it up in DNS. Disconnecting and reconnecting the internet does not interrupt an active timer or schedule.

The status **Engine stopped** refers to the local background process, not your internet connection. Administrator approval is still needed to manage the system hosts file, and that approval works without internet. Website rules can be created while offline and remain effective if you reconnect during an active block. After restarting the computer, reopen Arceo and enable the engine as described below.

The macOS `.app` needs no separate runtime download. Windows installers are configured to embed the complete WebView2 **offline installer**, rather than an online bootstrapper, so a computer without WebView2 can also install Arceo offline. This makes the Windows package larger. The Windows artifact must still be built and tested on Windows; this configuration has not been installation-tested on the macOS development machine.

Use the packaged desktop app for standalone use: Node.js, Rust, and a local development server are not required on the user's computer. The browser preview uses a local development server and supports local preview data/timers only. Developer dependency installation and building the Windows offline package require an initial download of build dependencies/runtime; these downloads are not required when using the finished desktop package. Building from source without internet also works once all dependencies and packaging tools are cached.

Verification includes UI tests with network APIs disabled, persistence across UI restarts, timer expiry using the local clock, a production-asset audit, and the Rust engine/tests running inside a macOS sandbox that denies network access. Run `npm run verify:engine-offline` on macOS after packaging to exercise native timed/scheduled blocking against a disposable fixture app, with every network operation denied and no real apps or website rules changed. Run `npm run verify:offline` after a production build to verify all referenced HTML/CSS assets are present locally, the frontend can connect only to native IPC, and Windows packaging embeds the offline runtime installer.

## Blocking engine

In the desktop app, go to **Settings → Enable blocking engine**, or start a focus session. macOS shows its administrator prompt; Windows shows UAC. Arceo never collects the password. On macOS the helper executable is staged in the application-data `engine/` directory before authorization, so a project located in Documents or Downloads does not prevent the elevated helper from launching. After authorization, a separate Rust helper runs in the background, even when you close the UI. It checks the saved configuration every second.

While a block is active, the helper updates only Arceo's marked section in the system hosts file and closes processes that match your selected executables. On macOS it also matches helpers inside that application's bundle, and limits termination to processes owned by the signed-in user. Arceo and OS system paths are excluded. **Save your work before enabling an app block: selected applications are terminated, and unsaved changes may be lost.** This is a voluntary focus tool, not an enterprise policy or tamper-proof security product.

The helper removes website rules when their timers/schedules finish, when the engine is disabled, and during normal signal-driven shutdown. **After restarting the computer, reopen Arceo and enable the engine again.** This version does not install a persistent system service or start automatically at login. Sleep pauses enforcement; the helper reconciles current local time on wake. It does not wake a sleeping computer.

On macOS, enable **Settings → Safari protection** with Safari open, then allow Arceo to control Safari in the macOS Automation prompt. This additional local watcher checks tab addresses about once a second during active website blocks. It replaces matching Safari tabs (including cached/open connections and any subdomain) with an embedded offline focus page. It does not disable Private Relay or change Safari's privacy settings. No browsing addresses are written to disk or sent to a server. The page's **Try again** link returns to the site's homepage when its block ends. A page can appear briefly before the watcher replaces it; this is a focus aid, not a network firewall. If permission is revoked, a visible error appears and new sessions require permission again.

With Safari protection enabled, closing the Arceo window hides it and leaves the watcher running. Click Arceo in the Dock to reopen. **Quit Arceo ends the timer and disables the engine**, because quitting also stops the Safari watcher. Restarting the computer still requires reopening Arceo and enabling its engine. Website/app enforcement without Safari protection continues in the separate helper when the UI quits.

System hosts rules cover exact domains and `www`. Other subdomains must be added explicitly for browsers without the Safari watcher. Hosts blocking cannot guarantee coverage through every VPN, proxy, secure-DNS setup, cached connection, or browser configuration. Existing connections may need to be closed. The engine reports filesystem/permission errors in the UI.

### Recovery

Use **Settings → Remove all Arceo blocks** to disable enforcement and remove managed website rules, including after an unexpected helper crash. Saved schedules remain available. This may prompt for administrator permission if the helper is offline. A forced kill or power loss can leave hosts entries behind until recovery; Arceo's rules are clearly marked.

For macOS terminal recovery, first disable the engine in Settings, then, if necessary:

```sh
sudo '/Applications/Arceo.app/Contents/MacOS/arceo' --restore-hosts
```

Adjust the app's location if running a local build. On Windows, run `arceo.exe --restore-hosts` from an administrator terminal after disabling the engine. Recovery removes only the marked Arceo section; it preserves unrelated host entries. Do not delete the system hosts file.

### Data locations

- macOS: `~/Library/Application Support/app.arceo.desktop/`
- Windows: the OS application-data directory for `app.arceo.desktop` (resolved by Tauri).

`config.json` stores lists, schedules, preferences, and timer history. `runtime.json` is the helper heartbeat/status. `engine.lock` prevents multiple helpers from competing. Config writes are atomic and helper output is separate, so neither process overwrites the other's changes.

## Build and verify

For downloadable offline installers and automated GitHub Releases, follow [the distribution guide](docs/DISTRIBUTION.md). Quick commands are `npm run bundle:mac` for a Mac DMG, `npm run bundle:mac:universal` for both Mac processor families, and `npm run bundle:windows` on Windows for the offline setup executable. Pushing a matching `v0.1.0` tag runs the release workflow and prepares a draft with universal Mac and Windows x64 downloads plus checksums.

```sh
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

Build on each target OS:

```sh
# macOS application bundle
npm run tauri build -- --bundles app

# Windows installer, on Windows
npm run tauri build -- --bundles nsis
```

The GitHub Actions workflow checks and packages both platforms without enabling system blocking. macOS development bundles are ad-hoc signed (`signingIdentity: "-"`). For macOS distribution, replace that identity and sign and notarize with your own Apple credentials; for Windows distribution, supply your own signing certificate. These are local development builds until signed. The Windows build requires its Windows runner; it cannot be validated by a macOS-only local build.

## Project structure

- `src/`: React / TypeScript presentation, local browser preview, styles, and pure-function tests.
- `src/defaults.json`: shared preset lists, embedded into the Rust binary.
- `src-tauri/src/model.rs`: validation, timed sessions, and schedule calculations.
- `src-tauri/src/daemon.rs`: background enforcement, app matching, administrator launch, and graceful recovery.
- `src-tauri/src/hosts.rs`: managed hosts rules and DNS refresh.
- `src-tauri/src/lib.rs`: Tauri commands, native app discovery, and persistent configuration.

Tests cover invalid domains, midnight boundaries, overnight weekday ownership, overlapping rules, preserving other hosts entries, malformed markers, and completed/early-ended session accounting. Unit tests do not modify the actual hosts file or terminate real applications.
