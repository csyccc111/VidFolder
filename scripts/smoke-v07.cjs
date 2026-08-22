/* eslint-disable */
// v0.7 冒烟：列表视图悬停胶片预览（真实 PreviewService + ffmpeg）。
// 运行：npx electron scripts/smoke-v07.cjs
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

protocol.registerSchemesAsPrivileged([
  { scheme: "preview", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const TMP = path.join(os.tmpdir(), "vfb-v07-smoke-" + Date.now());
const VIDEO = path.join(TMP, "list-demo.mp4");
const CACHE = path.join(TMP, "preview-cache");

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok, extra });
}

process.on("unhandledRejection", (reason) => {
  console.log("UNHANDLED REJECTION:", reason instanceof Error ? reason.stack : reason);
  process.exit(1);
});

app.whenReady().then(async () => {
  try {
    fs.mkdirSync(TMP, { recursive: true });
    execFileSync("ffmpeg", [
      "-y", "-f", "lavfi", "-i", "testsrc2=duration=5:size=640x360:rate=12",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", VIDEO
    ], { stdio: "ignore" });
    const videoStat = fs.statSync(VIDEO);

    // ---- 前端 DOM：列表视图悬停预览 ----
    const { PreviewService } = await import("../dist-electron/electron/preview.js");
    const service = new PreviewService({
      cacheDir: CACHE,
      isKnownVideoPath: () => true,
      getDuration: () => 5,
      probeDuration: async () => 5,
      isFfmpegAvailable: () => true
    });
    await service.initialize();
    service.registerProtocol();

    const receivedRequests = [];
    const cancelledRequests = [];
    const settings = {
      lastFolder: "C:\\Videos", viewMode: "list", sortKey: "fileName", ascending: true,
      thumbSize: "medium", sidebarOpen: true, sidebarWidth: 260, detailPaneOpen: false,
      hoverPreviewEnabled: true, recentFolders: []
    };
    ipcMain.handle("settings:get", () => settings);
    ipcMain.handle("settings:update", (_e, next) => { Object.assign(settings, next); return settings; });
    ipcMain.handle("dependencies:get", () => ({ ffmpeg: { available: true }, ffprobe: { available: true }, checkedAt: Date.now() }));
    ipcMain.handle("folder:validate", () => ({ exists: true, isDirectory: true }));
    ipcMain.handle("folder:choose", () => undefined);
    ipcMain.handle("folder:show-in-explorer", () => undefined);
    ipcMain.handle("scan:start", () => undefined);
    ipcMain.handle("scan:cancel", () => undefined);
    ipcMain.handle("video:context-action", () => undefined);
    ipcMain.handle("preview:request", async (_e, req) => {
      receivedRequests.push(req);
      await service.request(req);
    });
    ipcMain.handle("preview:cancel", async (_e, requestId) => {
      cancelledRequests.push(requestId);
      service.cancel(requestId);
    });
    ipcMain.handle("preview:stats", async () => service.stats());
    ipcMain.handle("preview:clear", async () => service.clear());
    service.onResult = (result) => {
      console.log("PREVIEW RESULT:", result.requestId, result.state, result.frames?.length, result.error?.message ?? "");
      win?.webContents.send("preview:result", result);
    };

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
    win.webContents.on("render-process-gone", (_e, details) => {
      errors.push(`render-process-gone: ${details?.reason ?? "unknown"}`);
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
    win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 2, processed: 2, thumbnailsReady: 2, failures: 0, message: "扫描完成", warningCount: 0, warnings: [] });
    win.webContents.send("scan:item", {
      id: "demo1", filePath: VIDEO, fileName: "列表演示视频.mp4", directory: "C:\\Videos\\电影",
      extension: ".mp4", size: videoStat.size, modifiedAt: Date.now(),
      duration: 5, width: 640, height: 360,
      thumbnailPath: `thumb://cache/${"a".repeat(40)}.jpg`, thumbnailStatus: "ready", metadataStatus: "ready"
    });
    win.webContents.send("scan:item", {
      id: "demo2", filePath: path.join(TMP, "plain.mp4"), fileName: "第二行视频.mp4", directory: "C:\\Videos",
      extension: ".mp4", size: 12345, modifiedAt: Date.now(),
      duration: 8, width: 640, height: 360, thumbnailStatus: "pending", metadataStatus: "pending"
    });
    await new Promise((r) => setTimeout(r, 800));

    // 列表行：小缩略图作为预览载体
    const rowCheck = await evalSafe(`(() => {
      const row = document.querySelector('[data-video-id="demo1"]');
      const thumb = row.querySelector('img');
      return { hasThumb: Boolean(thumb), cells: row.querySelectorAll('[role="row"]').length };
    })()`);
    check("list row shows thumbnail", rowCheck.hasThumb, rowCheck);

    // 悬停行 → 400ms 后发起预览请求
    await evalSafe(`(() => {
      const row = document.querySelector('[data-video-id="demo1"]');
      row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20, relatedTarget: null }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 4000));
    check("list hover activates preview request", receivedRequests.length === 1 && receivedRequests[0].videoId === "demo1", receivedRequests);

    // 帧就绪 → 胶片条浮层出现，含 8 帧
    const filmstrip = await evalSafe(`(async () => {
      await new Promise(r => setTimeout(r, 300));
      const overlay = document.querySelector('[data-video-id="demo1"] .absolute.top-full .pointer-events-auto');
      if (!overlay) return { present: false };
      const imgs = overlay.querySelectorAll('img');
      const time = overlay.querySelector('.font-mono');
      return { present: true, frameCount: imgs.length, time: time ? time.textContent : null, src0: imgs[0] ? imgs[0].src.slice(0, 70) : null };
    })()`);
    check("filmstrip overlay with 8 frames appears", filmstrip.present && filmstrip.frameCount === 8 && /preview:/.test(filmstrip.src0 || ""), filmstrip);

    // 鼠标在浮层内水平移动 → 切换帧并高亮
    const switchFrame = await evalSafe(`(async () => {
      const row = document.querySelector('[data-video-id="demo1"]');
      const overlay = row.querySelector('.absolute.top-full .pointer-events-auto');
      const rect = overlay.getBoundingClientRect();
      const before = row.querySelector('.ring-2.ring-sky-400');
      row.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * 0.9, clientY: rect.top + 5 }));
      await new Promise(r => setTimeout(r, 300));
      const after = row.querySelector('.ring-2.ring-sky-400');
      const time = overlay.querySelector('.font-mono');
      return { switched: Boolean(before) && Boolean(after) && before !== after, time: time ? time.textContent : null };
    })()`);
    check("pointer move switches frame and highlight", switchFrame.switched, switchFrame);

    // 排序变化 → 预览立即关闭
    const sortClose = await evalSafe(`(async () => {
      document.querySelector('[role="row"] button').click();
      await new Promise(r => setTimeout(r, 300));
      const overlay = document.querySelector('[data-video-id="demo1"] .absolute.top-full .pointer-events-auto');
      return { gone: !overlay };
    })()`);
    check("sort change closes filmstrip", sortClose.gone, sortClose);

    // 再次悬停 → 缓存命中快速出浮层；然后滚动 main → 关闭
    await evalSafe(`(() => {
      const row = document.querySelector('[data-video-id="demo1"]');
      row.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 20, clientY: 20, relatedTarget: null }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 1200));
    const scrollClose = await evalSafe(`(async () => {
      const main = document.querySelector('main');
      const before = Boolean(main.querySelector('[data-video-id="demo1"] .absolute.top-full .pointer-events-auto'));
      main.dispatchEvent(new Event('scroll'));
      await new Promise(r => setTimeout(r, 300));
      const after = Boolean(main.querySelector('[data-video-id="demo1"] .absolute.top-full .pointer-events-auto'));
      return { before, after };
    })()`);
    check("scroll closes filmstrip", scrollClose.before && !scrollClose.after, scrollClose);

    // 网格视图下悬停预览仍正常（回归）
    const gridRegress = await evalSafe(`(async () => {
      document.querySelector('button[aria-label="网格视图"]').click();
      await new Promise(r => setTimeout(r, 300));
      const card = document.querySelector('[data-video-id="demo1"] article');
      card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10, relatedTarget: null }));
      await new Promise(r => setTimeout(r, 1200));
      const previewImg = card.querySelector('.pointer-events-none img');
      return { previewOk: Boolean(previewImg) };
    })()`);
    check("grid preview still works after list", gridRegress.previewOk, gridRegress);

    console.log(JSON.stringify({ checks, errors }, null, 2));
    fs.mkdirSync(path.join(__dirname, "smoke-out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "smoke-out", "v07-checks.json"), JSON.stringify({ checks, errors }, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
