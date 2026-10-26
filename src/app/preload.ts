import { contextBridge, ipcRenderer } from 'electron';
import type { GitpickyApi } from './api';

const api: GitpickyApi = {
  pickRepo: () => ipcRenderer.invoke('repo:pick'),
  openRepo: (path) => ipcRenderer.invoke('repo:open', path),
  refresh: () => ipcRenderer.invoke('repo:refresh'),
  recentRepos: () => ipcRenderer.invoke('repo:recent'),
  commitFiles: (hash) => ipcRenderer.invoke('repo:commit-files', hash),
  plan: (op) => ipcRenderer.invoke('change:plan', op),
  run: (op) => ipcRenderer.invoke('change:run', op),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  proposals: () => ipcRenderer.invoke('proposals:list'),
  approveProposal: (id) => ipcRenderer.invoke('proposals:approve', id),
  rejectProposal: (id, note) => ipcRenderer.invoke('proposals:reject', id, note),
  onProposalsChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('proposals:changed', handler);
    return () => ipcRenderer.removeListener('proposals:changed', handler);
  },
  onRepoChanged: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('repo:changed', handler);
    return () => ipcRenderer.removeListener('repo:changed', handler);
  },
};

contextBridge.exposeInMainWorld('gitpicky', api);
