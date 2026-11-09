# Unified builds for Gitpicky, Hatpick and Readmotion

Date: 2026-10-28 (revised 2026-10-29: all three apps on all three operating
systems; matches Hatpick's Avalonia port and Readmotion's PyInstaller build)
Status: approved design

## Goal

All three repos build, test and release the same way:

1. One GitHub Actions pipeline shape that builds on push.
2. A real app for Windows, macOS and Linux from every repo, with a `.exe` on Windows.
3. One file layout that makes clear where builds land and which scripts make them.

Each repo keeps its own compiler (electron-builder, `dotnet publish`,
PyInstaller). What's shared is the convention: names, folders, triggers,
outputs and the release step.

## The convention (all three repos)

```
<Repo>/
  Build.cmd                  Windows: double-click to check tools, test, build, open release/
  build.sh                   macOS and Linux: the same, from a terminal
  scripts/                   the build steps the two wrappers call, nothing else
  release/                   ALL build output (gitignored)
    .work/                   scratch: intermediate builds, safe to delete
  .github/workflows/build.yml
  .github/release-notes.md   download help pasted at the top of every release
  BUILDING.md                what to install, what to run, where output lands, how to release
```

### The two wrappers

`Build.cmd` and `build.sh` are the only local entry points, and CI calls the
same two files, so a local build and a CI build can't drift apart. Each one:

1. Checks for its tools, and if one is missing says which and where to get it.
2. Runs the tests (or the nearest thing: Hatpick has no tests, so it compiles).
3. Builds by calling what's in `scripts/`.
4. On Windows, when double-clicked: opens `release/` and ends with `pause`.
   Both are skipped when the `CI` environment variable is set, which GitHub
   Actions does.

Arguments, identical in all three repos:

| Command | Does |
|---|---|
| `Build.cmd` / `./build.sh` | Test, then build for this machine |
| `Build.cmd <target>` / `./build.sh <target>` | Test, then build for that target |
| `Build.cmd test` / `./build.sh test` | Only the tests |

Exit code 0 on success, 1 on any failure.

### Names and versions

- Targets are `<os>-<arch>`: `win-x64`, `win-arm64`, `mac-arm64`, `mac-x64`,
  `mac-universal`, `linux-x64`, `linux-arm64`. Gitpicky also accepts plain
  `win`, `mac` and `linux`, because electron-builder makes every architecture
  for an OS in one run.
- Output files are `<App>-<version>-<target>.<ext>`. A Windows installer adds
  `-setup`: `Readmotion-2.3.0-win-x64-setup.exe` installs and
  `Hatpick-3.2.0-win-x64.exe` runs as it is.
- Each repo has one place for its version: `package.json` (Gitpicky),
  `<Version>` in `src/Hatpick.csproj` (Hatpick), `VERSION` (Readmotion).
  Release tags are `v<version>`.
- The build scripts never empty `release/`. They overwrite their own output
  files and clear only `release/.work/`. This protects anything you keep there,
  such as Hatpick's portable `hatpick.json` on Windows.

### What each operating system gets

| OS | Gitpicky | Hatpick | Readmotion |
|---|---|---|---|
| Windows | `-setup.exe` (x64, arm64) + portable `.zip` | `.exe` (x64, arm64), one file, nothing to install | `-setup.exe` (x64) + portable `.zip` |
| macOS | `.dmg` + `.zip`, universal | `.zip` with `Hatpick.app` (arm64, x64) | `.zip` with `Readmotion.app` (arm64, x64) |
| Linux | `.AppImage` + `.deb` (x64) | `.tar.gz`, one executable (x64, arm64) | `.tar.gz` of the app folder (x64) |

Installers add a Start menu icon and an uninstaller. None of the apps are
signed yet, so Windows SmartScreen and macOS Gatekeeper warn on first launch
(on macOS: right-click > Open, once).

## The pipeline (same build.yml shape in all three)

| Event | What happens |
|---|---|
| Pull request | `test` job on Linux: `./build.sh test`. No builds. |
| Push to `main` | `build` job on every target: `Build.cmd <target>` or `./build.sh <target>`, which tests and builds; files uploaded as run Artifacts kept 14 days. |
| Push a `v*` tag | Same, plus the `release` job: a **draft** GitHub Release with every build attached. Nothing is public until you publish it. |
| Run workflow button | Same as a push. |

- `test` runs only on pull requests, because every `build` already runs the
  tests on its own OS.
- `build` is a matrix whose rows give `os` (the runner) and `target`. The only
  per-repo differences are the rows and one tool setup step (`setup-node`,
  `setup-dotnet` or `setup-python`).
