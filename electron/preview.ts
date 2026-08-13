/**
 * 悬停多帧预览服务（v0.6）：
 * - 独立缓存目录 preview-cache/，与普通主封面缓存分离。
 * - 按需抽帧：只有悬停请求到达才生成，扫描阶段不预生成。
 * - 有界队列（并发 1）、requestId 取消、陈旧响应隔离。
 * - 近似 LRU 容量治理（默认 512 MiB），整组淘汰。
 * - 只接受主进程已知的已扫描视频路径；文件名与 URL 均为受控结构。
 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { net, protocol } from "electron";
import type { ItemError, PreviewCacheStats, PreviewRequest, PreviewResult } from "../src/shared.js";
import {
  computeFrameTimestamps,
  isPreviewSourceKey,
  parsePreviewUrl,
  pickLruEviction,
  previewFrameFileName,
  PREVIEW_CACHE_CAPACITY_BYTES,
  PREVIEW_SCHEMA_VERSION
} from "../src/lib/preview-time.js";

const PREVIEW_CONCURRENCY = 1;
const PREVIEW_QUEUE_LIMIT = 8;
const FRAME_SELECT_HALF_WINDOW = 0.05;
const FFMPEG_TIMEOUT_MS = 45000;
const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".m4v"]);

type GroupMeta = {
  sourceKey: string;
  size: number;
  mtimeMs: number;
  version: number;
  timestamps: number[];
  frameCount: number;
  bytes: number;
  lastAccessedAt: number;
};

type PreviewTask = {
  key: string;
  /** requestId → videoId */
  waiters: Map<string, string>;
  cancelled: boolean;
  run: () => Promise<void>;
};

export type PreviewServiceOptions = {
  cacheDir: string;
  isKnownVideoPath: (filePath: string) => boolean;
  getDuration: (filePath: string) => number | undefined;
  probeDuration: (filePath: string) => Promise<number | undefined>;
  isFfmpegAvailable: () => boolean;
};

export class PreviewService {
  private readonly cacheRoot: string;
  private readonly opts: PreviewServiceOptions;
  private readonly groups = new Map<string, GroupMeta>();
  private pending: PreviewTask[] = [];
  private running: PreviewTask | undefined;
  private child: ReturnType<typeof execFile> | undefined;
  private clearGeneration = 0;
  private disposed = false;

  constructor(opts: PreviewServiceOptions) {
    this.opts = opts;
    this.cacheRoot = opts.cacheDir;
  }

