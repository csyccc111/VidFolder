import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } from "electron";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppSettings, ContextAction, ErrorCategory, ItemError, ScanProgress, ThumbnailStatus, VideoItem } from "../src/shared.js";
import type { DependencyTool } from "../src/lib/deps-core.js";
import { DependencyManager } from "./deps.js";
import { sanitizeExpandedFoldersByRoot, sanitizeHistory } from "../src/lib/history.js";
import { parseMediaInfo, type MediaInfo } from "../src/lib/media-info.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
const videoExtensions = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"]);
const thumbnailConcurrency = 2;
const maxScanWarnings = 10;

/** 元信息缓存结构版本：旧版本缓存缺少 v0.8 技术字段时按未命中重新探测补全。 */
const INFO_VERSION = 1;

type CacheEntry = {
  key: string;
  /** 元信息结构版本；低于 INFO_VERSION 时视为需重新探测（缩略图仍可复用）。 */
  infoVersion?: number;
  item: Pick<
    VideoItem,
    | "duration"
    | "width"
    | "height"
    | "container"
    | "videoCodec"
    | "codecShortName"
    | "containerBitrate"
    | "videoBitrate"
    | "bitrateEstimated"
    | "frameRate"
    | "audioTracks"
    | "thumbnailPath"
    | "thumbnailStatus"
    | "metadataStatus"
    | "metadataError"
    | "thumbnailError"
  >;
};

/** 可分类错误：携带稳定分类与用户可见中文文案，原始错误作为 cause 保留。 */
class ScanError extends Error {
  readonly category: ErrorCategory;
  readonly cause?: unknown;
  constructor(category: ErrorCategory, message: string, cause?: unknown) {
    super(message);
    this.category = category;
    this.cause = cause;
  }
}

function extractDetail(error: unknown): string {
  if (error instanceof Error) {
    const withStderr = error as Error & { stderr?: string };
    return withStderr.stderr?.trim() || withStderr.message;
  }
  return String(error);
}

/** 把任意错误转换为稳定结构的 ItemError：中文文案 + 技术详情分离。 */
function toItemError(error: unknown): ItemError {
  if (error instanceof ScanError) {
    return {
      category: error.category,
      message: error.message,
      detail: error.cause !== undefined ? extractDetail(error.cause) : undefined
    };
  }
  return { category: "unknown", message: "处理视频时发生未知错误", detail: extractDetail(error) };
}

