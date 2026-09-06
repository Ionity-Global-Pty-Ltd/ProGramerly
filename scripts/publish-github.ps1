<#
    ProGramerly - one-shot publisher
    Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED

    Takes this checkout from "nothing on GitHub" to "a tagged Release building
    on GitHub's own runners", in one run, with no popup to fight:

      1. installs Git and the GitHub CLI if they are missing (winget)
      2. signs you in with GitHub's own device flow - a one-time code you paste
         into your browser, no password typed anywhere
      3. teaches git to use that same login, which is what stops Git Credential
         Manager throwing its own dialog on every push
      4. creates Ionity-Global-Pty-Ltd/ProGramerly if it does not exist yet
      5. commits, pushes, tags, and pushes the tag - the tag is what fires the
         Windows + macOS build and publishes the Release

    Safe to run again: every step checks before it acts.
#>

[CmdletBinding()]
param(
  [string] $Owner  = 'Ionity-Global-Pty-Ltd',
  [string] $Repo   = 'ProGramerly',
  [string] $Branch = 'main',
  [string] $AuthorName  = 'Johan Wilhelm van Antwerp',
  [string] $AuthorEmail = 'ai@ionity.today',
  [switch] $NoTag
)

# Windows PowerShell 5.1 turns ANY line a native command writes to stderr into a
# terminating NativeCommandError while ErrorActionPreference is 'Stop' - even
# with 2>$null on the call. `git remote get-url origin` on a fresh repo does
# exactly that. Every step below checks $LASTEXITCODE itself, so Continue is the
# correct setting here, not a shortcut.
$ErrorActionPreference = 'Continue'
$ProgressPreference    = 'SilentlyContinue'
if ($PSVersionTable.PSVersion.Major -ge 7) { $PSNativeCommandUseErrorActionPreference = $false }

function Say  ($m) { Write-Host "  $m" }
function Step ($m) { Write-Host ""; Write-Host "== $m" -ForegroundColor Cyan }
function Good ($m) { Write-Host "  $m" -ForegroundColor Green }
function Warn ($m) { Write-Host "  $m" -ForegroundColor Yellow }
function Bad  ($m) { Write-Host "  $m" -ForegroundColor Red }

function Have ($name) { [bool](Get-Command $name -ErrorAction SilentlyContinue) }

# Run git/gh, swallow their stderr, return stdout or $null on a non-zero exit.
function Quiet {
  $out = & $args[0] $args[1..($args.Count-1)] 2>&1
  if ($LASTEXITCODE -ne 0) { return $null }
  return (($out | Where-Object { $_ -isnot [System.Management.Automation.ErrorRecord] }) -join "`n").Trim()
}

# winget drops binaries in well-known places that the *current* shell's PATH
# was read before they existed. Re-read the machine + user PATH, and add the
# usual install roots, so this run can use what it just installed.
function Refresh-Path {
  $parts = @(
    [Environment]::GetEnvironmentVariable('Path','Machine'),
    [Environment]::GetEnvironmentVariable('Path','User'),
    "$env:ProgramFiles\Git\cmd",
    "$env:ProgramFiles\GitHub CLI",
    "${env:ProgramFiles(x86)}\GitHub CLI",
    "$env:LOCALAPPDATA\Programs\Git\cmd",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links"
  ) | Where-Object { $_ }
  $env:Path = ($parts -join ';')
}

