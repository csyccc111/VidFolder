import { describe, expect, it } from "vitest";
import { isNewerVersion, parseVersionParts } from "./semver";

describe("parseVersionParts", () => {
  it("parses with v prefix and prerelease suffix", () => {
    expect(parseVersionParts("v0.10.0")).toEqual([0, 10, 0]);
    expect(parseVersionParts("0.9.9-beta.1")).toEqual([0, 9, 9]);
    expect(parseVersionParts("V1.2")).toEqual([1, 2]);
  });

  it("returns undefined for garbage", () => {
    expect(parseVersionParts("")).toBeUndefined();
    expect(parseVersionParts("abc")).toBeUndefined();
    expect(parseVersionParts("1.a.0")).toBeUndefined();
  });
});

describe("isNewerVersion", () => {
  it("compares numerically across digit boundaries", () => {
    expect(isNewerVersion("v0.10.0", "0.9.9")).toBe(true);
    expect(isNewerVersion("0.9.9", "v0.10.0")).toBe(false);
    expect(isNewerVersion("v0.9.1", "0.9.1")).toBe(false);
    expect(isNewerVersion("1.0", "0.9.9")).toBe(true);
  });

  it("ignores prerelease suffix for magnitude", () => {
    expect(isNewerVersion("v1.0.0-beta.1", "1.0.0")).toBe(false);
    expect(isNewerVersion("v0.11.0-rc.1", "0.10.0")).toBe(true);
  });

  it("returns false when either side is unparseable", () => {
    expect(isNewerVersion("abc", "1.0.0")).toBe(false);
    expect(isNewerVersion("1.0.0", "")).toBe(false);
  });
});
