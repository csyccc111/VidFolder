import { describe, expect, it } from "vitest";
import {
  buildProbeCandidates,
  commonBinDirCandidates,
  FFMPEG_DOWNLOAD_MANIFEST,
  isManifestZipEntry,
  isSafeZipEntryPath,
  parseToolVersionLine,
  parseVendorVersionRecord
} from "./deps-core";

describe("parseToolVersionLine", () => {
  it("parses ffmpeg version token", () => {
    expect(parseToolVersionLine("ffmpeg version n8.1.2-50-g1a748fe2cd Copyright (c) 2000-2025 the FFmpeg developers")).toBe(
      "n8.1.2-50-g1a748fe2cd"
    );
  });

  it("parses ffprobe version token", () => {
    expect(parseToolVersionLine("ffprobe version 7.1.1-full_build-www.gyan.dev Copyright (c)")).toBe(
      "7.1.1-full_build-www.gyan.dev"
    );
  });

  it("returns undefined for unrelated or empty input", () => {
    expect(parseToolVersionLine("")).toBeUndefined();
    expect(parseToolVersionLine("'ffmpeg' is not recognized")).toBeUndefined();
    expect(parseToolVersionLine("ffmpeg version")).toBeUndefined();
  });
});

describe("isSafeZipEntryPath", () => {
  it("accepts normal relative paths", () => {
    expect(isSafeZipEntryPath("pkg/bin/ffmpeg.exe")).toBe(true);
    expect(isSafeZipEntryPath("pkg/")).toBe(true);
    expect(isSafeZipEntryPath("pkg/bin/")).toBe(true);
    expect(isSafeZipEntryPath("LICENSE")).toBe(true);
  });

  it("rejects directory traversal and absolute paths", () => {
    expect(isSafeZipEntryPath("../evil.exe")).toBe(false);
    expect(isSafeZipEntryPath("pkg/../../evil.exe")).toBe(false);
    expect(isSafeZipEntryPath("/abs/path.exe")).toBe(false);
    expect(isSafeZipEntryPath("\\abs\\path.exe")).toBe(false);
    expect(isSafeZipEntryPath("C:\\evil.exe")).toBe(false);
    expect(isSafeZipEntryPath("C:/evil.exe")).toBe(false);
    expect(isSafeZipEntryPath("")).toBe(false);
    expect(isSafeZipEntryPath("a//b.exe")).toBe(false);
  });
});

describe("isManifestZipEntry", () => {
  const topDir = "ffmpeg-n8.1.2-50-g1a748fe2cd-win64-gpl-shared-8.1";

  it("accepts entries inside the expected top dir", () => {
    expect(isManifestZipEntry(`${topDir}/bin/ffmpeg.exe`, topDir)).toBe(true);
    expect(isManifestZipEntry(`${topDir}/`, topDir)).toBe(true);
  });

  it("rejects entries outside the expected top dir", () => {
    expect(isManifestZipEntry("other/bin/ffmpeg.exe", topDir)).toBe(false);
    expect(isManifestZipEntry(`${topDir}-evil/bin/ffmpeg.exe`, topDir)).toBe(false);
    expect(isManifestZipEntry("bin/ffmpeg.exe", topDir)).toBe(false);
  });
});

describe("buildProbeCandidates", () => {
  it("orders vendor > custom > common and skips absent layers", () => {
    const full = buildProbeCandidates({
      tool: "ffmpeg",
      vendorBinDir: "C:\\vendor\\n8.1.2\\bin",
      customPath: " D:\\tools\\ffmpeg.exe ",
      commonBinDirs: ["C:\\ffmpeg\\bin", "C:\\ProgramData\\chocolatey\\bin"]
    });
    expect(full.map((entry) => entry.source)).toEqual(["vendor", "custom", "common", "common"]);
    expect(full[0].filePath).toBe("C:\\vendor\\n8.1.2\\bin\\ffmpeg.exe");
    expect(full[1].filePath).toBe("D:\\tools\\ffmpeg.exe");
    expect(full[1].filePath.endsWith("ffmpeg.exe")).toBe(true);

    const minimal = buildProbeCandidates({ tool: "ffprobe", commonBinDirs: ["C:\\ffmpeg\\bin"] });
    expect(minimal.map((entry) => entry.source)).toEqual(["common"]);
    expect(minimal[0].filePath).toBe("C:\\ffmpeg\\bin\\ffprobe.exe");
  });
});

describe("commonBinDirCandidates", () => {
  it("includes fixed dirs and expands user dirs when present", () => {
    const { fixedDirs, wingetDir } = commonBinDirCandidates({
      userProfile: "C:\\Users\\u",
      localAppData: "C:\\Users\\u\\AppData\\Local"
    });
    expect(fixedDirs).toContain("C:\\ffmpeg\\bin");
    expect(fixedDirs).toContain("C:\\Program Files\\ffmpeg\\bin");
    expect(fixedDirs).toContain("C:\\Users\\u\\scoop\\apps\\ffmpeg\\current\\bin");
    expect(fixedDirs).toContain("C:\\ProgramData\\chocolatey\\bin");
    expect(wingetDir).toBe("C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Packages");
  });

  it("omits user-specific dirs when env is missing", () => {
    const { fixedDirs, wingetDir } = commonBinDirCandidates({});
    expect(fixedDirs).not.toContain("C:\\Users\\u\\scoop\\apps\\ffmpeg\\current\\bin");
    expect(wingetDir).toBeUndefined();
  });
});

describe("parseVendorVersionRecord", () => {
  it("accepts a complete record", () => {
    const record = parseVendorVersionRecord({
      version: "n8.1.2",
      sourceUrl: FFMPEG_DOWNLOAD_MANIFEST.url,
      sha256: FFMPEG_DOWNLOAD_MANIFEST.sha256,
      installedAt: "2026-09-05T00:00:00.000Z"
    });
    expect(record?.version).toBe("n8.1.2");
  });

  it("rejects malformed records", () => {
    expect(parseVendorVersionRecord(undefined)).toBeUndefined();
    expect(parseVendorVersionRecord({})).toBeUndefined();
    expect(
      parseVendorVersionRecord({ version: "", sourceUrl: "https://x", sha256: "a".repeat(64), installedAt: "x" })
    ).toBeUndefined();
    expect(
      parseVendorVersionRecord({ version: "v", sourceUrl: "http://x", sha256: "a".repeat(64), installedAt: "x" })
    ).toBeUndefined();
    expect(
      parseVendorVersionRecord({ version: "v", sourceUrl: "https://x", sha256: "nothex", installedAt: "x" })
    ).toBeUndefined();
  });
});

describe("FFMPEG_DOWNLOAD_MANIFEST", () => {
  it("has a well-formed pinned manifest", () => {
    expect(FFMPEG_DOWNLOAD_MANIFEST.url.startsWith("https://github.com/BtbN/FFmpeg-Builds/releases/download/")).toBe(true);
    expect(FFMPEG_DOWNLOAD_MANIFEST.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(FFMPEG_DOWNLOAD_MANIFEST.topDir).not.toMatch(/[\\/]/);
    expect(FFMPEG_DOWNLOAD_MANIFEST.version).not.toMatch(/[\\/]/);
    expect(FFMPEG_DOWNLOAD_MANIFEST.bytes).toBeGreaterThan(0);
  });
});
