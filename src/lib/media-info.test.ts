import { describe, expect, it } from "vitest";
import {
  estimateBitrateKbps,
  formatAudioTrackText,
  formatFrameRateText,
  formatKbpsText,
  formatSampleRate,
  parseFrameRate,
  parseKbps,
  parseMediaInfo
} from "./media-info";

describe("parseFrameRate", () => {
  it("把 a/b 换算为两位小数 fps", () => {
    expect(parseFrameRate("24000/1001")).toBe(23.98);
    expect(parseFrameRate("30000/1001")).toBe(29.97);
    expect(parseFrameRate("25/1", "25/1")).toBe(25);
    expect(parseFrameRate("60/1")).toBe(60);
  });

  it("avg_frame_rate 优先于 r_frame_rate", () => {
    expect(parseFrameRate("30000/1001", "30/1")).toBe(29.97);
    expect(parseFrameRate(undefined, "30/1")).toBe(30);
  });

  it("0/0、负数、非法与缺失视为未知", () => {
    expect(parseFrameRate("0/0")).toBeUndefined();
    expect(parseFrameRate("5/0")).toBeUndefined();
    expect(parseFrameRate("-30/1")).toBeUndefined();
    expect(parseFrameRate("abc/1")).toBeUndefined();
    expect(parseFrameRate(undefined)).toBeUndefined();
    expect(parseFrameRate("")).toBeUndefined();
  });
});

describe("parseKbps", () => {
  it("字节/秒转为 kbps", () => {
    expect(parseKbps("128000")).toBe(128);
    expect(parseKbps("1000")).toBe(1);
    expect(parseKbps("1500000")).toBe(1500);
  });

  it("缺失与非法返回 undefined", () => {
    expect(parseKbps(undefined)).toBeUndefined();
    expect(parseKbps("")).toBeUndefined();
    expect(parseKbps("abc")).toBeUndefined();
    expect(parseKbps("-1")).toBeUndefined();
  });
});

describe("estimateBitrateKbps", () => {
  it("按 大小*8/时长 估算", () => {
    expect(estimateBitrateKbps(1024 * 1024, 10)).toBe(838.9);
  });

  it("非法输入返回 undefined", () => {
    expect(estimateBitrateKbps(0, 10)).toBeUndefined();
    expect(estimateBitrateKbps(100, 0)).toBeUndefined();
  });
});

describe("parseMediaInfo", () => {
  it("完整解析视频流与音轨", () => {
    const json = JSON.stringify({
      format: {
        format_name: "mov,mp4,m4a,3gp,3g2,mj2",
        format_long_name: "QuickTime / MOV",
        duration: "60.000000",
        bit_rate: "1280000",
        tags: { major_brand: "isom" }
      },
      streams: [
        {
          codec_type: "video",
          codec_name: "h264",
          profile: "High",
          level: 41,
          width: 1920,
          height: 1080,
          avg_frame_rate: "24000/1001",
          r_frame_rate: "24000/1001",
          bit_rate: "1000000"
        },
        {
          codec_type: "audio",
          codec_name: "aac",
          channels: 2,
          sample_rate: "44100",
          tags: { language: "chi" }
        }
      ]
    });
    const info = parseMediaInfo(json, 1024 * 1024);
    expect(info.duration).toBe(60);
    expect(info.width).toBe(1920);
    expect(info.height).toBe(1080);
    expect(info.container).toBe("MP4 (isom)");
    expect(info.videoCodec).toBe("H.264 (High, L4.1)");
    expect(info.codecShortName).toBe("h264");
    expect(info.containerBitrate).toBe(1280);
    expect(info.videoBitrate).toBe(1000);
    expect(info.bitrateEstimated).toBe(false);
    expect(info.frameRate).toBe(23.98);
    expect(info.audioTracks).toHaveLength(1);
    expect(info.audioTracks?.[0]).toMatchObject({ codec: "AAC", channels: 2, sampleRate: 44100, language: "chi" });
  });

  it("容器级码率缺失时按大小/时长估算并标记", () => {
    const json = JSON.stringify({
      format: { format_name: "matroska", duration: "10.000000" },
      streams: [{ codec_type: "video", codec_name: "hevc", width: 3840, height: 2160 }]
    });
    const info = parseMediaInfo(json, 1024 * 1024 * 10);
    expect(info.container).toBe("Matroska");
    expect(info.containerBitrate).toBeGreaterThan(0);
    expect(info.bitrateEstimated).toBe(true);
    expect(info.videoBitrate).toBeUndefined();
    expect(info.videoCodec).toBe("H.265/HEVC");
  });

  it("无音轨返回空数组；未知编码走大写兜底", () => {
    const json = JSON.stringify({
      format: { format_name: "avi" },
      streams: [{ codec_type: "video", codec_name: "divx" }]
    });
    const info = parseMediaInfo(json);
    expect(info.audioTracks).toEqual([]);
    expect(info.videoCodec).toBe("DIVX");
    expect(info.container).toBe("AVI");
  });

  it("字段缺失按未知兜底", () => {
    const info = parseMediaInfo(JSON.stringify({ format: { format_name: "mp4" } }));
    expect(info.duration).toBeUndefined();
    expect(info.width).toBeUndefined();
    expect(info.frameRate).toBeUndefined();
    expect(info.videoCodec).toBeUndefined();
    expect(info.containerBitrate).toBeUndefined();
    expect(info.bitrateEstimated).toBe(false);
  });

  it("非法 JSON 抛错", () => {
    expect(() => parseMediaInfo("not-json")).toThrow();
  });
});

describe("展示格式化", () => {
  it("formatKbpsText 千位取整", () => {
    expect(formatKbpsText(128)).toBe("128 kbps");
    expect(formatKbpsText(1200)).toBe("1 Mbps");
    expect(formatKbpsText(128, true)).toBe("128 kbps（估算）");
    expect(formatKbpsText(undefined)).toBeUndefined();
  });

  it("formatFrameRateText 去掉多余零", () => {
    expect(formatFrameRateText(23.98)).toBe("23.98 fps");
    expect(formatFrameRateText(25)).toBe("25 fps");
    expect(formatFrameRateText(undefined)).toBeUndefined();
  });

  it("formatSampleRate 千分位", () => {
    expect(formatSampleRate(44100)).toBe("44.1kHz");
    expect(formatSampleRate(48000)).toBe("48kHz");
    expect(formatSampleRate(8000)).toBe("8kHz");
    expect(formatSampleRate(undefined)).toBeUndefined();
  });

  it("formatAudioTrackText 组合显示", () => {
    expect(formatAudioTrackText({ codec: "AAC", channels: 2, sampleRate: 44100, language: "chi" })).toBe(
      "AAC 2声道 44.1kHz (chi)"
    );
    expect(formatAudioTrackText({})).toBe("未知");
    expect(formatAudioTrackText({ codec: "DTS" })).toBe("DTS");
  });
});