/** 路径规范化，用于缓存清理的范围判断（与前端 normalizePath 语义一致）。 */
function normalizePathForCompare(filePath: string) {
  return filePath.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

let mainWindow: BrowserWindow | undefined;
let activeScanToken = 0;
let cacheDir = "";
let settingsPath = "";
let metadataCachePath = "";
let metadataCache: Record<string, CacheEntry> = {};
let thumbnailQueue: Array<() => Promise<void>> = [];
let runningThumbnails = 0;
let depsManager: DependencyManager | undefined;

protocol.registerSchemesAsPrivileged([
  {
    scheme: "thumb",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
]);

function sendProgress(progress: ScanProgress) {
  mainWindow?.webContents.send("scan:progress", progress);
}

function sendItem(item: VideoItem) {
  mainWindow?.webContents.send("scan:item", item);
}

function cacheKey(filePath: string, size: number, modifiedAt: number) {
  return createHash("sha1").update(`${filePath}|${size}|${modifiedAt}`).digest("hex");
}

function itemId(filePath: string) {
  return createHash("sha1").update(filePath).digest("hex");
}

function toFileUrl(filePath: string) {
  return pathToFileURL(filePath).toString();
}

function toThumbnailUrl(filePath: string) {
  return `thumb://cache/${encodeURIComponent(path.basename(filePath))}`;
}

async function registerThumbnailProtocol() {
  protocol.handle("thumb", async (request) => {
    const url = new URL(request.url);
    const fileName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    if (!/^[a-f0-9]{40}\.jpg$/i.test(fileName)) {
      return new Response("Invalid thumbnail path", { status: 400 });
    }
    const thumbnailPath = path.join(cacheDir, fileName);
    try {
      await fs.access(thumbnailPath);
      return net.fetch(pathToFileURL(thumbnailPath).toString());
    } catch {
      return new Response("Thumbnail not found", { status: 404 });
    }
  });
}

/** 旧版（v0.3）缓存条目迁移：error 字符串 → 新结构的分类错误。返回是否发生迁移。 */
function migrateLegacyCacheEntry(entry: CacheEntry): boolean {
  const legacy = entry?.item as (CacheEntry["item"] & { error?: string }) | undefined;
  if (!legacy || typeof legacy.error !== "string") return false;
  const detail = legacy.error;
  delete legacy.error;
  if (legacy.metadataStatus === "failed" && !legacy.metadataError) {
    legacy.metadataError = { category: "probe_failed", message: "无法读取视频时长和分辨率", detail };
  }
  if (legacy.thumbnailStatus === "failed" && !legacy.thumbnailError) {
    legacy.thumbnailError = { category: "thumbnail_failed", message: "封面生成失败", detail };
  }
  return true;
}

async function ensureAppFiles() {
  const userData = app.getPath("userData");
  cacheDir = path.join(userData, "cache");
  settingsPath = path.join(userData, "settings.json");
  metadataCachePath = path.join(userData, "metadata-cache.json");
  await fs.mkdir(cacheDir, { recursive: true });
  // 悬停预览已移除：清掉历史版本遗留的预览缓存目录，避免占用磁盘。
  await fs.rm(path.join(userData, "preview-cache"), { recursive: true, force: true }).catch(() => {});
  depsManager = new DependencyManager({
    userDataDir: userData,
    readSettings,
    updateSettings,
    onStatusChanged: (status) => mainWindow?.webContents.send("deps:status-changed", status),
    onDownloadStateChanged: (state) => mainWindow?.webContents.send("deps:download-progress", state)
  });
  try {
    const parsed = JSON.parse(await fs.readFile(metadataCachePath, "utf8")) as Record<string, CacheEntry>;
    let migrated = false;
    for (const entry of Object.values(parsed)) {
      if (entry && typeof entry === "object" && migrateLegacyCacheEntry(entry)) migrated = true;
    }
    metadataCache = parsed;
    if (migrated) await saveMetadataCache();
  } catch {
    // metadata-cache.json 损坏：备份原文件后安全回退为空缓存，不阻断启动。
    try {
      await fs.rename(metadataCachePath, `${metadataCachePath}.corrupt-${Date.now()}`);
    } catch {
      /* 备份失败不阻断启动 */
    }
    metadataCache = {};
  }
}

async function readSettings(): Promise<AppSettings> {
  try {
    return JSON.parse(await fs.readFile(settingsPath, "utf8")) as AppSettings;
  } catch {
    return {};
  }
}

async function writeSettings(settings: AppSettings) {
  await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2), "utf8");
}

async function updateSettings(nextSettings: Partial<AppSettings>): Promise<AppSettings> {
  const current = await readSettings();
  const merged = { ...current, ...nextSettings };
  // v0.5：对历史记录与展开状态做兼容清理（去重、过滤非法、限长），防止 settings.json 无界增长。
  if (merged.recentFolders !== undefined) merged.recentFolders = sanitizeHistory(merged.recentFolders);
  if (merged.expandedFoldersByRoot !== undefined) {
    merged.expandedFoldersByRoot = sanitizeExpandedFoldersByRoot(merged.expandedFoldersByRoot);
  }
  await writeSettings(merged);
  return merged;
}

async function saveMetadataCache() {
  await fs.writeFile(metadataCachePath, JSON.stringify(metadataCache, null, 2), "utf8");
}

async function probeVideo(filePath: string, sizeBytes?: number): Promise<MediaInfo> {
  if (!depsManager?.resolveBinaryPath("ffprobe")) {
    throw new ScanError("dependency_missing", "缺少 ffprobe，无法读取视频信息。");
  }
  let stdout: string;
  try {
    ({ stdout } = await depsManager.runTool("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath
    ]));
  } catch (error) {
    throw new ScanError("probe_failed", "无法读取视频信息", error);
  }
  try {
    return parseMediaInfo(stdout, sizeBytes);
  } catch (error) {
    throw new ScanError("probe_failed", "视频信息解析失败", error);
  }
}

