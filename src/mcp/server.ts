#!/usr/bin/env node
// Gitpicky MCP server: lets an AI assistant look at a repository, explain git
// terms, preview changes, and ask the person (through the Gitpicky app) to
// approve them. It never changes a repository without that approval.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { ProposalView } from '../core/bridge-protocol';
import { findRepoRoot } from '../core/git';
import { GLOSSARY, formatEntry, lookupTerm } from '../core/glossary';
import { readSnapshot } from '../core/history';
import { planChange } from '../core/operations';
import { callApp } from './bridge-client';
import { formatHistory, formatOverview, formatPlan, formatProposal } from './format';
import { operationSchema } from './schemas';

const VERSION = '0.1.0';

const INSTRUCTIONS = `Gitpicky helps people who are new to git understand and change their repositories safely.

How to work with it:
- Start with get_repo_overview to see where things stand. Explain what you see in plain language; the person may not know git words.
- When the person wants a change, use preview_change first and explain the plan in your own words, including any warnings.
- Then use propose_change. The change appears in the Gitpicky app with a picture of the result, and the person approves or rejects it there. Nothing changes until they approve.
- Only say a change is done when propose_change or check_proposal reports "approved and done".
- Propose one change at a time and wait for the result before the next.
- Prefer safe options: revert over reset, stash over discard, a new branch over rewriting history.
- To fix authorship (wrong email, unwanted co-authors), use rewrite_authors. Prefer from: "unpushed" and set onlyAuthorEmail so other people keep their credit. If the preview says commits are already pushed, explain plainly that a force push would be needed and that anyone else using the branch would be affected, and let the person decide. Never force push for them.
- Use explain_git_term whenever a git word comes up that the person might not know.`;

const repoPath = z.string().min(1).describe('Absolute path to the project folder (any folder inside the repository works).');

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const fail = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }], isError: true });

async function requireRepo(path: string): Promise<string> {
  const root = await findRepoRoot(path);
  if (!root) throw new Error(`"${path}" isn't inside a git repository. Is this the right folder? It needs to have been set up with git (git init or a clone).`);
  return root;
}

function guard<A>(fn: (args: A) => Promise<ToolResult>): (args: A) => Promise<ToolResult> {
  return async (args) => {
    try {
      return await fn(args);
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
  };
}

const server = new McpServer({ name: 'gitpicky', version: VERSION }, { instructions: INSTRUCTIONS });

server.registerTool(
  'get_repo_overview',
  {
    title: 'Repository overview',
    description:
      'Where things stand in a repository: current branch, uncommitted changes, sync status with the remote, branches, tags, and a drawing of recent history. Read-only.',
    inputSchema: { repo_path: repoPath },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ repo_path }) => {
    const root = await requireRepo(repo_path);
    return text(formatOverview(await readSnapshot(root, 200)));
  }),
);

server.registerTool(
  'show_history',
  {
    title: 'Show history',
    description: 'Draws the commit history as a text graph (newest first), with branch and tag labels. Read-only.',
    inputSchema: {
      repo_path: repoPath,
      limit: z.number().int().min(1).max(300).optional().describe('How many commits to show. Default 40.'),
    },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ repo_path, limit }) => {
    const root = await requireRepo(repo_path);
    const n = limit ?? 40;
    const snapshot = await readSnapshot(root, n + 1);
    return text(formatHistory(snapshot.commits, n));
  }),
);

server.registerTool(
  'explain_git_term',
  {
    title: 'Explain a git term',
    description: 'Plain-English explanation of a git word or idea (HEAD, rebase, detached HEAD, stash, upstream, …) with an analogy and cautions. Pass "list" to see every term.',
    inputSchema: { term: z.string().min(1).describe('The word or phrase to explain.') },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ term }) => {
    if (term.trim().toLowerCase() === 'list') {
      return text(GLOSSARY.map((e) => `- **${e.term}**: ${e.short}`).join('\n'));
    }
    const entry = lookupTerm(term);
    if (!entry) {
      return text(`No entry for "${term}". Known terms: ${GLOSSARY.map((e) => e.term).join(', ')}.`);
    }
    return text(formatEntry(entry));
  }),
);

server.registerTool(
  'preview_change',
  {
    title: 'Preview a change',
    description:
      'Dry run: explains exactly what a change would do, the git commands involved, how risky it is, and anything blocking it. Changes nothing. Use before propose_change.',
    inputSchema: { repo_path: repoPath, operation: operationSchema },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ repo_path, operation }) => {
    const root = await requireRepo(repo_path);
    return text(formatPlan(await planChange(root, operation)));
  }),
);

server.registerTool(
  'propose_change',
  {
    title: 'Propose a change',
    description:
      'Sends a change to the Gitpicky app, where the person sees a preview and approves or rejects it. Waits for their decision (up to wait_seconds) and reports the outcome. Requires the Gitpicky app to be running.',
    inputSchema: {
      repo_path: repoPath,
      operation: operationSchema,
      reason: z.string().min(1).describe('One or two sentences, in plain language, on why you are suggesting this. Shown to the person.'),
      wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for a decision before returning. Default 90.'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true },
  },
  guard(async ({ repo_path, operation, reason, wait_seconds }) => {
    const root = await requireRepo(repo_path);
    const created = await callApp<ProposalView>('POST', '/proposals', { repo: root, operation, reason, requestedBy: 'Your assistant' });
    if (created.status !== 'pending') return text(formatProposal(created));
    const wait = wait_seconds ?? 90;
    if (wait === 0) return text(formatProposal(created));
    const decided = await callApp<ProposalView>('GET', `/proposals/${created.id}?wait=${wait}`, undefined, (wait + 15) * 1000);
    return text(formatProposal(decided));
  }),
);

server.registerTool(
  'check_proposal',
  {
    title: 'Check a proposal',
    description: 'Gets the status of a change sent with propose_change, optionally waiting for the person to decide.',
    inputSchema: {
      proposal_id: z.string().min(1),
      wait_seconds: z.number().int().min(0).max(110).optional().describe('How long to wait for a decision. Default 60.'),
    },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ proposal_id, wait_seconds }) => {
    const wait = wait_seconds ?? 60;
    const p = await callApp<ProposalView>('GET', `/proposals/${encodeURIComponent(proposal_id)}?wait=${wait}`, undefined, (wait + 15) * 1000);
    return text(formatProposal(p));
  }),
);

server.registerTool(
  'open_in_gitpicky',
  {
    title: 'Show in Gitpicky',
    description: 'Opens the repository in the Gitpicky app so the person can see its history as a picture. Requires the app to be running.',
    inputSchema: { repo_path: repoPath },
    annotations: { readOnlyHint: true },
  },
  guard(async ({ repo_path }) => {
    const root = await requireRepo(repo_path);
    await callApp('POST', '/open', { repo: root });
    return text(`Opened ${root} in Gitpicky.`);
  }),
);

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error('Gitpicky MCP server failed to start:', error);
  process.exit(1);
});
