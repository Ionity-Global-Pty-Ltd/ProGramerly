#!/usr/bin/env bash
# ============================================================================
#  ProGramerly - Basic Coding Software for All  (macOS / Linux bootstrap)
#
#  Author     : Johan Wilhelm van Antwerp
#  Company    : Antwerp Designs | Ionity (Pty) Ltd | AEDI
#  Governance : Policy 986 AED
#  Copyright  : (c) 2018-2026 - All rights reserved - TM2
#  Web        : https://www.ionity.today
#
#  Usage:
#    ./programerly.sh                     # full profile
#    ./programerly.sh --profile ai        # ai | minimal | full
#    ./programerly.sh --only git,node     # explicit item ids
#    ./programerly.sh --list              # show the catalog
#    ./programerly.sh --dry-run           # print commands, run nothing
# ============================================================================
set -uo pipefail

C='\033[1;36m'; G='\033[1;32m'; Y='\033[1;33m'; R='\033[1;31m'; D='\033[0;90m'; N='\033[0m'
PROFILE="full"; ONLY=""; DRY=0; LIST=0
CATALOG_URL="https://raw.githubusercontent.com/Ionity-Global/ProGramerly/main/src/main/catalog/catalog.json"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --only)    ONLY="$2";    shift 2 ;;
    --dry-run) DRY=1;        shift   ;;
    --list)    LIST=1;       shift   ;;
    --catalog) CATALOG="$2"; shift 2 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown option: $1"; exit 2 ;;
  esac
done

banner() {
  printf "\n${C}  ############################################################${N}\n"
  printf "${C}  #   P R O G R A M E R L Y                                  #${N}\n"
  printf "${C}  #   Basic Coding Software for All                          #${N}\n"
  printf "${C}  #   Antwerp Designs | Ionity (Pty) Ltd | AEDI              #${N}\n"
  printf "${C}  #   Policy 986 AED  -  Building Tomorrow, Today.           #${N}\n"
  printf "${C}  ############################################################${N}\n\n"
}
say()  { printf "  ${D}%s${N}\n" "$*"; }
head_(){ printf "\n${C}  == %s${N}\n" "$*"; }
good() { printf "     ${G}[ok]   %s${N}\n" "$*"; }
warn() { printf "     ${Y}[warn] %s${N}\n" "$*"; }
bad()  { printf "     ${R}[fail] %s${N}\n" "$*"; }

banner

