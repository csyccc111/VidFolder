/**
 * v0.9 依赖管理：ffmpeg/ffprobe 智能探测、统一路径解析、执行封装与应用内版本切换。
 * - 探测顺序（首个可用即停）：vendor 应用内 → 用户手动指定 → 系统 PATH → 常见安装位置。
 * - 探测结果持久化到 settings.resolvedDependencies；启动时先验证持久化结果（失效重探）。
 * - 所有 ffmpeg/ffprobe 调用统一走 runTool（绝对路径），禁止散落 PATH 查找逻辑。
 * - 应用内版本切换：version.json ↔ version.json.bak（vendor 文件保留以便切回）。
 */
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  AppSettings,
  DependencyDownloadState,
  DependencyStatus,
  DependencyTool,
  ResolvedDependencyRecord,
  ToolStatus
} from "../src/shared.js";
import type { DependencySource, VendorVersionRecord } from "../src/lib/deps-core.js";
import {
  buildProbeCandidates,
  commonBinDirCandidates,
  parseToolVersionLine,
  parseVendorVersionRecord
} from "../src/lib/deps-core.js";
import { FfmpegDownloader } from "./downloader.js";

export type DepsManagerOptions = {
  userDataDir: string;
  readSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  onStatusChanged: (status: DependencyStatus) => void;
  onDownloadStateChanged: (state: DependencyDownloadState) => void;
};

