# Unified Builds: Gitpicky Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gitpicky builds, tests and releases with the shared convention: `Build.cmd` / `build.sh` wrappers, a build step in `scripts/`, every output in `release/` with shared names, and the shared `build.yml`.

**Architecture:** The wrappers check for Node and Git, install packages, run the typecheck and tests, then call `node scripts/dist.mjs <target>`, which runs `npm run build` and electron-builder with the flags for that target. electron-builder already writes to `release/`; the NSIS installer gains a `-setup` suffix. GitHub Actions calls the same wrappers.

**Tech Stack:** Node 22, TypeScript, Electron 44, electron-builder 26, vitest, cmd, POSIX sh, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-10-28-unified-builds-design.md`

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `scripts/dist.mjs` | create | Map a target to electron-builder flags and build it |
| `Build.cmd` | create (replaces `Build-Windows.cmd`) | Windows wrapper |
| `build.sh` | create | macOS/Linux wrapper |
| `electron-builder.yml` | modify (`nsis:` block) | `-setup` suffix on the installer |
| `.github/workflows/build.yml` | rewrite | Shared pipeline shape |
| `.github/release-notes.md` | create | Download help at the top of each release |
| `BUILDING.md` | create | How to build and release |
| `README.md` | modify (the build section near line 275) | Point at BUILDING.md |
| `CHANGELOG.md` | modify line 19 | Mention the rename |

---

### Task 0: Branch

- [ ] **Step 1: Make the branch from an up-to-date main**

```bash
cd Gitpicky
git switch main
git pull --ff-only
git switch -c unified-builds
```

---

### Task 1: scripts/dist.mjs

**Files:**
- Create: `scripts/dist.mjs`

- [ ] **Step 1: Write `scripts/dist.mjs`**

```js
// Builds Gitpicky's installers for one target into release/.
// Called by Build.cmd and build.sh, the same on your machine and in GitHub Actions.
//   node scripts/dist.mjs win | win-x64 | win-arm64 | mac | mac-universal | linux | linux-x64
// A plain OS name builds every architecture electron-builder.yml lists for that OS.
import { spawnSync } from "node:child_process";

const FLAGS = {
  win: ["--win"],
  "win-x64": ["--win", "--x64"],
  "win-arm64": ["--win", "--arm64"],
  mac: ["--mac"],
  "mac-universal": ["--mac"],
  linux: ["--linux"],
  "linux-x64": ["--linux"],
};

const target = process.argv[2];
if (!FLAGS[target]) {
  console.error(`Unknown target "${target}". Use one of: ${Object.keys(FLAGS).join(", ")}`);
  process.exit(1);
}

// npm and npx are .cmd files on Windows, which only run through a shell
function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npm", ["run", "build"]);
// --publish never: the workflow's release job makes releases, not electron-builder
run("npx", ["electron-builder", ...FLAGS[target], "--publish", "never"]);
```

- [ ] **Step 2: Check it rejects an unknown target**

Run: `node scripts/dist.mjs bogus; echo "exit $?"`
Expected: `Unknown target "bogus". Use one of: win, win-x64, win-arm64, mac, mac-universal, linux, linux-x64` then `exit 1`

- [ ] **Step 3: Commit**

```bash
git add scripts/dist.mjs
git commit -m "Add scripts/dist.mjs: build one target's installers"
```

---

### Task 2: Installer name

**Files:**
- Modify: `electron-builder.yml` (the `nsis:` block)

- [ ] **Step 1: Add an `artifactName` to the `nsis:` block**

Replace:

```yaml
nsis:
  oneClick: false
```

with:

```yaml
nsis:
  # "-setup" marks the file that installs; the .zip next to it runs as it is
  artifactName: ${productName}-${version}-${os}-${arch}-setup.${ext}
  oneClick: false
```

- [ ] **Step 2: Commit**

```bash
git add electron-builder.yml
git commit -m "Name the Windows installer Gitpicky-<version>-win-<arch>-setup.exe"
```

---

### Task 3: The wrappers, Build.cmd and build.sh

**Files:**
- Create: `Build.cmd`
- Delete: `Build-Windows.cmd`
- Create: `build.sh`

- [ ] **Step 1: Move the old file so its history follows**

```bash
git mv Build-Windows.cmd Build.cmd
```

- [ ] **Step 2: Replace the contents of `Build.cmd`**

```bat
@echo off
setlocal
rem ------------------------------------------------------------------
rem  Gitpicky: test and build. Double-click this file.
rem    Build.cmd             this PC: installers for x64 and arm64, and a portable zip
rem    Build.cmd win-x64     one architecture (the list is in BUILDING.md)
rem    Build.cmd test        only the typecheck and tests
rem  Output lands in release\. GitHub Actions runs this same file.
rem ------------------------------------------------------------------
title Gitpicky build
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install the LTS version from https://nodejs.org and run this again.
  goto :fail
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install it from https://git-scm.com and run this again.
  goto :fail
)

