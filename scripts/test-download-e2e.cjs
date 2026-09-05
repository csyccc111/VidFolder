/* eslint-disable */
// v0.9 端到端验证（真实网络 + 真实文件系统）：下载 → SHA-256 校验 → 解压 → vendor 探测 → 版本切换。
// 运行：npx electron scripts/test-download-e2e.cjs
const { app } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const TMP = path.join(os.tmpdir(), "vfb-v09-e2e-" + Date.now());

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`, ok ? "" : JSON.stringify(extra));
}

app.setPath("userData", TMP);

// 清理上次运行遗留的临时目录（避免 temp 膨胀）。
fs.readdirSync(os.tmpdir())
  .filter((name) => name.startsWith("vfb-v09-e2e-") && name !== path.basename(TMP))
  .forEach((name) => {
    try {
      fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true });
    } catch {
      /* 被占用则跳过 */
    }
  });

app.whenReady().then(async () => {
  try {
    const { DependencyManager } = await import("../dist-electron/electron/deps.js");

    const settingsStore = {};
    let lastState = null;
    const manager = new DependencyManager({
      userDataDir: TMP,
      readSettings: async () => ({ ...settingsStore }),
      updateSettings: async (partial) => { Object.assign(settingsStore, partial); return { ...settingsStore }; },
      onStatusChanged: (status) => { console.log("status-changed:", JSON.stringify(status)); },
      onDownloadStateChanged: (state) => {
        if (state.phase !== lastState?.phase || state.receivedBytes !== lastState?.receivedBytes) {
          const pct = state.totalBytes > 0 ? Math.round((state.receivedBytes / state.totalBytes) * 100) : 0;
          console.log(`download: ${state.phase} ${pct}% ${(state.bytesPerSecond / 1048576).toFixed(1)}MB/s`);
        }
        lastState = state;
      }
    });

    // 1. 启动探测（开发机 ffmpeg 在 WinGet Packages 目录 → common；若在 PATH 则 path）
    const initial = await manager.initialize();
    check("initial detection finds system ffmpeg", initial.ffmpeg.available === true && (initial.ffmpeg.source === "path" || initial.ffmpeg.source === "common"), initial.ffmpeg);
    check("initial detection finds system ffprobe", initial.ffprobe.available === true && (initial.ffprobe.source === "path" || initial.ffprobe.source === "common"), initial.ffprobe);

    // 2. 触发真实下载，等待完成
    const startedAt = Date.now();
    void manager.startDownload();
    for (;;) {
      await new Promise((r) => setTimeout(r, 500));
      const state = manager.getDownloadState();
      if (state.phase === "done" || state.phase === "failed" || state.phase === "cancelled") break;
      if (Date.now() - startedAt > 10 * 60 * 1000) {
        manager.cancelDownload();
        break;
      }
    }
    const finalState = manager.getDownloadState();
    check("download completes", finalState.phase === "done", finalState);
    check("download finished in reasonable time", Date.now() - startedAt < 10 * 60 * 1000, { elapsedMs: Date.now() - startedAt });

    // 等待"下载完成后自动重探"推送新状态（真实应用由 status-changed 事件驱动 UI）。
    for (let waited = 0; manager.getStatus().ffmpeg.source !== "vendor" && waited < 10000; waited += 200) {
      await new Promise((r) => setTimeout(r, 200));
    }

    // 3. 下载后自动重探：vendor 优先
    const afterDownload = manager.getStatus();
    check("vendor ffmpeg used after download", afterDownload.ffmpeg.available && afterDownload.ffmpeg.source === "vendor", afterDownload.ffmpeg);
    check("vendor ffprobe used after download", afterDownload.ffprobe.available && afterDownload.ffprobe.source === "vendor", afterDownload.ffprobe);
    check("vendor version is n8.1.2", afterDownload.vendor?.version === "n8.1.2" && afterDownload.vendor?.active === true, afterDownload.vendor);
    check("vendor path within userData/vendor", (afterDownload.ffmpeg.resolvedPath ?? "").startsWith(path.join(TMP, "vendor", "ffmpeg")), afterDownload.ffmpeg.resolvedPath);

    // 4. 解析后的绝对路径可真实执行（ffprobe -version）
    const probe = await manager.runTool("ffprobe", ["-version"], 10000);
    check("runTool ffprobe works with vendor binary", /ffprobe version/.test(probe.stdout), probe.stdout.split(/\r?\n/)[0]);

    // 5. 恢复系统版本 → 回到系统来源（path 或 common）；vendor 记录保留为 .bak
    const restored = await manager.restoreSystemVersion();
    check("restore system switches back to system source", (restored.ffmpeg.source === "path" || restored.ffmpeg.source === "common") && restored.vendor?.active === false, restored);
    check("vendor backup record exists", fs.existsSync(path.join(TMP, "vendor", "ffmpeg", "version.json.bak")));

    // 6. 手动指定路径覆盖（vendor 停用时优先于系统来源）
    const systemPath = restored.ffmpeg.resolvedPath;
    const custom = await manager.setCustomPath("ffmpeg", systemPath);
    check("custom ffmpeg path takes precedence over system", custom.ffmpeg.source === "custom" && (custom.ffprobe.source === "path" || custom.ffprobe.source === "common"), custom);
    const cleared = await manager.setCustomPath("ffmpeg", undefined);
    check("clearing custom path falls back to system", cleared.ffmpeg.source === "path" || cleared.ffmpeg.source === "common", cleared);

    // 7. 重新启用应用内版本 → 回到 vendor
    const reEnabled = await manager.enableVendorVersion();
    check("re-enable vendor switches back", reEnabled.ffmpeg.source === "vendor" && reEnabled.vendor?.active === true, reEnabled);

    // 8. 持久化记录已写入 settings
    check("resolvedDependencies persisted", Boolean(settingsStore.resolvedDependencies?.ffmpeg?.path), settingsStore.resolvedDependencies);

    const failed = checks.filter((entry) => !entry.ok);
    console.log(JSON.stringify({ total: checks.length, failed: failed.length }, null, 2));
    fs.mkdirSync(path.join(__dirname, "smoke-out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "smoke-out", "v09-e2e.json"), JSON.stringify({ checks }, null, 2));
    app.quit();
    setTimeout(() => process.exit(failed.length > 0 ? 1 : 0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