  /** 启动时加载既有缓存元数据（失败不影响启动）。 */
  async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.cacheRoot, { recursive: true });
      const entries = await fs.readdir(this.cacheRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || !isPreviewSourceKey(entry.name)) continue;
        await this.loadGroupMeta(entry.name);
      }
    } catch {
      // 缓存不可读不阻断应用启动
    }
  }

  private async loadGroupMeta(sourceKey: string): Promise<void> {
    try {
      const raw = await fs.readFile(path.join(this.cacheRoot, sourceKey, "meta.json"), "utf8");
      const meta = JSON.parse(raw) as GroupMeta;
      if (meta && meta.sourceKey === sourceKey && meta.version === PREVIEW_SCHEMA_VERSION) {
        const bytes = await this.measureGroupBytes(sourceKey);
        this.groups.set(sourceKey, { ...meta, bytes });
      }
    } catch {
      // 无 meta 或损坏：组视为失效
    }
  }

  private async measureGroupBytes(sourceKey: string): Promise<number> {
    try {
      const files = await fs.readdir(path.join(this.cacheRoot, sourceKey));
      let bytes = 0;
      for (const file of files) {
        try {
          const stat = await fs.stat(path.join(this.cacheRoot, sourceKey, file));
          bytes += stat.size;
        } catch {
          /* 单文件缺失忽略 */
        }
      }
      return bytes;
    } catch {
      return 0;
    }
  }

  /** 校验并处理一次预览请求；立即返回 loading 事件，完成后发 ready/failed。 */
  async request(req: PreviewRequest): Promise<void> {
    const send = (result: PreviewResult) => this.sendResult(result);
    if (this.disposed) return;
    if (!this.opts.isFfmpegAvailable()) {
      send({
        requestId: req.requestId,
        videoId: req.videoId,
        state: "failed",
        frames: [],
        error: { category: "dependency_missing", message: "缺少 ffmpeg，无法生成悬停预览帧" }
      });
      return;
    }
    if (!this.opts.isKnownVideoPath(req.filePath)) {
      send({
        requestId: req.requestId,
        videoId: req.videoId,
        state: "failed",
        frames: [],
        error: { category: "unknown", message: "无法生成悬停预览：视频不在当前扫描结果中" }
      });
      return;
    }
    if (!VIDEO_EXTENSIONS.has(path.extname(req.filePath).toLowerCase())) {
      send({
        requestId: req.requestId,
        videoId: req.videoId,
        state: "failed",
        frames: [],
        error: { category: "unknown", message: "无法生成悬停预览：不是受支持的视频格式" }
      });
      return;
    }

    let stat;
    try {
      stat = await fs.stat(req.filePath);
    } catch {
      send({
        requestId: req.requestId,
        videoId: req.videoId,
        state: "failed",
        frames: [],
        error: { category: "file_unreadable", message: "视频文件无法读取" }
      });
      return;
    }
    const sourceKey = this.sourceKey(req.filePath, stat.size, stat.mtimeMs);

    // 缓存命中：全部帧文件可用则直接返回。
    const cached = this.groups.get(sourceKey);
    if (cached && cached.frameCount > 0) {
      if (await this.validateGroup(sourceKey, cached.frameCount)) {
        this.touch(sourceKey);
        send(this.buildReadyResult(req, sourceKey, cached));
        return;
      }
      this.groups.delete(sourceKey);
    }

    // 合并同 key 的等待者；已排队/运行中则复用任务。
    if (this.attachToExistingTask(sourceKey, req)) return;
    if (this.pending.length >= PREVIEW_QUEUE_LIMIT) {
      send({
        requestId: req.requestId,
        videoId: req.videoId,
        state: "cancelled",
        frames: []
      });
      return;
    }

    send({
      requestId: req.requestId,
      videoId: req.videoId,
      state: "loading",
      frames: [],
      sourceKey
    });

    const task: PreviewTask = {
      key: sourceKey,
      waiters: new Map([[req.requestId, req.videoId]]),
      cancelled: false,
      run: async () => {
        const generation = this.clearGeneration;
        let payload: Omit<PreviewResult, "requestId" | "videoId">;
        try {
          payload = await this.generate(sourceKey, req.filePath, stat.size, stat.mtimeMs);
        } catch (error) {
          payload = {
            state: "failed",
            frames: [],
            error: { category: "thumbnail_failed", message: "悬停预览帧生成失败", detail: String(error) }
          };
        }
        this.running = undefined;
        this.drain();
        if (generation !== this.clearGeneration || this.disposed) return;
        // 只发给仍在等待的请求。
        const waiters = [...task.waiters.entries()];
        for (const [requestId, videoId] of waiters) {
          this.sendResult({ ...payload, requestId, videoId });
        }
      }
    };
    this.pending.push(task);
    this.drain();
  }

  /** 校验渲染进程传入路径对应的源 key（主进程计算，不信任前端）。 */
  private sourceKey(filePath: string, size: number, mtimeMs: number): string {
    return cacheKeyFor(filePath, size, mtimeMs);
  }

  private attachToExistingTask(sourceKey: string, req: PreviewRequest): boolean {
    const candidates = [...(this.running ? [this.running] : []), ...this.pending];
    const task = candidates.find((candidate) => candidate.key === sourceKey && !candidate.cancelled);
    if (!task) return false;
    if (!task.waiters.has(req.requestId)) task.waiters.set(req.requestId, req.videoId);
    if (!this.running) this.drain();
    return true;
  }

  private drain(): void {
    if (this.disposed) return;
    if (this.running) return;
    while (this.pending.length > 0 && this.running === undefined) {
      const task = this.pending.shift();
      if (!task) return;
      if (task.cancelled || task.waiters.size === 0) continue;
      this.running = task;
      void task.run();
    }
  }

  /** 取消请求：移除等待者；未开始任务无等待者时从队列删除。 */
  cancel(requestId: string): void {
    for (const task of [...this.pending, ...(this.running ? [this.running] : [])]) {
      task.waiters.delete(requestId);
    }
    this.pending = this.pending.filter((task) => task.waiters.size > 0 && !task.cancelled);
  }

  /** 生成一组预览帧（一次 ffmpeg 调用）。 */
  private async generate(
    sourceKey: string,
    filePath: string,
    size: number,
    mtimeMs: number
  ): Promise<Omit<PreviewResult, "requestId" | "videoId">> {
    let duration = this.opts.getDuration(filePath);
    if (duration === undefined) {
      duration = await this.opts.probeDuration(filePath);
    }
    const timestamps = computeFrameTimestamps(duration);
    if (!timestamps || timestamps.length === 0) {
      return {
        state: "failed",
        frames: [],
        error: { category: "probe_failed", message: "无法获取视频时长，悬停预览已回退静态封面" }
      };
    }

    const groupDir = path.join(this.cacheRoot, sourceKey);
    await fs.rm(groupDir, { recursive: true, force: true });
    await fs.mkdir(groupDir, { recursive: true });

    const selectParts = timestamps.map((time) => {
      const half = Math.max(0.02, Math.min(FRAME_SELECT_HALF_WINDOW, this.frameInterval(timestamps) / 3));
      return `between(t\\,${time - half}\\,${time + half})`;
    });
    const filter = `select=${selectParts.join("+")},scale=480:-1`;
    await this.runFfmpeg([
      "-y",
      "-i",
      filePath,
      "-vf",
      filter,
      "-vsync",
      "vfr",
      "-q:v",
      "4",
      path.join(groupDir, `v${PREVIEW_SCHEMA_VERSION}_%d.jpg`)
    ]);

    // 校验生成结果：帧数、JPEG 头；失败则整组回退。
    const frameCount = await this.validateGroup(sourceKey, timestamps.length);
    if (frameCount === 0) {
      return {
        state: "failed",
        frames: [],
        error: { category: "thumbnail_failed", message: "预览帧生成失败" }
      };
    }

    const bytes = await this.measureGroupBytes(sourceKey);
    const meta: GroupMeta = {
      sourceKey,
      size,
      mtimeMs,
      version: PREVIEW_SCHEMA_VERSION,
      timestamps: timestamps.slice(0, frameCount),
      frameCount,
      bytes,
      lastAccessedAt: Date.now()
    };
    this.groups.set(sourceKey, meta);
    await fs.writeFile(path.join(groupDir, "meta.json"), JSON.stringify(meta), "utf8");
    await this.enforceCapacity(sourceKey);
    return this.buildReadyResultPayload(sourceKey, meta);
  }

  private frameInterval(timestamps: number[]): number {
    if (timestamps.length < 2) return 1;
    return timestamps[1] - timestamps[0];
  }

  private runFfmpeg(args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = execFile("ffmpeg", args, { windowsHide: true, timeout: FFMPEG_TIMEOUT_MS }, (error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
      this.child = child;
      child.once("exit", () => {
        if (this.child === child) this.child = undefined;
      });
    });
  }

  /** 校验组内帧文件数量与 JPEG 头；返回有效帧数（首帧缺失返回 0）。 */
  private async validateGroup(sourceKey: string, expected: number): Promise<number> {
    const groupDir = path.join(this.cacheRoot, sourceKey);
    let count = 0;
    try {
      const files = await fs.readdir(groupDir);
      const frameFiles = files.filter((file) => /^v\d+_\d+\.jpg$/i.test(file)).sort((a, b) => {
        const ai = Number(a.match(/_(\d+)\.jpg$/i)?.[1] ?? 0);
        const bi = Number(b.match(/_(\d+)\.jpg$/i)?.[1] ?? 0);
        return ai - bi;
      });
      for (const file of frameFiles) {
        if (count >= expected) break;
        try {
          const stat = await fs.stat(path.join(groupDir, file));
          if (stat.size === 0) continue;
          const handle = await fs.open(path.join(groupDir, file), "r");
          try {
            const buffer = Buffer.alloc(3);
            const { bytesRead } = await handle.read(buffer, 0, 3, 0);
            if (bytesRead !== 3 || !buffer.equals(JPEG_HEAD)) continue;
          } finally {
            await handle.close();
          }
          count += 1;
        } catch {
          /* 单帧无效继续 */
        }
      }
    } catch {
      return 0;
    }
    return count;
  }

  private buildReadyResultPayload(sourceKey: string, meta: GroupMeta): Omit<PreviewResult, "requestId" | "videoId"> {
    const frames = meta.timestamps.map((timestamp, index) => ({
      index,
      timestamp,
      imageUrl: `preview://cache/${sourceKey}/${previewFrameFileName(index + 1)}`
    }));
    return { state: "ready", frames, sourceKey };
  }

  private buildReadyResult(req: PreviewRequest, sourceKey: string, meta: GroupMeta): PreviewResult {
    return {
      requestId: req.requestId,
      videoId: req.videoId,
      ...this.buildReadyResultPayload(sourceKey, meta)
    };
  }

  private touch(sourceKey: string): void {
    const meta = this.groups.get(sourceKey);
    if (!meta) return;
    const now = Date.now();
    // 写盘节流：仅在最近访问时间明显变化时持久化，避免高频 hover 持续写盘。
    if (now - meta.lastAccessedAt > 60_000) {
      meta.lastAccessedAt = now;
      void this.writeMeta(sourceKey, meta);
    } else {
      meta.lastAccessedAt = now;
    }
  }

  private async writeMeta(sourceKey: string, meta: GroupMeta): Promise<void> {
    try {
      await fs.writeFile(path.join(this.cacheRoot, sourceKey, "meta.json"), JSON.stringify(meta), "utf8");
    } catch {
      /* 元数据写入失败不阻断 */
    }
  }

  /** 近似 LRU 容量治理：超出上限时淘汰最久未访问的整组（跳过当前组）。 */
  private async enforceCapacity(keepKey: string): Promise<void> {
    try {
      const now = Date.now();
      for (const group of this.groups.values()) {
        if (group.lastAccessedAt <= 0) group.lastAccessedAt = now;
      }
      while (this.totalBytes() > PREVIEW_CACHE_CAPACITY_BYTES) {
        const candidates = [...this.groups.entries()]
          .filter(([key]) => key !== keepKey)
          .map(([key, meta]) => ({ key, lastAccessedAt: meta.lastAccessedAt, bytes: meta.bytes }));
        const victimKey = pickLruEviction(candidates);
        if (!victimKey) break;
        await this.removeGroup(victimKey);
      }
    } catch {
      /* 容量治理失败不阻断请求 */
    }
  }

  private totalBytes(): number {
    return [...this.groups.values()].reduce((sum, meta) => sum + meta.bytes, 0);
  }

  private async removeGroup(sourceKey: string): Promise<void> {
    this.groups.delete(sourceKey);
    await fs.rm(path.join(this.cacheRoot, sourceKey), { recursive: true, force: true }).catch(() => {});
  }

  /** 缓存统计（内存元数据汇总）。 */
  async stats(): Promise<PreviewCacheStats> {
    return {
      bytes: this.totalBytes(),
      videoCount: this.groups.size,
      frameCount: [...this.groups.values()].reduce((sum, meta) => sum + meta.frameCount, 0)
    };
  }

  /** 清理全部预览缓存：取消未开始任务、删除全部组；运行中任务结果丢弃。 */
  async clear(): Promise<PreviewCacheStats> {
    this.clearGeneration += 1;
    for (const task of this.pending) task.cancelled = true;
    this.pending = [];
    const keys = [...this.groups.keys()];
    for (const key of keys) {
      await this.removeGroup(key);
    }
    return this.stats();
  }

  /** 应用退出：拒绝新任务并终止运行中的 ffmpeg 子进程。 */
  dispose(): void {
    this.disposed = true;
    for (const task of this.pending) task.cancelled = true;
    this.pending = [];
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* 已退出 */
      }
      this.child = undefined;
    }
  }

  private sendResult(result: PreviewResult): void {
    this.onResult?.(result);
  }

  onResult: ((result: PreviewResult) => void) | undefined;

  /** 注册 preview:// 受限协议：严格校验 URL 结构并限制在预览缓存目录内。 */
  registerProtocol(): void {
    protocol.handle("preview", async (request) => {
      const parsed = parsePreviewUrl(request.url);
      if (!parsed) return new Response("Invalid preview url", { status: 400 });
      const resolved = path.resolve(this.cacheRoot, parsed.sourceKey, parsed.fileName);
      const root = path.resolve(this.cacheRoot);
      if (!resolved.startsWith(`${root}${path.sep}`)) {
        return new Response("Invalid preview path", { status: 400 });
      }
      try {
        await fs.access(resolved);
        return net.fetch(pathToFileURL(resolved).toString());
      } catch {
        return new Response("Preview frame not found", { status: 404 });
      }
    });
  }
}

function cacheKeyFor(filePath: string, size: number, mtimeMs: number): string {
  return createHash("sha1").update(`${filePath}|${size}|${mtimeMs}`).digest("hex");
}