export function runProcess(
  command: string,
  args: string[],
  timeoutMs = 30000
): Promise<{ stdout: string; stderr: string }> {
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

type ProbeHit = {
  source: DependencySource;
  filePath: string;
  version?: string;
};

export class DependencyManager {
  private readonly opts: DepsManagerOptions;
  private readonly vendorRoot: string;
  private readonly downloader: FfmpegDownloader;
  private status: DependencyStatus = {
    ffmpeg: { available: false },
    ffprobe: { available: false },
    checkedAt: 0
  };
  private resolvedFfmpegPath: string | undefined;
  private resolvedFfprobePath: string | undefined;
  private redetectInFlight: Promise<DependencyStatus> | undefined;

  constructor(opts: DepsManagerOptions) {
    this.opts = opts;
    this.vendorRoot = path.join(opts.userDataDir, "vendor", "ffmpeg");
    this.downloader = new FfmpegDownloader({
      vendorRoot: this.vendorRoot,
      onState: opts.onDownloadStateChanged,
      probeVersion: async (exePath) => {
        const { stdout } = await runProcess(exePath, ["-version"], 8000);
        return (stdout || "").split(/\r?\n/).find(Boolean) ?? "";
      }
    });
  }

  getStatus(): DependencyStatus {
    return this.status;
  }

  /** 启动入口：优先验证持久化的探测结果（失效则全量重探）。 */
  async initialize(): Promise<DependencyStatus> {
    const settings = await this.opts.readSettings();
    const persisted = settings.resolvedDependencies;
    if (persisted && (persisted.ffmpeg || persisted.ffprobe)) {
      const [ffmpeg, ffprobe] = await Promise.all([
        this.validatePersisted("ffmpeg", persisted.ffmpeg, settings),
        this.validatePersisted("ffprobe", persisted.ffprobe, settings)
      ]);
      if (ffmpeg && ffprobe) {
        this.applyProbe("ffmpeg", ffmpeg);
        this.applyProbe("ffprobe", ffprobe);
        this.status = await this.buildStatus(ffmpeg, ffprobe);
        this.opts.onStatusChanged(this.status);
        return this.status;
      }
    }
    return this.redetect();
  }

  /** 全量重探：按优先级探测两个工具，持久化结果并推送状态。 */
  async redetect(): Promise<DependencyStatus> {
    if (this.redetectInFlight) return this.redetectInFlight;
    const task = (async () => {
      const vendor = await this.readVendorState();
      const settings = await this.opts.readSettings();
      const { fixedDirs, wingetDir } = commonBinDirCandidates({
        userProfile: process.env.USERPROFILE,
        localAppData: process.env.LOCALAPPDATA
      });
      const wingetHit = wingetDir ? await findWingetBinDir(wingetDir) : undefined;
      const effectiveCommonDirs = wingetHit ? [...fixedDirs, wingetHit] : fixedDirs;

      const [ffmpeg, ffprobe] = await Promise.all([
        this.probeTool("ffmpeg", { vendor, customPath: settings.customFfmpegPath, commonDirs: effectiveCommonDirs }),
        this.probeTool("ffprobe", { vendor, customPath: settings.customFfprobePath, commonDirs: effectiveCommonDirs })
      ]);
      this.applyProbe("ffmpeg", ffmpeg);
      this.applyProbe("ffprobe", ffprobe);
      this.status = await this.buildStatus(ffmpeg, ffprobe);
      await this.persistResolved(ffmpeg, ffprobe);
      this.opts.onStatusChanged(this.status);
      return this.status;
    })();
    this.redetectInFlight = task.finally(() => {
      this.redetectInFlight = undefined;
    });
    return this.redetectInFlight;
  }

  /** 解析当前可用的可执行文件绝对路径（未命中返回 undefined）。 */
  resolveBinaryPath(tool: DependencyTool): string | undefined {
    return tool === "ffmpeg" ? this.resolvedFfmpegPath : this.resolvedFfprobePath;
  }

  /** 统一执行入口：以解析后的绝对路径运行 ffmpeg/ffprobe；未解析到则抛错。 */
  runTool(tool: DependencyTool, args: string[], timeoutMs = 30000): Promise<{ stdout: string; stderr: string }> {
    const exePath = this.resolveBinaryPath(tool);
    if (!exePath) {
      throw new Error(`未检测到可用的 ${tool}`);
    }
    return runProcess(exePath, args, timeoutMs);
  }

  startDownload(): Promise<void> {
    void this.downloader
      .start()
      .then(() => this.redetect())
      .catch(() => {
        /* 失败状态已通过 onDownloadStateChanged 推送，保持现状可重试 */
      });
    return Promise.resolve();
  }

  cancelDownload(): void {
    this.downloader.cancel();
  }

  getDownloadState(): DependencyDownloadState {
    return this.downloader.getState();
  }

  /** 恢复系统版本：停用 vendor 记录（文件保留，可再次启用）。 */
  async restoreSystemVersion(): Promise<DependencyStatus> {
    const recordPath = path.join(this.vendorRoot, "version.json");
    try {
      await fs.rename(recordPath, `${recordPath}.bak`);
    } catch {
      /* 无记录或不支持重命名：维持现状 */
    }
    return this.redetect();
  }

  /** 重新启用应用内版本（恢复之前被停用的记录）。 */
  async enableVendorVersion(): Promise<DependencyStatus> {
    const recordPath = path.join(this.vendorRoot, "version.json");
    try {
      await fs.rename(`${recordPath}.bak`, recordPath);
    } catch {
      /* 无备份：维持现状 */
    }
    return this.redetect();
  }

  /** 设置/清除手动指定路径并重探。 */
  async setCustomPath(tool: DependencyTool, filePath: string | undefined): Promise<DependencyStatus> {
    const trimmed = filePath?.trim();
    await this.opts.updateSettings(
      tool === "ffmpeg" ? { customFfmpegPath: trimmed || undefined } : { customFfprobePath: trimmed || undefined }
    );
    return this.redetect();
  }

  private applyProbe(tool: DependencyTool, hit: ProbeHit | undefined): void {
    if (tool === "ffmpeg") {
      this.resolvedFfmpegPath = hit?.filePath;
    } else {
      this.resolvedFfprobePath = hit?.filePath;
    }
  }

  private async probeTool(
    tool: DependencyTool,
    context: {
      vendor: { active: boolean; binDir?: string };
      customPath?: string;
      commonDirs: string[];
    }
  ): Promise<ProbeHit | undefined> {
    const candidates = buildProbeCandidates({
      tool,
      vendorBinDir: context.vendor.active ? context.vendor.binDir : undefined,
      customPath: context.customPath,
      commonBinDirs: context.commonDirs
    });
    for (const candidate of candidates) {
      const hit = await this.tryProbe(candidate.source, candidate.filePath);
      if (hit) return hit;
    }
    // 系统 PATH（spec 顺序：vendor > custom > PATH > common）。
    const pathHit = await this.resolveViaPath(tool);
    if (pathHit) return pathHit;
    return undefined;
  }

  /** 校验候选可执行文件存在且能运行 -version。 */
  private async tryProbe(source: DependencySource, filePath: string): Promise<ProbeHit | undefined> {
    try {
      await fs.access(filePath);
      const { stdout } = await runProcess(filePath, ["-version"], 8000);
      const firstLine = (stdout || "").split(/\r?\n/).find(Boolean) ?? "";
      return { source, filePath, version: parseToolVersionLine(firstLine) };
    } catch {
      return undefined;
    }
  }

  private async resolveViaPath(tool: DependencyTool): Promise<ProbeHit | undefined> {
    let whereOutput: string;
    try {
      ({ stdout: whereOutput } = await runProcess("where", [tool], 8000));
    } catch {
      return undefined;
    }
    const firstPath = whereOutput.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0);
    if (!firstPath) return undefined;
    return this.tryProbe("path", firstPath);
  }

  /** 启动快速路径：验证持久化记录仍然有效（来源约束变化时作废）。 */
  private async validatePersisted(
    tool: DependencyTool,
    record: ResolvedDependencyRecord["ffmpeg"],
    settings: AppSettings
  ): Promise<ProbeHit | undefined> {
    if (!record) return undefined;
    if (record.source === "vendor") {
      const vendor = await this.readVendorState();
      if (!vendor.active) return undefined;
    }
    if (record.source === "custom") {
      const customPath = tool === "ffmpeg" ? settings.customFfmpegPath : settings.customFfprobePath;
      if (customPath !== record.path) return undefined;
    }
    return this.tryProbe(record.source, record.path);
  }

  /** 读取 vendor 状态：记录有效且当前未被停用则 active=true。 */
  private async readVendorState(): Promise<{ active: boolean; binDir?: string; version?: string }> {
    const recordPath = path.join(this.vendorRoot, "version.json");
    try {
      const raw = await fs.readFile(recordPath, "utf8");
      const record = parseVendorVersionRecord(JSON.parse(raw) as unknown);
      if (!record) return { active: false };
      const binDir = path.join(this.vendorRoot, record.version, "bin");
      try {
        await Promise.all([fs.access(path.join(binDir, "ffmpeg.exe")), fs.access(path.join(binDir, "ffprobe.exe"))]);
      } catch {
        return { active: false };
      }
      return { active: true, binDir, version: record.version };
    } catch {
      return { active: false };
    }
  }

  private async buildStatus(ffmpeg: ProbeHit | undefined, ffprobe: ProbeHit | undefined): Promise<DependencyStatus> {
    const vendor = await this.readVendorState();
    const vendorVersion = await this.readVendorVersionLabel();
    return {
      ffmpeg: toToolStatus(ffmpeg),
      ffprobe: toToolStatus(ffprobe),
      checkedAt: Date.now(),
      vendor: vendorVersion ? { version: vendorVersion, active: vendor.active } : undefined
    };
  }

  /** vendor 展示版本：优先 version.json；停用状态读 version.json.bak。 */
  private async readVendorVersionLabel(): Promise<string | undefined> {
    for (const fileName of ["version.json", "version.json.bak"]) {
      try {
        const raw = await fs.readFile(path.join(this.vendorRoot, fileName), "utf8");
        const record = parseVendorVersionRecord(JSON.parse(raw) as unknown) as VendorVersionRecord | undefined;
        if (record) return record.version;
      } catch {
        /* 尝试下一个文件 */
      }
    }
    return undefined;
  }

  private async persistResolved(ffmpeg: ProbeHit | undefined, ffprobe: ProbeHit | undefined): Promise<void> {
    const record: ResolvedDependencyRecord = {};
    if (ffmpeg) record.ffmpeg = { path: ffmpeg.filePath, source: ffmpeg.source, version: ffmpeg.version };
    if (ffprobe) record.ffprobe = { path: ffprobe.filePath, source: ffprobe.source, version: ffprobe.version };
    await this.opts.updateSettings({ resolvedDependencies: record }).catch(() => {
      /* 持久化失败不影响本次可用性 */
    });
  }
}