set TARGET=%~1
if "%TARGET%"=="" set TARGET=win

echo.
echo [1/3] Installing dependencies (quick if nothing changed)...
rem CI starts clean, so it installs exactly what package-lock.json says
if defined CI (call npm ci) else (call npm install --no-audit --no-fund)
if errorlevel 1 goto :fail

echo.
echo [2/3] Running the typecheck and tests...
call npm run typecheck
if errorlevel 1 goto :testsfailed
call npm test
if errorlevel 1 goto :testsfailed
if /i "%TARGET%"=="test" goto :done

echo.
echo [3/3] Building %TARGET%...
node scripts\dist.mjs %TARGET%
if errorlevel 1 (
  echo.
  echo The build failed. If you see "Cannot create symbolic link", turn on
  echo Developer Mode in Windows Settings ^(or run this as administrator^) and try again.
  goto :fail
)
if not defined CI start "" "%~dp0release"

:done
echo.
echo Done.
if not defined CI pause
exit /b 0

:testsfailed
echo.
echo Tests failed, so nothing was built. See the messages above.

:fail
echo.
if not defined CI pause
exit /b 1
```

- [ ] **Step 3: Write `build.sh`**

```sh
#!/bin/sh
# Gitpicky: test and build on macOS or Linux. GitHub Actions runs this same file.
#   ./build.sh            this machine (mac: universal dmg and zip; linux: AppImage and deb)
#   ./build.sh linux-x64  a named target (the list is in BUILDING.md)
#   ./build.sh test       only the typecheck and tests
# Output lands in release/.
set -e
cd "$(dirname "$0")"

for tool in node git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "$tool was not found. Install it (nodejs.org, git-scm.com) and run this again."
    exit 1
  fi
done

TARGET="$1"
if [ -z "$TARGET" ]; then
  case "$(uname -s)" in
    Darwin) TARGET=mac ;;
    *) TARGET=linux ;;
  esac
fi

echo "[1/3] Installing dependencies (quick if nothing changed)..."
# CI starts clean, so it installs exactly what package-lock.json says
if [ -n "$CI" ]; then npm ci; else npm install --no-audit --no-fund; fi

echo "[2/3] Running the typecheck and tests..."
npm run typecheck
npm test
if [ "$TARGET" = test ]; then
  echo "Done."
  exit 0
fi

echo "[3/3] Building $TARGET..."
node scripts/dist.mjs "$TARGET"
echo "Done."
```

- [ ] **Step 4: Check the shell syntax**

Run: `sh -n build.sh && echo ok`
Expected: `ok`

- [ ] **Step 5: Run the test mode**

Run on Windows: `set CI=1 && Build.cmd test`
Expected: typecheck and vitest pass, then `Done.`, exit code 0.

- [ ] **Step 6: Double-click `Build.cmd` on Windows**

Expected: `release\` opens with `Gitpicky-0.1.0-win-x64-setup.exe`, `Gitpicky-0.1.0-win-arm64-setup.exe` and `Gitpicky-0.1.0-win-x64.zip`. Running the x64 setup installs Gitpicky with a Start menu entry.

- [ ] **Step 7: Commit**

```bash
git add Build.cmd build.sh
git update-index --chmod=+x build.sh
git commit -m "Build with Build.cmd and build.sh, the same wrappers as Hatpick and Readmotion"
```

---

### Task 4: The shared workflow

**Files:**
- Rewrite: `.github/workflows/build.yml`
- Create: `.github/release-notes.md`

- [ ] **Step 1: Write `.github/release-notes.md`**

```markdown
Download the file for your system below. Needs Git.

- **Windows:** `Gitpicky-<version>-win-x64-setup.exe` installs Gitpicky with a Start menu entry (`win-arm64` for Windows on ARM). `Gitpicky-<version>-win-x64.zip` runs without installing.
- **macOS:** `Gitpicky-<version>-mac-universal.dmg` (Apple silicon and Intel). Drag Gitpicky to Applications, then right-click it > Open the first time.
- **Linux:** `Gitpicky-<version>-linux-x86_64.AppImage` (make it executable and run it), or the `.deb`.
```

- [ ] **Step 2: Rewrite `.github/workflows/build.yml`**

```yaml
# Builds Gitpicky installers for Windows, macOS and Linux with Build.cmd / build.sh,
# the same files you run locally. Hatpick and Readmotion use this same shape.
#
# - Pull request: typecheck and tests (./build.sh test, on Linux).
# - Push to main, or Actions > Build > Run workflow: tests and installers on all three
#   systems. Each is a download on the run's page for 14 days (Actions > the run > Artifacts).
# - Push a version tag (v0.1.0): the same, plus a DRAFT GitHub Release with the
#   installers attached. Check it, then press Publish. Re-pushing the tag replaces the files.
name: Build