function Winget-Install ($id, $friendly) {
  if (-not (Have 'winget')) {
    Bad "winget is not available, so $friendly cannot be installed automatically."
    Bad "Install '$friendly' by hand, then run this script again."
    exit 1
  }
  Say "installing $friendly (winget: $id)..."
  winget install --id $id --exact --silent --disable-interactivity `
                 --accept-package-agreements --accept-source-agreements | Out-Null
  Refresh-Path
}

Write-Host ""
Write-Host "  ProGramerly -> github.com/$Owner/$Repo" -ForegroundColor White
Write-Host "  Antwerp Designs | Ionity (Pty) Ltd | AEDI - Policy 986 AED" -ForegroundColor DarkGray

# The repository root is this script's parent's parent (scripts\ lives in it).
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root
Say "checkout: $root"

# ------------------------------------------------------------------- 1. git
Step "Git"
Refresh-Path
if (-not (Have 'git')) { Winget-Install 'Git.Git' 'Git' }
if (-not (Have 'git')) {
  Bad "Git still is not on PATH. Close this window, open a new one, and run again."
  exit 1
}
Good "git $((git --version) -replace 'git version ','')"

# ------------------------------------------------------------ 2. GitHub CLI
Step "GitHub CLI"
if (-not (Have 'gh')) { Winget-Install 'GitHub.cli' 'GitHub CLI' }
if (-not (Have 'gh')) {
  Bad "gh still is not on PATH. Close this window, open a new one, and run again."
  exit 1
}
Good ((gh --version | Select-Object -First 1))

# ------------------------------------------------------------------ 3. auth
Step "GitHub sign-in"
$null = Quiet gh auth status
if ($LASTEXITCODE -ne 0) {
  Warn "not signed in yet - GitHub will show a one-time code and open your browser."
  Warn "Nothing types your password: you approve it yourself, on github.com."
  gh auth login --hostname github.com --git-protocol https --web --scopes 'repo,workflow'
  if ($LASTEXITCODE -ne 0) { Bad "sign-in did not complete."; exit 1 }
}
$who = Quiet gh api user --jq .login
if (-not $who) { $who = "your account" }
Good "signed in as $who"

# This is the step that kills the Git Credential Manager popups: git now uses
# the token gh already holds, for every push, without asking anyone anything.
Step "Teaching git to use that login"
gh auth setup-git --hostname github.com
Good "git credential helper wired to gh"

# ------------------------------------------------------------------ 4. repo
Step "Repository $Owner/$Repo"
$null = Quiet gh repo view "$Owner/$Repo" --json name
if ($LASTEXITCODE -ne 0) {
  Say "it does not exist yet - creating it, public..."
  gh repo create "$Owner/$Repo" --public `
     --description "ProGramerly - Basic Coding Software for All. One free desktop app that provisions a complete development environment on Windows and macOS." `
     --homepage "https://www.ionity.today"
  if ($LASTEXITCODE -ne 0) {
    Bad "could not create the repository."
    Bad "If '$who' is not allowed to create repositories in $Owner, ask an owner"
    Bad "to create an empty public repo called $Repo, then run this again."
    exit 1
  }
  Good "created https://github.com/$Owner/$Repo"
} else {
  Good "already exists"
}

# --------------------------------------------------------------- 5. local git
Step "Local repository"
if (-not (Test-Path (Join-Path $root '.git'))) {
  git init -b $Branch | Out-Null
  Good "initialised on '$Branch'"
} else {
  $current = Quiet git rev-parse --abbrev-ref HEAD
  if ($current -and $current -ne $Branch -and $current -ne 'HEAD') {
    Say "on branch '$current' - leaving it alone and pushing that."
    $Branch = $current
  }
  Good "already a git repository"
}

git config user.name  $AuthorName  | Out-Null
git config user.email $AuthorEmail | Out-Null

$remote = Quiet git remote get-url origin
$want   = "https://github.com/$Owner/$Repo.git"
if (-not $remote)          { git remote add origin $want | Out-Null; Good "origin -> $want" }
elseif ($remote -ne $want) { git remote set-url origin $want | Out-Null; Good "origin re-pointed -> $want" }
else                       { Good "origin already correct" }

# ---------------------------------------------------------------- 6. commit
Step "Commit"
$version = (Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
git add -A
$pending = (git status --porcelain)
if ($pending) {
  git commit -m "ProGramerly v$version - Basic Coding Software for All" | Out-Null
  Good "committed v$version"
} else {
  if (-not (Quiet git rev-parse HEAD)) {
    Bad "nothing to commit and no history - is this the right folder?"
    exit 1
  }
  Good "nothing changed since the last commit"
}

# ------------------------------------------------------------------ 7. push
Step "Push"
git push -u origin $Branch 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
  # Almost always: the repository was created on github.com with a README or
  # licence, so the remote has one commit this checkout does not. Bring it in,
  # keep our version of anything both sides have, and push again.
  Say "the remote already has history - merging GitHub's initial commit in..."
  git fetch origin $Branch 2>&1 | Out-Null
  git merge --allow-unrelated-histories -X ours --no-edit "origin/$Branch" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Bad "merge did not complete. Run:  git status   to see the conflict, resolve it, then run this again."
    exit 1
  }
  Good "merged origin/$Branch (ours kept where both sides had a file)"
  git push -u origin $Branch 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Bad "push still failed. Check that '$who' has write access to $Owner/$Repo."
    exit 1
  }
}
Good "pushed $Branch"

# ------------------------------------------------------------------- 8. tag
if (-not $NoTag) {
  Step "Tag v$version - this is what builds the Release"
  $exists = Quiet git tag --list "v$version"
  if (-not $exists) { git tag "v$version" | Out-Null; Good "created tag v$version" }
  else              { Good "tag v$version already exists locally" }

  git push origin "v$version" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) {
    Warn "the tag was already on GitHub, or the push was rejected."
    Warn "To rebuild the same version:  git push origin :refs/tags/v$version  then run again."
  } else {
    Good "tag pushed - the build is starting now"
  }
}

Write-Host ""
Write-Host "  Done." -ForegroundColor Green
Write-Host "  Repository : https://github.com/$Owner/$Repo"
Write-Host "  Build      : https://github.com/$Owner/$Repo/actions"
Write-Host "  Release    : https://github.com/$Owner/$Repo/releases  (10-15 min, macOS is the slow one)"
Write-Host ""
Write-Host "  (c) 2018-2026 Antwerp Designs | Ionity (Pty) Ltd - TM2 - Policy 986 AED" -ForegroundColor DarkGray
Write-Host ""

try { Start-Process "https://github.com/$Owner/$Repo/actions" } catch { }
