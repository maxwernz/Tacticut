import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopAPI } from "../src/api";
const subscribe = (channel: string, fn: (value: any) => void) => {
  const listener = (_: unknown, value: unknown) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const api: DesktopAPI = {
  platform: process.platform,
  windowControl: (action) => ipcRenderer.send("window-control", action),
  open: () => ipcRenderer.invoke("open"),
  save: (data, as) => ipcRenderer.invoke("save", data, as),
  addVideos: () => ipcRenderer.invoke("add-videos"),
  importPaths: (paths) => ipcRenderer.invoke("import-paths", paths),
  filePaths: (files) => files.map((file) => webUtils.getPathForFile(file)),
  media: (source, path, proxy) =>
    ipcRenderer.invoke("media", source, path, proxy),
  relink: (source) => ipcRenderer.invoke("relink", source),
  recovery: (data) => ipcRenderer.invoke("recovery", data),
  restore: () => ipcRenderer.invoke("restore"),
  template: (categories) => ipcRenderer.invoke("template", categories),
  export: (data, options) => ipcRenderer.invoke("export", data, options),
  cancelExport: () => ipcRenderer.invoke("cancel-export"),
  onProgress: (fn) => subscribe("progress", fn),
  onCommand: (fn) => subscribe("command", fn),
  setDirty: (dirty) => ipcRenderer.send("dirty", dirty),
  close: () => ipcRenderer.send("close-approved"),
};
contextBridge.exposeInMainWorld("desktop", api);
