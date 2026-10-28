import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { AppEvent, TokFarmAPI } from '../shared/model'

const api: TokFarmAPI = {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  importVideo: (path) => ipcRenderer.invoke('import-video', path),
  openProject: (id) => ipcRenderer.invoke('open-project', id),
  saveProject: (project) => ipcRenderer.invoke('save-project', project),
  relinkSource: (id) => ipcRenderer.invoke('relink-source', id),
  chooseOutputDirectory: () => ipcRenderer.invoke('choose-output'),
  mediaUrl: (id) => ipcRenderer.invoke('media-url', id),
  thumbnails: (id) => ipcRenderer.invoke('thumbnails', id),
  createProxy: (id) => ipcRenderer.invoke('create-proxy', id),
  cancelProxy: (id) => ipcRenderer.invoke('cancel-proxy', id),
  enqueue: (project, ids) => ipcRenderer.invoke('enqueue', project, ids),
  queueAction: (action, id) => ipcRenderer.invoke('queue-action', action, id),
  revealOutput: (id) => ipcRenderer.invoke('reveal-output', id),
  droppedFilePath: (file) => webUtils.getPathForFile(file),
  onEvent: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, value: AppEvent) => callback(value)
    ipcRenderer.on('app-event', listener)
    return () => ipcRenderer.removeListener('app-event', listener)
  }
}
contextBridge.exposeInMainWorld('tokfarm', api)
