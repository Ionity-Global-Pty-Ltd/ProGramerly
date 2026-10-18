# Push ProGramerly to Ionity-Global-Pty-Ltd

## The short version

Double-click **`PUBLISH.cmd`** in this folder. That is the whole procedure.

It installs Git and the GitHub CLI if they are missing, signs you in through
GitHub's device flow (a one-time code you paste into your own browser — nothing
types a password for you), wires git to that same login so **Git Credential
Manager stops throwing its own dialog on every push**, creates
`Ionity-Global-Pty-Ltd/ProGramerly` if it doesn't exist yet, then commits, pushes, tags
`v2.2.0`, pushes the tag, and opens the Actions page.

The tag push is what fires the real build. Safe to run again — every step
checks before it acts.

If your account can't create repositories in the organisation, the script says
exactly that and tells you what to ask an owner for, rather than dying halfway.

## The same thing from inside the app

**Updates → Push & Release**, when ProGramerly is run from this source checkout
(`npm start`). Same steps, same result, with a live console. It also has an
**Install GitHub CLI** button if `gh` is missing, and a token field if you'd
rather create the repository through the API than sign `gh` in.

## By hand, if you'd rather

```powershell
cd "G:\.Development\ProGramerly-Basic Software for All"
gh auth login --hostname github.com --git-protocol https --web --scopes "repo,workflow"
gh auth setup-git
gh repo create Ionity-Global-Pty-Ltd/ProGramerly --public
git init -b main
git add .
git commit -m "ProGramerly v2.2.0 - Basic Coding Software for All"
git remote add origin https://github.com/Ionity-Global-Pty-Ltd/ProGramerly.git
git push -u origin main
git tag v2.2.0
git push origin v2.2.0
```

`dist/` and `node_modules/` are already in `.gitignore`, and
`.github/workflows/build.yml` is already written into this checkout (the app
rewrites it itself if it ever goes missing).

`gh auth setup-git` is the line that matters if you are tired of credential
popups: after it, git pushes with the token `gh` already holds.

## What the tag actually does

`validate` + `smoke` on `ubuntu-latest`, the real Windows installer on
`windows-latest`, the real macOS `.dmg` on `macos-latest` — genuinely built by
Apple's own toolchain on GitHub's runner, not emulated — then a `release` job
that collects both, generates `SHA256.txt`, and publishes everything as a
GitHub Release. Ten to fifteen minutes end to end; macOS is the slow one.

Turn on GitHub Pages for the `docs/` folder and `docs/index.html` becomes the
public download page. It reads the latest release from the GitHub API at load
time, so it never needs editing when the version changes.

## Optional — sign the builds

| Secret | What it is |
| --- | --- |
| `MAC_CERT_P12_BASE64` | Your Developer ID Application `.p12`, base64-encoded |
| `MAC_CERT_PASSWORD` | The password on that `.p12` |
| `APPLE_ID` | Your Apple developer account email |
| `APPLE_APP_PASSWORD` | An app-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Your 10-character Apple team ID |
| `CSC_LINK` / `CSC_KEY_PASSWORD` | Windows Authenticode certificate, the same way |

Without these the Release still ships working, unsigned builds — Windows shows
"Windows protected your PC" (More info → Run anyway) and macOS shows the
Gatekeeper right-click → Open prompt.

---

## Running the v2.2.0 installer right now, before the Release exists

A v2.2.0 Windows x64 installer is already built and sitting in `dist\` on this
machine. It is over the per-file limit for writing to disk in one piece, so it
came across in five parts. In `dist\`, double-click:

```
ASSEMBLE.cmd
```

It rebuilds `ProGramerly-Setup-2.2.0-x64.exe` and checks its SHA-256 against:

```
477c0fb56f244e55f9f20a4dcc2158dcff19693e44b819cb6b0e5da5af8dbb10
```

(The parts were reassembled and verified byte-identical before they were sent,
so a mismatch means the copy, not the build.)

Unsigned, so SmartScreen shows "Windows protected your PC" — More info → Run
anyway. On first launch it asks for administrator access once; say yes and no
installer after that will ask again.

There is no local Mac build from this machine — a genuine `.dmg` needs Apple's
own toolchain, which only exists on the `macos-latest` runner once you push the
tag. That is the one and only real path to a Mac launcher.

---

Governance: Policy 986 AED · © 2018–2026 Antwerp Designs | Ionity (Pty) Ltd — TM
Author: Johan Wilhelm van Antwerp · <https://www.ionity.today>
