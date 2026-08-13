/* eslint-disable */
// v0.6 冒烟：真实 PreviewService + 真实 ffmpeg 生成帧，前端 DOM 模拟 hover 交互。
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

protocol.registerSchemesAsPrivileged([
  { scheme: "preview", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

const TMP = path.join(os.tmpdir(), "vfb-v06-smoke-" + Date.now());
const VIDEO = path.join(TMP, "test-timeline.mp4");
const CACHE = path.join(TMP, "preview-cache");

const checks = [];
function check(name, ok, extra) {
  checks.push({ name, ok, extra });
}

const VIDEO_ID = "demo1";

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
    const results = [];
    service.onResult = (result) => results.push(result);

    // ---- 主进程侧验证 ----
    await service.request({ requestId: "r1", videoId: VIDEO_ID, filePath: VIDEO });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const firstResult = results.find((r) => r.requestId === "r1" && r.state !== "loading");

    check("preview generates ready result", firstResult?.state === "ready", firstResult?.state);
    check("8 frames with ascending timestamps", (() => {
      if (!firstResult || firstResult.frames.length !== 8) return false;
      for (let i = 1; i < firstResult.frames.length; i++) {
        if (firstResult.frames[i].timestamp <= firstResult.frames[i - 1].timestamp) return false;
      }
      return true;
    })(), firstResult?.frames?.map((f) => f.timestamp));
    check("frame files exist and are valid JPEG", (() => {
      if (!firstResult) return false;
      const key = firstResult.sourceKey;
      return firstResult.frames.every((frame) => {
        const file = path.join(CACHE, key, frame.imageUrl.split("/").pop());
        if (!fs.existsSync(file)) return false;
        const buf = fs.readFileSync(file);
        return buf.length > 100 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
      });
    })());

    // 缓存命中：第二次请求直接 ready
    results.length = 0;
    const t0 = Date.now();
    await service.request({ requestId: "r2", videoId: VIDEO_ID, filePath: VIDEO });
    const hitResult = results.find((r) => r.requestId === "r2" && r.state !== "loading");
    check("cache hit returns immediately", hitResult?.state === "ready" && Date.now() - t0 < 500, { elapsed: Date.now() - t0 });

    // 同 key 合并：生成中再次请求，两个 waiter 都收到 ready
    const video2 = path.join(TMP, "test-second.mp4");
    fs.copyFileSync(VIDEO, video2);
    results.length = 0;
    await service.request({ requestId: "r3", videoId: "v2", filePath: video2 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await service.request({ requestId: "r4", videoId: "v3", filePath: video2 });
    await new Promise((resolve) => setTimeout(resolve, 4000));
    const merged = results.filter((r) => r.state === "ready");
    check("same-source requests both receive ready", merged.length === 2 && merged.every((r) => r.state === "ready"), merged.map((r) => r.requestId));

    // 取消：运行中的任务不再向已取消 waiter 发送结果
    const video3 = path.join(TMP, "test-third.mp4");
    fs.copyFileSync(VIDEO, video3);
    results.length = 0;
    await service.request({ requestId: "r5", videoId: "v4", filePath: video3 });
    service.cancel("r5");
    await new Promise((resolve) => setTimeout(resolve, 4000));
    check("cancelled request emits no ready", !results.some((r) => r.requestId === "r5" && r.state === "ready"), results.map((r) => r.requestId));

    // 非法扩展名拒绝
    results.length = 0;
    await service.request({ requestId: "r6", videoId: "v5", filePath: path.join(TMP, "evil.txt") });
    await new Promise((resolve) => setTimeout(resolve, 100));
    check("unknown extension rejected", results.find((r) => r.requestId === "r6")?.state === "failed", results.find((r) => r.requestId === "r6"));

    // 清理
    const cleared = await service.clear();
    check("clear empties cache", cleared.videoCount === 0 && cleared.bytes === 0, cleared);

    // ---- 前端 DOM 交互验证（真实 PreviewService + preview 协议） ----
    const receivedRequests = [];
    ipcMain.handle("settings:get", () => ({
      lastFolder: "C:\\Videos", viewMode: "grid", sortKey: "fileName", ascending: true,
      thumbSize: "medium", sidebarOpen: true, sidebarWidth: 260, detailPaneOpen: false,
      hoverPreviewEnabled: true, recentFolders: []
    }));
    ipcMain.handle("settings:update", () => ({}));
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
      service.cancel(requestId);
    });
    ipcMain.handle("preview:stats", async () => service.stats());
    ipcMain.handle("preview:clear", async () => service.clear());
    service.onResult = (result) => win?.webContents.send("preview:result", result);

    const win = new BrowserWindow({
      width: 1280, height: 800, show: false, backgroundColor: "#101216",
      webPreferences: {
        preload: path.join(__dirname, "../dist-electron/electron/preload.cjs"),
        contextIsolation: true, nodeIntegration: false, backgroundThrottling: false
      }
    });
    const errors = [];
    win.webContents.on("console-message", (_e, details) => {
      const message = typeof details === "string" ? details : details?.message ?? "";
      if (message.toLowerCase().includes("error")) errors.push(message);
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
    win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 1, processed: 1, thumbnailsReady: 1, failures: 0, message: "扫描完成", warningCount: 0, warnings: [] });
    win.webContents.send("scan:item", {
      id: VIDEO_ID, filePath: VIDEO, fileName: "演示视频.mp4", directory: "C:\\Videos\\电影",
      extension: ".mp4", size: fs.statSync(VIDEO).size, modifiedAt: Date.now(),
      duration: 5, width: 640, height: 360, thumbnailStatus: "pending", metadataStatus: "ready"
    });
    await new Promise((r) => setTimeout(r, 600));

    // hover 卡片 → 400ms 延迟后发起请求 → 帧就绪
    await evalSafe(`(() => {
      document.querySelector('[role="gridcell"] article').dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10, relatedTarget: null }));
      return true;
    })()`);
    await new Promise((r) => setTimeout(r, 4000));
    check("hover activates preview request", receivedRequests.length === 1 && receivedRequests[0].videoId === VIDEO_ID, receivedRequests);

    // 帧就绪后移动鼠标 → 预览帧渲染 + 时间角标
    const move = await evalSafe(`(async () => {
      try {
        const card = document.querySelector('[role="gridcell"] article');
        const rect = card.getBoundingClientRect();
        card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * 0.9, clientY: rect.top + 10 }));
        await new Promise(r => setTimeout(r, 300));
        const img = card.querySelector('.pointer-events-none img');
        const badge = card.querySelector('span.font-mono');
        return { hasPreviewImg: Boolean(img), src: img ? img.src.slice(0, 80) : null, badge: badge ? badge.textContent : null };
      } catch (error) {
        return { innerError: String(error) };
      }
    })()`);
    check("preview frame rendered on move", move.hasPreviewImg && /preview:/.test(move.src || ""), move);

    // 鼠标移动到左侧 → 帧切换
    const moveLeft = await evalSafe(`(async () => {
      const card = document.querySelector('[role="gridcell"] article');
      const rect = card.getBoundingClientRect();
      card.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + rect.width * 0.1, clientY: rect.top + 10 }));
      await new Promise(r => setTimeout(r, 300));
      const img = card.querySelector('.pointer-events-none img');
      return { src: img ? img.src : null };
    })()`);
    check("mouse x maps to different frame", moveLeft.src !== move.src, { before: move.src, after: moveLeft.src });

    // 鼠标离开 → 恢复主封面
    const leave = await evalSafe(`(async () => {
      const card = document.querySelector('[role="gridcell"] article');
      card.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: null }));
      await new Promise(r => setTimeout(r, 300));
      const img = card.querySelector('.pointer-events-none img');
      return { previewGone: !img };
    })()`);
    check("pointerleave restores static cover", leave.previewGone, leave);

    // 开关关闭后 hover 不再发起请求
    const beforeToggle = receivedRequests.length;
    await evalSafe(`(async () => {
      document.querySelector('button[aria-label="切换悬停预览"]').click();
      await new Promise(r => setTimeout(r, 200));
      const card = document.querySelector('[role="gridcell"] article');
      card.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: 10, clientY: 10, relatedTarget: null }));
      await new Promise(r => setTimeout(r, 600));
      card.dispatchEvent(new PointerEvent('pointerout', { bubbles: true, relatedTarget: null }));
      return true;
    })()`);
    check("toggle off blocks preview requests", receivedRequests.length === beforeToggle, { beforeToggle, now: receivedRequests.length });

    console.log(JSON.stringify({ checks, errors }, null, 2));
    fs.writeFileSync(path.join(__dirname, "smoke-out", "preview-checks.json"), JSON.stringify({ checks, errors }, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
