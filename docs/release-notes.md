Arceo is an offline website and desktop app blocker with focus timers, local schedules, editable block lists, and local history.

Downloads:

- **macOS universal `.dmg`**: for Apple Silicon and Intel Macs, macOS 12 or later. Open the disk image and drag Arceo into Applications.
- **Windows x64 `-setup.exe`**: includes the WebView2 offline installer. Run it to install Arceo, including on a computer without WebView2 or internet access.
- **SHA256SUMS.txt**: checksums for verifying downloaded installers.

After downloading, installation and use require no internet connection, account, Node.js, Rust, or development server. Administrator approval is required for system website blocking. On macOS, enable Safari protection in Settings and allow its Automation permission to cover cached Safari pages and connections. Save your work before blocking desktop apps.

These are development builds: the macOS application is ad-hoc signed and is not notarized, and the Windows installer has no publisher certificate. They may be blocked or warned about by the operating system. Normal public macOS distribution requires Developer ID signing and notarization; Windows distribution should use a publisher signing certificate. Download checksums do not replace code signing.

The release is created as a draft for review and testing before publication. Windows installation must be tested on a clean, disconnected Windows computer. The macOS universal package must be tested on both supported processor families. After a computer restart, reopen Arceo and enable the engine again.
