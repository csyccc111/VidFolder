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
  /** 最近/固定文件夹记录（v0.5 新增）。 */
  recentFolders?: FolderHistoryEntry[];
  /** 每个根文件夹的展开节点集合，键为规范化根路径（v0.5 新增）。 */
  expandedFoldersByRoot?: Record<string, string[]>;
  /** 左侧栏折叠状态（v0.5 新增）。 */
  sidebarOpen?: boolean;
  /** 左侧栏宽度（像素，v0.5 新增）。 */
  sidebarWidth?: number;
  /** 右侧详情面板开关状态（v0.5 新增）。 */
  detailPaneOpen?: boolean;
  /** 网格悬停多帧预览开关（v0.6 新增，默认开启）。 */
  hoverPreviewEnabled?: boolean;
};

/** 最近/固定文件夹记录（v0.5 新增）。 */
export type FolderHistoryEntry = {
  path: string;
  lastOpenedAt: number;
  pinned: boolean;
};

/** 层级文件夹树节点（v0.5 新增）。 */
export type FolderTreeNode = {
  id: string;
  path: string;
  name: string;
  relativePath: string;
  directVideoCount: number;
  totalVideoCount: number;
  children: FolderTreeNode[];
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

export type FolderValidationResult = {
  exists: boolean;
  isDirectory: boolean;
};

// ---- v0.6 悬停多帧预览协议 ----

/** 单帧预览信息。 */
export type PreviewFrame = {
  index: number;
  /** 帧对应的视频时间点（秒）。 */
  timestamp: number;
  imageUrl: string;
};

export type PreviewState = "loading" | "ready" | "failed" | "cancelled";

export type PreviewRequest = {
  requestId: string;
  videoId: string;
  filePath: string;
};

export type PreviewResult = {
  requestId: string;
  videoId: string;
  state: PreviewState;
  frames: PreviewFrame[];
  /** 主进程计算得到的源 key（与前端无关的受控值）。 */
  sourceKey?: string;
  error?: ItemError;
};

export type PreviewCacheStats = {
  bytes: number;
  videoCount: number;
  frameCount: number;
};

export type IpcEvents = {
  "scan:progress": ScanProgress;
  "scan:item": VideoItem;
  "preview:result": PreviewResult;
};

export type ElectronApi = {
  getSettings: () => Promise<AppSettings>;
  updateSettings: (settings: Partial<AppSettings>) => Promise<AppSettings>;
  getDependencyStatus: () => Promise<DependencyStatus>;
  chooseFolder: () => Promise<string | undefined>;
  validateFolder: (folderPath: string) => Promise<FolderValidationResult>;
  showFolderInExplorer: (folderPath: string) => Promise<void>;
  startScan: (folderPath: string) => Promise<void>;
  cancelScan: () => Promise<void>;
  contextAction: (action: ContextAction, filePath: string) => Promise<VideoItem | undefined>;
  getPathForFile: (file: File) => string;
  previewRequest: (request: PreviewRequest) => Promise<void>;
  previewCancel: (requestId: string) => Promise<void>;
  previewGetStats: () => Promise<PreviewCacheStats>;
  previewClear: () => Promise<PreviewCacheStats>;
  onProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onItem: (callback: (item: VideoItem) => void) => () => void;
  onPreviewResult: (callback: (result: PreviewResult) => void) => () => void;
};

declare global {
  interface Window {
    videoBrowser: ElectronApi;
  }
}
