// How the MCP server finds and talks to the running Gitpicky app.
//
// When the app starts it listens on a random localhost port and writes the
// port plus a secret token to ~/.gitpicky/bridge.json. The MCP server reads
// that file and sends requests with the token, so only local processes that
// can read your home folder can talk to the app.

// Types only (no Node imports) so the window can share them; paths live in bridge-paths.ts.

import type { Operation, Plan } from './preview';

export interface BridgeInfo {
  port: number;
  token: string;
  pid: number;
  version: string;
}

export type ProposalStatus = 'pending' | 'running' | 'applied' | 'failed' | 'rejected';

export interface ProposalView {
  id: string;
  repo: string;
  operation: Operation;
  /** Why the assistant wants this, in its words. */
  reason: string;
  /** Who asked, e.g. "Claude". */
  requestedBy: string;
  createdAt: string;
  status: ProposalStatus;
  plan: Plan;
  /** Set once it ran (or failed). */
  result?: { ok: boolean; error?: string; log: { command: string; output: string }[] };
  /** Optional note from the person when rejecting. */
  note?: string;
}

export interface CreateProposalRequest {
  repo: string;
  operation: Operation;
  reason: string;
  requestedBy?: string;
}