on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:
  workflow_dispatch:

# a newer push to the same branch cancels the older run
concurrency:
  group: build-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  test:
    name: Tests (Linux)
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm
      - run: ./build.sh test

  build:
    name: Build (${{ matrix.target }})
    if: github.event_name != 'pull_request'
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest, target: win }
          - { os: macos-latest,   target: mac }
          - { os: ubuntu-latest,  target: linux }
    runs-on: ${{ matrix.os }}
    env:
      # No code-signing certificates yet; skip looking for them on macOS.
      CSC_IDENTITY_AUTO_DISCOVERY: "false"
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      # The same files you run locally: Build.cmd on Windows, build.sh elsewhere.
      - name: Test and build (Windows)
        if: runner.os == 'Windows'
        shell: cmd
        run: call Build.cmd ${{ matrix.target }}
      - name: Test and build (macOS, Linux)
        if: runner.os != 'Windows'
        run: ./build.sh ${{ matrix.target }}

      - uses: actions/upload-artifact@v7
        with:
          name: ${{ github.event.repository.name }}-${{ matrix.target }}
          path: |
            release/Gitpicky-*.exe
            release/Gitpicky-*.zip
            release/Gitpicky-*.dmg
            release/Gitpicky-*.AppImage
            release/Gitpicky-*.deb
          if-no-files-found: error
          retention-days: 14

  # Identical in Gitpicky, Hatpick and Readmotion: copy any change to all three.
  release:
    name: Draft release
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write   # to create the draft release
    steps:
      - uses: actions/checkout@v7
      - uses: actions/download-artifact@v7
        with:
          path: release
          merge-multiple: true
      - name: Make a draft release with every build
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.ref_name }}
          APP: ${{ github.event.repository.name }}
        run: |
          version="${TAG#v}"
          # Notes: the download help, then this version's CHANGELOG section, if either
          # exists. GitHub's list of changes since the last release goes after them.
          : > notes.md
          if [ -f .github/release-notes.md ]; then cat .github/release-notes.md >> notes.md; echo >> notes.md; fi
          if [ -f CHANGELOG.md ]; then
            awk -v v="$version" '$0 ~ "^## " v "( |$)" {f=1; next} /^## / {f=0} f' CHANGELOG.md >> notes.md
          fi
          if gh release view "$TAG" >/dev/null 2>&1; then
            # Same tag pushed again: replace the files, keep any notes you edited.
            gh release upload "$TAG" release/* --clobber
          else
            gh release create "$TAG" release/* --draft --title "$APP $version" \
              --notes-file notes.md --generate-notes
          fi
```

- [ ] **Step 3: Check the YAML parses**

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/build.yml')); print('ok')"`
Expected: `ok`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/build.yml .github/release-notes.md
git commit -m "Use the shared build workflow"
```

---

### Task 5: BUILDING.md, README and CHANGELOG

**Files:**
- Create: `BUILDING.md`
- Modify: `README.md` (the build section that starts near line 275)
- Modify: `CHANGELOG.md:19`

- [ ] **Step 1: Write `BUILDING.md`**

```markdown
# Building Gitpicky

Gitpicky is an Electron app in TypeScript. Hatpick and Readmotion build the same way.

## What to install

[Node.js](https://nodejs.org) 20 or later (the LTS version) and [Git](https://git-scm.com).

## Build

| On | Run | You get, in `release/` |
|---|---|---|
| Windows | double-click `Build.cmd` | `Gitpicky-<version>-win-x64-setup.exe` and `win-arm64-setup.exe` (installers), `Gitpicky-<version>-win-x64.zip` (portable), and the folder opens |
| macOS | `./build.sh` | `.dmg` and `.zip`, universal (Apple silicon and Intel) |
| Linux | `./build.sh` | `.AppImage` and `.deb` |

Each build installs packages, runs the typecheck and tests, and stops if they fail.
`Build.cmd test` or `./build.sh test` runs only the checks.

Targets: `win`, `win-x64`, `win-arm64`, `mac` (same as `mac-universal`), `linux` (same as
`linux-x64`). Installers can only be built on their own system.

If a Windows build says "Cannot create symbolic link", turn on Developer Mode in Windows
Settings (or run `Build.cmd` as administrator).

## Where things are

| Path | What |
|---|---|
| `Build.cmd`, `build.sh` | The two entry points: check tools, test, build. GitHub Actions runs these same files. |
| `scripts/dist.mjs` | Builds one target's installers with electron-builder |
| `scripts/build-renderer.mjs`, `scripts/build-mcp.mjs`, `scripts/render-icons.mjs` | The steps `npm run build` runs |
| `electron-builder.yml` | Installer settings: targets, names, icons |
| `release/` | Every build (ignored by git) |
| `dist/` | Compiled TypeScript that goes into the app (ignored by git) |
| `.github/workflows/build.yml` | The pipeline |
| `.github/release-notes.md` | Download help placed at the top of each release |

## The pipeline

| When | What runs |
|---|---|
| A pull request | `./build.sh test` on Linux |
| A push to `main`, or Actions > Build > Run workflow | Tests and installers on all three systems. Downloads are on the run's page for 14 days. |
| A `v*` tag | The same, plus a **draft** release with every installer attached |

## Making a release

1. Set `"version"` in `package.json`, for example `0.2.0`, add a `## 0.2.0` section to
   `CHANGELOG.md`, and commit.
2. `git tag v0.2.0 && git push origin v0.2.0`
3. When the run finishes, open Releases, check the draft, and press **Publish**. The notes
   already hold the download help and that CHANGELOG section.
```

- [ ] **Step 2: Replace the README's build instructions**

In `README.md`, find the paragraph starting `**On Windows, the easy way:** double-click \`Build-Windows.cmd\`` (near line 275). Replace that paragraph and the `| On | Run | You get (in \`release/\`) |` table after it with:

```markdown
**On Windows:** double-click `Build.cmd`. It checks for Node and Git, runs the tests, builds
the installers and opens `release/`. On macOS or Linux, run `./build.sh`.
[BUILDING.md](BUILDING.md) has the targets, where each file lives, and how to make a release.
```

Leave the developer commands block that follows (with `npm run dist` near line 310) as it is: those npm scripts still work.

- [ ] **Step 3: Update the CHANGELOG line**

In `CHANGELOG.md` line 19, replace:

```markdown
- `Build-Windows.cmd`: double-click to test and build the Windows installer
```

with:

```markdown
- `Build.cmd` (Windows, double-click) and `build.sh` (macOS, Linux): test and build the installers
```

- [ ] **Step 4: Check no old names are left**

Run: `git grep -n "Build-Windows" -- . ":!docs"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add BUILDING.md README.md CHANGELOG.md
git commit -m "Document the build in BUILDING.md"
```

---

### Task 6: Check it in CI

- [ ] **Step 1: Push and run the workflow on the branch**

```bash
git push -u origin unified-builds
gh workflow run build.yml --ref unified-builds
gh run watch "$(gh run list --workflow build.yml --branch unified-builds --limit 1 --json databaseId --jq '.[0].databaseId')"
```

Expected: `Build (win)`, `Build (mac)` and `Build (linux)` pass.

- [ ] **Step 2: Check the downloads**

```bash
gh run download "$(gh run list --workflow build.yml --branch unified-builds --limit 1 --json databaseId --jq '.[0].databaseId')" -D /tmp/gitpicky-run
ls -R /tmp/gitpicky-run
```

Expected, among others: `Gitpicky-0.1.0-win-x64-setup.exe`, `Gitpicky-0.1.0-win-x64.zip`, a `Gitpicky-0.1.0-mac-universal.dmg`, a `Gitpicky-0.1.0-linux-*.AppImage` and a `.deb`. No `.blockmap` files.

- [ ] **Step 3: Open the pull request and check only the test job runs**

```bash
gh pr create --base main --head unified-builds --title "Unified builds" --body "Build.cmd/build.sh wrappers, scripts/dist.mjs, -setup installer names, and the shared workflow. See docs/superpowers/specs/2026-10-28-unified-builds-design.md."
```

Expected: `Tests (Linux)` passes and no `Build` jobs run.

- [ ] **Step 4: Check the release job with a throwaway tag** (after merging)

```bash
git switch main && git pull --ff-only
git tag v0.0.0-test && git push origin v0.0.0-test
```

Expected: a **draft** "Gitpicky 0.0.0-test" with every installer and the download help at the top. Then delete the draft on GitHub, and `git push origin :refs/tags/v0.0.0-test && git tag -d v0.0.0-test`.
