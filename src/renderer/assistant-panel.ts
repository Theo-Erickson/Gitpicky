// The Assistant tab's chat (ask Ollama, Claude Code, Codex or Copilot from inside
// Gitpicky) and the "Use Gitpicky from other AI tools" list.

import type { GitpickyApi } from '../app/api';
import type { AssistantEvent, AssistantSettings, ClientId, ClientStatus, ProviderId, ProviderStatus } from '../core/assistant-protocol';
import { h } from './dom';

interface ShownMessage {
  role: 'user' | 'assistant';
  text: string;
  /** Gitpicky tools the assistant used while answering. */
  tools: string[];
  error?: boolean;
}

interface AssistantUi {
  providers: ProviderStatus[] | null;
  checking: boolean;
  settings: AssistantSettings;
  messages: ShownMessage[];
  draft: string;
  busy: boolean;
  clients: ClientStatus[] | null;
  config: string;
  /** Show the "other tools" list expanded. */
  connectOpen: boolean | null;
}

const ui: AssistantUi = {
  providers: null,
  checking: false,
  settings: { provider: null, models: {}, ollamaUrl: null },
  messages: [],
  draft: '',
  busy: false,
  clients: null,
  config: '',
  connectOpen: null,
};

let api: GitpickyApi;
let rerender: () => void = () => undefined;
let flash: (message: string) => void = () => undefined;

const TOOL_WORDS: Record<string, string> = {
  get_repo_overview: 'looked at the repository',
  show_history: 'read the history',
  explain_git_term: 'looked up a git word',
  preview_change: 'previewed a change',
  propose_change: 'asked you to approve a change',
  check_proposal: 'checked on a request',
  open_in_gitpicky: 'opened a repository',
};

export async function initAssistant(gitpicky: GitpickyApi, render: () => void, showFlash: (message: string) => void): Promise<void> {
  api = gitpicky;
  rerender = render;
  flash = showFlash;
  api.onAssistantEvent(onEvent);
  ui.settings = await api.assistantSettings();
  void checkProviders();
  void loadClients();
}

async function checkProviders(): Promise<void> {
  ui.checking = true;
  rerender();
  ui.providers = await api.assistantProviders();
  ui.checking = false;
  rerender();
}

async function loadClients(): Promise<void> {
  [ui.clients, ui.config] = await Promise.all([api.mcpClients(), api.mcpConfig()]);
  rerender();
}

/** The provider to use: the saved one if it works, otherwise the first that does. */
function activeProvider(): ProviderStatus | null {
  const list = ui.providers ?? [];
  return list.find((p) => p.id === ui.settings.provider && p.available) ?? list.find((p) => p.available) ?? null;
}

function activeModel(provider: ProviderStatus): string | undefined {
  if (provider.models.length === 0) return undefined;
  const saved = ui.settings.models[provider.id];
  return saved && provider.models.includes(saved) ? saved : provider.models[0];
}

function lastAssistant(): ShownMessage {
  const last = ui.messages[ui.messages.length - 1];
  if (last && last.role === 'assistant' && !last.error) return last;
  const fresh: ShownMessage = { role: 'assistant', text: '', tools: [] };
  ui.messages.push(fresh);
  return fresh;
}

function onEvent(event: AssistantEvent): void {
  if (event.kind === 'text') {
    const m = lastAssistant();
    m.text = m.text ? `${m.text}${m.text.endsWith('\n') || event.text.startsWith('\n') ? '' : '\n\n'}${event.text}` : event.text;
  } else if (event.kind === 'tool') {
    const m = lastAssistant();
    if (!m.tools.includes(event.name)) m.tools.push(event.name);
  } else if (event.kind === 'error') {
    ui.messages.push({ role: 'assistant', text: event.text, tools: [], error: true });
  } else {
    ui.busy = false;
    rerender();
    focusInput();
    return;
  }
  refreshLog();
}

/** Redraws just the conversation, so typing in the box isn't interrupted. */
function refreshLog(): void {
  const log = document.querySelector('.chat-log');
  if (!log) return;
  const next = renderLog();
  log.replaceWith(next);
  next.scrollTop = next.scrollHeight;
}

function focusInput(): void {
  requestAnimationFrame(() => (document.querySelector('.chat-input') as HTMLTextAreaElement | null)?.focus());
}

async function send(): Promise<void> {
  const provider = activeProvider();
  const prompt = ui.draft.trim();
  if (!provider || !prompt || ui.busy) return;
  const history = ui.messages.filter((m) => !m.error && m.text).map((m) => ({ role: m.role, text: m.text }));
  ui.messages.push({ role: 'user', text: prompt, tools: [] });
  ui.draft = '';
  ui.busy = true;
  rerender();
  const r = await api.askAssistant({ provider: provider.id, model: activeModel(provider), history, prompt });
  if (!r.ok) {
    ui.busy = false;
    ui.messages.push({ role: 'assistant', text: r.error, tools: [], error: true });
    rerender();
  }
}

async function saveSettings(change: Partial<AssistantSettings>): Promise<void> {
  ui.settings = await api.updateAssistantSettings(change);
  rerender();
}

function renderLog(): HTMLElement {
  const provider = activeProvider();
  return h(
    'div',
    { class: 'chat-log' },
    ui.messages.length === 0
      ? h('p', { class: 'muted chat-empty' }, provider ? `Ask ${provider.label} about this repository, or for a change in your own words, e.g. "make a branch for the ice cave level and commit what I have". You approve every change.` : '')
      : ui.messages.map((m) =>
          h(
            'div',
            { class: `chat-msg chat-${m.role}${m.error ? ' chat-error' : ''}` },
            m.tools.length ? h('div', { class: 'chat-tools' }, m.tools.map((t) => h('span', { class: 'chat-tool' }, TOOL_WORDS[t] ?? t))) : null,
            m.text ? h('div', { class: 'chat-text' }, m.text) : null,
          ),
        ),
    ui.busy ? h('div', { class: 'chat-msg chat-assistant chat-thinking' }, 'Thinking…') : null,
  );
}

function providerPicker(): HTMLElement {
  const list = ui.providers ?? [];
  const active = activeProvider();
  const select = h(
    'select',
    {
      class: 'chat-provider',
      'aria-label': 'Assistant',
      disabled: ui.busy || !active,
      onchange: (e: Event) => void saveSettings({ provider: (e.target as HTMLSelectElement).value as ProviderId }),
    },
    list.map((p) => h('option', { value: p.id, selected: p.id === active?.id, disabled: !p.available }, p.available ? p.label : `${p.label} (not set up)`)),
  );
  const model =
    active && active.models.length
      ? h(
          'select',
          {
            class: 'chat-model',
            'aria-label': 'Model',
            disabled: ui.busy,
            onchange: (e: Event) => void saveSettings({ models: { [active.id]: (e.target as HTMLSelectElement).value } }),
          },
          active.models.map((m) => h('option', { value: m, selected: m === activeModel(active) }, m)),
        )
      : null;
  return h(
    'div',
    { class: 'chat-pickers' },
    select,
    model,
    h('button', { type: 'button', class: 'link', disabled: ui.checking || ui.busy, onclick: () => void checkProviders() }, ui.checking ? 'Checking…' : 'Check again'),
  );
}

function providerHelp(): HTMLElement {
  const list = ui.providers ?? [];
  return h(
    'details',
    { class: 'chat-help' },
    h('summary', null, 'Which assistants can I use?'),
    h(
      'ul',
      null,
      list.map((p) =>
        h(
          'li',
          null,
          h('strong', null, p.label),
          ': ',
          p.detail,
          p.available ? null : [' ', h('button', { type: 'button', class: 'link', onclick: () => void api.openExternal(p.installUrl) }, 'How to install')],
        ),
      ),
    ),
    h('p', { class: 'muted' }, 'Claude Code, Codex and Copilot use your own sign-in for those tools. Ollama runs models on this computer.'),
  );
}

export function renderChat(): HTMLElement {
  if (!ui.providers) return h('div', { class: 'chat' }, h('p', { class: 'muted' }, 'Looking for assistants on this computer…'));
  const active = activeProvider();
  const input = h('textarea', {
    class: 'chat-input',
    rows: 3,
    placeholder: active ? `Message ${active.label}…` : 'Set up an assistant first',
    disabled: !active,
    'aria-label': 'Message the assistant',
  });
  input.value = ui.draft;
  input.addEventListener('input', () => (ui.draft = input.value));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });
  const log = renderLog();
  requestAnimationFrame(() => (log.scrollTop = log.scrollHeight));
  return h(
    'div',
    { class: 'chat' },
    providerPicker(),
    active ? null : h('p', { class: 'chat-none' }, 'No assistant found yet. Install one of these, then click Check again.'),
    providerHelp(),
    log,
    h(
      'div',
      { class: 'chat-compose' },
      input,
      h(
        'div',
        { class: 'actions' },
        ui.messages.length && !ui.busy
          ? h(
              'button',
              {
                type: 'button',
                onclick: () => {
                  ui.messages = [];
                  rerender();
                },
              },
              'New conversation',
            )
          : null,
        ui.busy
          ? h('button', { type: 'button', onclick: () => void api.cancelAssistant() }, 'Stop')
          : h('button', { type: 'button', class: 'primary', disabled: !active, onclick: () => void send() }, 'Send'),
      ),
    ),
  );
}

async function toggleClient(c: ClientStatus): Promise<void> {
  const r = c.connected && !c.note ? await api.disconnectMcpClient(c.id) : await api.connectMcpClient(c.id);
  if (!r.ok) {
    flash(r.error);
    return;
  }
  ui.clients = r.value;
  const now = r.value.find((x) => x.id === c.id);
  flash(now?.connected ? `Added to ${c.label}. Restart it to pick up Gitpicky.` : `Removed from ${c.label}.`);
  rerender();
}

const CLIENT_HINTS: Partial<Record<ClientId, string>> = {
  'claude-code': 'Also used by the Claude desktop app\'s Code tab.',
  vscode: 'For Copilot Chat in agent mode.',
};

export function renderConnect(hasRequests: boolean): HTMLElement {
  const clients = ui.clients ?? [];
  const anyConnected = clients.some((c) => c.connected);
  const open = ui.connectOpen ?? (!anyConnected && !hasRequests);
  const details = h(
    'details',
    { class: 'setup', open },
    h('summary', null, h('h3', null, 'Use Gitpicky from your other AI tools')),
    h('p', { class: 'muted' }, 'Lets those tools see your repositories and ask for changes, which show up here for you to approve. Changes the settings file of each tool you pick (a backup is saved next to it).'),
    h(
      'ul',
      { class: 'clients' },
      clients.map((c) =>
        h(
          'li',
          { class: 'client' },
          h(
            'div',
            { class: 'client-head' },
            h('span', { class: 'client-name' }, c.label),
            h('span', { class: `status ${c.connected ? 'status-applied' : ''}` }, c.connected ? 'connected' : 'not connected'),
            c.editable
              ? h('button', { type: 'button', onclick: () => void toggleClient(c) }, c.connected ? (c.note ? 'Update' : 'Disconnect') : 'Connect')
              : null,
          ),
          CLIENT_HINTS[c.id] ? h('div', { class: 'client-path' }, CLIENT_HINTS[c.id]) : null,
          h('div', { class: 'client-path', title: c.configPath }, c.configPath),
          c.note ? h('div', { class: 'client-note' }, c.note) : null,
        ),
      ),
    ),
    h('h3', null, 'Any other MCP tool'),
    h('p', null, 'Paste this into its MCP settings, then restart it.'),
    h('pre', null, ui.config),
    h(
      'button',
      {
        type: 'button',
        onclick: async () => {
          await navigator.clipboard.writeText(ui.config);
          flash('Config copied.');
        },
      },
      'Copy config',
    ),
  );
  details.addEventListener('toggle', () => (ui.connectOpen = details.open));
  return details;
}
