# ProGramerly 3.5.0 - Relations, Environments, System, and an honest AEDi

Ionity (Pty) Ltd | AEDI - Policy 986 AED | 2026-09-20
Author: Johan Wilhelm van Antwerp - prepared with Claude (Cowork)

## What changed

**No simulated data.** Every DOME percentage now carries the class of the thing it
was derived from - `measured`, `computed`, `assessment`, `state`, `manifest`,
`catalogue` - and a constant is never labelled a measurement. The Doctor findings and
reclaimable-space segments, which read the wrong field and were permanently "not
scanned", read again. The resolver segment now probes winget, Chocolatey, Homebrew,
apt/dnf/pacman, uv and conda. The standby list is read from the Memory performance
counters (with the reason shown when it cannot be). The payload segment says
"hashed and matched" only after a hash actually ran. An install item whose only
steps all failed reports **failed**, not "skipped - nothing to do". The intro speaks
only facts it read; no stand-in strata, no "0/0 tools verified".

**AEDi.** The Ionity local core is called AEDi everywhere in the app, and everywhere it
is called AEDi the engine under it is named: *AEDi · gemma3:4b*, "powered by Ollama on
this machine". No model means the chip, the ask box, the orb and every Ask button say
so. A tick-box at the top of the Software list installs the AEDi core (Ollama + a
starter model of your choice) with the rest of the run; its state line reads whether
Ollama is really running and which models it holds.

**Relations** (new workspace). The machine as one graph: processes - including the
session-0 processes a task list hides - listening ports, services, volumes,
interfaces, GPU, Ollama and its models, environments, repositories, installed tool
groups and the bundled programs, joined by the relations that exist right now
(spawned, listens, runs-as, holds, inside, contains, stored-on). Gradient paths with
flow particles, hue by kind, filter chips, search. Click a node for its facts, its
actions (end process, restart / stop service, open folder, inspect port, open the
workspace) and **Ask AEDi** - which answers from the node, its relations and the
registered sets its kind belongs to. Sources that could not be read are listed as
gaps, never drawn.

**Environments** (new workspace). Create a Python venv, uv venv, conda environment,
Node project or Docker compose stack. Type what you need and **Draft it**: AEDi returns
a recipe as JSON, the form fills, you press Create. Every command is the real one,
streamed line by line; nothing is reported created until `pyvenv.cfg`,
`package.json`, the compose file or `conda env list` proves it. Per environment:
open folder, terminal here, pip list, freeze to requirements.txt, add packages,
compose up / down / status, remove (only inside the managed roots, only with a
marker present).

**System** (new workspace). Processes, Services, Startup and Ports as sortable,
filterable tables read from the OS: Win32_Process + Get-Process, Win32_Service,
Run keys / Startup folders / Task Scheduler, Get-NetTCPConnection (and `ps`,
`systemctl`, `launchctl`, `ss`, `/proc/net` elsewhere). One action per row: End,
Start / Stop / Restart, Disable / Enable, Inspect. A disabled Run entry is written to
`<userData>/startup-backups` before it is removed and is restored from there.
Microsoft services are hidden by default and one tick away.

**The DOME grew.** 26 segments (System gains *Processes and services*), 34 data sets
(`system.processes`, `system.services`, `system.startup`, `system.listeners`,
`envs.all`), 14 presets (*what is running, seen and unseen*, *what starts by itself*,
*environments on this machine*).

**The intro** is now the IONITY GLOBAL wordmark, "Building Tomorrow, Today.", and the
DOME assembling in the brand gradient (blue -> cyan -> orange) from facts read off the
machine, with the AEDi mark. The arcs are timer-driven so they draw even where the
window is not being composited.

**Less text.** Every long explanatory paragraph in the workspaces is one line or gone;
every card has a primary action.

## Verification

- `node scripts/syntax-check.js` - 55 files parse.
- `node scripts/validate-catalog.js` - catalog OK, 116 items.
- `node scripts/ui-check-350.js` - **33/33 against the real running application**
  (Xvfb): DOME boot clears on milestones; AEDi chip / title / placeholder; the three
  new tiles; 26 segments, 34 sets, 14 presets; no constant scored as "measured";
  Relations graph built from the machine (62 nodes, 101 relations), machine node panel
  with Ask AEDi and its relations; Environments builders strip reads real tool state,
  five kinds, **a real venv created, pip-listed and removed through the surface**;
  System tables for processes, services, startup and ports with an action per row; the
  AEDi tick adds exactly Ollama + the starter model to the selection; no uncaught or
  console errors. CI now runs this check on every push.
- New services exercised directly on Linux: processes (ps), listeners (`/proc/net`
  fallback when `ss` is absent), startup (systemd user units), envs tools/list/
  create/packages/remove, recipe parser.

## Open items (need the owner)

1. `PAYLOAD_TOKEN` secret - Windows installers ship without the integrated tools until set.
2. Code signing - Azure Trusted Signing secrets, or an OV/EV `.pfx`.
3. DNS for the Pages domain in `docs/CNAME` (`ionity.digital`) - CNAME `www` ->
   `ionity-global-pty-ltd.github.io`, apex A records to GitHub Pages.
4. Firebase placeholders.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM
