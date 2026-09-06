# ProGramerly v1.1.0 - build notes

**Basic Coding Software for All** - provisions a complete development machine,
then keeps it in sync, watches it from the tray, and repairs Windows when it
breaks.

Author: Johan Wilhelm van Antwerp - Antwerp Designs | Ionity (Pty) Ltd | AEDI
Governance: Policy 986 AED - (c) 2018-2026 - TM
Built: 2026-09-06 - `G:\.Development\ProGramerly-Basic Software for All`
Supersedes the v1.0.0 notes.

---

## What 1.1.0 adds

| Area | Shipped |
| --- | --- |
| **Self-update** | `services/updater.js` - reads GitHub Releases directly, picks the asset for this platform/arch, verifies against the release `SHA256.txt`, launches the NSIS installer with `/S`. No store, no background service, never silent. |
| **Keep-in-sync** | `services/sync.js` - 08:00 and 20:00 local, default **on**. Walks winget/choco/brew, npm globals, pipx + uv tools, VS Code extensions, git repos under the dev root, Ollama models, and the official link registry. `autoInstallUpdates` default on; untick and it becomes a report. Writes a JSON report per run to `userData/sync/`, keeps 30. Re-arms on `powerMonitor` resume. |
| **Tray + metrics** | `tray.js` + `services/metrics.js` - minimise/close to tray, hover HUD (`renderer/hud.*`) with CPU load, CPU temp, every drive, live throughput and ping. Windows streams JSON from one long-lived PowerShell; unix reads `df`/`netstat`/`/proc`/`/sys` per tick. No native modules, no npm deps. |
| **Network** | `services/netprobe.js` - 5 s per region (BR, US, UK, CN, IN, NZ, ZA + geo-detected local) via TCP handshake; Cloudflare `cdn-cgi/trace` for geo; Cloudflare `__down`/`__up` speed test. |
| **Registry repair** | `services/registry.js` + `data/registry-fixes.json` - 12 Microsoft-documented fixes, 9 system tools. `reg export` backup before any change, removals gated behind an explicit tick. |
| **Intro** | `renderer/intro.*` - the IONITY LOADER v3.2 sequence with square-wave WebAudio matching the original `Console.Beep` frequencies. |
| **Catalog** | 62 -> **103 items**, 12 -> **19 groups**. |

## Catalog additions

Antigravity (IDE + CLI), OpenCode, Cursor, Windsurf, Zed, JetBrains Toolbox,
Neovim. Chrome extensions (uBlock Origin Lite `ddkjiahejlhfcafbddmgiahcphecmpfh`,
Claude in Chrome `fcoeoabgfenejglbffodgkkbkcdhcgfn`). Edge Dev, Firefox Dev.
Aider, Goose, Continue CLI, 5-model Ollama pull. Managed venv + PyTorch,
TensorFlow, Transformers, LangChain/LangGraph/LlamaIndex/CrewAI, data-science
stack. SQLite, MongoDB, PostgreSQL, MySQL, SQL Server, Redis, DBeaver. XAMPP,
PHP/Composer/Laravel/Symfony, Rails, Django, React/Express/Vite/Nest/PM2, a MERN
starter scaffold, .NET web tooling. Flutter/Dart, Kotlin/Gradle/Maven, Android
SDK, React Native/Expo. Arduino IDE + arduino-cli, PlatformIO, ESP-IDF, Thonny.
Postman, Insomnia, HTTPie, Newman. AWS SAM, Azure Functions, Firebase, Wrangler,
Vercel, Netlify, Cloudflare WARP + cloudflared. VS Code pack 16 -> 58 extensions.

## New step types

`chromeExt` (Chrome `ExtensionInstallForcelist` policy when elevated, Web Store
pages when not), `venv` (creates `Development/.venvs/ionity`), `venvPip`
(installs into it, optional custom index), `scaffold` (writes a starter project,
never over an existing folder). Platform blocks also take `pre`, which runs
before the package managers - that is how the Homebrew taps land in the right
order. All four are implemented in the GUI, `programerly.ps1` and
`programerly.sh`, and enforced by `validate-catalog.js`.

## Decisions worth remembering

**Zero runtime dependencies, deliberately.** Metrics, the probe, the updater and
the registry reader are Node stdlib plus the shell the OS already has.
`package.json` has no `dependencies` block.