async function generateThumbnail(filePath: string, key: string, duration?: number) {
  if (!depsManager?.resolveBinaryPath("ffmpeg")) {
    throw new ScanError("dependency_missing", "缺少 ffmpeg，无法生成视频封面。");
  }
  const outputPath = path.join(cacheDir, `${key}.jpg`);
  const timestamp = duration && duration > 0 ? Math.min(5, Math.max(0.1, duration / 2)) : 5;
  try {
    await depsManager.runTool("ffmpeg", [
      "-y",
      "-ss",
      String(timestamp),
      "-i",
      filePath,
      "-frames:v",
      "1",
      "-vf",
      "scale=480:-1",
      "-q:v",
      "4",
      outputPath
    ], 45000);
  } catch (error) {
    throw new ScanError("thumbnail_failed", "封面生成失败", error);
  }
  return outputPath;
}

/** 校验路径位于应用缓存目录内，防止缓存索引被篡改后操作范围外路径。 */
function isWithinCacheDir(targetPath: string) {
  const resolved = path.resolve(targetPath);
  const cacheRoot = path.resolve(cacheDir);
  return resolved === cacheRoot || resolved.startsWith(`${cacheRoot}${path.sep}`);
}

/** 缩略图真实可用性校验：存在、非零字节、JPEG 文件头完整。 */
async function isThumbnailUsable(thumbnailPath: string): Promise<boolean> {
  try {
    if (!isWithinCacheDir(thumbnailPath)) return false;
    const stat = await fs.stat(thumbnailPath);
    if (stat.size === 0) return false;
    const handle = await fs.open(thumbnailPath, "r");
    try {
      const buffer = Buffer.alloc(3);
      const { bytesRead } = await handle.read(buffer, 0, 3, 0);
      return bytesRead === 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
}

async function createVideoItem(filePath: string): Promise<VideoItem> {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (error) {
    throw new ScanError("file_unreadable", "无法读取视频文件信息", error);
  }
  const extension = path.extname(filePath).toLowerCase();
  const key = cacheKey(filePath, stat.size, stat.mtimeMs);
  const entry = metadataCache[filePath];
  const cached = entry?.key === key ? entry.item : undefined;
  // 元信息字段：旧结构版本（infoVersion 缺失或更旧）视为未命中，重扫时自然补全新字段；
  // 缩略图字段不受影响，命中即可复用，避免旧缓存全量重生成封面。
  const cachedInfo = entry?.key === key && entry.infoVersion === INFO_VERSION ? entry.item : undefined;
  // 缩略图命中缓存后仍需校验文件真实可用；缺失/损坏则降级为 pending，由扫描流程自动重试。
  let thumbnailStatus: ThumbnailStatus = cached?.thumbnailStatus === "ready" ? "ready" : "pending";
  let thumbnailPath: string | undefined;
  if (cached?.thumbnailStatus === "ready" && cached.thumbnailPath) {
    if (await isThumbnailUsable(cached.thumbnailPath)) {
      thumbnailPath = toThumbnailUrl(cached.thumbnailPath);
    } else {
      thumbnailStatus = "pending";
      thumbnailPath = undefined;
    }
  }
  return {
    id: itemId(filePath),
    filePath,
    fileName: path.basename(filePath),
    directory: path.dirname(filePath),
    extension,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    duration: cachedInfo?.duration,
    width: cachedInfo?.width,
    height: cachedInfo?.height,
    container: cachedInfo?.container,
    videoCodec: cachedInfo?.videoCodec,
    codecShortName: cachedInfo?.codecShortName,
    containerBitrate: cachedInfo?.containerBitrate,
    videoBitrate: cachedInfo?.videoBitrate,
    bitrateEstimated: cachedInfo?.bitrateEstimated,
    frameRate: cachedInfo?.frameRate,
    audioTracks: cachedInfo?.audioTracks,
    thumbnailPath,
    thumbnailStatus,
    metadataStatus: cachedInfo?.metadataStatus === "ready" ? "ready" : "pending",
    metadataError: cachedInfo?.metadataError,
    thumbnailError: cached?.thumbnailError
  };
}

async function* walkVideos(rootPath: string, isRoot: boolean, warnings: string[], warningCount: { count: number }): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch (error) {
    if (isRoot) {
      // 根目录不可读：必须使扫描进入明确错误状态，不得静默吞掉。
      throw new ScanError("directory_unreadable", "无法读取所选文件夹，请检查权限或路径是否存在", error);
    }
    // 子目录不可读：跳过并累计警告，继续扫描其余部分。
    warningCount.count += 1;
    if (warnings.length < maxScanWarnings) warnings.push(rootPath);
    return;
  }
  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkVideos(nextPath, false, warnings, warningCount);
    } else if (entry.isFile() && videoExtensions.has(path.extname(entry.name).toLowerCase())) {
      yield nextPath;
    }
  }
}

