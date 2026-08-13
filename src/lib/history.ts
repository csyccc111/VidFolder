import type { FolderHistoryEntry } from "../shared.js";
import { normalizePath } from "./path.js";

export const MAX_RECENT_FOLDERS = 10;
export const MAX_EXPANDED_KEYS_PER_ROOT = 2000;

/** 仅保留合法字符串路径。 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** 清理单条历史记录：仅保留合法字段与布尔标记。 */
function sanitizeEntry(entry: unknown): FolderHistoryEntry | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const record = entry as Record<string, unknown>;
  if (!isNonEmptyString(record.path)) return undefined;
  const lastOpenedAt =
    typeof record.lastOpenedAt === "number" && Number.isFinite(record.lastOpenedAt) ? record.lastOpenedAt : 0;
  return {
    path: record.path,
    lastOpenedAt,
    pinned: record.pinned === true
  };
}

/**
 * 兼容清理历史记录数组：
 * - 过滤非法条目（缺路径、格式异常）。
 * - 按规范化路径去重，保留较新的时间戳与固定标记。
 * - 固定项保留，非固定项超出上限时淘汰最旧。
 */
export function sanitizeHistory(input: unknown): FolderHistoryEntry[] {
  if (!Array.isArray(input)) return [];
  const byKey = new Map<string, FolderHistoryEntry>();
  for (const raw of input) {
    const entry = sanitizeEntry(raw);
    if (!entry) continue;
    const key = normalizePath(entry.path);
    const existing = byKey.get(key);
    if (!existing || entry.lastOpenedAt >= existing.lastOpenedAt || entry.pinned) {
      byKey.set(key, {
        // 保留首次出现的原始大小写路径，用于显示与系统操作。
        path: existing?.path ?? entry.path,
        lastOpenedAt: Math.max(entry.lastOpenedAt, existing?.lastOpenedAt ?? 0),
        pinned: entry.pinned || existing?.pinned === true
      });
    }
  }
  const entries = [...byKey.values()];
  const pinned = entries.filter((entry) => entry.pinned);
  const unpinned = entries
    .filter((entry) => !entry.pinned)
    .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
    .slice(0, MAX_RECENT_FOLDERS - pinned.length);
  return [...pinned, ...unpinned].sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** 添加/更新一条成功打开的文件夹记录；非固定记录按时间降序，固定记录优先展示。 */
export function addHistoryEntry(history: FolderHistoryEntry[], entry: FolderHistoryEntry): FolderHistoryEntry[] {
  const key = normalizePath(entry.path);
  const rest = history.filter((item) => normalizePath(item.path) !== key);
  return sanitizeHistory([...rest, { ...entry, pinned: entry.pinned }]);
}

/** 切换固定状态。 */
export function togglePin(history: FolderHistoryEntry[], path: string): FolderHistoryEntry[] {
  const updated = history.map((entry) =>
    normalizePath(entry.path) === normalizePath(path) ? { ...entry, pinned: !entry.pinned } : entry
  );
  return sanitizeHistory(updated);
}

/** 移除一条历史记录（不触碰文件系统）。 */
export function removeHistoryEntry(history: FolderHistoryEntry[], path: string): FolderHistoryEntry[] {
  const key = normalizePath(path);
  return history.filter((entry) => normalizePath(entry.path) !== key);
}

/** 历史记录中是否已存在该路径。 */
export function hasHistoryEntry(history: FolderHistoryEntry[], path: string): boolean {
  const key = normalizePath(path);
  return history.some((entry) => normalizePath(entry.path) === key);
}

/** 清理展开状态集合：只保留合法非空字符串、去重、限长。 */
export function sanitizeExpandedKeys(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const raw of input) {
    if (!isNonEmptyString(raw)) continue;
    const key = normalizePath(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
    if (keys.length >= MAX_EXPANDED_KEYS_PER_ROOT) break;
  }
  return keys;
}

/** 清理"根路径 → 展开节点集合"映射：过滤非法根路径与超限集合。 */
export function sanitizeExpandedFoldersByRoot(input: unknown): Record<string, string[]> {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const result: Record<string, string[]> = {};
  for (const [root, keys] of Object.entries(input)) {
    if (!isNonEmptyString(root)) continue;
    const sanitized = sanitizeExpandedKeys(keys);
    if (sanitized.length > 0) result[normalizePath(root)] = sanitized;
  }
  return result;
}

/** 展开/折叠一个节点，返回新集合。 */
export function toggleExpandedKey(keys: string[], key: string): string[] {
  const normalized = normalizePath(key);
  if (keys.includes(normalized)) return keys.filter((item) => item !== normalized);
  return sanitizeExpandedKeys([...keys, normalized]);
}