**One managed venv.** Every Python-side item installs into
`Development/.venvs/ionity`. Nothing touches the system Python, and the whole ML
stack is removable by deleting one folder. The base `python` item still upgrades
system pip - an early conversion pass wrongly rewired that to the venv, which
does not exist yet at that point in the queue. Fixed; watch for it if the
catalog is ever bulk-edited again.

**The logo is drawn from rectangles, not box-drawing characters.** The console
original needs a font that is not on every machine; on a box without it the
IONITY block art rendered as overlapping rubble. Screenshotted, caught, and
replaced with an SVG built from a 5x7 block font.

**The window is created before the intro plays.** The first version created the
intro window, awaited it, then created the main window - so when the intro
closed there were zero windows, `window-all-closed` fired, and the app quit on
launch every time. Now: main window created hidden, then intro, then reveal.
There is also a `booting` guard and a hard 12 s ceiling on the intro.

**A target that never answers is not packet loss.** Region loss is averaged only
over targets that replied, otherwise one firewalled host made a 20 ms region
read "poor".

**A link that answers 404 is reachable.** `api.anthropic.com`, `api.openai.com`
and the Google AI endpoint all reject a bare `GET /`. The link scan flags only
5xx and no-answer.

**`$N` was the ANSI reset code AND the loop counter** in `programerly.sh`, so
every line printed its item number and never reset its colour. Renamed to `$IDX`.

## Verification performed

- `syntax-check.js` (new) - parses all 25 shipped `.js`/`.json`
- `validate-catalog.js` - 103 items, 19 groups, new step types, no cycles
- `dry-run.js` for full/win, full/mac, ai/win, minimal/mac
- `programerly.sh --dry-run` against the real catalog
- Booted the GUI headless under Xvfb and screenshotted every tab; ran a live
  global sweep (geo resolved, 7 regions measured), a live Cloudflare speed test
  (466/342 Mb/s, 1.7 ms), and a full report-only sync (9 s, 25 links, JSON report
  written)
- Packaged and launched `dist/linux-unpacked` - asar contains `services/`,
  `data/`, `intro.*`, `hud.*`, `tray.js`
- Cross-built the Windows installers with wine (needs `wine64` + `wine32:i386`)
- `PROGRAMERLY_UI_FIXTURES=1` renders the Windows-only registry screen on Linux
  (`scripts/ui-fixtures.js`), so CI can screenshot it

## Artefacts

| File | Size | State |
| --- | --- | --- |
| `dist/ProGramerly-Setup-1.1.0-x64.exe` | 81 MB | NSIS, per-user, unsigned - delivered as 5 x 18 MB parts + `ASSEMBLE.cmd` (the file bridge caps at 20 MB) |
| `dist/ProGramerly-Setup-1.1.0-arm64.exe` | 87 MB | built here, not transferred |
| `dist/ProGramerly-Portable-1.1.0.exe` | 81 MB | built here, not transferred |
| `dist/SHA256.txt` | - | checksums for all three |

Run `dist/ASSEMBLE.cmd` to rebuild and verify the x64 installer.
`npm run dist:win` rebuilds all three locally in about two minutes.

## Open items

1. **Still not pushed.** `Ionity-Global/ProGramerly` does not exist yet, so the
   in-app updater has nothing to read - it reports the 404/403 cleanly and keeps
   running. Create the repo, push, tag `v1.1.0`, and the updater goes live.
   Steps are in `PUSH-TO-GITHUB.md`.
2. **`.github/workflows/build.yml` is still not on disk** - protected path for
   the remote-device tools. The updated version (adds `syntax-check`, a headless
   `smoke` job that boots the app and fails if it dies, and a `SHA256.txt`
   release step the updater depends on) is at `Claude outputs/build.yml`. Copy
   it to `.github/workflows/build.yml` by hand.
3. **Unsigned.** SmartScreen and Gatekeeper warn until the certificates are
   added as CI secrets.
4. **CPU temperature on Windows** depends on the machine exposing an ACPI
   thermal zone; many desktops do not. LibreHardwareMonitor or OpenHardwareMonitor
   running in the background is picked up automatically. The UI says so rather
   than showing a wrong number.
5. **`archify` is private** - unchanged from 1.0.0.

---

_Building Tomorrow, Today. Anything is Possible with God._