function enqueueThumbnail(task: () => Promise<void>) {
  thumbnailQueue.push(task);
  void drainThumbnailQueue();
}

async function drainThumbnailQueue() {
  while (runningThumbnails < thumbnailConcurrency && thumbnailQueue.length > 0) {
    const task = thumbnailQueue.shift();
    if (!task) return;
    runningThumbnails += 1;
    task().finally(() => {
      runningThumbnails -= 1;
      void drainThumbnailQueue();
    });
  }
}

async function enrichItem(baseItem: VideoItem, token: number, counters: ScanProgress) {
  let item = { ...baseItem };
  const key = cacheKey(item.filePath, item.size, item.modifiedAt);
  let itemFailed = false;
  // 阶段一：元信息探测。失败不阻断封面生成，两阶段状态与错误各自独立。
  if (item.metadataStatus !== "ready") {
    try {
      const metadata = await probeVideo(item.filePath, item.size);
      item = { ...item, ...metadata, metadataStatus: "ready", metadataError: undefined };
      if (token === activeScanToken) sendItem(item);
    } catch (error) {
      itemFailed = true;
      item = { ...item, metadataStatus: "failed", metadataError: toItemError(error) };
    }
  }
  // 阶段二：封面生成。失败不丢失已读取的元信息。
  if (item.thumbnailStatus !== "ready") {
    try {
      const thumbnailPath = await generateThumbnail(item.filePath, key, item.duration);
      item = { ...item, thumbnailPath: toThumbnailUrl(thumbnailPath), thumbnailStatus: "ready", thumbnailError: undefined };
      counters.thumbnailsReady += 1;
      if (token === activeScanToken) sendItem(item);
    } catch (error) {
      itemFailed = true;
      item = { ...item, thumbnailStatus: "failed", thumbnailError: toItemError(error) };
    }
  }
  metadataCache[item.filePath] = {
    key,
    infoVersion: INFO_VERSION,
    item: {
      duration: item.duration,
      width: item.width,
      height: item.height,
      container: item.container,
      videoCodec: item.videoCodec,
      codecShortName: item.codecShortName,
      containerBitrate: item.containerBitrate,
      videoBitrate: item.videoBitrate,
      bitrateEstimated: item.bitrateEstimated,
      frameRate: item.frameRate,
      audioTracks: item.audioTracks,
      thumbnailPath: item.thumbnailStatus === "ready" ? path.join(cacheDir, `${key}.jpg`) : undefined,
      thumbnailStatus: item.thumbnailStatus,
      metadataStatus: item.metadataStatus,
      metadataError: item.metadataError,
      thumbnailError: item.thumbnailError
    }
  };
  if (itemFailed) counters.failures += 1;
  await saveMetadataCache();
  if (token === activeScanToken) sendItem(item);
  counters.processed += 1;
  if (token === activeScanToken) sendProgress(counters);
}

