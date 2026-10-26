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
