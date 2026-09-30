# ProGramerly 3.6.0 - AEDi Predict, and the catalog people actually live in

Ionity (Pty) Ltd | AEDI - Policy 986 AED | 2026-09-29
Author: Johan Wilhelm van Antwerp - prepared with Claude (Cowork)
Document ID: DOC-2026-09-006 | Catalog 1.3.0 | Supersedes 3.5.0 (2026-09-20)

## What changed

**AEDi Predict** (new workspace, and a live line in the Software footer). Before a
run starts, ProGramerly now says how it expects the run to go on *this* machine:
a likelihood per item, the expected number of clean installs, minutes with a
range, download size against free space and an 8 GB reserve, and a risk list.
The forecast is built from facts read at that moment - which engines are on
PATH (winget, Chocolatey, Homebrew, npm, git, Python, uv, VS Code, Ollama, Java),
whether the package hosts answer a TCP connect (winget CDN, Chocolatey, Homebrew,
npm, GitHub, PyPI, Ollama, VS Code Marketplace, Firebase, nodejs.org), free disk,
and whether the process is elevated. An engine the queue itself installs earlier
is counted as present. Every figure carries its class, the same four words the
DOME uses: `measured`, `learned`, `computed`, `assumed`.

It learns. After every run the outcome and duration of each item go into
`<userData>/predict/history.json`; the likelihood is a shrunk posterior (three
real outcomes outweigh the shipped prior), minutes switch to the learned median
once an item has two timings here, and a speed factor scales the priors to this
line and disk. Nothing leaves the machine. **Forget the history** returns to the
priors. The **machine forecast** keeps one sample every five minutes while the
app runs and, once it has six samples over two hours, fits a line to each fixed
disk: GB/day and days-to-full, plus 24-hour memory and CPU averages and an
install budget. **Belongs next** lists stated relations from the catalog
(Claude Desktop → MCP config, Firebase → Java, KiCad → FreeCAD ...), profile
completion and the dependencies a run will add - never a statistic dressed as
one. **Explain** hands the pack to the local model, which is told to restate the
figures and add nothing; with no model running it says so.

**The catalog grew from 116 to 143 items, 19 to 22 groups.** Three new groups:

- **Communication** - WhatsApp Desktop, Microsoft Teams, Zoom, Slack + Discord,
  Telegram + Signal.
- **Cloud Drives & Sync** - Google Drive for desktop, Microsoft OneDrive, Dropbox,
  rclone.
- **Maker · CAD · PCB · 3D** - Blender, FreeCAD, KiCad, PrusaSlicer + Cura.

And across the existing groups: **Gemini CLI**, **OpenAI Codex CLI** and **GitHub
Copilot CLI** as their own items; **Claude Code ⇄ GitHub relations** (git, gh,
the official `claude-code-action` workflow template cloned into the dev root, and
a version check of each); **Firebase CLI + local emulators** (firebase-tools and
the Firestore, Database, Storage, Pub/Sub and Emulator UI jars, Java as a
dependency); **Node toolbelt** (pm2, nodemon, vite, tsx, eslint, prettier,
npm-check-updates, serve, http-server, concurrently, dotenv-cli); **Bun + Deno**;
**GitKraken + lazygit**; **PowerToys**; **LibreOffice**; **Unity Hub**; **Godot**;
**Bruno**; **Twilio CLI**; **n8n**. Claude Code installs by Homebrew cask on macOS
as well as npm. The VS Code pack gains GitHub Copilot, Copilot Chat, Gemini Code
Assist, Firebase Data Connect and vsfire. The MCP config writer (and both headless
scripts) now also register Firebase's own MCP server and Desktop Commander.

**archify** now points at the public Ionity fork
(`Ionity-Global-Pty-Ltd/archify`, MIT upstream `tt-a1i/archify`), installs its
Node dependencies and registers it as a global agent skill for Claude Code, Codex
and Cursor. No `gh auth login` needed any more.

**No account is linked, anywhere.** Every messenger, drive and CLI above is
installed and left signed-out; the description says so on each item. The
Firebase web config stays a placeholder. ProGramerly is for other people's
machines as much as ours.

## Verification

- `node scripts/syntax-check.js` - 59 files parse.
- `node scripts/validate-catalog.js` - catalog 1.3.0 OK, 143 items in 22 groups;
  Full 141 · AI Dev 64 · Minimal 27.
- `node scripts/dry-run.js` - every item resolves to a command plan; nothing executed.
- `node scripts/test-predict.js` - **14 checks** on the engine with injected facts:
  needs read from specs, a prior for every item, a clean forecast on a healthy
  machine, collapse when offline, a missing engine as a stated risk and its
  removal when the queue provides it, low disk against the reserve, a failure
  lowering the posterior and marking it learned, a slow run doubling the speed
  factor, learned medians after two timings, a ~2 GB/day disk trend recovered by
  regression with days-to-full, suggestions as stated relations, an explain
  prompt that forbids invention, reset.
- `node scripts/ui-check-360.js` - **39/39 against the real running application**
  (Xvfb): version, Predict tile and dock button, the surface and selection bridge
  registered, the three new groups in the served catalog and every new item on
  the list where it applies (and rightly absent where it does not), the AI Dev
  profile forecast in the Software footer with its classes, four stat tiles,
  class chips, a likelihood bar per item with a real width under the strict CSP,
  engines from PATH, ten hosts probed, the machine card, a suggestion added to
  the selection, Explain answering honestly with no model, no uncaught or console
  errors. `ui-check-350.js` still covers Relations, Environments and System.
- Every new winget ID was checked against `microsoft/winget-pkgs` manifests;
  WhatsApp is the Microsoft Store package `9NKSQGP7F2NH` (no community
  manifest exists), Gemini CLI has no winget package and installs by npm.

## Open items (need the owner)

1. `PAYLOAD_TOKEN` secret - Windows installers ship without the integrated tools until set.
2. Code signing - Azure Trusted Signing secrets, or an OV/EV `.pfx`.
3. GitHub Pages domains: `ionity.space` and `ionity.fun` were unverified by GitHub
   on 2026-09-22 and 2026-09-29 (missing TXT records); `docs/CNAME` still names
   `ionity.digital`. One domain, one TXT record, one CNAME.
4. Firebase placeholders stay placeholders by design.
5. Linux: the engine has no apt/dnf/pacman path yet; Linux users get the npm,
   pip and git items only, and the list says so.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM

Building Tomorrow, Today.
