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

/** 音轨信息（v0.8 新增）。 */
export type AudioTrackInfo = {
  /** 显示用编码名（如 "AAC"）。 */
  codec?: string;
  /** 声道数（如 2）。 */
  channels?: number;
  /** 采样率（Hz，如 44100）。 */
  sampleRate?: number;
  /** 语言标签（如 "chi"、"eng"）。 */
  language?: string;
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
  /** 容器格式展示（如 "MP4 (isom)"、"Matroska"）。 */
  container?: string;
  /** 视频编码展示（如 "H.264 (High, L4.1)"）。 */
  videoCodec?: string;
  /** 视频编码短名（如 "h264"、"hevc"），供列表编码列显示。 */
  codecShortName?: string;
  /** 容器总码率（kbps）。 */
  containerBitrate?: number;
  /** 视频流码率（kbps）。 */
  videoBitrate?: number;
  /** 码率是否由文件大小/时长估算而来（流级 bit_rate 缺失时）。 */
  bitrateEstimated?: boolean;
  /** 帧率（fps）。 */
  frameRate?: number;
  /** 音轨列表；解析成功但无音轨时为空数组。 */
  audioTracks?: AudioTrackInfo[];
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
  /** 列表视图显示编码列（v0.8 新增，默认关闭）。 */
  showCodecColumn?: boolean;
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

export type IpcEvents = {
  "scan:progress": ScanProgress;
  "scan:item": VideoItem;
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
  onProgress: (callback: (progress: ScanProgress) => void) => () => void;
  onItem: (callback: (item: VideoItem) => void) => () => void;
};

declare global {
  interface Window {
    videoBrowser: ElectronApi;
  }
}
