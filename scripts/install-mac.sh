#!/bin/bash
# ProGramerly - one-line macOS installer
# Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
#
#   curl -fsSL https://raw.githubusercontent.com/Ionity-Global-Pty-Ltd/ProGramerly/main/scripts/install-mac.sh | bash
#
# Picks the Apple Silicon or Intel build, verifies it against the release's
# SHA256.txt, copies ProGramerly.app into /Applications (or ~/Applications
# when /Applications is not writable) and opens it. Files fetched with curl
# carry no quarantine flag, so Gatekeeper does not block the unsigned build.
#
# Options (environment):
#   PROGRAMERLY_VERSION=v3.9.0   install a specific release instead of latest
#   PROGRAMERLY_NO_OPEN=1        do not launch the app afterwards
set -euo pipefail

REPO="Ionity-Global-Pty-Ltd/ProGramerly"
say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
fail() { printf '\033[1;31mxx\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "This installer is for macOS. On Linux use the .AppImage, .deb or .rpm from the releases page."

# Apple Silicon, including a shell running under Rosetta.
arch="$(uname -m)"
if [ "$arch" = "arm64" ] || [ "$(sysctl -n sysctl.proc_translated 2>/dev/null || echo 0)" = "1" ]; then
  chip="arm64"; pattern='-arm64-mac\.zip$'
else
  chip="x64";   pattern='[0-9]-mac\.zip$'
fi
say "Mac: $(sw_vers -productName) $(sw_vers -productVersion) on $chip"

if [ -n "${PROGRAMERLY_VERSION:-}" ]; then
  api="https://api.github.com/repos/$REPO/releases/tags/$PROGRAMERLY_VERSION"
else
  api="https://api.github.com/repos/$REPO/releases/latest"
fi
json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api")" || fail "Could not reach GitHub ($api)."
tag="$(printf '%s' "$json" | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name": *"([^"]+)".*/\1/')"
urls="$(printf '%s' "$json" | grep '"browser_download_url"' | sed -E 's/.*"(https:[^"]+)".*/\1/')"
zip_url="$(printf '%s\n' "$urls" | grep -E "$pattern" | head -n1 || true)"
sum_url="$(printf '%s\n' "$urls" | grep -iE '/SHA256(SUMS)?\.txt$' | head -n1 || true)"
[ -n "$zip_url" ] || fail "Release $tag has no $chip macOS build. See https://github.com/$REPO/releases"
say "Release $tag - $(basename "$zip_url")"

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
curl -fL --progress-bar -o "$work/app.zip" "$zip_url" || fail "Download failed."

if [ -n "$sum_url" ]; then
  curl -fsSL -o "$work/SHA256.txt" "$sum_url"
  want="$(grep -i " \*\{0,1\}$(basename "$zip_url")\$" "$work/SHA256.txt" | awk '{print tolower($1)}' | head -n1 || true)"
  have="$(shasum -a 256 "$work/app.zip" | awk '{print tolower($1)}')"
  if [ -n "$want" ]; then
    [ "$want" = "$have" ] || fail "Checksum mismatch: expected $want, got $have. Nothing was installed."
    say "SHA-256 verified"
  else
    say "SHA256.txt does not list this file - continuing without a checksum"
  fi
else
  say "Release has no SHA256.txt - continuing without a checksum"
fi

ditto -x -k "$work/app.zip" "$work/out"
src="$(find "$work/out" -maxdepth 2 -name 'ProGramerly.app' -type d | head -n1)"
[ -n "$src" ] || fail "The archive does not contain ProGramerly.app."

dest_dir="/Applications"
[ -w "$dest_dir" ] || { dest_dir="$HOME/Applications"; mkdir -p "$dest_dir"; }
dest="$dest_dir/ProGramerly.app"

if pgrep -xq ProGramerly; then
  say "Closing the running ProGramerly"
  osascript -e 'tell application "ProGramerly" to quit' >/dev/null 2>&1 || true
  sleep 2
fi
[ -d "$dest" ] && rm -rf "$dest"
ditto "$src" "$dest"
xattr -dr com.apple.quarantine "$dest" 2>/dev/null || true
say "Installed to $dest"

if [ -z "${PROGRAMERLY_NO_OPEN:-}" ]; then
  open "$dest"
fi
say "Done. ProGramerly asks for your Mac password once per install run - never more."
