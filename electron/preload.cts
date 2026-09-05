import type { IpcRendererEvent } from "electron";
import type {
  AppSettings,
  ContextAction,
  DependencyDownloadState,
  DependencyStatus,
  ElectronApi,
  FolderValidationResult,
  ScanProgress,
  VideoItem
} from "../src/shared";
import type { DependencyTool } from "../src/lib/deps-core";

const { contextBridge, ipcRenderer, webUtils } = require("electron") as typeof import("electron");

const api: ElectronApi = {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (settings: Partial<AppSettings>) => ipcRenderer.invoke("settings:update", settings),
  getDependencyStatus: () => ipcRenderer.invoke("dependencies:get"),
  redetectDependencies: () => ipcRenderer.invoke("deps:redetect"),
  startDependencyDownload: () => ipcRenderer.invoke("deps:download-start"),
  cancelDependencyDownload: () => ipcRenderer.invoke("deps:download-cancel"),
  getDependencyDownloadState: () => ipcRenderer.invoke("deps:download-state") as Promise<DependencyDownloadState>,
  restoreSystemDependencies: () => ipcRenderer.invoke("deps:restore-system"),
  enableVendorDependencies: () => ipcRenderer.invoke("deps:enable-vendor"),
  setCustomDependencyPath: (tool: DependencyTool, filePath: string | undefined) =>
    ipcRenderer.invoke("deps:set-custom-path", tool, filePath),
  chooseFolder: () => ipcRenderer.invoke("folder:choose"),
  validateFolder: (folderPath: string) => ipcRenderer.invoke("folder:validate", folderPath) as Promise<FolderValidationResult>,
  showFolderInExplorer: (folderPath: string) => ipcRenderer.invoke("folder:show-in-explorer", folderPath),
  startScan: (folderPath) => ipcRenderer.invoke("scan:start", folderPath),
  cancelScan: () => ipcRenderer.invoke("scan:cancel"),
  contextAction: (action: ContextAction, filePath: string) => ipcRenderer.invoke("video:context-action", action, filePath),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onDependenciesChanged: (callback: (status: DependencyStatus) => void) => {
    const listener = (_event: IpcRendererEvent, status: DependencyStatus) => callback(status);
    ipcRenderer.on("deps:status-changed", listener);
    return () => ipcRenderer.off("deps:status-changed", listener);
  },
  onDependencyDownloadStateChanged: (callback: (state: DependencyDownloadState) => void) => {
    const listener = (_event: IpcRendererEvent, state: DependencyDownloadState) => callback(state);
    ipcRenderer.on("deps:download-progress", listener);
    return () => ipcRenderer.off("deps:download-progress", listener);
  },
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
