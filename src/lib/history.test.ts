import { describe, expect, it } from "vitest";
import {
  addHistoryEntry,
  MAX_RECENT_FOLDERS,
  hasHistoryEntry,
  removeHistoryEntry,
  sanitizeExpandedKeys,
  sanitizeHistory,
  toggleExpandedKey,
  togglePin
} from "./history";

function entry(path: string, at: number, pinned = false) {
  return { path, lastOpenedAt: at, pinned };
}

describe("sanitizeHistory", () => {
  it("过滤非法条目并按规范化路径去重", () => {
    const input: unknown[] = [
      entry("C:\\Videos\\A", 100),
      entry("c:\\videos\\a", 200),
      { path: "", lastOpenedAt: 300, pinned: false },
      { lastOpenedAt: 400, pinned: false },
      "garbage",
      null,
      entry("C:\\Videos\\B", 150, true)
    ];
    const result = sanitizeHistory(input);
    expect(result).toHaveLength(2);
    expect(hasHistoryEntry(result, "C:\\Videos\\A")).toBe(true);
    expect(result.find((item) => item.path === "C:\\Videos\\A")!.lastOpenedAt).toBe(200);
  });

  it("固定项不被淘汰", () => {
    const pinnedOld = entry("C:\\Videos\\Pin", 1, true);
    const entries = [pinnedOld];
    for (let index = 0; index < MAX_RECENT_FOLDERS * 2; index += 1) {
      entries.push(entry(`C:\\Videos\\F${index}`, 1000 + index));
    }
    const result = sanitizeHistory(entries);
    expect(result.some((item) => item.path === "C:\\Videos\\Pin")).toBe(true);
  });

  it("超出上限时淘汰最旧的非固定记录", () => {
    const entries = [];
    for (let index = 0; index < MAX_RECENT_FOLDERS + 5; index += 1) {
      entries.push(entry(`C:\\Videos\\F${index}`, index));
    }
    const result = sanitizeHistory(entries);
    expect(result.length).toBeLessThanOrEqual(MAX_RECENT_FOLDERS);
    expect(result.some((item) => item.path === "C:\\Videos\\F0")).toBe(false);
    expect(result.some((item) => item.path === "C:\\Videos\\F14")).toBe(true);
  });

  it("非数组输入返回空", () => {
    expect(sanitizeHistory(undefined)).toEqual([]);
    expect(sanitizeHistory({})).toEqual([]);
  });
});

describe("addHistoryEntry", () => {
  it("新增记录并按时间降序", () => {
    const result = addHistoryEntry(
      [entry("C:\\Videos\\A", 100), entry("C:\\Videos\\B", 200)],
      entry("C:\\Videos\\C", 300)
    );
    expect(result.map((item) => item.path)).toEqual(["C:\\Videos\\C", "C:\\Videos\\B", "C:\\Videos\\A"]);
  });

  it("更新已有路径的时间戳且不重复", () => {
    const result = addHistoryEntry([entry("C:\\Videos\\A", 100)], entry("c:\\videos\\a", 500));
    expect(result).toHaveLength(1);
    expect(result[0].lastOpenedAt).toBe(500);
    expect(result[0].path).toBe("c:\\videos\\a");
  });
});

describe("togglePin / removeHistoryEntry", () => {
  it("切换固定状态", () => {
    const result = togglePin([entry("C:\\Videos\\A", 100)], "C:\\Videos\\A");
    expect(result[0].pinned).toBe(true);
    expect(togglePin(result, "c:\\videos\\a")[0].pinned).toBe(false);
  });

  it("移除记录不影响其他条目", () => {
    const result = removeHistoryEntry(
      [entry("C:\\Videos\\A", 100, true), entry("C:\\Videos\\B", 200)],
      "C:\\Videos\\A"
    );
    expect(result).toHaveLength(1);
    expect(result[0].path).toBe("C:\\Videos\\B");
  });
});

describe("sanitizeExpandedKeys / toggleExpandedKey", () => {
  it("清理非法值与重复，且限长", () => {
    const keys = sanitizeExpandedKeys(["C:\\Videos\\A", "c:/videos/a", "", 42, "C:\\Videos\\B"]);
    expect(keys).toEqual(["c:/videos/a", "c:/videos/b"]);
  });

  it("展开与折叠切换", () => {
    const expanded = toggleExpandedKey([], "C:\\Videos\\A");
    expect(expanded).toEqual(["c:/videos/a"]);
    expect(toggleExpandedKey(expanded, "C:\\Videos\\A")).toEqual([]);
  });
});
