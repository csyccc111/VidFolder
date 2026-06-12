import type { IpcRendererEvent } from "electron";
import type { ContextAction, ElectronApi, ScanProgress, VideoItem } from "../src/shared";

const { contextBridge, ipcRenderer } = require("electron") as typeof import("electron");

const api: ElectronApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  startScan: (folderPath) => ipcRenderer.invoke("scan:start", folderPath),
  cancelScan: () => ipcRenderer.invoke("scan:cancel"),
  contextAction: (action: ContextAction, filePath: string) => ipcRenderer.invoke("video:context-action", action, filePath),
  onProgress: (callback: (progress: ScanProgress) => void) => {
    const listener = (_event: IpcRendererEvent, progress: ScanProgress) => callback(progress);
    ipcRenderer.on("scan:progress", listener);
    return () => ipcRenderer.off("scan:progress", listener);
  },
  onItem: (callback: (item: VideoItem) => void) => {
    const listener = (_event: IpcRendererEvent, item: VideoItem) => callback(item);
    ipcRenderer.on("scan:item", listener);
    return () => ipcRenderer.off("scan:item", listener);
  }
};

contextBridge.exposeInMainWorld("videoBrowser", api);
