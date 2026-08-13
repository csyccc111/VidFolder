/* eslint-disable */
// 冒烟脚本：DOM 断言验证 v0.5 UI 布局与交互。
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const items = [
  { id: "a1", filePath: "C:\\Videos\\学习\\教程\\第一章.mp4", fileName: "第一章-视频剪辑入门教程.mp4", directory: "C:\\Videos\\学习\\教程", extension: ".mp4", size: 523287552, modifiedAt: 1753000000000, duration: 843, width: 1920, height: 1080, thumbnailStatus: "ready", metadataStatus: "ready" },
  { id: "a2", filePath: "C:\\Videos\\学习\\教程\\第二章.mkv", fileName: "第二章-色彩校正进阶.mkv", directory: "C:\\Videos\\学习\\教程", extension: ".mkv", size: 1200000000, modifiedAt: 1752900000000, duration: 1520, width: 3840, height: 2160, thumbnailStatus: "failed", metadataStatus: "ready" },
  { id: "b1", filePath: "C:\\Videos\\学习\\笔记.mp4", fileName: "课堂笔记回顾.mp4", directory: "C:\\Videos\\学习", extension: ".mp4", size: 85899345, modifiedAt: 1752800000000, duration: 42, width: 1280, height: 720, thumbnailStatus: "ready", metadataStatus: "ready" },
  { id: "c1", filePath: "C:\\Videos\\电影\\星际穿越 4K.mkv", fileName: "星际穿越 4K 导演剪辑版.mkv", directory: "C:\\Videos\\电影", extension: ".mkv", size: 15 * 1024 ** 3, modifiedAt: 1752700000000, duration: 10100, width: 3840, height: 2160, thumbnailStatus: "ready", metadataStatus: "ready" },
  { id: "c2", filePath: "C:\\Videos\\电影\\短片.webm", fileName: "旅行短片 60fps.webm", directory: "C:\\Videos\\电影", extension: ".webm", size: 104857600, modifiedAt: 1752600000000, duration: 95, width: 1920, height: 1080, thumbnailStatus: "ready", metadataStatus: "ready" }
];

const checks = [];

function check(name, ok, extra) {
  checks.push({ name, ok, extra });
}

