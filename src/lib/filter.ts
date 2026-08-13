import type { VideoItem } from "../shared.js";
import { isWithinDirectory } from "./path.js";

export type SortKey = "fileName" | "modifiedAt" | "size" | "duration";
export type ThumbSize = "small" | "medium" | "large";
export type ViewMode = "grid" | "list";
export type DurationFilter = "all" | "short" | "medium" | "long";
export type ResolutionFilter = "all" | "landscape" | "portrait" | "square" | "hd" | "fhd" | "uhd";

export type FilterState = {
  query: string;
  selectedDirectory: string;
  extensionFilter: string;
  durationFilter: DurationFilter;
  resolutionFilter: ResolutionFilter;
};

export function isFilterActive(state: FilterState): boolean {
  return Boolean(
    state.query.trim() ||
      state.selectedDirectory ||
      (state.extensionFilter !== "all") ||
      state.durationFilter !== "all" ||
      state.resolutionFilter !== "all"
  );
}

export function matchesDurationFilter(duration: number | undefined, filter: DurationFilter): boolean {
  if (filter === "all") return true;
  if (!duration || !Number.isFinite(duration)) return false;
  if (filter === "short") return duration < 60;
  if (filter === "medium") return duration >= 60 && duration <= 20 * 60;
  return duration > 20 * 60;
}

export function matchesResolutionFilter(item: VideoItem, filter: ResolutionFilter): boolean {
  if (filter === "all") return true;
  if (!item.width || !item.height) return false;
  if (filter === "landscape") return item.width > item.height;
  if (filter === "portrait") return item.height > item.width;
  if (filter === "square") return item.width === item.height;
  if (filter === "hd") return item.width >= 1280 || item.height >= 720;
  if (filter === "fhd") return item.width >= 1920 || item.height >= 1080;
  return item.width >= 3840 || item.height >= 2160;
}

export function compareItems(a: VideoItem, b: VideoItem, key: SortKey): number {
  if (key === "fileName") return a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true });
  return (a[key] ?? 0) - (b[key] ?? 0);
}

/** 搜索 + 目录 + 格式 + 时长 + 画面筛选，再排序。不修改 items。 */
export function filterAndSortItems(
  items: VideoItem[],
  state: FilterState,
  sortKey: SortKey,
  ascending: boolean
): VideoItem[] {
  const keyword = state.query.trim().toLocaleLowerCase();
  return items
    .filter((item) => (keyword ? item.fileName.toLocaleLowerCase().includes(keyword) : true))
    .filter((item) => (state.selectedDirectory ? isWithinDirectory(item.directory, state.selectedDirectory) : true))
    .filter((item) => (state.extensionFilter === "all" ? true : item.extension === state.extensionFilter))
    .filter((item) => matchesDurationFilter(item.duration, state.durationFilter))
    .filter((item) => matchesResolutionFilter(item, state.resolutionFilter))
    .sort((a, b) => (ascending ? 1 : -1) * compareItems(a, b, sortKey));
}
