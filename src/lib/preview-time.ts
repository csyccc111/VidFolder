/**
 * 悬停多帧预览的纯逻辑：时间点计算、缓存文件名与 URL 解析、LRU 淘汰选择。
 * 不包含文件系统或 ffmpeg 调用，便于聚焦测试。
 */

/** 预览算法版本：帧数、时间点策略、尺寸或编码参数变化时递增，避免误用旧帧。 */
export const PREVIEW_SCHEMA_VERSION = 1;
export const PREVIEW_FRAME_COUNT = 8;
export const PREVIEW_MIN_FRAMES = 2;
/** 时间点分布范围：避开首尾的纯黑/纯白帧。 */
export const PREVIEW_START_FRACTION = 0.05;
export const PREVIEW_END_FRACTION = 0.95;
export const PREVIEW_CACHE_CAPACITY_BYTES = 512 * 1024 * 1024;

/**
 * 计算帧时间点（秒）。
 * - 时长未知或无效返回 undefined，调用方应回退静态封面。
 * - 1 秒以上的视频使用完整帧数；不足 1 秒时减少帧数，保证时间点有效、递增。
 */
export function computeFrameTimestamps(
  duration: number | undefined,
  frameCount: number = PREVIEW_FRAME_COUNT
): number[] | undefined {
  if (!duration || !Number.isFinite(duration) || duration <= 0) return undefined;
  const usable = duration >= 1 ? frameCount : Math.max(PREVIEW_MIN_FRAMES, Math.floor(duration));
  const start = duration * PREVIEW_START_FRACTION;
  const end = duration * PREVIEW_END_FRACTION;
  const span = end - start;
  const points: number[] = [];
  let lastMs = -1;
  for (let index = 0; index < usable; index += 1) {
    const time = usable === 1 ? duration / 2 : start + (span * index) / (usable - 1);
    const ms = Math.round(time * 1000);
    if (ms > lastMs) {
      points.push(time);
      lastMs = ms;
    }
  }
  if (points.length === 0) points.push(duration / 2);
  return points;
}

/** 单帧缓存文件名：受控索引，不直接使用渲染进程提供的路径。 */
export function previewFrameFileName(index: number): string {
  return `v${PREVIEW_SCHEMA_VERSION}_${index}.jpg`;
}

/** 校验文件名是否为受控预览帧名（帧索引为单数字，与 PREVIEW_FRAME_COUNT<=9 保持一致）。 */
export function isPreviewFrameFileName(name: string): boolean {
  return new RegExp(`^v${PREVIEW_SCHEMA_VERSION}_\\d\\.jpg$`, "i").test(name);
}

/** 校验源 key 是否为受控 hash（sha1 hex）。 */
export function isPreviewSourceKey(key: string): boolean {
  return /^[a-f0-9]{40}$/i.test(key);
}

export type ParsedPreviewUrl = {
  sourceKey: string;
  fileName: string;
};

/**
 * 解析 preview:// 协议 URL 为缓存目录内的相对路径。
 * 任何不匹配的结构（目录穿越、非法文件名、非法 key）返回 undefined。
 */
export function parsePreviewUrl(rawUrl: string): ParsedPreviewUrl | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== "preview:") return undefined;
  const segments = decodeURIComponent(url.pathname.replace(/^\/+/, "")).split("/").filter(Boolean);
  if (segments.length !== 2) return undefined;
  const [sourceKey, fileName] = segments;
  if (!isPreviewSourceKey(sourceKey)) return undefined;
  if (!isPreviewFrameFileName(fileName)) return undefined;
  return { sourceKey, fileName };
}

export type LruEntry = {
  key: string;
  lastAccessedAt: number;
};

/** 近似 LRU：选出最久未访问的条目。空输入返回 undefined。 */
export function pickLruEviction(entries: LruEntry[]): string | undefined {
  if (entries.length === 0) return undefined;
  let oldest = entries[0];
  for (const entry of entries) {
    if (entry.lastAccessedAt < oldest.lastAccessedAt) oldest = entry;
  }
  return oldest.key;
}

/** 分组字节统计。 */
export function totalBytes(entries: Array<{ bytes: number }>): number {
  return entries.reduce((sum, entry) => sum + entry.bytes, 0);
}
