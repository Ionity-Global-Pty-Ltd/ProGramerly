<div align="center">

<img src="src/renderer/assets/logo.png" alt="Ionity" width="110" />

# ProGramerly
### Basic Coding Software for All

**One free desktop app. A complete development machine in one run —
then kept in sync, watched from the tray, and repaired when Windows breaks it.**

Windows · macOS · Linux · No licence key · No account · No telemetry

[![Build installers](https://github.com/Ionity-Global-Pty-Ltd/ProGramerly/actions/workflows/build.yml/badge.svg)](https://github.com/Ionity-Global-Pty-Ltd/ProGramerly/actions/workflows/build.yml)
[![Licence: CC BY-NC-SA 4.0](https://img.shields.io/badge/licence-CC%20BY--NC--SA%204.0-00c6ff)](LICENSE)
[![Policy 986 AED](https://img.shields.io/badge/governance-Policy%20986%20AED-0d1b2a)](https://www.ionity.today)

_Antwerp Designs | Ionity (Pty) Ltd | AEDI — Building Tomorrow, Today._

</div>

---

## What it does

You hand a new machine to a developer. Two days later they are still installing
things. ProGramerly is the answer to that: tick a profile, press **Install**,
walk away. It drives the package managers the platform already trusts — never a
mystery binary from a random URL.

| Platform | Engine | Fallback |
| --- | --- | --- |
| Windows 10/11 | `winget` | Chocolatey (bootstrapped automatically) |
| macOS 12+ | Homebrew (bootstrapped automatically) | — |
| Everywhere | `npm -g`, `pip`, `uvx` | — |

Nothing is redistributed. ProGramerly asks the official package manager to
fetch from the official vendor source, so what lands on disk is exactly what
the vendor shipped.

Then it stays. Four things run after the install is finished:

| | |
| --- | --- |
| **Keeps everything in sync** | 08:00 and 20:00 every day, it walks the whole installed code base — winget, Chocolatey, Homebrew, npm globals, pipx and uv tools, VS Code extensions, cloned repos, Ollama models — and the official link registry. It installs what it finds by default; untick one box and nothing is touched, every program stays exactly where it is, and the scan becomes a report. |
| **Updates itself from GitHub** | Straight from the release feed. No store, no background installer service, no silent replacement — you are told, and you choose. The download is checksum-verified against the release's `SHA256.txt` when one is published. |
| **Lives in the tray** | Hover the icon: CPU load, CPU temperature, free space on every drive, live up and down throughput, and current ping. Right-click for a sync, an update check or a speed test. |
| **Repairs the machine** | A curated set of Microsoft-documented registry fixes, every key exported to a `.reg` file before the first change, plus SFC, DISM, Winsock, TCP/IP and the Windows Update component reset. |

---

## Profiles

| Profile | Items | Roughly | Good for |
| --- | ---: | --- | --- |
| **Full Stack** | 102 | 60–95 GB | A fresh machine you want finished |
| **AI Dev** | 49 | 20–35 GB | Claude, MCP, local models, PyTorch, Node, Python |
| **Minimal** | 19 | 5–10 GB | Git, Node, Python, VS Code, Chrome, pwsh, SQLite |
| **Custom** | — | — | Tick exactly what you want |

Every item is individually toggleable regardless of profile, and dependencies
are pulled in automatically — tick *MCP servers* and Node and Python arrive
with it.

---

## What's in the catalog

<details open>
<summary><b>Desktop applications</b></summary>

Claude Desktop · Google Chrome · GitHub Desktop · OBS Studio · Canva ·
Obsidian · Notion · Miro · Docker Desktop · 7-Zip / Keka
</details>

<details>
<summary><b>IDEs and editors</b></summary>

Visual Studio Community (ManagedDesktop, NetWeb, NativeDesktop, Node, Azure,
NetCrossPlat workloads) · Visual Studio Build Tools · VS Code + a **58-extension
critical pack** · **Google Antigravity** (IDE + CLI) · Cursor · Windsurf · Zed ·
JetBrains Toolbox · Neovim · Android Studio
</details>

<details>
<summary><b>Browsers and extensions</b></summary>

Google Chrome · Microsoft Edge Dev · Firefox Developer Edition ·
**uBlock Origin Lite** and **Claude in Chrome**, force-installed through Chrome's
documented `ExtensionInstallForcelist` policy when you have administrator rights,
or opened at their Web Store pages when you do not.
</details>

<details>
<summary><b>Language runtimes</b></summary>

**Node** — fnm + LTS + Latest + a system Node, pnpm, Yarn, ncu
**Python** — 3.13 and 3.12, uv, pipx, poetry, ruff
**.NET** — SDK 10, 9, 8 side by side + Framework 4.8 Dev Pack
**Java** — Temurin 21 LTS and 17 LTS
**Go** · **Rust** (rustup) · **C/C++** (LLVM, CMake, Ninja) · **Ruby** · **PHP**
**Electron** — electron, electron-builder, Forge
**TypeScript** — tsc, tsx, ESLint, Prettier
</details>

<details>
<summary><b>Shells and terminal</b></summary>

PowerShell 7+ · Windows Terminal · Git Bash · Nushell · Oh My Posh ·
Starship · Cascadia Code and JetBrains Mono Nerd Fonts ·
plus a "*update every shell and package source*" sweep
</details>

<details>
<summary><b>AI tooling</b></summary>

Claude Code CLI · **OpenCode** · Qwen Code CLI · Gemini CLI · OpenAI Codex CLI ·
**Aider** · Continue CLI · Goose · LM Studio ·
**Ollama** with a five-model starter pull — `qwen2.5-coder` for code,
`llama3.2` for chat, `deepseek-r1` for reasoning, `nomic-embed-text` for
embeddings, `llava` for vision ·
Anthropic / OpenAI / Google GenAI SDKs for Python and Node
</details>

<details>
<summary><b>ML and AI frameworks</b></summary>

Everything here installs into **one managed virtual environment** at
`Development/.venvs/ionity` — nothing lands in the system Python, and the whole
set is removable by deleting one folder.

**PyTorch** (torch, torchvision, torchaudio — CPU wheels, swap the index for CUDA) ·
**TensorFlow** + Keras 3 + TensorBoard ·
**Hugging Face** (transformers, datasets, accelerate, tokenizers, safetensors,
sentence-transformers, peft, trl, `huggingface_hub[cli]`) ·
**Agent frameworks** (LangChain, LangGraph, LlamaIndex, CrewAI, ChromaDB, FAISS,
the `mcp` SDK, FastAPI) ·
**Data science** (numpy, pandas, scipy, scikit-learn, matplotlib, seaborn,
JupyterLab, OpenCV, Polars, PyArrow)
</details>

<details>
<summary><b>Databases</b></summary>

**SQLite** + DB Browser · **MongoDB** Community + Compass + mongosh + Database
Tools · **PostgreSQL** + pgAdmin · **MySQL** + Workbench ·
**SQL Server Express** + SSMS + Azure Data Studio · **Redis** ·
**DBeaver** universal client
</details>

<details>
<summary><b>Web stacks</b></summary>

**XAMPP** (Apache + MariaDB + PHP + Perl) ·
**PHP** + Composer + Laravel installer + Symfony CLI ·
**Ruby on Rails** (rails, bundler, rake) ·
**Django** + DRF + Celery + Gunicorn + PostgreSQL and MySQL drivers ·
**React / Express / Vite / NestJS / PM2** ·
**.NET web** (dotnet-ef, ASP.NET scaffolder, Azure Functions Core Tools) ·
a **MERN starter project** written into `Development/Sandbox/mern-starter` —
server, client, scripts, README, and an in-memory fallback so `npm run dev`
works before MongoDB is even running
</details>

<details>
<summary><b>Mobile and cross-platform</b></summary>

**Flutter** + **Dart** · **Kotlin** + Gradle + Maven ·
**Android SDK** command line tools, platform tools and a licence acceptance pass ·
**React Native** + Expo + EAS CLI
</details>

<details>
<summary><b>Embedded and IoT</b></summary>

**Arduino IDE 2** + `arduino-cli` with the AVR and ESP32 cores pre-installed ·
**PlatformIO** Core + the VS Code extension ·
**ESP-IDF** VS Code extension · esptool, mpremote, ampy, pyserial ·
**Thonny** for MicroPython
</details>

<details>
<summary><b>APIs and testing</b></summary>

**Postman** · **Insomnia** · HTTPie · Newman · Redocly CLI · swagger-cli · http-server
</details>

<details>
<summary><b>MCP servers for Claude Desktop</b></summary>

`filesystem` · `memory` · `sequential-thinking` · `git` · `fetch` · `time` ·
`playwright` · `context7`

They are pre-cached so Claude launches them instantly, and
`claude_desktop_config.json` is **merged, not overwritten** — anything you
already configured stays, and a timestamped `.bak` is written first.
</details>

<details>
<summary><b>SDKs, cloud and libraries</b></summary>

Windows SDK · Android SDK · Google ADK (`google-adk`) ·
Azure CLI · AWS CLI · Google Cloud CLI ·
**Serverless** — AWS SAM (Lambda), Azure Functions Core Tools, Firebase,
Cloudflare Wrangler (Workers), Vercel, Netlify ·
**Cloudflare WARP** desktop client + `cloudflared` ·
jq, ripgrep, fzf, fd, bat, delta, curl, wget ·
OpenSSL, pkg-config, libffi, protobuf
</details>

<details>
<summary><b>Windows Subsystem for Linux</b></summary>

WSL 2 + Ubuntu, set to version 2. Flagged **reboot** in the UI because it needs one.
</details>

<details>
<summary><b>Ionity / AEDI</b></summary>

Clones [`archify`](https://github.com/AntwerpDesignsIonity/archify) and
[`ionity-assets1`](https://github.com/AntwerpDesignsIonity/ionity-assets1),
then lays out the standard dev tree
(`Projects/ Clients/ POC/ Scripts/ Assets/ Hardware/ Docs/ Archive/ Sandbox/ .mcp/`)
with a Policy 986 AED README at the root.

> `archify` is a private repo. Run `gh auth login` first, or that one item
> reports a warning and everything else carries on.
</details>

---

## Antigravity, curl and friends

Four catalogue items added in v2.2.0, each verified against its source before it
went in:

- **curl** — `cURL.cURL` on winget, `curl` on Homebrew. Windows ships an older
  `curl.exe`; this puts the current one on PATH. Every install script below
  assumes it exists, so it is in all three profiles.
- **Google Antigravity IDE** — `Google.AntigravityIDE` on winget, cask
  `antigravity` on Homebrew.
- **Google Antigravity CLI (`agy`)** — installed with Google's own script,
  exactly as documented: `curl -fsSL https://antigravity.google/cli/install.cmd
  -o install.cmd && install.cmd && del install.cmd` on Windows,
  `curl -fsSL https://antigravity.google/cli/install.sh | bash` on macOS.
  Depends on curl, so the order takes care of itself. Run `agy` once to sign in.
- **Antigravity auto-accept** — clones Ionity's own utility from
  `Ionity-Global-Pty-Ltd/antigravity-auto-accept` into the dev root.

---

## Staying current

ProGramerly does not stop when the install finishes.

### Keeping the code base in sync

At **08:00 and 20:00** local, every day, it walks everything it put on the
machine and reports what has moved:

| Scope | What it checks |
| --- | --- |
| Package managers | `winget upgrade`, `choco outdated`, `brew outdated` (formulae and casks) |
| npm | every global package, via `npm outdated -g` |
| Python | pipx tools and uv tools |
| VS Code | every installed extension |
| Git | every repository under the dev root — fetches, counts how far behind |
| Ollama | every local model |
| Links | the official Ionity, package-source, AI and cloud endpoints, with latency |

**Install the updates it finds** is on by default. Untick it and nothing is
touched: every program stays exactly where it is and the twice-daily run becomes
a report you can read in the Updates tab. Each scope is individually
toggleable, each run writes a JSON report to `userData/sync/`, and the newest
thirty are kept.

A laptop that slept through 08:00 re-arms its schedule the moment it wakes.

### Updating ProGramerly itself

The updater reads **GitHub Releases directly** — `api.github.com/repos/<repo>/releases`
— picks the asset for this platform and architecture, and stops there. It tells
you a new build exists; you press the button. The download is verified against
the release's `SHA256.txt` when one is published, and a mismatched file is
deleted rather than run. Stable-only by default; switch to the pre-release
channel in Settings. Point `updateRepo` anywhere you like — it is a setting, not
a constant.

---

## The tray

Minimise and ProGramerly goes to the tray instead of the taskbar. Hover the icon
and a live panel appears — the OS tooltip stops at 127 characters, which is not
enough room to tell the truth about six drives:

- **CPU load** — computed from `os.cpus()` deltas, so it is the same number on every OS
- **CPU temperature** — ACPI thermal zone, or LibreHardwareMonitor / OpenHardwareMonitor when either is running; honestly reported as unavailable when the machine exposes no sensor
- **Every drive** — fixed, removable and network, with free space and a fill bar that turns amber at 80% and red at 92%
- **Network** — live download and upload throughput from the adapter counters, plus current ping

Right-click for: open, live monitor, network sweep, sync now, check for a new
build, run a speed test, open the log, quit. The two sync switches are in that
menu too.

On Windows one long-lived PowerShell process streams the readings as JSON —
starting PowerShell every two seconds would cost more than the readings are
worth. macOS and Linux read `df`, `netstat`, `/proc/net/dev` and
`/sys/class/thermal` directly, which is cheap enough to do per tick. **No native
modules and no npm dependency** for any of it.

---

## Network

A five-second sweep per region against Cloudflare, Google and a regional host —
**Brazil, United States, United Kingdom, China, India, New Zealand, South
Africa**, plus wherever this machine actually is, resolved from the Cloudflare
edge trace and marked *local*.

Being straight about what that measures: these are **TCP handshakes to the live
service port, not ICMP** — which is what an application actually feels — and
Cloudflare and Google are anycast, so a country target answers from the nearest
edge that serves that name. Each region reports min, average, p95, jitter, loss
and how many of its targets answered at all. A target that is blocked or
unresolvable is counted as unreachable, not as packet loss, so one firewalled
host cannot make a 20 ms region look "poor".

The throughput test runs against `speed.cloudflare.com` and reports download,
upload, latency and jitter with the edge that served it.

---

## Maintenance — registry repair

Windows only, and deliberately conservative. Three rules the module will not
break:

1. **It only writes values Microsoft documents as the correct setting.** Every
   entry carries a link to the Microsoft article it comes from.
2. **It never deletes anything** unless Microsoft's own guidance names that value
   as the fault — and even then only when you tick the removals box, which is
   off by default.
3. **Every key it is about to touch is exported to a `.reg` file first**, into a
   timestamped folder with a manifest telling you how to put it back.

A value that is already correct is reported and left alone.

| Fix | Why |
| --- | --- |
| `.exe` file association | Double-clicking a program opens the wrong thing |
| Windows Installer start type | Error 1719 — blocks nearly every `.msi` |
| BITS / wuauserv / CryptSvc / WSearch start types | Windows Update and search stop working after a "tuning" script |
| **Long paths** | `LongPathsEnabled=1` — `node_modules`, Gradle caches and deep monorepos stop failing |
| **Developer Mode** | Symlinks without elevation, which is what npm, pnpm and Flutter need |
| Show file extensions and hidden files | Per user, no elevation |
| Re-enable UAC | Only written when it has been switched off |
| CD/DVD class filters *(removal)* | KB 314060 — optical drive vanishes after a burning tool is uninstalled |
| Orphaned WSUS policy *(removal)* | Update error 0x80244019 on a machine that has left a domain |

Alongside them: SFC, DISM component-store repair, Winsock reset, TCP/IP reset,
DNS flush, an online read-only `chkdsk`, the Windows Update component reset,
Store cache clear, policy refresh — and a button that opens `regedit` on the key
you are looking at.

---

## AI — services, models, environments

### What is actually running

Twelve local inference and vector services are probed on their default ports —
Ollama, LM Studio, llama.cpp, vLLM, Jan, Text generation WebUI, LocalAI, Open
WebUI, ComfyUI, Stable Diffusion WebUI, Qdrant, Chroma. A service moved to
another port will not be found, which is honest and better than calling it
absent when it is merely elsewhere.

### Models

Ollama's own API, spoken directly over HTTP — no CLI shelling, no scraping:

- every model on disk, with parameter size, quantisation and family
- **what is loaded in VRAM right now**, and whether it is on the GPU or has
  fallen back to CPU — the thing you actually want to know before starting a
  long generation
- **pulling a model** streams Ollama's own newline-delimited progress, so the
  percentage and the byte counts on the bar are the download's, not an
  estimate. Ten curated models are offered with a sentence each on when to
  reach for them, and any tag can be typed instead.
- removing a model, when the disk gets tight

### LLM console

Talk to any model the scan found — Ollama through its native API, everything
else through the OpenAI-compatible `/v1/chat/completions` — streamed token by
token into the window, with a rolling twelve-turn transcript sent back as
context. Nothing leaves the machine.

- **Explain this** treats the box as an error, log excerpt or stack trace and
  asks the model for what it means, the likely cause and the single next thing
  to try, under 200 words, no speculation beyond the evidence.
- **Benchmark** times a fixed prompt. For Ollama the tokens-per-second figure
  comes from the server's own `eval_count` / `eval_duration` — the honest
  number. For servers that send no usage block it is chunk-counted and the
  stats line says *estimate* rather than pretending.
- An NVIDIA GPU shows free VRAM and a one-line reading of what that room
  comfortably runs, so the model picker is informed rather than hopeful.

### Environments

Virtual environments are found by their `pyvenv.cfg` marker. A venv is exactly
a folder containing that file, so this finds every one of them and nothing
else — no guessing from folder names, no `venv`-called-something-else missed.
Each row shows the interpreter version it was built from, its full path, and
whether **this session is standing in it**. Conda environments come from conda
itself, and fnm/nvm Node versions are listed alongside.

---

## Projects

Every git repository under the development folder, two levels deep — enough
for a `root/org/repo` layout — with the four things you want before opening
one: branch, uncommitted work (modified and untracked counted separately),
ahead/behind the remote, and the last commit with its age. What each is built
with is read from the marker files a stack leaves behind (`package.json`,
`pyproject.toml`, `Cargo.toml`, `platformio.ini`, `*.kicad_pro`, `Dockerfile`
and twenty more), not guessed from the folder name. Dirty repositories sort to
the top and carry an amber edge.

Read-only apart from **Fetch** (`git fetch --all --prune`), which changes
nothing in a working tree. Repositories are read one at a time on purpose:
forty parallel git processes on a laptop disk is slower than forty in a row.
Each row opens in the file manager or in VS Code — and if `code` is not on the
PATH the button says so instead of silently doing nothing.

---

## Terminals

Every shell on the machine, found by looking for it rather than assuming, and
opened in your development folder from a button: Windows Terminal, PowerShell 7,
Windows PowerShell 5.1, Command Prompt, Git Bash, Git CMD, WSL and each
installed distribution separately, Nushell, the Anaconda Prompt, and the
Developer Command Prompt with the MSVC toolchain on PATH. On macOS: Terminal,
iTerm2, Warp, kitty, Alacritty.

Nothing is emulated in the window. A terminal emulator inside an Electron app
is a worse terminal than the one already installed — so this launches the real
one, detached, and lets go of it. Where Windows Terminal exists, console shells
are hosted inside it rather than in conhost, because it is the better console.

---

## Hardware — sensors, fans, RGB, memory

### Sensors

Temperatures, fan RPM, controller duty, loads, voltages, power and clocks, read
live from LibreHardwareMonitor's WMI namespace and grouped by the chip they came
off. Tick **Live** for a three-second refresh. If LHM is not running the panel
says exactly that and offers to install it, rather than showing empty dials.

### Fan control — the honest version

Setting a fan curve means writing to the Super IO or embedded controller. On
Windows that needs a signed kernel-mode driver, which is precisely what
FanControl and LibreHardwareMonitor ship and why they exist. ProGramerly does
not ship a kernel driver, and an application claiming to set your fan curve
without one would be lying to you.

So it does the part it can do well: detects both tools, installs either through
winget on request, launches them, shows which are running, and reads their
sensors on the panel above. The curve is set in the tool that owns the driver.
That is the correct division of labour, not a limitation being dressed up as
one.

### RGB — a real OpenRGB SDK client

A complete, dependency-free implementation of the OpenRGB network protocol,
spoken over TCP to a running OpenRGB server (127.0.0.1:6742 — switch it on
under **Settings → General → Start server**). That reaches motherboard 12 V
headers, 5 V addressable headers, GPU, RAM, AIO pumps, fan controllers,
keyboards and mice, because OpenRGB already carries the per-vendor reverse
engineering and reimplementing any of it would be worse in every way.

What the client does:

- enumerates every controller, its zones (with LED counts per zone, so a 12 V
  header and a 24-LED ARGB strip are told apart) and every built-in mode
- sets one colour across a single device or every device at once, via
  `SETCUSTOMMODE` then a per-LED `UPDATELEDS` write
- applies any of a device's own effects by re-serialising its mode

The protocol negotiation deliberately caps at version 3. Version 4 adds zone
segments and version 5 adds controller flags, neither of which this client
needs — asking for 3 makes the server emit exactly the layout the parser
implements, which removes a whole class of parsing bug. One unreadable
controller is reported as unreadable and costs you none of the others.

### Memory and cache

- **RAM flush** calls `EmptyWorkingSet` on every reachable process. Pages move
  to the standby list, where Windows can still reuse them — and the panel says
  so, rather than claiming memory was freed.
- **Purge standby list** is the `NtSetSystemInformation` call RAMMap makes,
  which actually returns those pages to free. It needs `SeProfileSingleProcess`
  privilege and an administrator token; without them it reports privilege not
  held instead of silently doing nothing.
- Free memory is read **before and after both**, so every number reported is
  measured.
- **Clear temp cache** empties the OS temporary folder and nothing else. Not
  browser caches, not package caches, not anything inside a project. Files a
  running program still holds open are counted as left alone, not as deleted.

---

## Profile

Name, email, role, organisation and a preferred install profile, stored in
settings — alongside a read-only summary of the machine itself: host and user,
OS build, processor and core count, memory, GPU, free space, whether this
session holds an administrator token, the development folder, and how many
catalogue items ProGramerly has installed here.

---

## System Doctor — diagnose, then fix

A tab of its own. It answers three questions for every check: what is wrong,
why that matters on a development machine specifically, and whether this app
can repair it without turning you into a systems administrator.

Two rules hold throughout, and they are the reason it is safe to press:

- **A check never changes anything.** Running diagnostics is always safe.
- **A Fix button only appears on a check that actually failed**, and it always
  reports the command it ran and what came back. Nothing is silently
  "handled".

**Fix everything safe** does exactly the subset that is safe unattended.
Anything needing administrator rights, a restart, or a judgement call is
deliberately left out and stays a single deliberate click — the run tells you
which ones it left alone and why.

What it looks at:

| Check | The failure it catches |
| --- | --- |
| Free space | Package managers unpack before they install; under a few GB, installs fail looking like network errors |
| Temporary files | Failed installers abandon unpacked payloads in TEMP — usually the biggest pile of dead weight on the machine |
| ProGramerly's own logs | A log per launch adds up; prunes anything over 30 days |
| Node and npm | Missing or pre-18 Node quietly breaks every npm-installed item in the catalogue |
| npm cache integrity | A half-written cache entry survives every retry until the cache is verified |
| Git identity | Commits attributed to nobody, which some hosts reject outright |
| Git credential helper | The reason every push asks again — and the fix is the same `gh auth setup-git` that kills the popups |
| PATH sanity | Dead and duplicated entries, plus the Windows length limit that silently truncates |
| Environment variables | `NODE_TLS_REJECT_UNAUTHORIZED=0`, stray `PYTHONHOME`, global `NODE_ENV=production`, blanket `NODE_OPTIONS` |
| Package managers | winget / Chocolatey / Homebrew present, and their source index refreshed |
| Long path support | Windows truncating at 260 characters is why deep `node_modules` trees refuse to copy or delete |
| Developer Mode | Without it, creating a symlink needs elevation — which is why pnpm and bun fail on Windows and nowhere else |
| PowerShell execution policy | `Restricted` blocks the `.ps1` files package managers write for you |
| Pending restart | Installers failing for reasons that have nothing to do with the installer |
| Xcode command line tools | macOS: native npm modules cannot build without them |
| ProGramerly itself | Catalogue parses, settings parse, log folder is writable |

The PATH fix only ever rewrites the **user** value, never the machine one, and
writes the old value to a timestamped backup file first. On macOS and Linux it
refuses to touch anything — your shell profile is yours — and just names the
dead entries so you know which lines to delete.

### The report folder

**Full report** runs everything, snapshots the machine, checks the usual
development ports, and leaves one timestamped folder under
`userData/diagnostics/` containing:

```
report.md      the whole thing, readable, with a "why this matters" section
report.json    the same data, for anything that wants to parse it
path.txt       every PATH entry, one per line
<newest>.log   the current ProGramerly log, copied in
```

That folder is the thing to zip and send when something needs a second pair of
eyes. **Reports folder** opens it.

### Toolbox

- **Environment report** — OS, CPU, RAM, GPU, disks, and the version of every
  development tool it can find, written into the report folder.
- **Disk cleanup** — measures first, deletes second. npm, pip, Electron and
  electron-builder caches, Chocolatey downloads, Homebrew's cache, TEMP over 7
  days, ProGramerly's own logs over 30. Everything offered is re-downloaded
  when next needed; nothing here is state you cannot lose. Windows'
  `%LOCALAPPDATA%\\Packages` is deliberately **not** offered — it holds live
  application state as well as installer payloads, and there is no safe line
  between the two from outside.
- **Port inspector** — what is holding a port, by name and PID, with the full
  command line on Windows. The answer to `EADDRINUSE` without opening a
  terminal. It can also sweep the usual suspects (3000, 5173, 5432, 8080,
  11434, 27017 and friends).

---

## The backdrop

A small graph of soft gradient nodes drifting behind the whole application,
linked to their neighbours by gradients that belong to both endpoints, all
breathing on one shared eleven-second oscillator — so the field inhales and
exhales as a single thing rather than as thirty independent animations.

Restraint is the point. Few nodes, low alpha, no hard edges, nothing that
competes with the text in front of it. A backdrop you notice is a backdrop
that failed.

It costs nothing when nobody is looking at it: the loop stops on window blur
and on tab hide, the node count scales with the window area and caps at thirty,
`prefers-reduced-motion` gets one still frame and no loop at all, and the
Settings switch stops it drawing entirely.

---

## One prompt, then silence — administrator handling

Windows raises a UAC consent dialog for every machine-scope installer. Across a
full profile that is a hundred dialogs, which is not an install, it is a
data-entry job. ProGramerly asks once instead.

**Settings → "Run as administrator automatically"** (on by default) means that
at launch, before a window is even drawn, ProGramerly checks whether it holds an
administrator token. If it doesn't, it restarts itself with one — a single
consent dialog — and every `winget` and `choco` install for the rest of that
session inherits the elevated token and runs silently. The package commands
already carry `--silent --disable-interactivity --accept-package-agreements
--accept-source-agreements` and `choco -y`, so with elevation sorted there is
nothing left to click.

Three details in that restart matter, and each of them was a real bug worth
naming:

- **The single-instance lock is released first.** Otherwise the elevated copy
  loses the race against the copy that spawned it, quits during startup, and
  you consented to a UAC prompt for nothing at all.
- **The relaunch is awaited, and a decline is honoured.** Cancelling UAC leaves
  the app running normally as a standard user. It does not quit into nothing.
- **The original arguments are forwarded, plus an `--elevated` marker.** The
  new copy starts exactly the way this one did, and the marker means a
  misreporting `IsInRole` check can never spawn prompts in a loop.

Turn the setting off and ProGramerly runs as a standard user; the install run
then warns you once, up front, that each package will ask for itself — rather
than discovering that fact a hundred dialogs in. The **Restart as
Administrator** badge in the header does the same thing on demand.

On macOS the GUI is never run as root, which would be wrong. Instead the
install run primes `sudo` once through the system's own authorisation prompt
and keeps that credential warm for the length of the run, so cask installers
do not stall halfway.

---

## Push & release — maintainer only

On the **Updates** tab, when ProGramerly is run from its own source checkout
(`npm start`, not the packaged install — a packaged app has no `.git` to
push), there is a **Push & Release** card. It turns the whole "get this onto
GitHub as a proper Release" chore into one button:

1. Writes `.github/workflows/build.yml` from the copy bundled inside the app,
   so the CI workflow is never a step you do by hand.
2. Runs `git init` if this isn't a repository yet, and points `origin` at the
   configured owner/repo (`Ionity-Global-Pty-Ltd/ProGramerly` by default).
3. Creates the GitHub repository if it doesn't exist — via the `gh` CLI if
   you're signed in, or via a GitHub token you can store in the same card
   (encrypted at rest with the OS keychain; used only for this one call,
   never for the push itself). No `gh`? The card has its own **Install
   GitHub CLI** button (`winget install GitHub.cli` / `brew install gh`) so
   you never have to go find it in the Software tab first.
4. Commits everything, pushes to `main` through your system's own git
   credential manager (no token ever goes near the push URL), tags the
   release as `v<version>` from `package.json`, and pushes the tag.

That tag push is what fires the real build: GitHub's own `windows-latest`
and `macos-latest` runners build the actual installer and the actual macOS
`.dmg`, and publish both together as a GitHub Release a few minutes later.
Nothing in ProGramerly itself ever fakes a Mac build — that only happens on
Apple's own OS, on GitHub's runner.

Every step reports honestly in the card's own console: if `git` isn't on the
`PATH`, or the repo can't be created automatically, it says so and stops
rather than pretending to have finished.

### Or: `PUBLISH.cmd` — the same thing, without opening the app

Double-click **`PUBLISH.cmd`** in the checkout root. It runs
`scripts/publish-github.ps1`, which is deliberately boring and safe to run
again as many times as you like — every step checks before it acts:

1. Installs Git and the GitHub CLI through `winget` if they are missing, then
   re-reads `PATH` in-process so the run can use what it just installed
   instead of telling you to open a new window.
2. Signs you in with GitHub's device flow — a one-time code you paste into
   your own browser. No password is typed by anything but you.
3. Runs `gh auth setup-git`. **This is the step that removes the Git
   Credential Manager popups**: git then pushes with the token `gh` already
   holds, and stops opening dialogs of its own.
4. Creates `Ionity-Global-Pty-Ltd/ProGramerly` if it does not exist, commits, pushes,
   tags `v<version>`, pushes the tag, and opens the Actions page so you can
   watch the build.

If your account cannot create repositories in the organisation, it says exactly
that and tells you what to ask an owner for, instead of failing halfway.

---

## The intro

ProGramerly opens with the IONITY loader: the charging beam with its rising
tone, the 6 kHz impact and quadruple flash, the block logo, the typed
`ANYTHING IS POSSIBLE | BY CREATOR FOR CREATION`, the loader bar with its status
lines, then six pulses with scattered stars at 4 kHz. `Console.Beep` was a square
wave, so the audio is a square oscillator with a short envelope — the same
instrument, in the browser.

The wordmark is drawn from rectangles rather than typed with box-drawing
characters: the console original relied on a font that is not on every machine,
and one missing glyph turns a logo into rubble. Click, press any key, or hit
**Skip** to jump straight in — and there is a hard 12-second ceiling in the main
process, because an application must never be held hostage by an animation.
Both the intro and its sound are switches in Settings.

---

## Install

### Windows

Download `ProGramerly-Setup-1.0.0-x64.exe` from
[Releases](https://github.com/Ionity-Global-Pty-Ltd/ProGramerly/releases) and run it.
It installs per-user, so no admin prompt to install ProGramerly itself. The app
then asks for elevation once, when you actually press Install.

There is also a **portable** build that runs from a USB stick with no install.

### macOS

Download `ProGramerly-1.0.0-arm64.dmg` (Apple Silicon) or `-x64.dmg` (Intel),
drag it to Applications. macOS asks for your password once at the start of a
run so cask installers do not stall halfway through.

### No installer, just the script

If you would rather not run a GUI at all, the same catalog runs headless:

```powershell
# Windows - elevated PowerShell
irm https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/scripts/programerly.ps1 | iex
```

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/scripts/programerly.sh | bash
```

Both accept `--profile ai`, `--only git,node,claude-desktop`, `--list` and
`--dry-run` (`-WhatIf` on PowerShell).

---

## Adding your own software

Everything ProGramerly installs lives in one file:
[`src/main/catalog/catalog.json`](src/main/catalog/catalog.json). The GUI, the
PowerShell script and the bash script all read it — add an entry once and it
appears in all three.

```jsonc
{
  "id": "my-tool",
  "name": "My Tool",
  "group": "libs",
  "desc": "One line that shows under the name in the UI.",
  "profiles": ["full"],
  "dependsOn": ["node-system"],
  "win": { "winget": ["Publisher.MyTool"], "choco": ["my-tool"] },
  "mac": { "brew": { "cask": ["my-tool"] } },
  "npm": ["my-tool-cli"],
  "steps": [
    { "type": "shell", "cmd": "my-tool --version", "allowFail": true }
  ]
}
```

`winget` takes an **array of candidate IDs** and tries each in turn — when a
publisher renames a package, add the new ID next to the old one instead of
replacing it, and the entry keeps working on machines with either.

Step types:

| Type | Does |
| --- | --- |
| `shell` | Runs a command. `cmd`, plus optional `winCmd` / `macCmd` overrides, and `allowFail` |
| `vscodeExt` | Installs VS Code extensions with `--force`, tolerating individual failures |
| `gitClone` | Clones into the dev root, or pulls if it is already there |
| `workspace` | Lays out the standard Ionity dev tree |
| `mcpConfig` | Merges the MCP servers into `claude_desktop_config.json` |
| `chromeExt` | Chrome extensions, by enterprise policy when elevated, by Web Store page when not |
| `venv` | Creates the managed virtual environment at `Development/.venvs/ionity` |
| `venvPip` | `pip install` into that environment — `packages`, plus optional `args` for a custom index |
| `scaffold` | Writes a starter project. Never overwrites a folder that already has anything in it |

A platform block also takes `pre` (runs before the package managers — Homebrew
taps, extra repositories) and `post` (runs after them).

Then check your work:

```bash
node scripts/validate-catalog.js      # schema, groups, profiles, step types, dependency cycles
node scripts/dry-run.js full win      # print the exact command plan, run nothing
node scripts/syntax-check.js          # parse every shipped .js and .json
```

---

## The download page

`docs/index.html` is the public landing page — turn on GitHub Pages for the
`docs/` folder and it serves itself. It reads the latest release straight from
the GitHub API at load time, so the version, the file sizes and every download
link are whatever is actually published, not something hard-coded that rots on
the next tag. The backdrop is a flow field of dashes on one slow ~13-second
breath: stroke opacity, drift speed, trail length and the core glow all ride the
same oscillator, so the whole field inhales and exhales together instead of
looking like six unrelated animations. The pointer pushes the field away from
itself. `prefers-reduced-motion` gets a single static frame, and the canvas
stops entirely when the tab is hidden.

---

## Build from source

```bash
git clone https://github.com/Ionity-Global-Pty-Ltd/ProGramerly.git
cd ProGramerly
npm install
npm start              # run the GUI
npm run start:min      # start straight into the tray
npm run validate       # catalog
npm run lint:syntax    # parse every shipped source file
npm run build          # alias for npm run dist
npm run dist           # build for current platform
npm run dist:win       # -> dist/ProGramerly-Setup-*.exe   (on Windows)
npm run dist:mac       # -> dist/ProGramerly-*.dmg         (on macOS)
npm run dist:linux     # -> dist/ProGramerly-*.AppImage / *.deb (on Linux)
```

`PROGRAMERLY_UI_FIXTURES=1` makes the Windows-only readers return a fixed
sample, so the registry screen can be rendered and screenshotted from a Linux
CI runner. A screen nobody has ever looked at is a screen nobody has tested.

Cross-compiling desktop installers is unreliable, so CI builds each target on
its own runner.

## Create release artifacts

The workflow at `.github/workflows/build.yml` builds and publishes release
artifacts on:

- `push` tags matching `v*`
- `release` events (`published`)
- manual `workflow_dispatch`

Artifact matrix:

| Platform | Artifacts |
| --- | --- |
| Windows | `ProGramerly-Setup-<version>-x64.exe`, `ProGramerly-Setup-<version>-arm64.exe`, `ProGramerly-Portable-<version>.exe` |
| macOS | `ProGramerly-<version>-arm64.dmg`, `ProGramerly-<version>-x64.dmg` (+ `.zip`) |
| Linux | `ProGramerly-<version>-*.AppImage`, `ProGramerly-<version>-*.deb` |

The workflow also attaches `SHA256.txt` to the GitHub Release.

Code-signing/notarization is optional:

- macOS signing/notarization: `MAC_CERT_P12_BASE64`, `MAC_CERT_PASSWORD`,
  `APPLE_ID`, `APPLE_APP_PASSWORD`, `APPLE_TEAM_ID`
- Windows code signing: `CSC_LINK`, `CSC_KEY_PASSWORD`

Without signing secrets, builds are unsigned but still generated.

---

## How a failure behaves

Nothing aborts the run. Each item reports **ok / partial / failed / skipped**,
the full console output is written to a timestamped log
(`%APPDATA%\ProGramerly\logs` or `~/Library/Application Support/ProGramerly/logs`),
and you can re-run just the items that failed. The most common cause is a
package ID that moved — the fix is one line in `catalog.json`.

Windows exit codes that mean *"already installed, nothing to do"* are treated
as success, not failure.

---

## Design notes

- **`contextIsolation: true`, `nodeIntegration: false`, strict CSP.** The
  renderer gets a fixed list of named IPC calls and no filesystem, no Node and
  no arbitrary channel names.
- **Zero runtime dependencies.** Metrics, the network probe, the GitHub updater
  and the registry reader are all built on Node's standard library and the
  shell the OS already has. `package.json` has no `dependencies` block at all —
  only Electron and electron-builder to build it.
- **The window is created before the intro plays** and only revealed when it
  ends, so the renderer is warm by the time the logo lands — and the app can
  never quit itself in the gap between the two windows.
- **Elevation happens once**, not per package. Windows relaunches elevated on
  request; macOS primes `sudo` through `osascript` and keeps the timestamp
  warm for the length of the run.
- **Dependencies are resolved, then topologically sorted**, with catalog order
  as the tiebreaker so package managers bootstrap first.
- **The catalog is data, not code**, so the GUI, PowerShell and bash paths can
  never drift apart.

---

<div align="center">

**Ionity (Pty) Ltd** — formerly Antwerp Designs — AEDI
Johan Wilhelm van Antwerp · Centurion, Gauteng, South Africa
[ionity.today](https://www.ionity.today) · [ionity.world](https://www.ionity.world) · [ionity.co.za](https://www.ionity.co.za)
ORCID [0009-0005-7181-0347](https://orcid.org/0009-0005-7181-0347)

Governance **Policy 986 AED** · Licence CC BY-NC-SA 4.0 where stated
© 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — All rights reserved — TM²

_Building Tomorrow, Today. Anything is Possible with God._

</div>
