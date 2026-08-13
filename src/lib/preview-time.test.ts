import { describe, expect, it } from "vitest";
import {
  computeFrameTimestamps,
  isPreviewFrameFileName,
  isPreviewSourceKey,
  parsePreviewUrl,
  pickLruEviction,
  previewFrameFileName,
  PREVIEW_FRAME_COUNT
} from "./preview-time";

describe("computeFrameTimestamps", () => {
  it("未知时长返回 undefined", () => {
    expect(computeFrameTimestamps(undefined)).toBeUndefined();
    expect(computeFrameTimestamps(NaN)).toBeUndefined();
    expect(computeFrameTimestamps(0)).toBeUndefined();
    expect(computeFrameTimestamps(-5)).toBeUndefined();
  });

  it("正常时长生成 8 个递增时间点，范围在 5%-95% 之间", () => {
    const points = computeFrameTimestamps(600)!;
    expect(points).toHaveLength(PREVIEW_FRAME_COUNT);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]).toBeGreaterThan(points[index - 1]);
    }
    expect(points[0]).toBeCloseTo(30, 5);
    expect(points[points.length - 1]).toBeCloseTo(570, 5);
  });

  it("3 秒视频仍使用完整帧数", () => {
    const points = computeFrameTimestamps(3)!;
    expect(points).toHaveLength(PREVIEW_FRAME_COUNT);
    expect(points.every((point) => point >= 0 && point <= 3)).toBe(true);
  });

  it("不足 1 秒的视频减少帧数但保持有效递增", () => {
    const points = computeFrameTimestamps(0.6)!;
    expect(points.length).toBeLessThanOrEqual(2);
    expect(points.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]).toBeGreaterThan(points[index - 1]);
    }
    expect(points.every((point) => point >= 0 && point <= 0.6)).toBe(true);
  });
});

describe("previewFrameFileName / isPreviewFrameFileName", () => {
  it("生成受控文件名并可校验", () => {
    const name = previewFrameFileName(3);
    expect(name).toBe("v1_3.jpg");
    expect(isPreviewFrameFileName(name)).toBe(true);
    expect(isPreviewFrameFileName("v1_0.jpg")).toBe(true);
    expect(isPreviewFrameFileName("v2_0.jpg")).toBe(false);
    expect(isPreviewFrameFileName("v1_999.jpg")).toBe(false);
    expect(isPreviewFrameFileName("evil.jpg")).toBe(false);
    expect(isPreviewFrameFileName("../v1_0.jpg")).toBe(false);
  });

  it("sourceKey 校验", () => {
    expect(isPreviewSourceKey("a".repeat(40))).toBe(true);
    expect(isPreviewSourceKey("A".repeat(40))).toBe(true);
    expect(isPreviewSourceKey("short")).toBe(false);
    expect(isPreviewSourceKey("x".repeat(41))).toBe(false);
  });
});

describe("parsePreviewUrl", () => {
  it("解析合法 URL", () => {
    const key = "a".repeat(40);
    const parsed = parsePreviewUrl(`preview://cache/${key}/v1_2.jpg`);
    expect(parsed).toEqual({
      sourceKey: key,
      fileName: "v1_2.jpg"
    });
  });

  it("拒绝目录穿越、非法文件名与结构", () => {
    const key = "a".repeat(40);
    expect(parsePreviewUrl(`preview://cache/${key}/../../v1_0.jpg`)).toBeUndefined();
    expect(parsePreviewUrl(`preview://cache/${key}/v1_99.jpg`)).toBeUndefined();
    expect(parsePreviewUrl(`preview://cache/not-a-key/v1_0.jpg`)).toBeUndefined();
    expect(parsePreviewUrl(`preview://cache/${key}`)).toBeUndefined();
    expect(parsePreviewUrl("https://cache/x.jpg")).toBeUndefined();
    expect(parsePreviewUrl("not a url")).toBeUndefined();
  });
});

describe("pickLruEviction", () => {
  it("选出最久未访问的条目", () => {
    const entries = [
      { key: "a", lastAccessedAt: 300 },
      { key: "b", lastAccessedAt: 100 },
      { key: "c", lastAccessedAt: 200 }
    ];
    expect(pickLruEviction(entries)).toBe("b");
  });

  it("空输入返回 undefined", () => {
    expect(pickLruEviction([])).toBeUndefined();
  });
});
