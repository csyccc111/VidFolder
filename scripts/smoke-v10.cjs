/* eslint-disable */
// v0.10 冒烟：更新检查对话框全状态 + 工具栏入口（真实 Electron，stub IPC）。
// 运行：npx electron scripts/smoke-v10.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = path.join(os.tmpdir(), "vfb-v10-smoke-" + Date.now());

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok, extra });
}

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED REJECTION:", reason instanceof Error ? reason.stack : reason);
  process.exit(1);
});

function outcome(state, extra = {}) {
  return { state, checkedAt: Date.now(), ...extra };
}

const AVAILABLE = outcome("available", {
  update: {
    currentVersion: "0.10.0",
    latestVersion: "0.11.0",
    latestTag: "v0.11.0",
    releaseUrl: "https://github.com/csyccc111/VidFolder/releases/tag/v0.11.0",
    releaseName: "Vid Folder Browser v0.11.0",
    releaseNotesExcerpt: "## 新功能\n- 筛选排序增强\n- 虚拟滚动",
    publishedAt: "2026-10-01T00:00:00Z"
  }
});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    const calls = { check: [], ignore: [], openRelease: [], settingsUpdate: [] };
    // 队列：每次 check 弹出一个结果。
    const queue = [outcome("latest"), AVAILABLE, outcome("error", { error: "HTTP 403" })];

    const settings = { viewMode: "grid", recentFolders: [], checkUpdatesEnabled: true };
    ipcMain.handle("settings:get", () => settings);
    ipcMain.handle("settings:update", (_e, next) => { Object.assign(settings, next); calls.settingsUpdate.push(next); return settings; });
    ipcMain.handle("dependencies:get", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("deps:redetect", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("deps:download-start", () => undefined);
    ipcMain.handle("deps:download-cancel", () => undefined);
    ipcMain.handle("deps:download-state", () => ({ phase: "idle", receivedBytes: 0, totalBytes: 0, bytesPerSecond: 0 }));
    ipcMain.handle("deps:restore-system", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("deps:enable-vendor", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("deps:set-custom-path", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("update:check", (_e, force) => { calls.check.push(force); return queue.length > 0 ? queue.shift() : outcome("latest"); });
    ipcMain.handle("update:state", () => ({ state: "idle", checkedAt: 0 }));
    ipcMain.handle("update:ignore", (_e, version) => { calls.ignore.push(version); return outcome("ignored", { update: AVAILABLE.update }); });
    ipcMain.handle("update:open-release", (_e, url) => { calls.openRelease.push(url); return undefined; });
    ipcMain.handle("folder:validate", () => ({ exists: true, isDirectory: true }));
    ipcMain.handle("folder:choose", () => undefined);
    ipcMain.handle("folder:show-in-explorer", () => undefined);
    ipcMain.handle("scan:start", () => undefined);
    ipcMain.handle("scan:cancel", () => undefined);
    ipcMain.handle("video:context-action", () => undefined);

    const win = new BrowserWindow({
      width: 1280, height: 800, show: false, backgroundColor: "#101216",
      webPreferences: {
        preload: path.join(__dirname, "../dist-electron/electron/preload.cjs"),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    const errors = [];
    win.webContents.on("console-message", (_e, level, message) => {
      const text = String(message ?? "");
      if (String(level) === "3" || text.toLowerCase().includes("error")) errors.push(text.slice(0, 300));
    });
    const evalSafe = async (code) => {
      try {
        return await win.webContents.executeJavaScript(code);
      } catch (error) {
        return { evalError: String(error) };
      }
    };
    await win.loadFile(path.join(__dirname, "../dist/index.html"));
    await new Promise((r) => setTimeout(r, 800));
    win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 0, processed: 0, thumbnailsReady: 0, failures: 0, message: "扫描完成", warningCount: 0, warnings: [] });
    await new Promise((r) => setTimeout(r, 300));

    // 1. 工具栏入口存在，点击 → 打开对话框并自动触发一次手动检查（force=true）
    const entry = await evalSafe(`(async () => {
      const btn = document.querySelector('button[aria-label="检查更新"]');
      if (!btn) return { found: false };
      btn.click();
      await new Promise(r => setTimeout(r, 500));
      const dialog = document.querySelector('[data-update-state]');
      return { found: true, dialogOpen: Boolean(dialog), state: dialog?.getAttribute('data-update-state') };
    })()`);
    check("toolbar entry opens dialog and triggers manual check", entry.found && entry.dialogOpen && entry.state === "latest" && calls.check[0] === true, { entry, calls });

    // 2. available 状态：立即检查 → 新版本 + 摘要 + 两个按钮
    const available = await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      const btn = [...dialog.querySelectorAll('button')].find(b => (b.textContent || '').includes('立即检查'));
      btn.click();
      await new Promise(r => setTimeout(r, 500));
      const text = document.querySelector('[data-update-state]').textContent;
      return {
        state: document.querySelector('[data-update-state]').getAttribute('data-update-state'),
        showsVersion: text.includes('v0.11.0') && text.includes('v0.10.0'),
        showsNotes: text.includes('虚拟滚动'),
        hasOpenRelease: [...dialog.querySelectorAll('button')].some(b => (b.textContent || '').includes('打开下载页')),
        hasIgnore: [...dialog.querySelectorAll('button')].some(b => (b.textContent || '').includes('忽略此版本'))
      };
    })()`);
    check("available: version + notes + open/ignore buttons", available.state === "available" && available.showsVersion && available.showsNotes && available.hasOpenRelease && available.hasIgnore, available);

    // 3. 点击打开下载页（github 链接放行）
    await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      [...dialog.querySelectorAll('button')].find(b => (b.textContent || '').includes('打开下载页')).click();
      await new Promise(r => setTimeout(r, 300));
    })()`);
    check("open release page reached main with github url", calls.openRelease[0] === AVAILABLE.update.releaseUrl, calls.openRelease);

    // 4. 忽略此版本 → 主进程收到版本号，UI 转 ignored
    const ignored = await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      [...dialog.querySelectorAll('button')].find(b => (b.textContent || '').includes('忽略此版本')).click();
      await new Promise(r => setTimeout(r, 400));
      const panel = document.querySelector('[data-update-state]');
      return { state: panel.getAttribute('data-update-state'), text: panel.textContent };
    })()`);
    check("ignore reached main and state becomes ignored", calls.ignore[0] === "0.11.0" && ignored.state === "ignored" && ignored.text.includes("已被忽略"), { calls, ignored });

    // 5. error 状态：检查失败文案 + 重试按钮
    const errored = await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      [...dialog.querySelectorAll('button')].find(b => (b.textContent || '').includes('立即检查')).click();
      await new Promise(r => setTimeout(r, 500));
      const panel = document.querySelector('[data-update-state]');
      return { state: panel.getAttribute('data-update-state'), text: panel.textContent };
    })()`);
    check("error state shows silent failure + retry", errored.state === "error" && errored.text.includes("检查失败"), errored);

    // 6. 自动检查开关 → settings:update 持久化 checkUpdatesEnabled
    const toggled = await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      const toggle = dialog.querySelector('button[aria-label="启动时自动检查更新"]');
      toggle.click();
      await new Promise(r => setTimeout(r, 300));
      return true;
    })()`);
    const lastSetting = calls.settingsUpdate[calls.settingsUpdate.length - 1] ?? {};
    check("auto-check toggle persists setting", toggled === true && lastSetting.checkUpdatesEnabled === false, { lastSetting });

    check("no console errors", errors.length === 0, errors);

    console.log(JSON.stringify({ checks, errors }, null, 2));
    fs.mkdirSync(path.join(__dirname, "smoke-out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "smoke-out", "v10-checks.json"), JSON.stringify({ checks, errors }, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
