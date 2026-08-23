/* eslint-disable */
// v0.8 冒烟：技术信息深度解析（真实 ffprobe）+ 详情技术区块 + 列表编码列。
// 运行：npx electron scripts/smoke-v08.cjs
const { app, BrowserWindow, ipcMain, protocol } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const os = require("node:os");

const TMP = path.join(os.tmpdir(), "vfb-v08-smoke-" + Date.now());
const VIDEO = path.join(TMP, "detail-demo.mp4");

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
      "-f", "lavfi", "-i", "sine=frequency=440:duration=5",
      "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "64k", "-ac", "2", "-shortest", VIDEO
    ], { stdio: "ignore" });
    const videoStat = fs.statSync(VIDEO);

    // ---- 真实 ffprobe → parseMediaInfo ----
    const { parseMediaInfo, formatKbpsText, formatAudioTrackText, formatFrameRateText } = await import("../dist-electron/src/lib/media-info.js");
    const rawOut = execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", VIDEO], { encoding: "utf8" });
    const info = parseMediaInfo(rawOut, videoStat.size);

    check("container parsed as MP4", info.container === "MP4 (isom)" || (info.container || "").startsWith("MP4"), info.container);
    check("video codec parsed (H.264)", (info.videoCodec || "").startsWith("H.264"), info.videoCodec);
    check("codec short name", info.codecShortName === "h264", info.codecShortName);
    check("resolution", info.width === 640 && info.height === 360, { w: info.width, h: info.height });
    check("duration", typeof info.duration === "number" && info.duration > 4 && info.duration <= 6, info.duration);
    check("frame rate ~12fps", typeof info.frameRate === "number" && Math.abs(info.frameRate - 12) < 0.1, info.frameRate);
    check("container bitrate present", typeof info.containerBitrate === "number" && info.containerBitrate > 0, info.containerBitrate);
    check("audio track AAC 2ch", Array.isArray(info.audioTracks) && info.audioTracks.length === 1 && info.audioTracks[0].codec === "AAC" && info.audioTracks[0].channels === 2, info.audioTracks);
    const texts = {
      codecText: info.videoCodec,
      bitrateText: formatKbpsText(info.containerBitrate, info.bitrateEstimated),
      fpsText: formatFrameRateText(info.frameRate),
      trackText: formatAudioTrackText(info.audioTracks?.[0] ?? {})
    };
    check("display texts sane", /kbps|Mbps/.test(texts.bitrateText) && /fps/.test(texts.fpsText) && /AAC/.test(texts.trackText), texts);

    // ---- 前端 DOM：详情技术区块 + 列表编码列 ----
    const settings = {
      lastFolder: "C:\\Videos", viewMode: "list", sortKey: "fileName", ascending: true,
      thumbSize: "medium", sidebarOpen: true, sidebarWidth: 260, detailPaneOpen: true,
      hoverPreviewEnabled: true, showCodecColumn: false, recentFolders: []
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
    ipcMain.handle("preview:request", () => undefined);
    ipcMain.handle("preview:cancel", () => undefined);
    ipcMain.handle("preview:stats", () => ({ bytes: 0, videoCount: 0, frameCount: 0 }));
    ipcMain.handle("preview:clear", () => ({ bytes: 0, videoCount: 0, frameCount: 0 }));

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
    win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 1, processed: 1, thumbnailsReady: 1, failures: 0, message: "扫描完成", warningCount: 0, warnings: [] });
    win.webContents.send("scan:item", {
      id: "detail1", filePath: VIDEO, fileName: "技术详情演示.mp4", directory: "C:\\Videos",
      extension: ".mp4", size: videoStat.size, modifiedAt: Date.now(),
      duration: 5, width: 640, height: 360,
      container: "MP4 (isom)", videoCodec: "H.264 (High, L4.1)", codecShortName: "h264",
      containerBitrate: 320, videoBitrate: 256, bitrateEstimated: false, frameRate: 12,
      audioTracks: [{ codec: "AAC", channels: 2, sampleRate: 44100, language: "chi" }],
      thumbnailPath: `thumb://cache/${"a".repeat(40)}.jpg`, thumbnailStatus: "ready", metadataStatus: "ready"
    });
    await new Promise((r) => setTimeout(r, 600));

    // 点击行 → 详情面板出现；展开技术信息区块
    const detail = await evalSafe(`(async () => {
      document.querySelector('[data-video-id="detail1"]').click();
      await new Promise(r => setTimeout(r, 400));
      const trigger = [...document.querySelectorAll('button')].find(b => b.textContent.includes('技术信息'));
      if (!trigger) return { trigger: false };
      trigger.click();
      await new Promise(r => setTimeout(r, 400));
      const panel = document.querySelector('aside dl') ?? document.querySelector('[role="dialog"] dl');
      const text = panel ? panel.textContent : '';
      return {
        trigger: true,
        container: text.includes('MP4 (isom)'),
        codec: text.includes('H.264 (High, L4.1)'),
        bitrate: text.includes('kbps'),
        fps: text.includes('fps'),
        track: text.includes('AAC 2声道 44.1kHz (chi)')
      };
    })()`);
    check("detail technical section renders", detail.trigger && detail.container && detail.codec && detail.bitrate && detail.fps && detail.track, detail);

    // 列表编码列：默认隐藏 → 打开开关后出现 h264
    const codecColOff = await evalSafe(`(async () => {
      await new Promise(r => setTimeout(r, 300));
      const row = document.querySelector('[data-video-id="detail1"]');
      const spans = row ? row.querySelectorAll('span') : [];
      return [...spans].some(s => s.textContent === 'h264');
    })()`);
    check("codec column hidden by default", !codecColOff, codecColOff);

    const codecColOn = await evalSafe(`(async () => {
      document.querySelector('button[title="筛选"]').click();
      await new Promise(r => setTimeout(r, 400));
      const toggle = [...document.querySelectorAll('button')].find(b => (b.textContent || '').trim() === '编码');
      if (!toggle) return { found: false };
      toggle.click();
      await new Promise(r => setTimeout(r, 500));
      document.body.click();
      await new Promise(r => setTimeout(r, 400));
      const row = document.querySelector('[data-video-id="detail1"]');
      const spans = row ? row.querySelectorAll('span') : [];
      return { found: true, hasCodec: [...spans].some(s => s.textContent === 'h264') };
    })()`);
    check("codec column appears after toggle", codecColOn.found && codecColOn.hasCodec, codecColOn);
    check("codec column persisted to settings", settings.showCodecColumn === true, settings.showCodecColumn);

    // 未知字段兜底：无音轨视频显示"无音轨"，字段缺失显示"未知"
    win.webContents.send("scan:item", {
      id: "detail2", filePath: path.join(TMP, "silent.mp4"), fileName: "无声视频.mp4", directory: "C:\\Videos",
      extension: ".mp4", size: 54321, modifiedAt: Date.now(),
      duration: 3, width: 320, height: 240,
      container: "MP4", videoCodec: undefined, audioTracks: [],
      thumbnailStatus: "pending", metadataStatus: "ready"
    });
    await new Promise((r) => setTimeout(r, 500));
    const fallback = await evalSafe(`(async () => {
      const row = document.querySelector('[data-video-id="detail2"]');
      row.click();
      await new Promise(r => setTimeout(r, 400));
      const trigger = [...document.querySelectorAll('button')].find(b => b.textContent.includes('技术信息'));
      if (!trigger) return { trigger: false };
      trigger.click();
      await new Promise(r => setTimeout(r, 400));
      const panel = document.querySelector('aside dl');
      const text = panel ? panel.textContent : '';
      return { trigger: true, noAudio: text.includes('无音轨'), unknown: text.includes('未知') };
    })()`);
    check("fallback: no-audio shows 无音轨, missing fields show 未知", fallback.trigger && fallback.noAudio && fallback.unknown, fallback);

    console.log(JSON.stringify({ checks, errors }, null, 2));
    fs.mkdirSync(path.join(__dirname, "smoke-out"), { recursive: true });
    fs.writeFileSync(path.join(__dirname, "smoke-out", "v08-checks.json"), JSON.stringify({ checks, errors }, null, 2));
    app.quit();
    setTimeout(() => process.exit(0), 2000);
  } catch (error) {
    console.log("CAUGHT:", error instanceof Error ? error.stack : String(error));
    app.quit();
    setTimeout(() => process.exit(1), 500);
  }
});