async function startScan(folderPath: string) {
  activeScanToken += 1;
  const token = activeScanToken;
  thumbnailQueue = [];
  const counters: ScanProgress = {
    state: "scanning",
    rootPath: folderPath,
    found: 0,
    processed: 0,
    thumbnailsReady: 0,
    failures: 0,
    message: "正在扫描",
    warningCount: 0,
    warnings: []
  };
  await updateSettings({ lastFolder: folderPath });
  sendProgress(counters);

  try {
    const warningCount = { count: 0 };
    for await (const filePath of walkVideos(folderPath, true, counters.warnings, warningCount)) {
      if (token !== activeScanToken) return;
      try {
        const item = await createVideoItem(filePath);
        counters.found += 1;
        if (item.thumbnailStatus === "ready") counters.thumbnailsReady += 1;
        if (item.metadataStatus === "ready" && item.thumbnailStatus === "ready") counters.processed += 1;
        sendItem(item);
        sendProgress(counters);
        if (item.metadataStatus !== "ready" || item.thumbnailStatus !== "ready") {
          enqueueThumbnail(() => enrichItem(item, token, counters));
        }
      } catch {
        counters.failures += 1;
        sendProgress(counters);
      }
    }
    const waitForQueue = async () => {
      while (token === activeScanToken && (thumbnailQueue.length > 0 || runningThumbnails > 0)) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    };
    await waitForQueue();
    if (token === activeScanToken) {
      const finished = { ...counters, warningCount: warningCount.count };
      sendProgress({ ...finished, state: "complete", message: "扫描完成" });
      // 扫描完成后清理当前扫描根内已失效记录与孤儿缩略图（异步、失败不影响主流程）。
      void cleanupOrphanedCache(folderPath);
    }
  } catch (error) {
    const scanError = toItemError(error);
    sendProgress({
      ...counters,
      state: "error",
      message: "扫描失败",
      scanError
    });
  }
}

/**
 * 孤儿缓存清理（仅扫描完成后执行）：
 * - 元信息记录：只删除当前扫描根目录范围内、源文件已确认不存在的记录。
 * - 缩略图：只删除不再被任何有效缓存记录引用的文件。
 * - 只操作应用自身缓存目录，不触碰用户视频文件。
 */
async function cleanupOrphanedCache(rootPath: string) {
  try {
    const rootNorm = normalizePathForCompare(rootPath);
    const referenced = new Set<string>();
    for (const [filePath, entry] of Object.entries(metadataCache)) {
      const norm = normalizePathForCompare(filePath);
      const inScope = norm === rootNorm || norm.startsWith(`${rootNorm}/`);
      if (inScope) {
        try {
          await fs.stat(filePath);
        } catch {
          // 当前扫描根内源文件已不存在：删除失效记录（跨文件夹共用的记录不受影响）。
          delete metadataCache[filePath];
          continue;
        }
      }
      const thumbPath = entry?.item?.thumbnailPath;
      if (typeof thumbPath === "string") {
        const base = path.basename(thumbPath);
        if (/^[a-f0-9]{40}\.jpg$/i.test(base)) referenced.add(base);
      }
    }
    const files = await fs.readdir(cacheDir);
    for (const file of files) {
      if (!/^[a-f0-9]{40}\.jpg$/i.test(file)) continue;
      if (!referenced.has(file)) {
        await fs.unlink(path.join(cacheDir, file)).catch(() => {});
      }
    }
    await saveMetadataCache();
  } catch {
    // 清理失败不影响主流程（缩略图缺失时已有自愈重试兜底）。
  }
}

