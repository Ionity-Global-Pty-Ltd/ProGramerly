# ProGramerly 3.9.1 — hardened

Ionity (Pty) Ltd | AEDI | 2026-10-21
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-005 | Version 3.9.1 | Builds on 3.9.0 (2026-10-18) and 3.7.0, neither of which was tagged

This is the first release since 3.6.2. It ships three things together:

- **3.7.0:** the IDE Lab, Maker & Embedded and Linux installs.
- **3.9.0:** a Mac build that opens, and the AEDi assistant, off by default.
- **3.9.1:** a full bug sweep of the engine, the platform services and the IPC surface. That is 39 fixes, each tied to a concrete failure.

## One password per run, now on Linux too

- **macOS:** 3.9.0 moved macOS to one native password dialog per run, served to every `sudo` through `SUDO_ASKPASS`.
- **Linux:** 3.9.1 uses the same session, with zenity, kdialog or ssh-askpass as the dialog.
- **Tighter:**
  - The socket now answers only a helper that carries a one-run token.
  - The helper runs on the app's own binary, so it no longer needs `nc`.
  - There is no dialog at all when sudo is already passwordless.
- **No dialog tool:** a Linux desktop with none of those falls back to `pkexec`. That fallback works now: it used to break on `DEBIAN_FRONTEND=…`, because pkexec does not accept `VAR=value` before the command.
- **Scripts piped into bash:** catalog scripts piped into `bash` (Homebrew's installer, vendor setup scripts) also get `sudo -A`.

## Cancel means cancel

- **Cancel:** now stops the step in progress and everything it started (process group on macOS/Linux, `taskkill /T` on Windows), not only the items queued after it.
- **Timeouts:** stop the whole process tree the same way.
- **Stop and quit:** now quits. Before, the app stayed alive in the tray with the install still running, and a second run could start beside the first.

## Fixes by area

**Installer engine**
- npm globals on a root-owned Node fall back to `~/.npm-global` instead of failing with EACCES.
- After "Linux package sources" installs Flatpak or snapd, later items in the same run now see them (the result was cached as "absent").
- Re-running ESP-IDF (pinned to tag `v5.5`) no longer fails on `git pull` from a detached HEAD.
- Two step options are now implemented:
  - `linuxCmd`
  - `check`, a command that skips the step when it is already satisfied.
- The validator checks every step key.
- Step output kept in memory is capped. Multi-megabyte clones and model pulls no longer grow the main process.

**MCP for Claude Desktop, Claude Code, Kiro, Cursor and Windsurf**
- On Windows, servers written as `npx.cmd` never started, because Node refuses to spawn `.cmd` files without a shell. They now run through `cmd /c npx`.
- The time server uses this machine's time zone instead of a hard-coded `Africa/Johannesburg`.
- A config that is not valid JSON is left untouched and reported. It used to be replaced, which on `~/.claude.json` wipes Claude Code's state.
- Writes are atomic. A run that adds nothing writes nothing and leaves no new `.bak`.

**Sync, updates and downloads**
- Git repo sync never ran on Windows: PowerShell 5.1 has no `&&`. Folder names are now quoted, so a name containing `$` or a backtick is treated as text.
- A connection dropped mid-download crashed the main process. Downloads now go to `.part`, are size-checked, and only then take their real name.
- A sync slot missed while the machine slept now runs on wake, instead of waiting for the next slot.
- Update ordering follows SemVer: `+build` is ignored and `rc10` sorts after `rc2`.
- Linux updates:
  - An AppImage install picks the AppImage; Debian-family distros pick `.deb` and Fedora/SUSE pick `.rpm`.
  - The AppImage gets its exec bit.
  - Open errors are reported instead of claiming success.

**Security (IPC from the window)**
- Installing an update runs only the file this process downloaded and checksummed. The window can no longer name a path.
- "Open" never runs an executable (`.exe`, `.bat`, `.desktop`, `.app`, …).
- Links opened from the window must be `http`/`https`.
- Startup-entry actions:
  - Every PowerShell value is escaped.
  - Registry keys, task paths, Startup-folder items, systemd unit names and backup references are validated.
- A WSL distro name can no longer inject Windows Terminal commands.

**Linux and macOS desktop**
- The desktop shortcut works from an AppImage, and its icon is copied out of the archive.
- Launch at login works on Linux (`~/.config/autostart`). It was a silent no-op.
- The process list fixes:
  - It read nothing under non-English locales.
  - It marked all of your own processes as hidden when your user name is longer than 8 characters.
  - Columns shifted for apps with spaces in their names.

**Windows**
- Command Prompt opened from Terminals no longer prints "syntax is incorrect".
- A terminal that fails to launch reports the error instead of crashing the main process.

**Settings and publishing**
- Settings writes are atomic with a `.bak`. A crash mid-write no longer resets installed items, the dev root and the publish setup to defaults.
- The dev root setting reaches the installer, MCP writer and terminals, not only sync.
- Push & Release stops if the commit fails. It refuses a tag that already exists on an older commit, which used to release old code under a new number.

**Download page**
- The page advertised versions that were never released. It now reads v3.9.1, which is the build the download buttons serve.

## Verification

- `test-engine` (new in 3.9.1, 34 checks): SemVer, sudo routing, process-group kill and timeout, the askpass socket and its token, MCP merge for all five targets, the pinned-tag re-run, torn-settings recovery, the missed-slot catch-up. CI now also runs it on `windows-latest` and `macos-latest`, so the macOS path is exercised on a real Mac.
- 3.9.0's `test-390` (40 checks) and `ui-check-390` still pass.
- Existing checks: catalog validator OK (166 items), syntax check on 66 files, AEDi Predict 15 of 15, dry runs on Windows, macOS and Linux.
- The real app driven under Xvfb: UI checks 33/33, 39/39 and 22/22.

No account is linked anywhere. Every client is installed and left signed out.

BUILDING TOMORROW, TODAY
