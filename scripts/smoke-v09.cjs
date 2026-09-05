/* eslint-disable */
// v0.9 冒烟：依赖对话框 UI 全状态（缺失/下载中/失败/完成）+ 状态栏细化徽标。
// 运行：npx electron scripts/smoke-v09.cjs
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");

const TMP = path.join(os.tmpdir(), "vfb-v09-smoke-" + Date.now());
const MANIFEST_BYTES = 80069474;

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok, extra });
}

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED REJECTION:", reason instanceof Error ? reason.stack : reason);
  process.exit(1);
});

function missingStatus() {
  return {
    ffmpeg: { available: false, error: "未检测到" },
    ffprobe: { available: false, error: "未检测到" },
    checkedAt: Date.now()
  };
}

function vendorStatus() {
  return {
    ffmpeg: { available: true, version: "n8.1.2-50-g1a748fe2cd", source: "vendor", resolvedPath: "C:\\vendor\\n8.1.2\\bin\\ffmpeg.exe" },
    ffprobe: { available: true, version: "n8.1.2-50-g1a748fe2cd", source: "vendor", resolvedPath: "C:\\vendor\\n8.1.2\\bin\\ffprobe.exe" },
    checkedAt: Date.now(),
    vendor: { version: "n8.1.2", active: true }
  };
}

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    let customPaths = {};
    const calls = { redetect: 0, downloadStart: 0, downloadCancel: 0, restoreSystem: 0, setCustomPath: 0 };

    const settings = {
      lastFolder: null, viewMode: "grid", sortKey: "modifiedAt", ascending: false,
      thumbSize: "medium", sidebarOpen: true, sidebarWidth: 260, detailPaneOpen: true, recentFolders: []
    };
    ipcMain.handle("settings:get", () => ({ ...settings, customFfmpegPath: customPaths.ffmpeg, customFfprobePath: customPaths.ffprobe }));
    ipcMain.handle("settings:update", (_e, next) => { Object.assign(settings, next); if (next.customFfmpegPath !== undefined) customPaths.ffmpeg = next.customFfmpegPath; if (next.customFfprobePath !== undefined) customPaths.ffprobe = next.customFfprobePath; return settings; });
    ipcMain.handle("dependencies:get", () => missingStatus());
    ipcMain.handle("deps:redetect", () => { calls.redetect += 1; return missingStatus(); });
    ipcMain.handle("deps:download-start", () => { calls.downloadStart += 1; return undefined; });
    ipcMain.handle("deps:download-cancel", () => { calls.downloadCancel += 1; return undefined; });
    ipcMain.handle("deps:download-state", () => ({ phase: "idle", receivedBytes: 0, totalBytes: 0, bytesPerSecond: 0 }));
    ipcMain.handle("deps:restore-system", () => { calls.restoreSystem += 1; return missingStatus(); });
    ipcMain.handle("deps:enable-vendor", () => vendorStatus());
    ipcMain.handle("deps:set-custom-path", (_e, tool, filePath) => { calls.setCustomPath += 1; if (tool === "ffmpeg") customPaths.ffmpeg = filePath; else customPaths.ffprobe = filePath; return missingStatus(); });
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

    // 1. 缺失状态：状态栏徽标 + 提示条下载按钮
    const missing = await evalSafe(`(() => {
      const footer = document.querySelector('footer');
      const text = footer ? footer.textContent : '';
      const noticeBtn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('下载 ffmpeg'));
      return { hasMissingFfmpeg: text.includes('缺少 ffmpeg'), hasMissingFfprobe: text.includes('缺少 ffprobe'), hasNoticeDownloadBtn: Boolean(noticeBtn) };
    })()`);
    check("missing state: status bar badges + notice download button", missing.hasMissingFfmpeg && missing.hasMissingFfprobe && missing.hasNoticeDownloadBtn, missing);

    // 2. 打开依赖对话框（经提示条按钮）
    const dialogOpen = await evalSafe(`(async () => {
      const noticeBtn = [...document.querySelectorAll('button')].find(b => (b.textContent || '').includes('下载 ffmpeg'));
      noticeBtn.click();
      await new Promise(r => setTimeout(r, 400));
      const dialog = document.querySelector('[role="dialog"]');
      const rows = dialog ? dialog.querySelectorAll('[data-dep-tool]') : [];
      const downloadBtn = dialog ? [...dialog.querySelectorAll('button')].find(b => (b.textContent || '').includes('下载 ffmpeg')) : undefined;
      return {
        open: Boolean(dialog),
        rows: rows.length,
        rowsMissing: [...rows].every(row => row.textContent.includes('未检测到')),
        hasDownloadBtn: Boolean(downloadBtn),
        hasRedetect: dialog ? [...dialog.querySelectorAll('button')].some(b => (b.textContent || '').includes('重新检测')) : false
      };
    })()`);
    check("dialog: opens with two missing tool rows + download + redetect", dialogOpen.open && dialogOpen.rows === 2 && dialogOpen.rowsMissing && dialogOpen.hasDownloadBtn && dialogOpen.hasRedetect, dialogOpen);

    // 3. 点下载 → 主进程收到 download-start；注入下载进度
    await evalSafe(`(async () => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')].find(b => (b.textContent || '').includes('下载 ffmpeg（约'));
      btn.click();
      await new Promise(r => setTimeout(r, 200));
    })()`);
    check("download-start reached main process once", calls.downloadStart === 1, calls);
    win.webContents.send("deps:download-progress", { phase: "downloading", receivedBytes: Math.floor(MANIFEST_BYTES * 0.5), totalBytes: MANIFEST_BYTES, bytesPerSecond: 5 * 1024 * 1024 });
    await new Promise((r) => setTimeout(r, 300));
    const downloading = await evalSafe(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog ? dialog.textContent : '';
      const cancel = [...(dialog?.querySelectorAll('button') ?? [])].find(b => (b.textContent || '').includes('取消下载'));
      return { showsDownloading: text.includes('下载中'), showsSpeed: /\\/s/.test(text), showsHalf: text.includes('38.1') || text.includes('40.0') || text.includes('38'), hasCancel: Boolean(cancel) };
    })()`);
    check("downloading: phase text + speed + cancel button", downloading.showsDownloading && downloading.showsSpeed && downloading.hasCancel, downloading);

    // 4. 失败状态：错误文案 + 重试
    win.webContents.send("deps:download-progress", { phase: "failed", receivedBytes: 0, totalBytes: 0, bytesPerSecond: 0, error: { category: "download_failed", message: "下载失败，请检查网络后重试" } });
    await new Promise((r) => setTimeout(r, 300));
    const failed = await evalSafe(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const text = dialog ? dialog.textContent : '';
      const retry = [...(dialog?.querySelectorAll('button') ?? [])].find(b => (b.textContent || '').includes('重试下载'));
      return { showsError: text.includes('下载失败，请检查网络后重试'), hasRetry: Boolean(retry) };
    })()`);
    check("failed: error message + retry button", failed.showsError && failed.hasRetry, failed);

    // 5. 下载完成 → 推送 vendor 状态：徽标细化 + 对话框切换
    win.webContents.send("deps:status-changed", vendorStatus());
    win.webContents.send("deps:download-progress", { phase: "done", receivedBytes: MANIFEST_BYTES, totalBytes: MANIFEST_BYTES, bytesPerSecond: 0 });
    await new Promise((r) => setTimeout(r, 300));
    const vendor = await evalSafe(`(() => {
      const footer = document.querySelector('footer');
      const footerText = footer ? footer.textContent : '';
      const dialog = document.querySelector('[role="dialog"]');
      const dialogText = dialog ? dialog.textContent : '';
      const rows = dialog ? dialog.querySelectorAll('[data-dep-tool]') : [];
      const restoreBtn = [...(dialog?.querySelectorAll('button') ?? [])].find(b => (b.textContent || '').includes('恢复系统版本'));
      return {
        footerVendor: footerText.includes('应用内') && footerText.includes('n8.1.2'),
        rowsVendor: [...rows].every(row => row.textContent.includes('应用内')),
        restoreEnabled: restoreBtn ? !restoreBtn.disabled : false,
        doneText: dialogText.includes('下载完成')
      };
    })()`);
    check("vendor active: status bar + dialog rows + restore enabled", vendor.footerVendor && vendor.rowsVendor && vendor.restoreEnabled && vendor.doneText, vendor);

    // 6. 恢复系统版本 → 主进程收到调用；状态回到缺失（stub 返回 missing）
    await evalSafe(`(async () => {
      const btn = [...document.querySelectorAll('[role="dialog"] button')].find(b => (b.textContent || '').includes('恢复系统版本'));
      btn.click();
      await new Promise(r => setTimeout(r, 300));
    })()`);
    check("restore-system reached main process", calls.restoreSystem === 1, calls);

    // 7. 手动指定路径：输入回车 → set-custom-path 到主进程（React 受控输入需原生 setter 注入）
    const custom = await evalSafe(`(async () => {
      const dialog = document.querySelector('[role="dialog"]');
      const input = dialog.querySelector('input[aria-label="ffmpeg 自定义路径"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'D:\\\\tools\\\\ffmpeg.exe');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      return true;
    })()`);
    check("custom path set reached main process", custom === true && calls.setCustomPath === 1 && customPaths.ffmpeg === "D:\\tools\\ffmpeg.exe", { calls, customPaths });

    // 8. 关闭对话框不中断下载：注入 downloading 后关闭，进度仍更新（不报错即可）
    win.webContents.send("deps:download-progress", { phase: "downloading", receivedBytes: 1024, totalBytes: MANIFEST_BYTES, bytesPerSecond: 1024 });
    await evalSafe(`(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await new Promise(r => setTimeout(r, 200));
    })()`);
    win.webContents.send("deps:download-progress", { phase: "downloading", receivedBytes: 2048, totalBytes: MANIFEST_BYTES, bytesPerSecond: 2048 });
    await new Promise((r) => setTimeout(r, 200));
    check("download events after dialog close do not crash", errors.length === 0, errors);

    console.log(JSON.stringify({ checks, errors }, null, 2));
    fs.mkdirSync(path.join(__dirname, "smoke-out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "smoke-out", "v09-checks.json"), JSON.stringify({ checks, errors }, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
