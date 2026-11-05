// Shared types for the in-app assistant and for connecting Gitpicky to other AI tools.
// Types only (no Node imports) so the window can use them too.

/** The AI tools Gitpicky can use as its in-app assistant. */
export type ProviderId = 'ollama' | 'claude' | 'codex' | 'copilot';

export const PROVIDER_IDS: ProviderId[] = ['ollama', 'claude', 'codex', 'copilot'];

export interface ProviderStatus {
  id: ProviderId;
  label: string;
  /** True when Gitpicky found it and can talk to it. */
  available: boolean;
  /** Plain-language status: the version found, or why it isn't usable. */
  detail: string;
  /** Where to get it, for the "not found" hint. */
  installUrl: string;
  /** Models to pick from (Ollama only). Empty when the tool picks its own model. */
  models: string[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
}

export interface AssistantRequest {
  provider: ProviderId;
  /** The model to use, for providers that offer a choice. */
  model?: string;
  /** Earlier turns of the conversation, oldest first. */
  history: ChatMessage[];
  prompt: string;
}

/** What the window hears while the assistant works. */
export type AssistantEvent =
  | { kind: 'text'; text: string }
  | { kind: 'tool'; name: string }
  | { kind: 'error'; text: string }
  | { kind: 'done' };

/** The tools that can use Gitpicky's MCP server themselves. */
export type ClientId = 'claude-code' | 'claude-desktop' | 'codex' | 'copilot-cli' | 'vscode' | 'gemini';

export interface ClientStatus {
  id: ClientId;
  label: string;
  /** The settings file Gitpicky writes to. */
  configPath: string;
  /** True when Gitpicky is already set up in that tool. */
  connected: boolean;
  /** False when the settings file can't be safely edited (e.g. it has comments); copy the config instead. */
  editable: boolean;
  /** Extra information, e.g. why it can't be edited. */
  note?: string;
}

/** Saved assistant choices. */
export interface AssistantSettings {
  provider: ProviderId | null;
  models: Partial<Record<ProviderId, string>>;
  /** Where Ollama listens. Default http://127.0.0.1:11434 (or OLLAMA_HOST). */
  ollamaUrl: string | null;
}
