import type { IpcRendererEvent } from "electron";
import type { AppSettings, ContextAction, ElectronApi, FolderValidationResult, ScanProgress, VideoItem } from "../src/shared";

const { contextBridge, ipcRenderer, webUtils } = require("electron") as typeof import("electron");

const api: ElectronApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  getDependencyStatus: () => ipcRenderer.invoke("dependencies:get"),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  validateFolder: (folderPath: string) => ipcRenderer.invoke("folder:validate", folderPath) as Promise<FolderValidationResult>,
  showFolderInExplorer: (folderPath: string) => ipcRenderer.invoke("folder:show-in-explorer", folderPath),
  startScan: (folderPath) => ipcRenderer.invoke("scan:start", folderPath),
  cancelScan: () => ipcRenderer.invoke("scan:cancel"),
  contextAction: (action: ContextAction, filePath: string) => ipcRenderer.invoke("video:context-action", action, filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
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
