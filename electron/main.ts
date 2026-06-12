import { app, BrowserWindow, clipboard, dialog, ipcMain, net, protocol, shell } from "electron";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AppSettings, ContextAction, ScanProgress, VideoItem } from "../src/shared.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = process.env.VITE_DEV_SERVER_URL || !app.isPackaged;
const videoExtensions = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"]);
const thumbnailConcurrency = 2;

type CacheEntry = {
  key: string;
  item: Pick<VideoItem, "duration" | "width" | "height" | "thumbnailPath" | "thumbnailStatus" | "metadataStatus" | "error">;
};

let mainWindow: BrowserWindow | undefined;
let activeScanToken = 0;
let cacheDir = "";
let settingsPath = "";
let metadataCachePath = "";
let metadataCache: Record<string, CacheEntry> = {};
let thumbnailQueue: Array<() => Promise<void>> = [];
let runningThumbnails = 0;

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

async function ensureAppFiles() {
  const userData = app.getPath("userData");
  cacheDir = path.join(userData, "cache");
  settingsPath = path.join(userData, "settings.json");
  metadataCachePath = path.join(userData, "metadata-cache.json");
  await fs.mkdir(cacheDir, { recursive: true });
  try {
    metadataCache = JSON.parse(await fs.readFile(metadataCachePath, "utf8")) as Record<string, CacheEntry>;
  } catch {
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

async function saveMetadataCache() {
  await fs.writeFile(metadataCachePath, JSON.stringify(metadataCache, null, 2), "utf8");
}

function runProcess(command: string, args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { windowsHide: true, timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stdout, stderr }));
        return;
      }
      resolve({ stdout, stderr });
    });
    child.stdin?.end();
  });
}

async function probeVideo(filePath: string) {
  const { stdout } = await runProcess("ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format=duration:stream=width,height",
    filePath
  ]);
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ width?: number; height?: number }>;
  };
  const videoStream = parsed.streams?.find((stream) => stream.width && stream.height);
  return {
    duration: parsed.format?.duration ? Number(parsed.format.duration) : undefined,
    width: videoStream?.width,
    height: videoStream?.height
  };
}

async function generateThumbnail(filePath: string, key: string, duration?: number) {
  const outputPath = path.join(cacheDir, `${key}.jpg`);
  const timestamp = duration && duration > 0 ? Math.min(5, Math.max(0.1, duration / 2)) : 5;
  await runProcess("ffmpeg", [
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
  return outputPath;
}

async function createVideoItem(filePath: string): Promise<VideoItem> {
  const stat = await fs.stat(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const key = cacheKey(filePath, stat.size, stat.mtimeMs);
  const cached = metadataCache[filePath]?.key === key ? metadataCache[filePath].item : undefined;
  return {
    id: itemId(filePath),
    filePath,
    fileName: path.basename(filePath),
    directory: path.dirname(filePath),
    extension,
    size: stat.size,
    modifiedAt: stat.mtimeMs,
    duration: cached?.duration,
    width: cached?.width,
    height: cached?.height,
    thumbnailPath: cached?.thumbnailPath && cached.thumbnailStatus === "ready" ? toThumbnailUrl(cached.thumbnailPath) : undefined,
    thumbnailStatus: cached?.thumbnailStatus === "ready" ? "ready" : "pending",
    metadataStatus: cached?.metadataStatus === "ready" ? "ready" : "pending",
    error: cached?.error
  };
}

async function* walkVideos(rootPath: string): AsyncGenerator<string> {
  let entries;
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const nextPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walkVideos(nextPath);
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
  try {
    if (item.metadataStatus !== "ready") {
      const metadata = await probeVideo(item.filePath);
      item = { ...item, ...metadata, metadataStatus: "ready" };
      if (token === activeScanToken) sendItem(item);
    }
    if (item.thumbnailStatus !== "ready") {
      const thumbnailPath = await generateThumbnail(item.filePath, key, item.duration);
      item = { ...item, thumbnailPath: toThumbnailUrl(thumbnailPath), thumbnailStatus: "ready" };
      counters.thumbnailsReady += 1;
      if (token === activeScanToken) sendItem(item);
    }
    metadataCache[item.filePath] = {
      key,
      item: {
        duration: item.duration,
        width: item.width,
        height: item.height,
        thumbnailPath: item.thumbnailPath ? path.join(cacheDir, `${key}.jpg`) : undefined,
        thumbnailStatus: item.thumbnailStatus,
        metadataStatus: item.metadataStatus
      }
    };
    await saveMetadataCache();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    counters.failures += 1;
    item = { ...item, metadataStatus: item.metadataStatus === "ready" ? "ready" : "failed", thumbnailStatus: "failed", error: message };
    metadataCache[item.filePath] = { key, item };
    await saveMetadataCache();
    if (token === activeScanToken) sendItem(item);
  } finally {
    counters.processed += 1;
    if (token === activeScanToken) sendProgress(counters);
  }
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
    message: "正在扫描"
  };
  await writeSettings({ lastFolder: folderPath });
  sendProgress(counters);

  try {
    for await (const filePath of walkVideos(folderPath)) {
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
      sendProgress({ ...counters, state: "complete", message: "扫描完成" });
    }
  } catch (error) {
    sendProgress({
      ...counters,
      state: "error",
      message: error instanceof Error ? error.message : String(error)
    });
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
  const item = await createVideoItem(filePath);
  const key = cacheKey(item.filePath, item.size, item.modifiedAt);
  delete metadataCache[filePath];
  await saveMetadataCache();
  try {
    const metadata = await probeVideo(filePath);
    const thumbnailPath = await generateThumbnail(filePath, key, metadata.duration);
    const updated: VideoItem = {
      ...item,
      ...metadata,
      thumbnailPath: toThumbnailUrl(thumbnailPath),
      thumbnailStatus: "ready",
      metadataStatus: "ready"
    };
    metadataCache[filePath] = {
      key,
      item: {
        duration: updated.duration,
        width: updated.width,
        height: updated.height,
        thumbnailPath,
        thumbnailStatus: "ready",
        metadataStatus: "ready"
      }
    };
    await saveMetadataCache();
    return updated;
  } catch (error) {
    return {
      ...item,
      thumbnailStatus: "failed",
      metadataStatus: "failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
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
  await registerThumbnailProtocol();
  ipcMain.handle("settings:get", readSettings);
  ipcMain.handle("folder:choose", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("scan:start", async (_event, folderPath: string) => startScan(folderPath));
  ipcMain.handle("scan:cancel", async () => {
    activeScanToken += 1;
    thumbnailQueue = [];
    sendProgress({ state: "cancelled", found: 0, processed: 0, thumbnailsReady: 0, failures: 0, message: "已取消" });
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
