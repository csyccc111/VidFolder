/* eslint-disable */
// 临时冒烟脚本：加载构建产物，注入模拟 IPC 数据，截图验证 UI 渲染。
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const OUT = path.join(__dirname, "smoke-out");
const fs = require("node:fs");

const items = [
  { id: "a1", filePath: "C:\\Videos\\学习\\教程\\第一章.mp4", fileName: "第一章-视频剪辑入门教程.mp4", directory: "C:\\Videos\\学习\\教程", extension: ".mp4", size: 523287552, modifiedAt: 1753000000000, duration: 843, width: 1920, height: 1080, thumbnailStatus: "pending", metadataStatus: "ready" },
  { id: "a2", filePath: "C:\\Videos\\学习\\教程\\第二章.mkv", fileName: "第二章-色彩校正进阶.mkv", directory: "C:\\Videos\\学习\\教程", extension: ".mkv", size: 1200000000, modifiedAt: 1752900000000, duration: 1520, width: 3840, height: 2160, thumbnailStatus: "failed", metadataStatus: "ready" },
  { id: "b1", filePath: "C:\\Videos\\学习\\笔记.mp4", fileName: "课堂笔记回顾.mp4", directory: "C:\\Videos\\学习", extension: ".mp4", size: 85899345, modifiedAt: 1752800000000, duration: 42, width: 1280, height: 720, thumbnailStatus: "pending", metadataStatus: "pending" },
  { id: "c1", filePath: "C:\\Videos\\电影\\星际穿越 4K.mkv", fileName: "星际穿越 4K 导演剪辑版.mkv", directory: "C:\\Videos\\电影", extension: ".mkv", size: 15 * 1024 ** 3, modifiedAt: 1752700000000, duration: 10100, width: 3840, height: 2160, thumbnailStatus: "pending", metadataStatus: "ready" },
  { id: "c2", filePath: "C:\\Videos\\电影\\短片.webm", fileName: "旅行短片 60fps.webm", directory: "C:\\Videos\\电影", extension: ".webm", size: 104857600, modifiedAt: 1752600000000, duration: 95, width: 1920, height: 1080, thumbnailStatus: "pending", metadataStatus: "ready" }
];

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  ipcMain.handle("settings:get", () => ({
    lastFolder: "C:\\Videos",
    viewMode: "grid",
    sortKey: "modifiedAt",
    ascending: false,
    thumbSize: "medium",
    sidebarOpen: true,
    sidebarWidth: 260,
    detailPaneOpen: true,
    recentFolders: [
      { path: "C:\\Videos", lastOpenedAt: Date.now() - 1000, pinned: true },
      { path: "D:\\素材\\空镜头", lastOpenedAt: Date.now() - 5000, pinned: false },
      { path: "E:\\old\\deleted-folder", lastOpenedAt: Date.now() - 9000, pinned: false }
    ]
  }));
  ipcMain.handle("settings:update", () => ({}));
  ipcMain.handle("dependencies:get", () => ({ ffmpeg: { available: true }, ffprobe: { available: false }, checkedAt: Date.now() }));
  ipcMain.handle("folder:validate", async (_e, p) => {
    return { exists: !p.includes("deleted-folder"), isDirectory: true };
  });
  ipcMain.handle("folder:choose", () => undefined);
  ipcMain.handle("folder:show-in-explorer", () => undefined);
  ipcMain.handle("scan:start", () => undefined);
  ipcMain.handle("scan:cancel", () => undefined);
  ipcMain.handle("video:context-action", () => undefined);

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#101216",
    webPreferences: {
      preload: path.join(__dirname, "../dist-electron/electron/preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  const errors = [];
  win.webContents.on("console-message", (_e, _level, message) => {
    if (message.toLowerCase().includes("error")) errors.push(message);
  });

  await win.loadFile(path.join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1200));

  win.webContents.send("scan:progress", { state: "scanning", rootPath: "C:\\Videos", found: 5, processed: 2, thumbnailsReady: 1, failures: 0, message: "正在扫描", warningCount: 0, warnings: [] });
  for (const item of items) win.webContents.send("scan:item", item);
  await new Promise((r) => setTimeout(r, 800));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(OUT, "grid.png"), img.toPNG()));

  win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 5, processed: 5, thumbnailsReady: 5, failures: 0, message: "扫描完成", warningCount: 1, warnings: ["C:\\Videos\\locked"] });

  const listMode = await win.webContents.executeJavaScript("window.__smoke = true; document.querySelectorAll('button').length");
  await new Promise((r) => setTimeout(r, 400));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(OUT, "complete.png"), img.toPNG()));

  // 切列表视图 + 搜索
  await win.webContents.executeJavaScript(`
    (() => {
      const btns = [...document.querySelectorAll('button')];
      const list = btns.find(b => b.getAttribute('aria-label') === '列表视图');
      if (list) list.click();
      return true;
    })()
  `);
  await new Promise((r) => setTimeout(r, 400));
  await win.webContents.capturePage().then((img) => fs.writeFileSync(path.join(OUT, "list.png"), img.toPNG()));

  console.log(JSON.stringify({ errors, listMode }, null, 2));
  fs.writeFileSync(path.join(OUT, "console-errors.json"), JSON.stringify(errors, null, 2));
  app.quit();
});
