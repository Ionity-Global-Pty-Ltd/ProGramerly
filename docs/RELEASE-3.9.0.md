# ProGramerly 3.9.0: a Mac build that opens, and an assistant you switch on

Ionity (Pty) Ltd | AEDI | 2026-10-18
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-005 | Catalog 1.5.0 | Supersedes 3.7.0 (GitHub) and the unpublished 3.8.0
Governance: Policy 986 AED | Web: https://www.ionity.today | Ref: https://www.ionity.co.za

3.8.0 was written up but never reached GitHub; `main` was still 3.7.0. 3.9.0
starts from 3.7.0 and rebuilds the macOS work, then adds the AI assistant.

## macOS

Why the Mac release did not work, and what changed:

- **"ProGramerly is damaged and can't be opened."** With no Developer ID,
  electron-builder skipped signing after it had rewritten the app bundle. That
  broke the ad-hoc seal Electron ships with, and Apple Silicon refuses to open a
  bundle with a broken seal. `scripts/after-pack.js` now ad-hoc signs the `.app`
  (with the entitlements) before the `.dmg` and `.zip` are made. With a real
  certificate in the repo secrets it does nothing, and CI turns the hardened
  runtime and notarisation on.
- **The admin prompt did nothing for `sudo`.** `osascript … with administrator
  privileges` does not prime `sudo`. `services/macAuth.js` asks once with a
  native dialog, checks the password with `sudo -v`, keeps it in memory behind a
  Unix socket in a private temp folder, and points `SUDO_ASKPASS` at a small
  helper. Homebrew's bootstrap, casks and catalog lines (`sudo` becomes
  `sudo -A`) all use it. It is wiped when the run ends.
- **No terminal for `sudo`.** Each step runs in its own session (`setsid`), so
  `sudo` asks the helper and never waits on a hidden TTY.
- **Homebrew not on PATH from Finder.** The app adds `/opt/homebrew/bin`,
  `/usr/local/bin`, `~/.local/bin`, `~/.cargo/bin`, the Python framework and
  VS Code's CLI to its own PATH at start, and to every child process.
- **In the app.** A real Mac menu bar (⌘, Settings, ⌘1-4 for Software,
  AEDi, Doctor, Terminals, plus a working Edit menu for copy/paste), room for
  the traffic lights, and the badge reads "Asks for your password once".
- **Doctor.** New checks: `brew shellenv` in `~/.zprofile` (with a fix that
  backs the file up first) and Rosetta 2 on Apple Silicon.
- **Updates.** An Intel build running under Rosetta now updates to the arm64
  build. Linux picks `.deb` or `.rpm` by distro family.
- **One-line install:**

  ```bash
  curl -fsSL https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/scripts/install-mac.sh | bash
  ```

  It picks Apple Silicon or Intel (Rosetta shells included), checks
  `SHA256.txt`, installs to `/Applications` (or `~/Applications`) and opens
  the app.
- **CI proves it.** The macOS job now unpacks each `.zip`, runs
  `codesign --verify --deep --strict`, and launches the binary for 12 seconds
  before the artifacts are uploaded.

## AEDi assistant

- **Two providers, both off.** AEDi → Providers:
  - **Local AI** (Ollama / LM Studio). Nothing leaves the machine.
  - **Claude** (Anthropic API) with your own key. The key is checked against
    Anthropic, then stored encrypted with the OS keychain (DPAPI, Keychain or
    libsecret). It is never written to `settings.json`. Prompts and any machine
    context a feature attaches go to Anthropic, and every Claude surface says
    so.
- **Off by default.** A fresh install starts no model and runs no launch brief.
  No profile ticks Ollama any more; the "AEDi local core" tick on the Software
  list is the only way in. Updating users who had local AI working turn it on
  once in AEDi → Providers.
- **Suggest with AEDi** (Software). Describe what you build. AEDi chooses from
  this catalog only. Ids it invents and items that do not apply to your OS are
  dropped before anything is ticked. You review the list before installing.
- **Explain failures** (after a run). The last 60 log lines of each failed or
  partial item go to the assistant, which gives the cause and the fix per item.
- **Explain with AEDi** (Doctor). Ranks the three findings that matter, each
  with its fix.
- The chat console, the DOME, Relations, Environments and AEDi Predict all route
  through the same provider switch. Benchmark stays local-only.

## Layout

- Software: the AEDi strip, the new recommend bar and the profiles share one
  22 px inset. All five profiles sit on one row at 1320 px and wider, and still
  fit at the 980 px minimum.
- Repository: loose screenshots, `BUILD-NOTES-1.1.0.md`, `FINISH-2.2.1.cmd` and
  the stale 2.2.0 `SHA256.txt` moved to `docs/archive/`. `PUSH-TO-GITHUB.md`
  moved to `docs/`.

## Verification

- `test-390`: 40 of 40. Covers the `sudo` → `sudo -A` rewrite, PATH hydration,
  no controlling TTY, providers off by default, key format and encryption, the
  key never reaching settings, Anthropic message shaping, and invented
  recommendation ids being dropped.
- UI under Xvfb on a fresh profile:
  - `ui-check-390`: 31 of 31.
  - Earlier suites still pass: `ui-check-350` 33/33, `ui-check-360` 39/39,
    `ui-check-370` 22/22.
  - No renderer or console errors.
- `validate-catalog`, `check-programs`, `test-predict` (15) and `syntax-check`
  pass.
- Dry runs resolve: Full on macOS 134, AI Dev on macOS 60, Full on Windows
  146, Full on Linux 114.
- The askpass socket round trip was exercised with `nc -U`.

**Not yet verified:**

- The macOS path has not been run on a physical Mac in this session. The new
  CI step (signature verify plus a launch on `macos-latest`) is the first real
  check.
- The Claude streaming path has not been called against the live API here.

BUILDING TOMORROW, TODAY
