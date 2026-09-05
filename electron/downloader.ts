/**
 * v0.9 应用内 ffmpeg 下载管理（单任务并发）：
 * - 固定清单（BtbN autobuild）：net.fetch 流式下载 → SHA-256 与内置清单比对 → 解压 → 校验可执行 → 写版本记录。
 * - 任何一步失败都清理临时内容并保持"缺失依赖"现状；断点续传不做，重试即可。
 * - 解压双重防 zip-slip：yauzl 内建校验 + onEntry 二次校验（条目名安全 + 必须位于清单顶层目录内）。
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { net } from "electron";
import extract from "extract-zip";
import type { DependencyDownloadState, ItemError } from "../src/shared.js";
import {
  FFMPEG_DOWNLOAD_MANIFEST,
  isManifestZipEntry,
  isSafeZipEntryPath,
  type VendorVersionRecord
} from "../src/lib/deps-core.js";

/** 校验失败：独立错误类型，映射到 cache_invalid 分类。 */
export class ChecksumMismatchError extends Error {}

export type DownloaderOptions = {
  /** vendor 根目录（userData/vendor/ffmpeg）。 */
  vendorRoot: string;
  onState: (state: DependencyDownloadState) => void;
  /** 运行 `<exe> -version` 并返回首行；失败 reject（用于安装后最终校验）。 */
  probeVersion: (exePath: string) => Promise<string>;
};

const PROGRESS_EMIT_INTERVAL_MS = 250;

export class FfmpegDownloader {
  private readonly opts: DownloaderOptions;
  private phase: DependencyDownloadState["phase"] = "idle";
  private receivedBytes = 0;
  private totalBytes = 0;
  private bytesPerSecond = 0;
  private error: ItemError | undefined;
  private abortController: AbortController | undefined;
  private running = false;

  constructor(opts: DownloaderOptions) {
    this.opts = opts;
  }

  isRunning(): boolean {
    return this.running;
  }

  getState(): DependencyDownloadState {
    return {
      phase: this.phase,
      receivedBytes: this.receivedBytes,
      totalBytes: this.totalBytes,
      bytesPerSecond: Math.round(this.bytesPerSecond),
      error: this.error
    };
  }

  cancel(): void {
    if (this.running) this.abortController?.abort();
  }

