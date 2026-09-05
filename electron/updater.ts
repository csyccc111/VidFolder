/**
 * v0.10 应用内更新检查（只提示 + 引导下载，不做自动替换安装）：
 * - 数据源：GitHub API releases/latest（未认证限流 60 次/时，应用低频调用足够）。
 * - 启动延迟静默检查（受设置开关控制）+ 手动强制检查；手动检查绕过开关与节流。
 * - 单飞（并发合并）+ 10 分钟节流；任何失败静默返回 error 状态，不弹错误框。
 * - "忽略此版本"持久化到 settings.ignoredUpdateVersions，命中后状态为 ignored 不再提示。
 */
import { net } from "electron";
import type { AppSettings, UpdateCheckOutcome, UpdateInfo } from "../src/shared.js";
import { isNewerVersion, parseVersionParts } from "../src/lib/semver.js";

const RELEASES_API_URL = "https://api.github.com/repos/csyccc111/VidFolder/releases/latest";
const REQUEST_TIMEOUT_MS = 10_000;
const THROTTLE_INTERVAL_MS = 10 * 60 * 1000;
const MAX_IGNORED_VERSIONS = 10;
/** Release body 摘要行数上限。 */
const NOTES_EXCERPT_LINES = 8;

type GitHubRelease = {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  prerelease?: boolean;
  draft?: boolean;
  published_at?: string;
};

export type UpdaterOptions = {
  currentVersion: string;
  readSettings: () => Promise<AppSettings>;
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>;
  /** 每次状态落定后广播（主进程转发给渲染进程）。 */
  onStatus: (outcome: UpdateCheckOutcome) => void;
};

export class UpdateChecker {
  private readonly opts: UpdaterOptions;
  private lastOutcome: UpdateCheckOutcome = { state: "idle", checkedAt: 0 };
  private lastFinishedAt = 0;
  private inFlight: Promise<UpdateCheckOutcome> | undefined;

  constructor(opts: UpdaterOptions) {
    this.opts = opts;
  }

  getState(): UpdateCheckOutcome {
    return this.lastOutcome;
  }

  /**
   * 执行检查。force=true（手动按钮）绕过设置开关与节流；否则开关关闭直接返回 disabled、
   * 距上次检查不足 10 分钟返回缓存结果。
   */
  async check(force: boolean): Promise<UpdateCheckOutcome> {
    if (this.inFlight) return this.inFlight;
    if (!force) {
      const settings = await this.opts.readSettings();
      if (settings.checkUpdatesEnabled === false) {
        return this.settle({ state: "disabled", checkedAt: Date.now() });
      }
      if (this.lastFinishedAt > 0 && Date.now() - this.lastFinishedAt < THROTTLE_INTERVAL_MS) {
        return this.lastOutcome;
      }
    }
    const task = this.runCheck().finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = task;
    return task;
  }

  /** 忽略指定版本：持久化并将当前结果（若匹配）转为 ignored。 */
  async ignoreVersion(version: string): Promise<UpdateCheckOutcome> {
    const settings = await this.opts.readSettings();
    const ignored = new Set(settings.ignoredUpdateVersions ?? []);
    ignored.add(version);
    await this.opts.updateSettings({
      ignoredUpdateVersions: [...ignored].slice(-MAX_IGNORED_VERSIONS)
    });
    const update = this.lastOutcome.update;
    if (this.lastOutcome.state === "available" && update?.latestVersion === version) {
      return this.settle({ state: "ignored", checkedAt: Date.now(), update });
    }
    return this.lastOutcome;
  }

  private async runCheck(): Promise<UpdateCheckOutcome> {
    let release: GitHubRelease;
    try {
      const response = await net.fetch(RELEASES_API_URL, {
        headers: { "User-Agent": "VidFolderBrowser", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      });
      if (!response.ok) {
        return this.settle({ state: "error", checkedAt: Date.now(), error: `HTTP ${response.status}` });
      }
      release = (await response.json()) as GitHubRelease;
    } catch (error) {
      return this.settle({
        state: "error",
        checkedAt: Date.now(),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const tag = typeof release.tag_name === "string" ? release.tag_name : "";
    const parts = parseVersionParts(tag);
    const latestVersion = parts ? parts.join(".") : "";
    if (!tag || !latestVersion || !release.html_url || release.draft) {
      return this.settle({ state: "error", checkedAt: Date.now(), error: "Release 数据不完整" });
    }
    if (release.prerelease || !isNewerVersion(latestVersion, this.opts.currentVersion)) {
      return this.settle({ state: "latest", checkedAt: Date.now() });
    }

    const update: UpdateInfo = {
      currentVersion: this.opts.currentVersion,
      latestVersion,
      latestTag: tag,
      releaseUrl: release.html_url,
      releaseName: release.name,
      releaseNotesExcerpt: excerptNotes(release.body),
      publishedAt: release.published_at
    };
    const settings = await this.opts.readSettings();
    if (settings.ignoredUpdateVersions?.includes(latestVersion)) {
      return this.settle({ state: "ignored", checkedAt: Date.now(), update });
    }
    return this.settle({ state: "available", checkedAt: Date.now(), update });
  }

  private settle(outcome: UpdateCheckOutcome): UpdateCheckOutcome {
    if (outcome.state !== "disabled") {
      this.lastFinishedAt = outcome.checkedAt;
    }
    this.lastOutcome = outcome;
    this.opts.onStatus(outcome);
    return outcome;
  }
}

/** 取 Release body 前几行作为摘要，去掉 markdown 徽章图片等噪声行。 */
function excerptNotes(body: string | undefined): string | undefined {
  if (!body) return undefined;
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("![") && !line.startsWith("[!["));
  return lines.slice(0, NOTES_EXCERPT_LINES).join("\n") || undefined;
}
