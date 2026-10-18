# ProGramerly - Claude session 2026-09-13 (v2.3.0 release)

Ionity (Pty) Ltd | AEDI - Policy 986 AED

## Result
- `main` and tag `v2.3.0` pushed to https://github.com/Ionity-Global-Pty-Ltd/ProGramerly
- Release v2.3.0 published with 15 assets (Windows x64/ARM64/universal/portable,
  macOS arm64 + x64 dmg/zip, Linux AppImage/deb/rpm, SHA256.txt). Verified: the
  portable exe download hashes to the value in SHA256.txt.
- Local checkout `G:\.Development\ProGramerly-Basic Software for All` is in
  sync with origin/main (no uncommitted work).

## Files added / changed this session
| Path | Purpose |
| --- | --- |
| `src/main/data/programs.json` | manifest: size + SHA-256 pins for the 4 bundled EXEs, payload repo/tag |
| `src/main/services/programs.js` | stage-from-resources or download-from-release, verify, launch; progress sink |
| `src/main/main.js` | forwards `programs:progress` to the renderer |
| `src/main/preload.js` | `programs.onProgress` bridge method |
| `src/main/services/updater.js` | ignores non-version tags (`programs-v1`) |
| `src/renderer/dashboard.js` | download-aware tiles, live progress, "Get & launch" |
| `scripts/check-programs.js` | manifest + payload verifier (`--strict`, `--write-sums`) |
| `.github/workflows/build.yml` | validate runs check-programs; windows job fetches + verifies payload; release-job duplicate-upload fix |
| `docs/index.html` | "Bundled Ionity utilities" section, www.ionity.fun canonical |
| `docs/CNAME` | `www.ionity.fun` |
| `docs/STATUS-2026-09-13.md` | full status report |
| `README.md` | Command Center, kiosk, bundled utilities, download page, Linux build |
| `package.json` | 2.3.0, `check:programs`, `dist:linux` |
| `PUBLISH-PROGRAMS.cmd` | one-click creation of the `programs-v1` payload release |

## Files in this folder
- `STATUS-2026-09-13.md` - copy of the status report
- `programs-service-test-harness.js` - Node harness that exercised programs.js with a mocked Electron/HTTP layer (bundled launch, download+verify, cached relaunch, corrupt payload rejected, tampered copy refused). Run: `node programs-service-test-harness.js` after editing the `root` constant.
- `download-page-render-check.js` - Playwright script that rendered docs/index.html headless and asserted the sections.
- `download-page-utilities-section.png` - screenshot from that render.

## Still needs the owner
1. Double-click `PUBLISH-PROGRAMS.cmd` (creates/uploads the `programs-v1` payload; blocked for the automated session).
2. DNS: `www.ionity.fun` CNAME -> `ionity-global-pty-ltd.github.io` (+ apex A records 185.199.108-111.153), then Enforce HTTPS in Pages.
3. `gh release delete-asset v2.2.1 app.log --yes` and `... screenshot.png --yes`.
4. Fill Firebase placeholders when the project exists.
