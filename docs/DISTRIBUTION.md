# Offline installers and GitHub downloads

The finished installers work without internet, Node.js, Rust, or a development server. Building them initially needs internet to download development dependencies and the Windows offline runtime. Uploading to GitHub and downloading from it also need internet; users can then transfer the installer by USB and install offline.

## Build on this Mac

```sh
npm ci
npm run bundle:mac
```

The `.dmg` appears in `src-tauri/target/release/bundle/dmg/`. Open it and drag Arceo into Applications. This command builds for the current Mac's processor. On the current Apple Silicon machine, its filename ends in `_aarch64.dmg`.

To build one installer for both Apple Silicon and Intel Macs:

```sh
rustup target add aarch64-apple-darwin x86_64-apple-darwin
npm run bundle:mac:universal
```

The universal download appears in `src-tauri/target/universal-apple-darwin/release/bundle/dmg/`.

## Build on Windows

With the Tauri Windows build prerequisites installed:

```powershell
npm ci
npm run bundle:windows
```

The `-setup.exe` appears in `src-tauri/target/release/bundle/nsis/`. The existing `offlineInstaller` configuration includes the full WebView2 installer inside it. Test installation on a clean, disconnected Windows computer, especially one without WebView2 installed. This project has not yet been installation-tested on Windows.

## Put the source on GitHub

Create a repository with your chosen visibility. A private repository restricts downloads to authorized collaborators; a public repository exposes the source and published releases to everyone. Choose a license before offering the source under an open-source license.

From this project folder, using the GitHub account and destination you intend:

```sh
git init -b main
git add .
git commit -m "Add Arceo offline desktop blocker"
gh repo create OWNER/Arceo --private --source=. --remote=origin --push
```

Replace `OWNER/Arceo` with your repository, and use `--public` only if public visibility is intended. If the repository already exists, instead add its remote and push:

```sh
git remote add origin https://github.com/OWNER/Arceo.git
git push -u origin main
```

The `.gitignore` excludes build output, local release files, environment files, and private signing keys/certificate archives. GitHub builds installers from the source; installers belong in Releases, rather than in the source tree.

## Create the download release

The workflow `.github/workflows/release.yml` runs when you push a version tag. Keep `package.json`, `src-tauri/tauri.conf.json`, and `src-tauri/Cargo.toml` at the same version. The first release uses `0.1.0`:

```sh
git tag -a v0.1.0 -m "Arceo 0.1.0"
git push origin v0.1.0
```

GitHub Actions checks the version, runs tests and builds a universal macOS `.dmg` and a Windows x64 `-setup.exe` on their respective operating systems. Once both finish, it creates a **draft** release containing both installers and `SHA256SUMS.txt`. It uses GitHub's automatic repository token; no personal access token is needed in the workflow. Check **Actions** for progress, then open **Releases**, review the draft, test the installers, and publish it when ready. The release notes disclose the current development signing status.

The ordinary `build.yml` workflow also produces downloadable installer artifacts for `main` pushes and pull requests. Draft releases and Actions artifacts are for review; published GitHub Releases are the stable place to send users for downloads.

To attach an existing local installer to a draft release manually:

```sh
gh release create v0.1.0 --verify-tag --draft --title "Arceo v0.1.0" --notes-file docs/release-notes.md release-assets/*.dmg release-assets/SHA256SUMS.txt
```

Use either the automated workflow or manual creation for a given tag, not both. Copy the installer into `release-assets/` and run `npm run release:checksums` before manual upload. On macOS, verify its checksum from that directory with `shasum -a 256 -c SHA256SUMS.txt`.

## Signing for public distribution

The current macOS build is ad-hoc signed and not notarized; Windows builds have no publisher certificate. These files can be packaged and uploaded, but operating systems may block them or show warnings. Do not represent them as notarized or publisher-signed releases.

For normal macOS public downloads, use an Apple Developer ID Application certificate, replace `bundle.macOS.signingIdentity` with its identity, and configure notarization credentials through local environment variables or GitHub Actions secrets. Staple the notarization ticket so Gatekeeper can verify the distributed application offline. For Windows, configure a code-signing certificate and Tauri's Windows signing settings. Never commit signing keys or passwords to the repository.

See the official [Tauri macOS signing guide](https://v2.tauri.app/distribute/sign/macos/), [Windows installer guide](https://v2.tauri.app/distribute/windows-installer/), and [GitHub Releases documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository).
