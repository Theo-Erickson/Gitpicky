# Changelog

## 0.1.0 (unreleased)

First working version.

- History graph with branch lanes, labels for branches, tags, remote branches and HEAD
- Uncommitted changes shown as a dashed "your changes" dot
- Change planner with plain-English summaries, exact commands, risk levels, blockers and warnings
- Previews that redraw the history as it will look after a change
- Actions: commit (pick files), branch, switch, merge, revert, cherry-pick, undo last commit, reset,
  discard, stash/pop, tag, rename/delete branch, fetch, pull, push, abort
- Learn tab: searchable glossary of git terms
- MCP server with read-only tools plus `propose_change`, approved inside the app
- Local, token-protected bridge between the MCP server and the app
- Installers for Windows (NSIS + zip), macOS (dmg + zip) and Linux (AppImage + deb)
- GitHub Actions workflow that tests on all three systems and builds installers for tagged releases
- Assistant tab shows a ready-to-copy MCP config with the installed server path
- `Build-Windows.cmd`: double-click to test and build the Windows installer
- GitHub Actions builds installers on every push to main, not just tags
- Fix author / remove co-authors: rewrites a run of commits (or just unpushed ones), with warnings
  about pushed commits, other people's credit, other branches, tags and signatures, plus a backup ref
- Commit details show the author's email and any co-authors
- Glossary: Author / Committer, Co-author, Rewriting history
- Pick icon: branch glyph recentered so it no longer runs off the edge
- Repo paths use the native Windows form, so the same repo is never treated as two
- README rebuilt with real footage: banner, hero and clips recorded from the app by
  `tools/readme-media/` (a Playwright capture script and a Pillow GIF builder)
- Esc closes a preview or form from anywhere in the window
- Recent repositories dropdown: the last 12 repos with their branch, filter, keyboard navigation,
  remove from list, flags folders that were moved or deleted; Ctrl/Cmd+O opens it
- Drop a folder (or any file inside a repo) on the window to open it
- Repository browser (Ctrl/Cmd+Shift+O): every repo in your project folders, grouped by folder, with
  branch, last activity and search; finds common project folders and your recent repos' folders
  automatically, and you can add or remove folders
