import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { DesktopAPI, Result } from '../shared/types';
async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const result: Result<T> = await ipcRenderer.invoke(channel, input);
  if (!result.ok) {
    // contextBridge drops custom properties on Error instances. Plain records retain error codes.
    throw result.error;
  }
  return result.value;
}
function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}
const api: DesktopAPI = {
  bootstrap: () => invoke('app:bootstrap'),
  readyForFiles: () => invoke('app:ready-for-files'),
  openDialog: () => invoke('file:dialog'),
  open: (path, encoding) => invoke('file:open', { path, encoding }),
  inspect: (path, encoding) => invoke('file:inspect', { path, encoding }),
  openDropped: (file) => invoke('file:read-dropped', webUtils.getPathForFile(file)),
  readPage: (path, offset, encoding) => invoke('file:page', { path, offset, encoding }),
  save: (text, meta) => invoke('file:save', { text, meta }),
  saveAs: (text, name, source) => invoke('file:save-as', { text, name, source }),
  closeFile: (path) => invoke('file:close', path),
  pickWorkspace: () => invoke('workspace:pick'),
  list: (path) => invoke('workspace:list', path),
  search: (query, caseSensitive) => invoke('search:files', { query, caseSensitive }),
  cancelSearch: () => invoke('search:cancel'),
  rename: (path, name) => invoke('file:rename', { path, name }),
  trash: (path) => invoke('file:trash', path),
  reveal: (path) => invoke('file:reveal', path),
  writeImage: (path, bytes) => invoke('file:write-image', { path, bytes }),
  exportDocument: (html, name, format) => invoke('export:document', { html, name, format }),
  openExternal: (url) => invoke('app:external', url),
  setSettings: (settings) => invoke('settings:set', settings),
  saveSession: (session) => invoke('session:save', session),
  clearRecovery: () => invoke('session:clear-recovery'),
  confirmClose: (name) => invoke('app:confirm-close', name),
  finishClose: () => invoke('app:finish-close'),
  checkUpdates: () => invoke('update:check'),
  onCommand: (callback) => subscribe('event:command', callback),
  onOpen: (callback) => subscribe('event:open', callback),
  onFileChanged: (callback) => subscribe('event:file-changed', callback),
  onCloseRequested: (callback) => subscribe('event:close-requested', callback),
};
contextBridge.exposeInMainWorld('md', api);
