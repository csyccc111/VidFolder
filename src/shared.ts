export type ThumbnailStatus = "pending" | "ready" | "failed";
export type MetadataStatus = "pending" | "ready" | "failed";
export type ScanState = "idle" | "scanning" | "complete" | "cancelled" | "error";

export type VideoItem = {
  id: string;
  filePath: string;
  fileName: string;
  directory: string;
  extension: string;
  size: number;
  modifiedAt: number;
  duration?: number;
  width?: number;
  height?: number;
  thumbnailPath?: string;
  thumbnailStatus: ThumbnailStatus;
  metadataStatus: MetadataStatus;
  error?: string;
};

export type ScanProgress = {
  state: ScanState;
  rootPath?: string;
  found: number;
  processed: number;
  thumbnailsReady: number;
  failures: number;
  message?: string;
};

export type AppSettings = {
  lastFolder?: string;
  viewMode?: "grid" | "list";
  sortKey?: "fileName" | "modifiedAt" | "size" | "duration";
  ascending?: boolean;
  thumbSize?: "small" | "medium" | "large";
};

export type ToolStatus = {
  available: boolean;
  version?: string;
  error?: string;
};

export type DependencyStatus = {
  ffmpeg: ToolStatus;
  ffprobe: ToolStatus;
  checkedAt: number;
};

export type ContextAction = "showInFolder" | "openVideo" | "copyPath" | "regenerateThumbnail";

export type IpcEvents = {
  "scan:progress": ScanProgress;
  "scan:item": VideoItem;
};

export type ElectronApi = {
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getDependencyStatus: () => Promise<DependencyStatus>;
  chooseFolder: () => Promise<string | undefined>;
  startScan: (folderPath: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  contextAction: (action: ContextAction, filePath: string) => Promise<VideoItem | undefined>;
  onProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onItem: (callback: (item: VideoItem) => void) => () => void;
};

declare global {
  interface Window {
    videoBrowser: ElectronApi;
  }
}
