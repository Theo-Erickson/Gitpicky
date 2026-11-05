// Runs one assistant conversation turn at a time and reports progress to the window.

import type { AssistantEvent, AssistantRequest, ProviderStatus } from '../../core/assistant-protocol';
import { PROVIDER_IDS } from '../../core/assistant-protocol';
import type { Launch } from './cli';
import { PROVIDERS } from './providers';

export interface ServiceHooks {
  mcp: () => Launch | null;
  node: () => Launch | null;
  repo: () => string | null;
  ollamaUrl: () => string;
  emit: (event: AssistantEvent) => void;
}

export class AssistantService {
  private current: AbortController | null = null;

  constructor(private readonly hooks: ServiceHooks) {}

  get busy(): boolean {
    return this.current !== null;
  }

  private context() {
    const mcp = this.hooks.mcp();
    if (!mcp) throw new Error("Can't start Gitpicky's MCP server: Node.js wasn't found. Install it from nodejs.org.");
    return { mcp, node: this.hooks.node(), repo: this.hooks.repo(), ollamaUrl: this.hooks.ollamaUrl() };
  }

  async detect(): Promise<ProviderStatus[]> {
    let ctx;
    try {
      ctx = this.context();
    } catch {
      ctx = { mcp: { command: 'node', args: [] }, node: null, repo: null, ollamaUrl: this.hooks.ollamaUrl() };
    }
    return Promise.all(PROVIDER_IDS.map((id) => PROVIDERS[id].detect(ctx)));
  }

  /** Starts a turn. Progress arrives through hooks.emit and always ends with a 'done' event. */
  send(request: AssistantRequest): void {
    if (this.current) throw new Error('The assistant is still working on the last message.');
    const controller = new AbortController();
    this.current = controller;
    const emit = (event: AssistantEvent) => {
      if (!controller.signal.aborted) this.hooks.emit(event);
    };
    void (async () => {
      try {
        const ctx = this.context();
        await PROVIDERS[request.provider].run(ctx, {
          model: request.model,
          history: request.history,
          prompt: request.prompt,
          signal: controller.signal,
          emit,
        });
      } catch (error) {
        if (!controller.signal.aborted) emit({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
      } finally {
        this.current = null;
        this.hooks.emit({ kind: 'done' });
      }
    })();
  }

  cancel(): void {
    this.current?.abort();
  }
}