- `release` is copied word for word between repos. It downloads every build
  and creates the draft with `gh release create --draft`. The notes are
  `.github/release-notes.md`, then that version's section of `CHANGELOG.md` if
  there is one, then GitHub's generated list of changes. Pushing the same tag
  again replaces the files on the draft.
- A newer push to the same branch cancels the older run (`concurrency`).
- `fail-fast: false`, so one broken OS doesn't hide the others' results.
- Action versions are the same everywhere: `actions/checkout@v7`,
  `actions/upload-artifact@v7`, `actions/download-artifact@v7`,
  `actions/setup-node@v6`, `actions/setup-dotnet@v5`, `actions/setup-python@v6`.
- Permissions: `contents: read`, raised to `contents: write` only on the
  `release` job.

## Per repo

### Gitpicky

- `Build-Windows.cmd` becomes `Build.cmd`, plus a new `build.sh`. Both call
  the existing `npm run` scripts.
- The NSIS installer gets the `-setup` suffix.
- The workflow is the shared shape (it runs PR tests on Linux only now, and
  builds through the wrappers).
- Add `BUILDING.md`, and point the README's build section at it.

### Hatpick (Avalonia on .NET 10)

- `build.cmd` becomes `Build.cmd`; `build.sh` stays as the wrapper. The
  `dotnet publish` and packaging steps move to `scripts/publish.cmd` and
  `scripts/publish.sh`.
- Output: `release/Hatpick-<ver>-<target>.exe | .zip | .tar.gz`.
  `dist/<rid>/` moves to `release/.work/<rid>/`, and the copy of `Hatpick.exe`
  into the repo root is dropped.
- Zipping the `.app` and tarring the Linux executable move out of the
  workflow and into `scripts/publish.sh`, so a local build makes the same files.
- `tools/readme_capture/record.ps1` runs the newest
  `release/Hatpick-*-win-x64.exe` instead of `Hatpick.exe`.
- The release becomes a draft, and its download help moves to
  `.github/release-notes.md`.
- **Your settings:** on Windows, Hatpick keeps `hatpick.json`, its error log
  and `hats/` next to the exe. Move them from the repo root to wherever you
  keep the Hatpick you use every day (the build never deletes them from
  `release/` either).

### Readmotion (already frozen; joins the convention)

Kept as it is: the PyInstaller spec, which builds `Readmotion` (the app) and
`readmotion-cli` (the command line) into one folder; `cli_command()` in the
app; the smoke test; and the built-app test run (`READMOTION_APP`).

Changes:

- `packaging/` becomes `scripts/` (`build.py`, `readmotion.spec`, and a new
  `readmotion.iss`). `Build-Windows.cmd` becomes `Build.cmd`, plus a new
  `build.sh`. Both keep the private `.venv-build` environment.
- Output moves from `dist/` to `release/`: `release/Readmotion/` (the app,
  runnable in place), `release/Readmotion.app` on macOS, and
  `Readmotion-<ver>-<target>.zip` (`.tar.gz` on Linux). PyInstaller's scratch
  folder moves to `release/.work/`.
- **Windows installer:** `build.py` runs Inno Setup 6 on `scripts/readmotion.iss`
  to make `Readmotion-<ver>-win-x64-setup.exe`. It installs for the current
  user (no admin), adds a Start menu icon and an optional desktop icon, and
  registers an uninstaller. If Inno Setup isn't installed locally, the build
  says how to get it and skips the installer. In CI it's required (the
  Windows runners include it).
- **macOS Intel:** a `macos-15-intel` row is added to the matrix.
- The workflow becomes the shared shape. Today it builds only on tags; under
  the shared shape it builds on pushes to `main` too.

## Out of scope

- Code signing and notarization (no certificates yet).
- Auto-update feeds.
- A shared build repo or reusable workflow. Only the `release` job is truly
  shared, and three short copies are easier to change than a cross-repo
  dependency.
- Reworking any repo's README media tooling beyond the one path in Hatpick's
  `record.ps1`.

## Done when

- In each repo, double-clicking `Build.cmd` on Windows (or `./build.sh` on
  macOS or Linux) with the tools from `BUILDING.md` produces that system's app
  in `release/`, and `Build.cmd test` runs only the tests.
- In each repo, a push to `main` builds every target in the table above, and
  the files can be downloaded from the run's page.
- In each repo, a `v*` tag makes a draft Release with every build attached and
  the download help at the top of the notes.
- On Windows, each release includes an `.exe` that opens the app with a
  double-click, either directly (Hatpick) or after installing, from the Start
  menu (Gitpicky, Readmotion).
