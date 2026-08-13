import { describe, expect, it } from "vitest";
import { getDirectoryName, getRelativeDirectory, isSamePath, isWithinDirectory, normalizePath, pathKey } from "./path";

describe("normalizePath", () => {
  it("统一分隔符并去除尾部斜杠", () => {
    expect(normalizePath("C:\\Videos\\Movies\\")).toBe("c:/videos/movies");
    expect(normalizePath("C:/Videos//")).toBe("c:/videos");
  });

  it("大小写不敏感", () => {
    expect(normalizePath("C:\\Videos")).toBe(normalizePath("c:\\videos"));
  });
});

describe("isSamePath / pathKey", () => {
  it("忽略大小写与分隔符差异", () => {
    expect(isSamePath("C:\\Videos\\A", "c:/videos/a/")).toBe(true);
    expect(pathKey("C:\\Videos\\A")).toBe("c:/videos/a");
  });
});

describe("getRelativeDirectory", () => {
  it("根目录返回 .", () => {
    expect(getRelativeDirectory("C:\\Videos", "C:\\Videos")).toBe(".");
  });

  it("子目录返回相对路径", () => {
    expect(getRelativeDirectory("C:\\Videos", "C:\\Videos\\A\\B")).toBe("A/B");
  });

  it("目录不在根内时返回原路径", () => {
    expect(getRelativeDirectory("C:\\Videos", "D:\\Other")).toBe("D:/Other");
  });
});

describe("getDirectoryName", () => {
  it("根返回全部视频", () => {
    expect(getDirectoryName(".")).toBe("全部视频");
  });

  it("返回最后一级名称", () => {
    expect(getDirectoryName("A/B/C")).toBe("C");
  });
});

describe("isWithinDirectory", () => {
  const item = "C:\\Videos\\A\\B\\v1.mp4";
  it("同一目录命中", () => {
    expect(isWithinDirectory(item, "C:\\Videos\\A\\B")).toBe(true);
  });
  it("祖先目录命中", () => {
    expect(isWithinDirectory(item, "C:\\Videos\\A")).toBe(true);
  });
  it("兄弟目录不命中", () => {
    expect(isWithinDirectory(item, "C:\\Videos\\A\\C")).toBe(false);
  });
  it("空选择表示全部", () => {
    expect(isWithinDirectory(item, "")).toBe(true);
  });
  it("前缀相似但非目录关系不命中", () => {
    expect(isWithinDirectory("C:\\Videos\\AB\\v.mp4", "C:\\Videos\\A")).toBe(false);
  });
});
