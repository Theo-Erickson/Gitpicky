// Turns repository state and plans into Markdown an assistant can read and relay.

import { renderAsciiGraph } from '../core/graph';
import { describeStep, type Plan } from '../core/preview';
import type { ProposalView } from '../core/bridge-protocol';
import type { Commit, RepoSnapshot } from '../core/types';

function refLabel(commit: Commit): string {
  const refs = commit.refs
    .filter((r) => r.kind !== 'head')
    .map((r) => (r.current ? `HEAD -> ${r.name}` : r.kind === 'tag' ? `tag: ${r.name}` : r.name));
  if (commit.refs.some((r) => r.kind === 'head') && !commit.refs.some((r) => r.current)) refs.unshift('HEAD (detached)');
  return refs.length ? `(${refs.join(', ')}) ` : '';
}

export function formatHistory(commits: Commit[], limit: number): string {
  const shown = commits.slice(0, limit);
  if (shown.length === 0) return '(no commits yet)';
  const graph = renderAsciiGraph(
    shown.map((c) => ({
      hash: c.hash,
      parents: c.parents,
      shortHash: c.shortHash,
      label: `${refLabel(c)}${c.subject} [${c.authorName}, ${c.date.slice(0, 10)}]`,
    })),
  );
  const more = commits.length > limit ? `\n… ${commits.length - limit} older commits not shown` : '';
  return '```\n' + graph + more + '\n```\n`*` = commit, `M` = merge commit, `|` = a branch line passing by. Newest first.';
}

export function formatOverview(s: RepoSnapshot, historyLimit = 15): string {
  const st = s.status;
  const lines: string[] = [`# ${s.name}`, `Path: ${s.path}`, ''];
  if (st.branch) lines.push(`On branch **${st.branch}**.`);
  else lines.push('**Detached HEAD**: looking at a commit directly, not on a branch. New commits here would not belong to any branch.');
  if (st.upstream) {
    lines.push(
      st.ahead || st.behind
        ? `Compared with ${st.upstream}: ${st.ahead} commit(s) to push, ${st.behind} to pull.`
        : `In sync with ${st.upstream} (as of the last fetch).`,
    );
  } else if (st.branch) {
    lines.push(s.remotes.length ? 'This branch has not been pushed to the remote yet.' : 'No remote is set up (nothing is on GitHub yet).');
  }
  if (st.inProgress) lines.push(`⚠️ A **${st.inProgress}** is in progress and must be finished (commit) or aborted first.`);
  lines.push('');
  if (st.changes.length === 0) {
    lines.push('No uncommitted changes.');
  } else {
    lines.push('Uncommitted changes:');
    for (const c of st.changes) {
      const where = c.kind === 'untracked' ? 'new file, not tracked yet' : c.kind === 'conflicted' ? 'CONFLICT - needs fixing' : `${c.kind}, ${c.staged ? 'staged' : 'not staged'}`;
      lines.push(`- ${c.from ? `${c.from} → ` : ''}${c.path} (${where})`);
    }
  }
  lines.push('', `Local branches: ${s.branches.join(', ') || '(none)'}`);
  if (s.remotes.length) lines.push(`Remotes: ${s.remotes.join(', ')}`);
  if (s.tags.length) lines.push(`Tags: ${s.tags.slice(-15).join(', ')}`);
  lines.push('', `## Recent history`, formatHistory(s.commits, historyLimit));
  return lines.join('\n');
}

const RISK_TEXT: Record<Plan['risk'], string> = {
  safe: 'Safe',
  careful: 'Be careful',
  destructive: 'Can lose work',
};

export function formatPlan(plan: Plan): string {
  const lines = [`## ${plan.title}`, `Risk: **${RISK_TEXT[plan.risk]}**`, '', plan.summary];
  if (plan.blockers.length) {
    lines.push('', "**Can't run right now:**", ...plan.blockers.map((b) => `- ${b}`));
  }
  if (plan.warnings.length) {
    lines.push('', '**Good to know:**', ...plan.warnings.map((w) => `- ${w}`));
  }
  if (plan.steps.length) {
    lines.push('', 'Commands:', ...plan.steps.map((s, i) => `${i + 1}. \`${describeStep(s)}\` - ${s.why}`));
  }
  if (plan.learn.length) lines.push('', `Terms worth explaining: ${plan.learn.join(', ')} (use explain_git_term).`);
  return lines.join('\n');
}

export function formatProposal(p: ProposalView): string {
  const head = `Proposal ${p.id}: ${p.plan.title}`;
  switch (p.status) {
    case 'pending':
      return `${head}\nStatus: **waiting for the person to approve it in Gitpicky.** Nothing has changed yet. Call check_proposal with id "${p.id}" to keep waiting.`;
    case 'running':
      return `${head}\nStatus: approved and running now. Call check_proposal with id "${p.id}" for the result.`;
    case 'applied':
      return `${head}\nStatus: **approved and done.**\n${(p.result?.log ?? []).map((l) => `- \`${l.command}\`${l.output ? `: ${l.output.split('\n')[0]}` : ''}`).join('\n')}`;
    case 'rejected':
      return `${head}\nStatus: **rejected by the person.** Nothing changed.${p.note ? `\nTheir note: "${p.note}"` : ''}`;
    case 'failed':
      return `${head}\nStatus: **failed.** ${p.result?.error ?? ''}\n${formatPlan(p.plan)}`;
  }
}