  /** 执行完整下载链路；成功返回版本目录。失败抛错且已清理临时内容。 */
  async start(): Promise<{ versionDir: string; version: string }> {
    if (this.running) {
      throw new Error("已有下载任务在进行中");
    }
    this.running = true;
    this.error = undefined;
    this.receivedBytes = 0;
    this.totalBytes = FFMPEG_DOWNLOAD_MANIFEST.bytes;
    this.bytesPerSecond = 0;
    const tmpRoot = path.join(this.opts.vendorRoot, ".downloading");
    let versionDir: string | undefined;
    try {
      await fs.rm(tmpRoot, { recursive: true, force: true });
      await fs.mkdir(tmpRoot, { recursive: true });
      const zipPath = path.join(tmpRoot, "ffmpeg.zip");
      const extractDir = path.join(tmpRoot, "extract");

      this.setPhase("downloading");
      await this.download(zipPath);

      this.setPhase("verifying");
      const actualSha = await sha256File(zipPath);
      if (actualSha.toLowerCase() !== FFMPEG_DOWNLOAD_MANIFEST.sha256.toLowerCase()) {
        throw new ChecksumMismatchError(`SHA-256 不匹配：期望 ${FFMPEG_DOWNLOAD_MANIFEST.sha256}，实际 ${actualSha}`);
      }

      this.setPhase("extracting");
      await this.extractAndInstall(zipPath, extractDir);
      versionDir = path.join(this.opts.vendorRoot, FFMPEG_DOWNLOAD_MANIFEST.version);
      await this.verifyInstalled(versionDir);
      // 版本记录固定写在 vendor 根目录（与探测/切换逻辑共用一处）。
      await fs.writeFile(
        path.join(this.opts.vendorRoot, "version.json"),
        JSON.stringify({
          version: FFMPEG_DOWNLOAD_MANIFEST.version,
          sourceUrl: FFMPEG_DOWNLOAD_MANIFEST.url,
          sha256: FFMPEG_DOWNLOAD_MANIFEST.sha256,
          installedAt: new Date().toISOString()
        } satisfies VendorVersionRecord),
        "utf8"
      );
      this.phase = "done";
      this.emitState();
      return { versionDir, version: FFMPEG_DOWNLOAD_MANIFEST.version };
    } catch (error) {
      if (this.abortController?.signal.aborted) {
        this.phase = "cancelled";
      } else {
        this.phase = "failed";
        this.error = classifyDownloadError(error);
      }
      this.emitState();
      throw error;
    } finally {
      this.running = false;
      this.abortController = undefined;
      // 成功时 versionDir 已就位；失败时清掉可能产生的半成品目录与临时目录。
      if (versionDir && this.phase !== "done") {
        await fs.rm(versionDir, { recursive: true, force: true }).catch(() => {});
      }
      await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }

  private setPhase(phase: DependencyDownloadState["phase"]): void {
    this.phase = phase;
    this.emitState();
  }

  private emitState(): void {
    this.opts.onState(this.getState());
  }

  private async download(zipPath: string): Promise<void> {
    this.abortController = new AbortController();
    const response = await net.fetch(FFMPEG_DOWNLOAD_MANIFEST.url, {
      signal: this.abortController.signal,
      headers: { "user-agent": "VidFolderBrowser" }
    });
    if (!response.ok || !response.body) {
      throw new Error(`下载源响应异常：HTTP ${response.status}`);
    }
    const headerLength = Number(response.headers.get("content-length") ?? 0);
    if (Number.isFinite(headerLength) && headerLength > 0) this.totalBytes = headerLength;

    const reader = response.body.getReader();
    const output = createWriteStream(zipPath);
    let lastEmitAt = 0;
    let lastSampleAt = performance.now();
    let lastSampleBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!output.write(value)) {
        await new Promise<void>((resolve) => output.once("drain", resolve));
      }
      this.receivedBytes += value.byteLength;
      const now = performance.now();
      if (now - lastSampleAt >= 500) {
        const instant = ((this.receivedBytes - lastSampleBytes) / (now - lastSampleAt)) * 1000;
        // 指数平滑，避免瞬时抖动误导用户。
        this.bytesPerSecond = this.bytesPerSecond === 0 ? instant : this.bytesPerSecond * 0.6 + instant * 0.4;
        lastSampleAt = now;
        lastSampleBytes = this.receivedBytes;
      }
      if (now - lastEmitAt >= PROGRESS_EMIT_INTERVAL_MS) {
        lastEmitAt = now;
        this.emitState();
      }
    }
    await new Promise<void>((resolve, reject) => {
      output.end(() => resolve());
      output.on("error", reject);
    });
    if (this.receivedBytes === 0) {
      throw new Error("下载内容为空");
    }
  }

  /** 解压到临时目录（条目二次校验），随后把 bin 与许可证文件安装到 vendor/<版本>/。 */
  private async extractAndInstall(zipPath: string, extractDir: string): Promise<void> {
    const topDir = FFMPEG_DOWNLOAD_MANIFEST.topDir;
    await extract(zipPath, {
      dir: extractDir,
      onEntry: (entry) => {
        const name = entry.fileName;
        if (!isSafeZipEntryPath(name) || !isManifestZipEntry(name, topDir)) {
          throw new Error(`压缩包含非法条目：${name}`);
        }
      }
    });

    const srcBin = path.join(extractDir, topDir, "bin");
    const ffmpegPath = path.join(srcBin, "ffmpeg.exe");
    const ffprobePath = path.join(srcBin, "ffprobe.exe");
    try {
      await Promise.all([fs.access(ffmpegPath), fs.access(ffprobePath)]);
    } catch {
      throw new Error("压缩包内缺少 ffmpeg.exe / ffprobe.exe");
    }

    const versionDir = path.join(this.opts.vendorRoot, FFMPEG_DOWNLOAD_MANIFEST.version);
    await fs.rm(versionDir, { recursive: true, force: true });
    await fs.mkdir(path.join(versionDir, "bin"), { recursive: true });
    await fs.cp(srcBin, path.join(versionDir, "bin"), { recursive: true });
    // 顺带安装许可证文件（GPL 合规展示）。
    for (const fileName of ["LICENSE.txt", "COPYING.TXT", "LICENSE"]) {
      const src = path.join(extractDir, topDir, fileName);
      try {
        await fs.access(src);
        await fs.cp(src, path.join(versionDir, fileName));
      } catch {
        /* 无该文件则跳过 */
      }
    }
  }

  /** 安装后校验：两个可执行文件均可成功运行 -version（同时确认共享 DLL 完整）。 */
  private async verifyInstalled(versionDir: string): Promise<void> {
    for (const fileName of ["ffmpeg.exe", "ffprobe.exe"]) {
      try {
        await this.opts.probeVersion(path.join(versionDir, "bin", fileName));
      } catch (error) {
        throw new Error(`安装校验失败：${fileName} 无法运行（${String(error)}）`);
      }
    }
  }
}

async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/** 把下载链路错误映射为用户可见的稳定分类。 */
function classifyDownloadError(error: unknown): ItemError {
  const detail = error instanceof Error ? error.message : String(error);
  if (error instanceof ChecksumMismatchError) {
    return { category: "cache_invalid", message: "校验失败，可能被篡改或源变更，已清理下载内容", detail };
  }
  if (detail.includes("无法运行")) {
    return { category: "dependency_missing", message: "下载内容安装校验未通过", detail };
  }
  if (detail.includes("非法条目") || detail.includes("解压")) {
    return { category: "download_failed", message: "解压失败，已清理下载内容", detail };
  }
  return { category: "download_failed", message: "下载失败，请检查网络后重试", detail };
}