async function handleContextAction(action: ContextAction, filePath: string): Promise<VideoItem | undefined> {
  if (action === "showInFolder") {
    shell.showItemInFolder(filePath);
    return undefined;
  }
  if (action === "openVideo") {
    await shell.openPath(filePath);
    return undefined;
  }
  if (action === "copyPath") {
    clipboard.writeText(filePath);
    return undefined;
  }
  // regenerateThumbnail：封面无条件重新生成；元信息仅在其缺失/失败时顺带重试，不破坏已有效的元信息。
  const item = await createVideoItem(filePath);
  const key = cacheKey(item.filePath, item.size, item.modifiedAt);
  let updated: VideoItem = { ...item, thumbnailStatus: "pending", thumbnailPath: undefined };
  if (updated.metadataStatus !== "ready") {
    try {
      const metadata = await probeVideo(filePath, updated.size);
      updated = { ...updated, ...metadata, metadataStatus: "ready", metadataError: undefined };
    } catch (error) {
      updated = { ...updated, metadataStatus: "failed", metadataError: toItemError(error) };
    }
  }
  try {
    const thumbnailPath = await generateThumbnail(filePath, key, updated.duration);
    updated = { ...updated, thumbnailPath: toThumbnailUrl(thumbnailPath), thumbnailStatus: "ready", thumbnailError: undefined };
  } catch (error) {
    updated = { ...updated, thumbnailStatus: "failed", thumbnailError: toItemError(error) };
  }
  metadataCache[filePath] = {
    key,
    infoVersion: INFO_VERSION,
    item: {
      duration: updated.duration,
      width: updated.width,
      height: updated.height,
      container: updated.container,
      videoCodec: updated.videoCodec,
      codecShortName: updated.codecShortName,
      containerBitrate: updated.containerBitrate,
      videoBitrate: updated.videoBitrate,
      bitrateEstimated: updated.bitrateEstimated,
      frameRate: updated.frameRate,
      audioTracks: updated.audioTracks,
      thumbnailPath: updated.thumbnailStatus === "ready" ? path.join(cacheDir, `${key}.jpg`) : undefined,
      thumbnailStatus: updated.thumbnailStatus,
      metadataStatus: updated.metadataStatus,
      metadataError: updated.metadataError,
      thumbnailError: updated.thumbnailError
    }
  };
  await saveMetadataCache();
  return updated;
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: "视频文件浏览器",
    backgroundColor: "#101216",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
    await mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? "http://127.0.0.1:5173");
  } else {
    await mainWindow.loadFile(path.join(__dirname, "../../dist/index.html"));
  }
}

app.whenReady().then(async () => {
  await ensureAppFiles();
  await depsManager?.initialize();
  await registerThumbnailProtocol();
  ipcMain.handle("settings:get", readSettings);
  ipcMain.handle("settings:update", async (_event, settings: Partial<AppSettings>) => updateSettings(settings));
  ipcMain.handle("dependencies:get", () =>
    Promise.resolve(depsManager?.getStatus() ?? { ffmpeg: { available: false }, ffprobe: { available: false }, checkedAt: 0 })
  );
  ipcMain.handle("deps:redetect", () => depsManager!.redetect());
  ipcMain.handle("deps:download-start", () => depsManager!.startDownload());
  ipcMain.handle("deps:download-cancel", () => depsManager!.cancelDownload());
  ipcMain.handle("deps:download-state", () => depsManager!.getDownloadState());
  ipcMain.handle("deps:restore-system", () => depsManager!.restoreSystemVersion());
  ipcMain.handle("deps:enable-vendor", () => depsManager!.enableVendorVersion());
  ipcMain.handle("deps:set-custom-path", (_event, tool: DependencyTool, filePath: string | undefined) =>
    depsManager!.setCustomPath(tool, filePath)
  );
  ipcMain.handle("folder:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("folder:validate", async (_event, folderPath: string) => {
    try {
      const stat = await fs.stat(folderPath);
      return { exists: true, isDirectory: stat.isDirectory() };
    } catch {
      return { exists: false, isDirectory: false };
    }
  });
  ipcMain.handle("folder:show-in-explorer", async (_event, folderPath: string) => {
    shell.showItemInFolder(folderPath);
  });
  ipcMain.handle("scan:start", async (_event, folderPath: string) => startScan(folderPath));
  ipcMain.handle("scan:cancel", async () => {
    activeScanToken += 1;
    thumbnailQueue = [];
    sendProgress({ state: "cancelled", found: 0, processed: 0, thumbnailsReady: 0, failures: 0, message: "已取消", warningCount: 0, warnings: [] });
  });
  ipcMain.handle("video:context-action", async (_event, action: ContextAction, filePath: string) => handleContextAction(action, filePath));
  await createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
