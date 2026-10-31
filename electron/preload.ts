import { contextBridge, ipcRenderer, webUtils } from "electron";
import type { DesktopAPI } from "../src/api";
import { UPDATE_CHANNELS } from "../src/updates";
const subscribe = (channel: string, fn: (value: any) => void) => {
  const listener = (_: unknown, value: unknown) => fn(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};
const api: DesktopAPI = {
  platform: process.platform,
  language: process.argv.includes("--tacticut-language=de") ? "de" : "en",
  setLanguage: (language) => ipcRenderer.invoke("set-language", language),
  windowControl: (action) => ipcRenderer.send("window-control", action),
  open: () => ipcRenderer.invoke("open"),
  projects: () => ipcRenderer.invoke("projects"),
  browseProjects: () => ipcRenderer.invoke("browse-projects"),
  openProject: (path) => ipcRenderer.invoke("open-project", path),
  createCollection: (paths, title) =>
    ipcRenderer.invoke("create-collection", paths, title),
  forgetProject: (path) => ipcRenderer.invoke("forget-project", path),
  openPending: () => ipcRenderer.invoke("open-pending"),
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
  playerExports: (data, options) =>
    ipcRenderer.invoke("player-exports", data, options),
  cancelExport: () => ipcRenderer.invoke("cancel-export"),
  report: (data, ids, format) =>
    ipcRenderer.invoke("report", data, ids, format),
  onProgress: (fn) => subscribe("progress", fn),
  onCommand: (fn) => subscribe("command", fn),
  setDirty: (dirty) => ipcRenderer.send("dirty", dirty),
  close: () => ipcRenderer.send("close-approved"),
  updates: {
    state: () => ipcRenderer.invoke(UPDATE_CHANNELS.state),
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    restart: () => ipcRenderer.invoke(UPDATE_CHANNELS.restart),
    openPage: () => ipcRenderer.invoke(UPDATE_CHANNELS.openPage),
    onChange: (fn) => subscribe(UPDATE_CHANNELS.changed, fn),
  },
};
contextBridge.exposeInMainWorld("desktop", api);
