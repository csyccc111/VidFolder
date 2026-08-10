export type ThumbnailStatus = "pending" | "ready" | "failed";
export type MetadataStatus = "pending" | "ready" | "failed";
export type ScanState = "idle" | "scanning" | "complete" | "cancelled" | "error";

/**
 * 可预期错误的稳定分类（v0.4 新增）。
 * 用户可见文案与原始技术详情分离：message 面向用户，detail 仅用于诊断。
 */
export type ErrorCategory =
  | "dependency_missing"
  | "directory_unreadable"
  | "file_unreadable"
  | "probe_failed"
  | "thumbnail_failed"
  | "cache_invalid"
  | "unknown";

export type ItemError = {
  category: ErrorCategory;
  /** 用户可见的简洁中文说明。 */
  message: string;
  /** 原始错误信息（stderr 等），仅用于诊断，默认不直接展示。 */
  detail?: string;
};

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
  /** 元信息读取失败详情（与封面失败分离，互不覆盖）。 */
  metadataError?: ItemError;
  /** 封面生成失败详情。 */
  thumbnailError?: ItemError;
};

export type ScanProgress = {
  state: ScanState;
  rootPath?: string;
  found: number;
  processed: number;
  thumbnailsReady: number;
  failures: number;
  message?: string;
  /** 整体扫描错误（如根目录不可读），仅 state 为 error 时有值。 */
  scanError?: ItemError;
  /** 被跳过的不可读子目录真实总数。 */
  warningCount: number;
  /** 被跳过的不可读子目录路径（仅前若干条，供悬停摘要展示）。 */
  warnings: string[];
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