function toToolStatus(hit: ProbeHit | undefined): ToolStatus {
  if (!hit) {
    return { available: false, error: "未检测到" };
  }
  return { available: true, version: hit.version, source: hit.source, resolvedPath: hit.filePath };
}

/**
 * winget 包目录的浅层查找：Packages/<包含 ffmpeg 的包>/ 下最多下探 3 层找 ffmpeg.exe，
 * 整体限时，防止拖慢启动探测。
 */
async function findWingetBinDir(wingetPackagesRoot: string, budgetMs = 2000): Promise<string | undefined> {
  const startedAt = Date.now();
  let packages: string[];
  try {
    packages = (await fs.readdir(wingetPackagesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => name.toLowerCase().includes("ffmpeg"));
  } catch {
    return undefined;
  }
  for (const packageName of packages) {
    const packageDir = path.join(wingetPackagesRoot, packageName);
    const hit = await findFileUpToDepth(packageDir, "ffmpeg.exe", 3, startedAt, budgetMs);
    if (hit) return path.dirname(hit);
  }
  return undefined;
}

async function findFileUpToDepth(
  dir: string,
  fileName: string,
  depth: number,
  startedAt: number,
  budgetMs: number
): Promise<string | undefined> {
  if (depth < 0 || Date.now() - startedAt > budgetMs) return undefined;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isFile() && entry.name.toLowerCase() === fileName) return entryPath;
    if (entry.isDirectory()) {
      const hit = await findFileUpToDepth(entryPath, fileName, depth - 1, startedAt, budgetMs);
      if (hit) return hit;
    }
  }
  return undefined;
}
