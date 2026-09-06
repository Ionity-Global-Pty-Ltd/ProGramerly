#!/usr/bin/env bash
# ProGramerly - write claude_desktop_config.json (macOS)
# Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED
set -uo pipefail
ROOT="${PROGRAMERLY_DEV_ROOT:-$HOME/Development}"
CFG="$HOME/Library/Application Support/Claude/claude_desktop_config.json"
mkdir -p "$(dirname "$CFG")" "$ROOT"
python3 - "$CFG" "$ROOT" <<'PY'
import json, os, sys, datetime, shutil
cfg, root = sys.argv[1], sys.argv[2]
servers = {
  "filesystem": {"command":"npx","args":["-y","@modelcontextprotocol/server-filesystem",root]},
  "memory": {"command":"npx","args":["-y","@modelcontextprotocol/server-memory"]},
  "sequential-thinking": {"command":"npx","args":["-y","@modelcontextprotocol/server-sequential-thinking"]},
  "playwright": {"command":"npx","args":["-y","@playwright/mcp@latest"]},
  "context7": {"command":"npx","args":["-y","@upstash/context7-mcp"]},
  "git": {"command":"uvx","args":["--from","mcp-server-git","mcp-server-git","--repository",root]},
  "fetch": {"command":"uvx","args":["mcp-server-fetch"]},
  "time": {"command":"uvx","args":["mcp-server-time","--local-timezone","Africa/Johannesburg"]},
}
data = {}
if os.path.exists(cfg):
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    shutil.copy2(cfg, f"{cfg}.{stamp}.bak")
    try: data = json.load(open(cfg))
    except Exception: data = {}
mcp = data.setdefault("mcpServers", {})
added = [k for k in servers if k not in mcp]
for k in added: mcp[k] = servers[k]
json.dump(data, open(cfg, "w"), indent=2)
print(f"     wrote {cfg}")
if added: print("     added: " + ", ".join(added))
PY
