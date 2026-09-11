# ProGramerly v2.2.1 - full function audit

Ionity (Pty) Ltd | AEDI - Policy 986 AED
Audited 2026-09-11 against the v2.2.0 source tree.

## Verdict

Every function works. Four real defects were found and fixed - all the same
root cause, and all of them silent.

## Root cause: CSP drops inline style attributes

Both renderer windows declare `style-src 'self'`. That makes the browser
discard every `style="..."` attribute in parsed markup **without throwing**,
so the code looks correct, runs without error, and simply does nothing.

Four places still relied on it:

| Where | Symptom before the fix |
|---|---|
| `renderer.js` - Monitor tab | every disk usage bar rendered at **zero width** |
| `hud.js` - HUD overlay | same, for its compact drive bars |
| `renderer.js` - AI tab | Node version-manager label lost its faint colour |
| `renderer.js` - `boot()` catch | startup-failure notice rendered unstyled - the one message that must be readable when nothing else worked |

**Fix:** bar widths are emitted as `data-pct` and painted through the CSSOM
once the markup is in place (CSSOM is not blocked - only parsed style
attributes are). The two colour cases moved to real classes, `.faint` and
`.bootfail`.

**Rule for future work:** never put `style="..."` inside a template string in
this project. Set it via `el.style.x` after insertion, or add a class.

## Verified clean (no defects)

- **IPC**: 82 `ipcMain.handle` channels <-> 110 preload methods <-> 103
  renderer call sites. No orphan handler, no missing bridge method, no
  unrouted event.
- **DOM**: all 185 `$('id')` references resolve against `index.html`; all 11
  tabs map to a real view in `VIEWS`; all 64 buttons are wired.
- **Installer engine**: dependency resolution and topological ordering correct
  for all 110 catalogue items, across `full` / `ai` / `minimal` / `custom`, on
  win32. Every `dependsOn` is auto-pulled and ordered before its dependant.
- **Modules**: all 20 service/installer modules load; 34 files parse.
- **Formatters / parsers**: `cmpVersion` (numeric not lexical, tolerates a `v`
  prefix), byte and bit formatters, `detectStack`, `hexToRgb` (invalid input
  falls back to Ionity cyan by design).

## End-to-end proof

Booted the **real** main process under Xvfb, clicked all 11 tabs, asserted
each renders content, and measured the previously-broken bars:

    data-pct=89.9  style.width=89.9%  rendered=315.8px
    data-pct=90.3  style.width=90.3%  rendered=317.2px
    data-pct=66.5  style.width=66.5%  rendered=233.6px

Bridge exposed 110 methods, catalogue rendered 84 items, console clean.

## Open item

The four fixes are applied and staged on the build machine, but `git commit`
failed there with `fatal: failed to write commit object` - a local git/disk
condition, not a code problem. `FINISH-2.2.1.cmd` in the project root
diagnoses it, commits, pushes, and tags `v2.2.1`, which triggers
`.github/workflows/build.yml` to build Windows/macOS/Linux on GitHub's own
runners and attach them to the release (the macOS runner produces a native
`.dmg`, which cannot be built off macOS).
