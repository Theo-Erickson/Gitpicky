import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { CreateProposalRequest, ProposalView } from '../core/bridge-protocol';
import { executePlan, planChange } from '../core/operations';

/**
 * Changes an assistant has asked for. Each one waits here until the person
 * approves or rejects it in the app; nothing runs on its own.
 */
export class ProposalQueue extends EventEmitter {
  private items = new Map<string, ProposalView>();

  list(): ProposalView[] {
    return [...this.items.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): ProposalView | undefined {
    return this.items.get(id);
  }

  async create(request: CreateProposalRequest): Promise<ProposalView> {
    const plan = await planChange(request.repo, request.operation);
    const proposal: ProposalView = {
      id: randomUUID().slice(0, 8),
      repo: request.repo,
      operation: request.operation,
      reason: request.reason,
      requestedBy: request.requestedBy ?? 'Your assistant',
      createdAt: new Date().toISOString(),
      status: 'pending',
      plan,
    };
    // A plan that can't run is reported straight back instead of bothering the person.
    if (plan.blockers.length > 0) {
      proposal.status = 'failed';
      proposal.result = { ok: false, error: plan.blockers.join(' '), log: [] };
    }
    this.items.set(proposal.id, proposal);
    this.trim();
    this.emit('changed', proposal);
    return proposal;
  }

  async approve(id: string): Promise<ProposalView> {
    const proposal = this.require(id);
    if (proposal.status !== 'pending') return proposal;
    proposal.status = 'running';
    this.emit('changed', proposal);
    const result = await executePlan(proposal.repo, proposal.operation);
    proposal.plan = result.plan;
    proposal.result = { ok: result.ok, error: result.error, log: result.log };
    proposal.status = result.ok ? 'applied' : 'failed';
    this.emit('changed', proposal);
    return proposal;
  }

  reject(id: string, note?: string): ProposalView {
    const proposal = this.require(id);
    if (proposal.status === 'pending') {
      proposal.status = 'rejected';
      proposal.note = note?.trim() || undefined;
      this.emit('changed', proposal);
    }
    return proposal;
  }

  /** Resolves when the proposal leaves the pending/running state, or after `ms`. */
  waitForDecision(id: string, ms: number): Promise<ProposalView> {
    const proposal = this.require(id);
    if (proposal.status !== 'pending' && proposal.status !== 'running') return Promise.resolve(proposal);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off('changed', listener);
        resolve(this.require(id));
      };
      const listener = (p: ProposalView) => {
        if (p.id === id && p.status !== 'pending' && p.status !== 'running') done();
      };
      const timer = setTimeout(done, ms);
      this.on('changed', listener);
    });
  }

  private require(id: string): ProposalView {
    const proposal = this.items.get(id);
    if (!proposal) throw new Error(`No proposal with id "${id}".`);
    return proposal;
  }

  /** Keeps the last 50 finished proposals so the list doesn't grow forever. */
  private trim(): void {
    const finished = this.list().filter((p) => p.status !== 'pending' && p.status !== 'running');
    for (const p of finished.slice(50)) this.items.delete(p.id);
  }
}
