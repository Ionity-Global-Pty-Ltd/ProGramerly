# ProGramerly 3.6.2: the pulse flow, every OS, less text

Ionity (Pty) Ltd | AEDI | Policy 986 AED | 2026-10-02
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-002 | Catalog 1.3.0 | Supersedes 3.6.1 (2026-10-01)

## What changed

**The pulse flow, in the app.** The Command Center now shows four steps under the ask box: **Pick → Predict → Install → Watch**.

- A light pulse travels from one step to the next, and each node rings as the pulse arrives.
- Each caption reads a value the app already shows:
  - Pick shows the selection count.
  - Predict shows the clean-install estimate from AEDi Predict.
  - Install shows the run counter.
  - Watch shows the CPU tile.
- During an install the pulse turns orange and speeds up. Click any node to open its workspace.
- The flow is CSS only, works under the strict CSP, and stops when the system asks for reduced motion.

**The pulse flow, on the site.** The hero has the same four steps, sized down for phones.

**The site, with far less text.** The page went from about 1,460 words to about 240.

- **Hero:** one line and two buttons.
- **The DOME:** one line.
- **Tools:** ten tool cards. Each has a name, one line, and tags that open on hover.
- **Film:** the Ionity brand film.
- **Every OS:** Windows, macOS and Linux tiles, one button per build:
  - Windows: x64, ARM64 and Portable.
  - macOS: Apple Silicon and Intel.
  - Linux: AppImage, .deb and .rpm.

  The tile for the visitor's OS is highlighted. Every button links straight to the file in the latest release. The checksum file and the unsigned-build notes fit on one line.
- **Archive:** the 3.6.1 page is kept at `versions/3.6.1/`.

**Every OS in the release.** CI publishes all of these and fails if a macOS image is missing:

- Windows: x64 and ARM64 installers, plus a portable build.
- macOS: Apple Silicon and Intel, each as a .dmg and a .zip.
- Linux: AppImage, .deb and .rpm.
- `SHA256.txt` with the checksums.

No account is linked, and no catalog item changed.

## Verification

- syntax-check, validate-catalog, test-predict, ui-check-350 and ui-check-360 all pass.
- Electron screenshots show the flow with live captions (for example `50 selected · ≈31/50 clean · idle · CPU 58%`), the pulse moving from step to step, and the faster busy mode.
- The site was screenshotted at 1366 px and 390 px against a mocked release. All nine download buttons resolve, the visitor's OS is detected, and there are no page errors.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM

BUILDING TOMORROW, TODAY