app.whenReady().then(async () => {
  ipcMain.handle("settings:get", () => ({
    lastFolder: "C:\\Videos", viewMode: "grid", sortKey: "modifiedAt", ascending: false, thumbSize: "medium",
    sidebarOpen: true, sidebarWidth: 260, detailPaneOpen: true,
    recentFolders: [
      { path: "C:\\Videos", lastOpenedAt: Date.now() - 1000, pinned: true },
      { path: "D:\\素材\\空镜头", lastOpenedAt: Date.now() - 5000, pinned: false },
      { path: "E:\\old\\deleted-folder", lastOpenedAt: Date.now() - 9000, pinned: false }
    ]
  }));
  ipcMain.handle("settings:update", () => ({}));
  ipcMain.handle("dependencies:get", () => ({ ffmpeg: { available: true }, ffprobe: { available: false }, checkedAt: Date.now() }));
  ipcMain.handle("folder:validate", async (_e, p) => ({ exists: !p.includes("deleted-folder"), isDirectory: true }));
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
  win.webContents.on("console-message", (_e, details) => {
    const message = typeof details === "string" ? details : details?.message ?? "";
    if (message.toLowerCase().includes("error")) errors.push(message);
  });

  const evalSafe = async (code) => {
    try {
      return await win.webContents.executeJavaScript(code);
    } catch (error) {
      return { evalError: String(error) };
    }
  };

  await win.loadFile(path.join(__dirname, "../dist/index.html"));
  await new Promise((r) => setTimeout(r, 1000));
  win.webContents.send("scan:progress", { state: "scanning", rootPath: "C:\\Videos", found: 5, processed: 2, thumbnailsReady: 1, failures: 0, message: "正在扫描", warningCount: 0, warnings: [] });
  for (const item of items) win.webContents.send("scan:item", item);
  await new Promise((r) => setTimeout(r, 600));
  win.webContents.send("scan:progress", { state: "complete", rootPath: "C:\\Videos", found: 5, processed: 5, thumbnailsReady: 5, failures: 0, message: "扫描完成", warningCount: 1, warnings: ["C:\\Videos\\locked"] });
  await new Promise((r) => setTimeout(r, 600));

  const dom = await evalSafe(`(() => {
    const q = (s) => document.querySelector(s);
    const qa = (s) => [...document.querySelectorAll(s)];
    const treeitems = qa('[role="treeitem"]');
    const cards = qa('[role="gridcell"] article');
    return {
      bridge: Boolean(window.videoBrowser),
      treeCount: treeitems.length,
      treeTexts: treeitems.map(n => n.textContent.trim()),
      cardCount: cards.length,
      statusText: q('footer')?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 140),
      hasSearchInput: Boolean(q('input[placeholder="搜索文件名"]')),
      hasFolderFilter: Boolean(q('input[placeholder="筛选文件夹"]')),
      hasWarnBanner: document.body.textContent.includes('无法访问'),
      hasDependencyWarn: document.body.textContent.includes('缺少 ffprobe'),
      toolbarButtons: qa('header button').length,
      quickAccessRows: document.body.textContent.includes('已固定') && document.body.textContent.includes('最近使用'),
      invalidMarked: document.body.textContent.includes('deleted-folder') && Boolean(q('button[aria-label^="打开文件夹"]')),
      detailVisible: document.body.textContent.includes('详情'),
      bodyScrollOverflow: document.body.scrollWidth > window.innerWidth + 2 || document.body.scrollHeight > window.innerHeight + 2
    };
  })()`);

  check("preload bridge", dom.bridge);
  check("tree renders visible nodes (root + 2 children, 学习 folded)", dom.treeCount === 3 && dom.treeTexts.length === 3, dom.treeTexts);
  check("grid renders 5 cards", dom.cardCount === 5);
  check("toolbar has buttons", dom.toolbarButtons >= 5, dom.toolbarButtons);
  check("search input present", dom.hasSearchInput);
  check("folder filter input present", dom.hasFolderFilter);
  check("scan warning banner", dom.hasWarnBanner);
  check("dependency warning (ffprobe missing)", dom.hasDependencyWarn);
  check("quick access sections", dom.quickAccessRows);
  check("invalid path marked", dom.invalidMarked);
  check("detail pane visible", dom.detailVisible);
  check("no body overflow", !dom.bodyScrollOverflow);

  // 树键盘导航：ArrowDown 选择第二个节点
  const keyboard = await evalSafe(`(async () => {
    const tree = document.querySelector('[role="tree"]');
    tree.focus();
    tree.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 100));
    const selected = document.querySelector('[role="treeitem"][aria-selected="true"]');
    return { selectedText: selected ? selected.textContent.trim().slice(0, 30) : null };
  })()`);
  check("tree keyboard ArrowDown selects node", Boolean(keyboard.selectedText && keyboard.selectedText.length > 0), keyboard);

  // 点击"电影"节点 → 筛选结果只剩 2 张卡片
  const filter = await evalSafe(`(async () => {
    const items = [...document.querySelectorAll('[role="treeitem"]')];
    const movie = items.find(n => n.textContent.includes('电影'));
    if (movie) movie.click();
    await new Promise(r => setTimeout(r, 200));
    return { count: document.querySelectorAll('[role="gridcell"] article').length };
  })()`);
  check("tree filter to 电影 shows 2", filter.count === 2, filter);

  // 网格键盘：ArrowRight 移动选中项（筛选后第 1 张 → 第 2 张）
  const gridKey = await evalSafe(`(async () => {
    const grid = document.querySelector('[role="grid"]');
    const cells = [...document.querySelectorAll('[role="gridcell"]')];
    cells[0].querySelector('article').click();
    await new Promise(r => setTimeout(r, 100));
    grid.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 150));
    const selected = grid.querySelector('.ring-ring');
    const cell = selected ? selected.closest('[role="gridcell"]') : null;
    return { selectedIndex: cell ? cells.indexOf(cell) : -1 };
  })()`);
  check("grid ArrowRight moves selection", gridKey.selectedIndex === 1, gridKey);

  // Enter 打开选中视频（应为筛选后的第 2 张：短片.webm）
  let openedPath = null;
  ipcMain.removeHandler("video:context-action");
  ipcMain.handle("video:context-action", async (_e, action, filePath) => {
    if (action === "openVideo") openedPath = filePath;
    return undefined;
  });
  await evalSafe(`(async () => {
    document.querySelector('[role="grid"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 300));
    return true;
  })()`);
  check("Enter opens selected video", openedPath === "C:\\Videos\\电影\\短片.webm", { openedPath });

  // Ctrl+C 复制路径
  let copiedPath = null;
  ipcMain.removeHandler("video:context-action");
  ipcMain.handle("video:context-action", async (_e, action, filePath) => {
    if (action === "copyPath") copiedPath = filePath;
    return undefined;
  });
  await evalSafe(`(() => {
    document.querySelector('[role="grid"]').dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await new Promise((r) => setTimeout(r, 300));
  check("Ctrl+C copies path", copiedPath === "C:\\Videos\\电影\\短片.webm", { copiedPath });

  // 窄窗口：详情变为 Sheet 覆盖层
  const narrow = await evalSafe(`(async () => {
    window.resizeTo(900, 700);
    await new Promise(r => setTimeout(r, 300));
    const btn = document.querySelector('button[aria-label="切换详情面板"]');
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 400));
    const sheet = [...document.querySelectorAll('[role="dialog"]')].find(d => d.textContent.includes('详情'));
    return { hasToggleBtn: Boolean(btn), sheetOpen: Boolean(sheet) };
  })()`);
  check("narrow window uses Sheet detail", narrow.hasToggleBtn && narrow.sheetOpen, narrow);

  console.log(JSON.stringify({ checks, errors }, null, 2));
  fs.writeFileSync(path.join(__dirname, "smoke-out", "dom-checks.json"), JSON.stringify({ checks, errors }, null, 2));
  app.quit();
  setTimeout(() => process.exit(0), 2000);
});
