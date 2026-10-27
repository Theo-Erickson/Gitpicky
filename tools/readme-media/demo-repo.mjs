// Builds the throwaway "starlight-runner" repository the README footage is
// recorded in: a small game project with branches, a merge, a tag, a remote,
// commits made with the wrong email, co-author lines and some unsaved edits.
// Everyone in it is made up.

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, appendFileSync, utimesSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const DEMO = {
  me: { name: 'Sam Rivera', email: 'sam@studio.example' },
  oldEmail: 'sam.rivera@example.net',
  teammate: { name: 'Ava Chen', email: 'ava@studio.example' },
  coAuthor: 'Claude <noreply@anthropic.com>',
};

const DAY = 24 * 60 * 60;

/** Creates the demo repo (and its "GitHub" remote) under `root`. Returns the repo path. */
export function buildDemoRepo(root) {
  rmSync(root, { recursive: true, force: true });
  const repo = join(root, 'starlight-runner');
  const remote = join(root, 'remote.git');
  mkdirSync(repo, { recursive: true });
  const now = Math.floor(Date.now() / 1000);
  let when = now - 21 * DAY;

  const git = (args, env = {}) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
  const write = (file, text) => {
    mkdirSync(dirname(join(repo, file)), { recursive: true });
    appendFileSync(join(repo, file), text);
  };
  const commit = (who, message, file, text, days = 1.3) => {
    when += Math.round(days * DAY);
    write(file, text);
    git(['add', '-A']);
    const date = `${when} +0000`;
    git(['commit', '-q', `--author=${who.name} <${who.email}>`, '-m', message], {
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    });
  };

  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.name', DEMO.me.name]);
  git(['config', 'user.email', DEMO.me.email]);
  git(['config', 'commit.gpgsign', 'false']);
  git(['config', 'core.autocrlf', 'false']);

  const old = { name: DEMO.me.name, email: DEMO.oldEmail };
  commit(DEMO.me, 'Initial project setup', 'README.md', '# Starlight Runner\n');
  commit(old, 'Add player movement', 'scripts/player.gd', 'extends CharacterBody2D\n');
  git(['tag', 'v0.1']);
  git(['switch', '-q', '-c', 'feature/double-jump']);
  commit(old, 'Add double jump', 'scripts/player.gd', 'var jumps := 2\n');
  commit(old, `Tune jump height\n\nCo-authored-by: ${DEMO.coAuthor}`, 'scripts/player.gd', 'const JUMP := -420.0\n');
  git(['switch', '-q', 'main']);
  commit(DEMO.teammate, 'Fix camera jitter', 'scripts/camera.gd', 'extends Camera2D\n');
  when += DAY;
  git(['merge', '-q', '--no-ff', '--no-edit', 'feature/double-jump'], {
    GIT_AUTHOR_DATE: `${when} +0000`,
    GIT_COMMITTER_DATE: `${when} +0000`,
  });
  git(['branch', '-q', '-d', 'feature/double-jump']);
  git(['switch', '-q', '-c', 'art/new-sprites']);
  commit(DEMO.teammate, 'Import hero sprite sheet', 'art/hero.txt', 'hero sprite sheet v1\n');
  git(['switch', '-q', 'main']);
  commit(DEMO.me, 'Add coin pickups', 'scripts/coin.gd', 'extends Area2D\n');

  execFileSync('git', ['init', '-q', '--bare', remote]);
  git(['remote', 'add', 'origin', remote]);
  git(['push', '-q', '-u', 'origin', 'main', 'art/new-sprites']);

  commit(old, `Add pause menu\n\nCo-authored-by: ${DEMO.coAuthor}`, 'scripts/menu.gd', 'extends Control\n', 2);

  // Unsaved work for the commit scene.
  write('scripts/menu.gd', 'func _on_resume_pressed() -> void:\n\tget_tree().paused = false\n');
  writeFileSync(join(repo, 'level-ideas.md'), '- ice cave with slippery floors\n');
  return repo;
}

/** Small extra repositories, so the recent-repositories list has something to show. */
export function buildSideRepos(root) {
  const specs = [
    ['level-editor', ['Initial editor shell', 'Add tile palette', 'Snap tiles to the grid', 'Save levels as JSON'], 'feature/undo'],
    ['studio-website', ['Initial site', 'Add press kit page'], null],
    ['sound-bank', ['Import footstep sounds', 'Normalize volume'], null],
    ['dialogue-system', ['Initial dialogue runner', 'Add branching choices', 'Add portraits'], 'feature/voice-lines'],
    ['pixel-tools', ['Initial palette swapper', 'Add outline filter'], null],
  ];
  const now = Math.floor(Date.now() / 1000);
  return specs.map(([name, messages, branch], r) => {
    const repo = join(root, name);
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    const git = (args, env = {}) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', env: { ...process.env, ...env } });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.name', DEMO.me.name]);
    git(['config', 'user.email', DEMO.me.email]);
    git(['config', 'commit.gpgsign', 'false']);
    git(['config', 'core.autocrlf', 'false']);
    let when = now - (30 - r * 3) * DAY;
    messages.forEach((message, i) => {
      when += Math.round(1.6 * DAY);
      writeFileSync(join(repo, `notes-${i}.md`), `${message}\n`);
      git(['add', '-A']);
      const who = i % 3 === 2 ? DEMO.teammate : DEMO.me;
      git(['commit', '-q', `--author=${who.name} <${who.email}>`, '-m', message], {
        GIT_AUTHOR_DATE: `${when} +0000`,
        GIT_COMMITTER_DATE: `${when} +0000`,
      });
    });
    if (branch) {
      git(['switch', '-q', '-c', branch]);
      when += DAY;
      writeFileSync(join(repo, 'wip.md'), 'work in progress\n');
      git(['add', '-A']);
      git(['commit', '-q', '-m', `Start ${branch.split('/').pop()}`], { GIT_AUTHOR_DATE: `${when} +0000`, GIT_COMMITTER_DATE: `${when} +0000` });
    }
    // The repository browser shows "last activity" from these files' times.
    for (const f of ['index', 'HEAD']) utimesSync(join(repo, '.git', f), when, when);
    return repo;
  });
}