command -v python3 >/dev/null 2>&1 || { bad "python3 is required to read the catalog"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CATALOG="${CATALOG:-$HERE/../src/main/catalog/catalog.json}"
if [[ ! -f "$CATALOG" ]]; then
  CATALOG="$(mktemp -t programerly).json"
  say "downloading catalog…"
  curl -fsSL "$CATALOG_URL" -o "$CATALOG" || { bad "could not fetch catalog"; exit 1; }
fi

PLAT="mac"; [[ "$(uname -s)" == "Linux" ]] && PLAT="linux"
DEV_ROOT="${PROGRAMERLY_DEV_ROOT:-$HOME/Development}"
export DEV_ROOT

if [[ $LIST -eq 1 ]]; then
  python3 - "$CATALOG" "$PLAT" <<'PY'
import json,sys
cat=json.load(open(sys.argv[1])); plat=sys.argv[2]
def ok(i):
    p=i.get("platforms")
    return (plat in p) if p else bool(i.get(plat) or i.get("npm") or i.get("steps"))
for g in cat["groups"]:
    rows=[i for i in cat["items"] if i["group"]==g["id"] and ok(i)]
    if not rows: continue
    print(f"\n  == {g['label']}")
    for i in rows: print(f"  {i['id']:<24} {i['name']}")
print()
PY
  exit 0
fi

# Resolve the queue (ids, in catalog order, dependencies pulled in).
QUEUE=$(python3 - "$CATALOG" "$PLAT" "$PROFILE" "$ONLY" <<'PY'
import json,sys
cat=json.load(open(sys.argv[1])); plat, prof, only = sys.argv[2], sys.argv[3], sys.argv[4]
def ok(i):
    p=i.get("platforms")
    return (plat in p) if p else bool(i.get(plat) or i.get("npm") or i.get("steps"))
by={i["id"]:i for i in cat["items"]}
want=set(x.strip() for x in only.split(",") if x.strip()) if only else \
     {i["id"] for i in cat["items"] if ok(i) and prof in i.get("profiles",[])}
changed=True
while changed:
    changed=False
    for i in list(want):
        for d in by.get(i,{}).get("dependsOn",[]):
            if d in by and d not in want: want.add(d); changed=True
print("\n".join(i["id"] for i in cat["items"] if i["id"] in want and ok(i)))
PY
)

COUNT=$(printf '%s\n' "$QUEUE" | grep -c . || true)
say "profile: $PROFILE"
say "queue:   $COUNT items"
say "dev root: $DEV_ROOT"

if [[ "$PLAT" == "mac" ]] && ! command -v brew >/dev/null 2>&1; then
  head_ "Installing Homebrew"
  [[ $DRY -eq 1 ]] && say "DRY> homebrew install script" || \
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
fi
eval "$(/opt/homebrew/bin/brew shellenv 2>/dev/null || /usr/local/bin/brew shellenv 2>/dev/null || true)"

OK=0; PARTIAL=0; FAILED=0; SKIPPED=0; IDX=0

run_cmd() {
  if [[ $DRY -eq 1 ]]; then say "DRY> $1"; return 0; fi
  say "> $1"
  bash -lc "$1" 2>&1 | sed 's/^/       /'
  return "${PIPESTATUS[0]}"
}

while IFS= read -r ID; do
  [[ -z "$ID" ]] && continue
  IDX=$((IDX+1))
  NAME=$(python3 -c "import json,sys;print(next(i['name'] for i in json.load(open(sys.argv[1]))['items'] if i['id']==sys.argv[2]))" "$CATALOG" "$ID")
  head_ "[$IDX/$COUNT] $NAME"

  # Emit the concrete command list for this item as "kind<TAB>command".
  PLAN=$(python3 - "$CATALOG" "$PLAT" "$ID" <<'PY'
import json,sys
cat=json.load(open(sys.argv[1])); plat, iid = sys.argv[2], sys.argv[3]
item=next(i for i in cat["items"] if i["id"]==iid)
spec=item.get(plat,{}) or {}
out=[]
brew=spec.get("brew")
formulae = brew if isinstance(brew,list) else (brew or {}).get("formula",[])
casks    = (brew or {}).get("cask",[]) if isinstance(brew,dict) else spec.get("brewCask",[])
for f in formulae: out.append(("pkg", f"brew install {f}"))
for c in casks:    out.append(("pkg", f"brew install --cask {c}"))
npm = spec.get("npm") or item.get("npm")
if npm: out.append(("pkg", "npm install -g " + " ".join(npm) + " --no-fund --no-audit"))
VENV = '"$DEV_ROOT/.venvs/ionity"'
for s in (spec.get("pre",[]) + spec.get("steps",[]) + item.get("steps",[]) + spec.get("post",[])):
    t=s.get("type")
    if t=="shell":
        c = s.get("macCmd") if plat=="mac" and s.get("macCmd") else s.get("cmd")
        if c: out.append(("soft" if s.get("allowFail") else "hard", c))
    elif t=="vscodeExt":
        for e in s.get("ids",[]): out.append(("soft", f"code --install-extension {e} --force"))
    elif t=="gitClone":
        out.append(("soft", f'mkdir -p "$DEV_ROOT" && if [ -d "$DEV_ROOT/{s["dest"]}/.git" ]; then git -C "$DEV_ROOT/{s["dest"]}" pull --ff-only; else git clone --depth 1 {s["repo"]} "$DEV_ROOT/{s["dest"]}"; fi'))
    elif t=="workspace":
        dirs=" ".join(f'"$DEV_ROOT/{d}"' for d in ["Projects","Clients","POC","Scripts","Assets","Hardware","Docs","Archive","Sandbox",".mcp"])
        out.append(("soft", f"mkdir -p {dirs}"))
    elif t=="mcpConfig":
        out.append(("soft", "__MCP_CONFIG__"))
    elif t=="venv":
        out.append(("soft",
            f'mkdir -p "$DEV_ROOT/.venvs" && '
            f'if [ ! -x {VENV}/bin/python ]; then python3 -m venv {VENV} || python -m venv {VENV}; fi'))
    elif t=="venvPip":
        args = (s.get("args","") + " ").lstrip() if s.get("args") else ""
        pkgs = " ".join(s.get("packages",[]))
        out.append(("soft" if s.get("allowFail") else "hard",
            f'{VENV}/bin/python -m pip install --upgrade {args}{pkgs}'))
    elif t=="chromeExt":
        # No enterprise policy path outside Windows - open the store listings.
        opener = "open" if plat=="mac" else "xdg-open"
        for e in s.get("ids",[]):
            out.append(("soft", f'{opener} "{e["url"]}"'))
    elif t=="scaffold":
        out.append(("soft", f'echo "scaffold {s.get("kind")} is written by the desktop app - skipped here"'))
for kind,c in out: print(f"{kind}\t{c}")
PY
)

  ANY=0; BAD=0
  while IFS=$'\t' read -r KIND CMD; do
    [[ -z "${CMD:-}" ]] && continue
    if [[ "$CMD" == "__MCP_CONFIG__" ]]; then
      if [[ $DRY -eq 1 ]]; then say "DRY> write claude_desktop_config.json"; ANY=1; continue; fi
      "$HERE/write-mcp-config.sh" && ANY=1 || BAD=1
      continue
    fi
    if run_cmd "$CMD"; then ANY=1; good "${CMD:0:70}"
    else [[ "$KIND" == "soft" ]] && warn "${CMD:0:70}" || { BAD=1; warn "${CMD:0:70}"; }
    fi
  done <<< "$PLAN"

  if   [[ $ANY -eq 0 && $BAD -eq 0 ]]; then SKIPPED=$((SKIPPED+1)); say "nothing to do here"
  elif [[ $ANY -eq 1 && $BAD -eq 1 ]]; then PARTIAL=$((PARTIAL+1))
  elif [[ $ANY -eq 1 ]];              then OK=$((OK+1))
  else FAILED=$((FAILED+1)); bad "$NAME"; fi
done <<< "$QUEUE"

printf "\n${C}  ------------------------------------------------------------${N}\n"
printf "   ok %s   partial %s   failed %s   skipped %s\n" "$OK" "$PARTIAL" "$FAILED" "$SKIPPED"
printf "${C}  ------------------------------------------------------------${N}\n"
say "Open a new terminal so the updated PATH takes effect."
printf "\n  ${D}(c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - Policy 986 AED${N}\n"
printf "  ${D}Anything is Possible with God.${N}\n\n"
