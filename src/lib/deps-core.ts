/**
 * v0.9 依赖解决纯逻辑：ffmpeg/ffprobe 探测顺序、版本行解析、下载清单与 zip 条目校验。
 * 不含文件系统 / 网络 / 子进程调用，便于聚焦单测。
 */

export type DependencyTool = "ffmpeg" | "ffprobe";

/** 依赖来源：应用内 vendor / 用户手动指定 / 系统 PATH / 常见安装位置。 */
export type DependencySource = "vendor" | "custom" | "path" | "common";

/** 下载清单：固定版本的 BtbN 构建，URL 与内容均不变，SHA-256 可预置比对。 */
export const FFMPEG_DOWNLOAD_MANIFEST = {
  /** 展示与 vendor 目录名用短版本号。 */
  version: "n8.1.2",
  url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-09-04-14-01/ffmpeg-n8.1.2-50-g1a748fe2cd-win64-gpl-shared-8.1.zip",
  sha256: "43d5d900dfa34038e1b0fd254f9630ee38a636ad6fb024cf731ca5b803f8a09e",
  bytes: 80069474,
  /** zip 顶层目录名（bin/ 在其下），解压时用于路径前缀校验。 */
  topDir: "ffmpeg-n8.1.2-50-g1a748fe2cd-win64-gpl-shared-8.1",
  /** 选型记录：固定 autobuild（URL/内容固定可预置校验值）+ n8.1.2 稳定分支 + gpl-shared 体积适中。 */
  selectedReason: "BtbN 固定 autobuild（2026-09-04），n8.1.2 稳定分支，win64 gpl-shared"
} as const;

/** vendor 版本记录（vendor/ffmpeg/<version>/version.json）。 */
export type VendorVersionRecord = {
  version: string;
  sourceUrl: string;
  sha256: string;
  installedAt: string;
};

/** 校验 vendor version.json 结构是否完整（内容不可信，来自磁盘）。 */
export function parseVendorVersionRecord(raw: unknown): VendorVersionRecord | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Partial<VendorVersionRecord>;
  if (typeof record.version !== "string" || record.version.length === 0) return undefined;
  if (typeof record.sourceUrl !== "string" || !/^https:\/\//.test(record.sourceUrl)) return undefined;
  if (typeof record.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(record.sha256)) return undefined;
  if (typeof record.installedAt !== "string") return undefined;
  return {
    version: record.version,
    sourceUrl: record.sourceUrl,
    sha256: record.sha256,
    installedAt: record.installedAt
  };
}

/**
 * 解析 `ffmpeg -version` / `ffprobe -version` 首行中的版本 token。
 * 例："ffmpeg version n8.1.2-50-g1a748fe2cd-... Copyright ..." → "n8.1.2-50-g1a748fe2cd-..."
 * 无法解析返回 undefined。
 */
export function parseToolVersionLine(firstLine: string): string | undefined {
  const match = firstLine.match(/^\s*(?:ffmpeg|ffprobe)\s+version\s+(\S+)/i);
  return match?.[1];
}

/**
 * zip 条目路径安全校验（防 zip-slip 的第二道防线，yauzl 之外的自校验）：
 * 拒绝绝对路径、盘符、空段、"." 之外的目录穿越（"..）与反斜杠分隔。
 */
export function isSafeZipEntryPath(entryName: string): boolean {
  if (entryName.length === 0) return false;
  if (entryName.startsWith("/") || entryName.startsWith("\\")) return false;
  const segments = entryName.split(/[\\/]/);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.length === 0) {
      // 仅允许末尾空段（目录条目以 / 结尾）
      if (index === segments.length - 1) continue;
      return false;
    }
    if (segment === "..") return false;
    if (/^[a-zA-Z]:$/.test(segment)) return false;
  }
  return true;
}

/** 校验条目位于预期顶层目录内（下载包只应包含该目录）。 */
export function isManifestZipEntry(entryName: string, topDir: string): boolean {
  const normalized = entryName.replaceAll("\\", "/");
  return normalized === `${topDir}/` || normalized.startsWith(`${topDir}/`);
}

export type ProbeCandidate = {
  source: DependencySource;
  /** 候选可执行文件绝对路径。 */
  filePath: string;
};

/**
 * 组装单个工具的候选路径（按优先级）：vendor → 用户手动指定 → 常见安装位置。
 * 系统 PATH 不在此列：由调用方用 `where` 在候选全部落空后解析（spec 顺序：vendor > custom > PATH > common）。
 */
export function buildProbeCandidates(args: {
  tool: DependencyTool;
  vendorBinDir?: string;
  customPath?: string;
  commonBinDirs: string[];
}): ProbeCandidate[] {
  const candidates: ProbeCandidate[] = [];
  if (args.vendorBinDir) {
    candidates.push({ source: "vendor", filePath: pathJoin(args.vendorBinDir, `${args.tool}.exe`) });
  }
  if (args.customPath && args.customPath.trim().length > 0) {
    candidates.push({ source: "custom", filePath: args.customPath.trim() });
  }
  for (const dir of args.commonBinDirs) {
    candidates.push({ source: "common", filePath: pathJoin(dir, `${args.tool}.exe`) });
  }
  return candidates;
}

function pathJoin(dir: string, fileName: string): string {
  return dir.endsWith("\\") || dir.endsWith("/") ? `${dir}${fileName}` : `${dir}\\${fileName}`;
}

/** Windows 常见安装位置（含环境变量展开后的具体路径由调用方组装）；winget 目录单独返回，供浅层查找。 */
export function commonBinDirCandidates(env: {
  userProfile?: string;
  localAppData?: string;
}): { fixedDirs: string[]; wingetDir?: string } {
  const fixedDirs = ["C:\\ffmpeg\\bin", "C:\\Program Files\\ffmpeg\\bin"];
  if (env.userProfile) {
    fixedDirs.push(`${env.userProfile}\\scoop\\apps\\ffmpeg\\current\\bin`);
  }
  fixedDirs.push("C:\\ProgramData\\chocolatey\\bin");
  return { fixedDirs, wingetDir: env.localAppData ? `${env.localAppData}\\Microsoft\\WinGet\\Packages` : undefined };
}
