# ProGramerly 3.7.0: the IDE Lab, Maker & Embedded, Linux installs

Ionity (Pty) Ltd | AEDI | Policy 986 AED | 2026-10-05
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-003 | Catalog 1.4.0 | Supersedes 3.6.2 (2026-10-02)

## What changed

**The IDE Lab.** Every mainstream IDE is now a catalog item, each with its Windows, macOS and Linux route.

- **Kiro** - Amazon's agentic IDE (`Amazon.Kiro` on winget, the `kiro` cask, the signed .deb or tarball on Linux). Full and AI Dev profiles.
- **Kiro CLI** - installed with Kiro's own script: `irm https://cli.kiro.dev/install.ps1 | iex` on Windows, `curl -fsSL https://cli.kiro.dev/install | bash` elsewhere. Binary `kiro-cli`; `kiro-cli doctor` checks it.
- **Visual Studio Community 2026** replaces 2022 as the default (`Microsoft.VisualStudio.Community`), with the Python and Unity (ManagedGame) workloads and the Git component added. The 2022 package is the automatic fallback, and a separate side-by-side **Visual Studio 2022** item is there for solutions that pin it. Build Tools stay on 2022, which is what node-gyp expects, and gain the CMake component.
- **JetBrains outright**: IntelliJ IDEA Community, PyCharm Community, WebStorm, Rider, CLion - beside the Toolbox.
- **Eclipse** (Java + C/C++), **Sublime Text 4**, **Notepad++**, **VS Code Insiders**, **Helix + Lapce**.
- **GitHub Desktop** now installs on Linux (shiftkey community build: apt and rpm repos, Flatpak fallback) and is in every profile.
- **MCP config for the IDEs.** The same server set Claude Desktop gets is merged into `~/.kiro/settings/mcp.json`, `~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json` and the user scope of `~/.claude.json`. Existing entries are kept; a .bak is written first.

**Maker & Embedded** - a fifth profile, 31 items on Windows.

- **Arduino IDE 2 + arduino-cli + cores**: AVR, SAMD, Mbed RP2040, ESP32, ESP8266 and the community RP2040 core, plus a starter library set (NeoPixel, DHT, ArduinoJson, PubSubClient, WiFiManager, SSD1306, OneWire, Servo, ...). Linux adds the user to the dialout group.
- **ESP-IDF v5**: shallow clone into `<dev root>/Hardware/esp-idf` at `v5.5`, then Espressif's installer for esp32, esp32s3, esp32c3, esp32c6 and esp32h2.
- **VS Code embedded extension set**: Arduino, PlatformIO, ESP-IDF, Cortex-Debug, Serial Monitor, Wokwi, Pico, Pymakr, C/C++ tools, CMake.
- **Serial terminals & flashing tools**: PuTTY and Tera Term 5; minicom, picocom and screen; pyserial, esptool and pyocd in the managed venv.
- **Raspberry Pi Imager + balenaEtcher.** **STM32 & Cortex tooling**: Arm GNU toolchain, OpenOCD, stlink. **Processing 4** joins the maker group.
- PlatformIO writes its udev rules on Linux. CLion is in this profile as the IDE for the toolchain.

**WSL.**

- `WSL 2 + Ubuntu 24.04` installs the current LTS by name (plain `Ubuntu` as fallback), updates the kernel, pins version 2 and writes a `.wslconfig` (half the RAM, 4 GB swap, mirrored networking) if none exists.
- **WSL: dev toolchain inside Ubuntu** - build-essential, git, Python + venv + pip, Node.js LTS from NodeSource, Docker, OpenSSH, jq/ripgrep/fzf, and systemd turned on. Runs after the reboot; it tells you if the distro is not registered yet.
- **WSL: Debian + Kali** as optional extra distros.

**Linux is now a real install target.** The engine, the bash script and the planner all learned the native package managers.

- 129 of 166 items carry a `linux` block: an `apt`, `dnf`, `pacman` or `zypper` list, with `flatpak` and `snap` fallbacks that only run when the native list did not deliver. A new **Linux package sources** bootstrap item refreshes the index, installs Flatpak with the Flathub remote and snapd where the distro allows it.
- `sudo` in a Linux step is rewritten to `pkexec` when the desktop has no passwordless sudo, so the system's own authentication dialog appears instead of a hang. Root needs nothing.
- The Full profile on Linux resolves 118 items (3.6.2: only the npm and shell-step items applied).
- AEDi Predict probes the distro mirrors, Flathub and the Snap Store, and names `linux-pkg` as the provider when a manager is missing.
- The bash script's catalog URL pointed at the old organisation name; fixed.

**Engine.**

- `stopOnFirstSuccess` on a `win` block makes the winget candidates a chain of alternatives (2026, then 2022) instead of a set to install in full (Python 3.13 and 3.12).
- `gitClone` takes `branch` and `recursive`. `mcpConfig` takes `target`.
- The runner re-reads PATH from the registry (Windows) or prefixes `~/.local/bin`, `~/.cargo/bin`, Homebrew, snap and Flatpak export paths (macOS, Linux) before every step, so `arduino-cli`, `gh` or `kiro-cli` installed one step earlier is callable in the next without a new terminal.
- Pre-steps now run before the package managers in both scripts, matching the app (the apt repo key for VS Code is written before `apt install code`).
- The validator checks every key in a platform block. It found three dormant defects in the 3.6.2 catalog - `allowFail` where `allowPartial` was meant (twice) and an OpenRGB mac spec whose cask was at the wrong level and never installed - all fixed.

No account is linked anywhere. Every client is installed and left signed out.

## Verification

- `validate-catalog`: 166 items, 22 groups, 5 profiles, OK. Platform coverage: Windows 163, macOS 149, Linux 129.
- `syntax-check`: 63 files parse. `test-predict`: 15 checks pass, including a new Linux case.
- `dry-run` resolves every profile on all three platforms (Windows full 150, AI 68, minimal 26, embedded 31; macOS 138/64/23/27; Linux 118/55/17/25).
- The Linux engine path was exercised on a Debian container: `curl` (already present, reported ok) and `neovim` (installed through apt) both returned `ok`. The `sudo` to `pkexec` rewrite was unit-checked against chained commands.
- The MCP writer was run against a scratch home for Kiro, Cursor and Claude Code: new files created, an existing Kiro entry kept, a .bak written.
- Every winget ID, Homebrew cask and Chocolatey name added in this release was resolved against the live indexes on 2026-10-05.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM

BUILDING TOMORROW, TODAY
