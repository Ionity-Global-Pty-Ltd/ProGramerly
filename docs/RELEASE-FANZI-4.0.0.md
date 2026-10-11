# ProGramerly: FANZi IO-nity 4.0.0, linked from the app and the download page

Ionity (Pty) Ltd | AEDI | Policy 986 AED | 2026-10-11
Author: Johan Wilhelm van Antwerp, prepared with Claude (Cowork)
Document ID: DOC-2026-10-003 | Applies from the next ProGramerly release after 3.6.2

## What changed

**FANZi IO-nity has a public release.** The fan tool bundled in ProGramerly is FANZi IO-nity (component `Fanzi.FanControl`). Its first public GitHub release, **v4.0.0 (2026-10-11)**, is now linked from the app and from the download page:

https://github.com/Ionity-Global-Pty-Ltd/FANZi-IO-nity/releases/tag/v4.0.0

| Asset | Size |
| --- | --- |
| `FANZi-IO-nity-v4.0.0-Installer-win-x64.zip` | 112 MB |
| `FANZi-IO-nity-v4.0.0-Portable-win-x64.exe` | 142 MB |
| `FANZi-IO-nity-v4.0.0-Portable-win-x64.zip` | 59.1 MB |
| `SHA256SUMS.txt` | 599 B |

Windows 10 / 11 x64. 4.0.0 brings RGB Studio, AEDi Lighting AI (offline), Overlay Studio, a deep hardware scan that cross-checks OpenRGB against Windows, device cards with Identify, and one shared heartbeat for every panel.

**In the app.**

- `src/main/data/programs.json`: the `fanzi` entry is now the product **FANZi IO-nity** and carries a `release` block (repo, tag, version, date, page, latest, platform, four assets, highlights). The bundled payload pin (file, byte size, SHA-256) is unchanged.
- `programs.js`: `list()` returns `release` for each program through `publicRelease()`, which keeps only `https://github.com/` links. Nothing in the block is downloaded or launched by the app.
- Hardware → **Fan control**: the window head has a second button, *FANZi IO-nity 4.0.0 · release*, next to *Open FANZi IO-nity*. Under *Who writes the curve* a release card lists the highlights and the four assets; every button opens the browser via `app:openExternal`.
- A build without the bundled payload (no `PAYLOAD_TOKEN`, or macOS / Linux) used to stop at *not in this build*. It now opens the public release instead.

**On the download page.** A new *Also free from Ionity* section after *Every OS* with the FANZi tile (Installer, Portable .exe, Portable .zip), a *New in 4.0.0* tile, release notes, GitHub, wiki and the checksum file. The Fans tool card links to it. 

**On www.ionity.co.za.** FANZi IO-nity is listed under Software and on the Freebies shelf with the same release links (separate repository, same day).

## Verification performed

- `node scripts/syntax-check.js` - every source parses.
- `node scripts/check-programs.js` - manifest valid, 4 programs pinned.
- Every release URL in `programs.json`, the download page and the site answers HTTP 200/302 at GitHub.

Governance: Policy 986 AED - (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM
