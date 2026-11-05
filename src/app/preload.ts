import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { GitpickyApi } from './api';

const api: GitpickyApi = {
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
  openRepo: (path) => ipcRenderer.invoke('repo:open', path),
  refresh: () => ipcRenderer.invoke('repo:refresh'),
  recentRepos: () => ipcRenderer.invoke('repo:recent'),
  forgetRepo: (path) => ipcRenderer.invoke('repo:forget', path),
  pathForFile: (file) => webUtils.getPathForFile(file),
  browseRepos: () => ipcRenderer.invoke('repos:browse'),
  addScanFolder: () => ipcRenderer.invoke('repos:add-root'),
  removeScanFolder: (path) => ipcRenderer.invoke('repos:remove-root', path),
  commitFiles: (hash) => ipcRenderer.invoke('repo:commit-files', hash),
  commitMessage: (hash) => ipcRenderer.invoke('repo:commit-message', hash),
  plan: (op) => ipcRenderer.invoke('change:plan', op),
  run: (op) => ipcRenderer.invoke('change:run', op),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  mcpServerPath: () => ipcRenderer.invoke('mcp:server-path'),
  proposals: () => ipcRenderer.invoke('proposals:list'),
  approveProposal: (id) => ipcRenderer.invoke('proposals:approve', id),
  rejectProposal: (id, note) => ipcRenderer.invoke('proposals:reject', id, note),
  onProposalsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('proposals:changed', handler);
    return () => ipcRenderer.removeListener('proposals:changed', handler);
  },
  assistantProviders: () => ipcRenderer.invoke('assistant:providers'),
  assistantSettings: () => ipcRenderer.invoke('assistant:settings'),
  updateAssistantSettings: (change) => ipcRenderer.invoke('assistant:update-settings', change),
  askAssistant: (request) => ipcRenderer.invoke('assistant:ask', request),
  cancelAssistant: () => ipcRenderer.invoke('assistant:cancel'),
  onAssistantEvent: (listener) => {
    const handler = (_e: unknown, event: Parameters<typeof listener>[0]) => listener(event);
    ipcRenderer.on('assistant:event', handler);
    return () => ipcRenderer.removeListener('assistant:event', handler);
  },
  mcpClients: () => ipcRenderer.invoke('mcp:clients'),
  connectMcpClient: (id) => ipcRenderer.invoke('mcp:connect', id),
  disconnectMcpClient: (id) => ipcRenderer.invoke('mcp:disconnect', id),
  mcpConfig: () => ipcRenderer.invoke('mcp:config'),
  onRepoChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('repo:changed', handler);
    return () => ipcRenderer.removeListener('repo:changed', handler);
  },
};

contextBridge.exposeInMainWorld('gitpicky', api);
