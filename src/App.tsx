import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextAction, DependencyStatus, ScanProgress, VideoItem } from "./shared";

type SortKey = "fileName" | "modifiedAt" | "size" | "duration";
type ThumbSize = "small" | "medium" | "large";
type ViewMode = "grid" | "list";
type DurationFilter = "all" | "short" | "medium" | "long";
type ResolutionFilter = "all" | "landscape" | "portrait" | "square" | "hd" | "fhd" | "uhd";

const emptyProgress: ScanProgress = {
  state: "idle",
  found: 0,
  processed: 0,
  thumbnailsReady: 0,
  failures: 0
};

const sortLabels: Record<SortKey, string> = {
  fileName: "文件名",
  modifiedAt: "修改时间",
  size: "文件大小",
  duration: "时长"
};

const durationLabels: Record<DurationFilter, string> = {
  all: "全部时长",
  short: "1 分钟内",
  medium: "1-20 分钟",
  long: "20 分钟以上"
};

const resolutionLabels: Record<ResolutionFilter, string> = {
  all: "全部画面",
  landscape: "横屏",
  portrait: "竖屏",
  square: "方形",
  hd: "720p+",
  fhd: "1080p+",
  uhd: "4K+"
};

const sortableListColumns: Array<{ key: SortKey; label: string }> = [
  { key: "fileName", label: "文件名" },
  { key: "duration", label: "时长" },
  { key: "size", label: "大小" },
  { key: "modifiedAt", label: "修改时间" }
];

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const power = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** power).toFixed(power === 0 ? 0 : 1)} ${units[power]}`;
}

function formatDuration(seconds?: number) {
  if (!seconds || !Number.isFinite(seconds)) return "--:--";
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function compareItems(a: VideoItem, b: VideoItem, key: SortKey) {
  if (key === "fileName") return a.fileName.localeCompare(b.fileName, "zh-CN", { numeric: true });
  return (a[key] ?? 0) - (b[key] ?? 0);
}

function normalizePath(value: string) {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

function getRelativeDirectory(rootPath: string, directory: string) {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedDirectory = normalizePath(directory);
  if (!normalizedRoot || normalizedDirectory === normalizedRoot) return ".";
  if (normalizedDirectory.startsWith(`${normalizedRoot}/`)) {
    return directory.slice(rootPath.replace(/[/\\]+$/, "").length + 1).replaceAll("\\", "/");
  }
  return directory.replaceAll("\\", "/");
}

function getDirectoryName(relativePath: string) {
  if (relativePath === ".") return "全部视频";
  const parts = relativePath.split("/").filter(Boolean);
  return parts.at(-1) ?? relativePath;
}

function isWithinDirectory(itemDirectory: string, selectedDirectory: string) {
  if (!selectedDirectory) return true;
  const itemPath = normalizePath(itemDirectory);
  const selectedPath = normalizePath(selectedDirectory);
  return itemPath === selectedPath || itemPath.startsWith(`${selectedPath}/`);
}

function matchesDurationFilter(duration: number | undefined, filter: DurationFilter) {
  if (filter === "all") return true;
  if (!duration || !Number.isFinite(duration)) return false;
  if (filter === "short") return duration < 60;
  if (filter === "medium") return duration >= 60 && duration <= 20 * 60;
  return duration > 20 * 60;
}

function matchesResolutionFilter(item: VideoItem, filter: ResolutionFilter) {
  if (filter === "all") return true;
  if (!item.width || !item.height) return false;
  if (filter === "landscape") return item.width > item.height;
  if (filter === "portrait") return item.height > item.width;
  if (filter === "square") return item.width === item.height;
  if (filter === "hd") return item.width >= 1280 || item.height >= 720;
  if (filter === "fhd") return item.width >= 1920 || item.height >= 1080;
  return item.width >= 3840 || item.height >= 2160;
}

export default function App() {
  const [folderPath, setFolderPath] = useState("");
  const [items, setItems] = useState<VideoItem[]>([]);
  const [progress, setProgress] = useState<ScanProgress>(emptyProgress);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [ascending, setAscending] = useState(false);
  const [thumbSize, setThumbSize] = useState<ThumbSize>("medium");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [selectedDirectory, setSelectedDirectory] = useState("");
  const [extensionFilter, setExtensionFilter] = useState("all");
  const [durationFilter, setDurationFilter] = useState<DurationFilter>("all");
  const [resolutionFilter, setResolutionFilter] = useState<ResolutionFilter>("all");
  const [selectedId, setSelectedId] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; item: VideoItem }>();
  const [notice, setNotice] = useState("");
  const [bridgeReady, setBridgeReady] = useState(true);
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>();
  const initialized = useRef(false);
  const settingsLoaded = useRef(false);

  useEffect(() => {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const disposeProgress = window.videoBrowser.onProgress((next) => {
      setProgress(next);
      if (next.rootPath) setFolderPath(next.rootPath);
    });
    const disposeItem = window.videoBrowser.onItem((next) => {
      setItems((current) => {
        const index = current.findIndex((item) => item.id === next.id);
        if (index === -1) return [...current, next];
        const copy = [...current];
        copy[index] = { ...copy[index], ...next };
        return copy;
      });
    });
    if (!initialized.current) {
      initialized.current = true;
      window.videoBrowser.getSettings().then((settings) => {
        if (settings.viewMode) setViewMode(settings.viewMode);
        if (settings.sortKey) setSortKey(settings.sortKey);
        if (typeof settings.ascending === "boolean") setAscending(settings.ascending);
        if (settings.thumbSize) setThumbSize(settings.thumbSize);
        settingsLoaded.current = true;
        if (settings.lastFolder) {
          setFolderPath(settings.lastFolder);
          void startScan(settings.lastFolder);
        }
      });
      window.videoBrowser.getDependencyStatus().then(setDependencyStatus);
    }
    return () => {
      disposeProgress();
      disposeItem();
    };
  }, []);

  useEffect(() => {
    if (!bridgeReady || !settingsLoaded.current || !window.videoBrowser) return;
    const timer = window.setTimeout(() => {
      void window.videoBrowser.updateSettings({
        viewMode,
        sortKey,
        ascending,
        thumbSize
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [bridgeReady, viewMode, sortKey, ascending, thumbSize]);

  useEffect(() => {
    const closeMenu = () => setMenu(undefined);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, []);

  async function startScan(path: string) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    setItems([]);
    setSelectedId(undefined);
    setSelectedDirectory("");
    setProgress({ ...emptyProgress, state: "scanning", rootPath: path, message: "正在扫描" });
    await window.videoBrowser.startScan(path);
  }

  async function chooseFolder() {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const selected = await window.videoBrowser.chooseFolder();
    if (selected) {
      setFolderPath(selected);
      await startScan(selected);
    }
  }

  async function runContextAction(action: ContextAction, item: VideoItem) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const updated = await window.videoBrowser.contextAction(action, item.filePath);
    setMenu(undefined);
    if (updated) {
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      setNotice(action === "regenerateThumbnail" ? "封面已重新生成" : "");
    } else if (action === "copyPath") {
      setNotice("路径已复制");
    }
    window.setTimeout(() => setNotice(""), 1800);
  }

  const directories = useMemo(() => {
    const root = folderPath.replace(/[/\\]+$/, "");
    const directoryCounts = new Map<string, { path: string; count: number; relativePath: string }>();
    for (const item of items) {
      const relativePath = getRelativeDirectory(root, item.directory);
      if (relativePath === ".") continue;
      const parts = relativePath.split("/").filter(Boolean);
      for (let index = 0; index < parts.length; index += 1) {
        const ancestorRelativePath = parts.slice(0, index + 1).join("/");
        const ancestorPath = `${root}\\${ancestorRelativePath.replaceAll("/", "\\")}`;
        const existing = directoryCounts.get(ancestorPath);
        directoryCounts.set(ancestorPath, {
          path: ancestorPath,
          relativePath: ancestorRelativePath,
          count: (existing?.count ?? 0) + 1
        });
      }
    }
    return [...directoryCounts.values()]
      .filter((directory) => directory.relativePath !== ".")
      .sort((a, b) => a.relativePath.localeCompare(b.relativePath, "zh-CN", { numeric: true }));
  }, [folderPath, items]);

  const extensionOptions = useMemo(() => {
    return [...new Set(items.map((item) => item.extension).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true }));
  }, [items]);

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items
      .filter((item) => (keyword ? item.fileName.toLocaleLowerCase().includes(keyword) : true))
      .filter((item) => (selectedDirectory ? isWithinDirectory(item.directory, selectedDirectory) : true))
      .filter((item) => (extensionFilter === "all" ? true : item.extension === extensionFilter))
      .filter((item) => matchesDurationFilter(item.duration, durationFilter))
      .filter((item) => matchesResolutionFilter(item, resolutionFilter))
      .sort((a, b) => (ascending ? 1 : -1) * compareItems(a, b, sortKey));
  }, [items, query, selectedDirectory, extensionFilter, durationFilter, resolutionFilter, sortKey, ascending]);

  const selectedItem = items.find((item) => item.id === selectedId);
  const gridClass = `video-grid ${thumbSize}`;
  const isScanning = progress.state === "scanning";
  const missingTools = [
    dependencyStatus?.ffmpeg.available === false ? "ffmpeg" : undefined,
    dependencyStatus?.ffprobe.available === false ? "ffprobe" : undefined
  ].filter(Boolean);

  function changeListSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(nextKey);
      setAscending(nextKey === "fileName");
    }
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return "";
    return ascending ? " ↑" : " ↓";
  }

  return (
    <div className="app-shell">
      <header className="toolbar">
        <div className="toolbar-row">
          <div className="primary-actions">
            <button className="button primary" onClick={chooseFolder}>选择文件夹</button>
            <button className="button" disabled={!folderPath || isScanning} onClick={() => void startScan(folderPath)}>刷新</button>
          </div>
          <input
            className="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索文件名"
          />
          <select className="select" value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
            {Object.entries(sortLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button className="icon-button" title={ascending ? "升序" : "降序"} onClick={() => setAscending((value) => !value)}>
            {ascending ? "↑" : "↓"}
          </button>
          <div className="segmented" aria-label="视图模式">
            <button className={viewMode === "grid" ? "active" : ""} title="网格视图" onClick={() => setViewMode("grid")}>网格</button>
            <button className={viewMode === "list" ? "active" : ""} title="列表视图" onClick={() => setViewMode("list")}>列表</button>
          </div>
          <div className="segmented" aria-label="缩略图大小">
            {(["small", "medium", "large"] as const).map((size) => (
              <button
                key={size}
                className={thumbSize === size ? "active" : ""}
                title={`缩略图${size === "small" ? "小" : size === "medium" ? "中" : "大"}`}
                onClick={() => setThumbSize(size)}
                disabled={viewMode === "list"}
              >
                {size === "small" ? "小" : size === "medium" ? "中" : "大"}
              </button>
            ))}
          </div>
        </div>
        <div className="toolbar-row filter-row">
          <select className="select" value={extensionFilter} onChange={(event) => setExtensionFilter(event.target.value)}>
            <option value="all">全部格式</option>
            {extensionOptions.map((extension) => (
              <option key={extension} value={extension}>{extension.replace(".", "").toUpperCase()}</option>
            ))}
          </select>
          <select className="select" value={durationFilter} onChange={(event) => setDurationFilter(event.target.value as DurationFilter)}>
            {Object.entries(durationLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <select className="select" value={resolutionFilter} onChange={(event) => setResolutionFilter(event.target.value as ResolutionFilter)}>
            {Object.entries(resolutionLabels).map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
          <button
            className="button subtle"
            disabled={!query && !selectedDirectory && extensionFilter === "all" && durationFilter === "all" && resolutionFilter === "all"}
            onClick={() => {
              setQuery("");
              setSelectedDirectory("");
              setExtensionFilter("all");
              setDurationFilter("all");
              setResolutionFilter("all");
            }}
          >
            清除筛选
          </button>
        </div>
        {dependencyStatus && missingTools.length > 0 && (
          <div className="dependency-alert">
            缺少 {missingTools.join("、")}。已有缓存仍可浏览，但新视频的封面或时长/分辨率可能无法生成。
          </div>
        )}
      </header>

      <main className="content">
        <aside className="folder-pane">
          <div className="pane-title">文件夹</div>
          <button
            className={`folder-item root ${selectedDirectory ? "" : "active"}`}
            disabled={!folderPath}
            onClick={() => setSelectedDirectory("")}
            title={folderPath || "未选择文件夹"}
          >
            <span className="folder-name">全部视频</span>
            <span className="folder-count">{items.length}</span>
          </button>
          <div className="folder-list">
            {directories.map((directory) => {
              const depth = directory.relativePath === "." ? 0 : directory.relativePath.split("/").length - 1;
              return (
                <button
                  key={directory.path}
                  className={`folder-item ${selectedDirectory === directory.path ? "active" : ""}`}
                  style={{ paddingLeft: 12 + depth * 14 }}
                  onClick={() => setSelectedDirectory(directory.path)}
                  title={directory.relativePath === "." ? folderPath : directory.relativePath}
                >
                  <span className="folder-name">{getDirectoryName(directory.relativePath)}</span>
                  <span className="folder-count" title="包含子文件夹的视频数">{directory.count}</span>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="browser-pane">
          {!bridgeReady && (
            <div className="empty-state">
              <h1>Electron 桥接未加载</h1>
              <p>请重新运行开发服务；如果仍出现此提示，preload 没有被 Electron 正确加载。</p>
            </div>
          )}

          {bridgeReady && !folderPath && (
            <div className="empty-state">
              <h1>选择一个视频文件夹</h1>
              <p>递归扫描本地视频文件，生成封面并缓存基础信息。</p>
              <button className="button primary" onClick={chooseFolder}>选择文件夹</button>
            </div>
          )}

          {bridgeReady && folderPath && items.length === 0 && (
            <div className="empty-state">
              <h1>{isScanning ? "正在扫描" : "没有找到视频"}</h1>
              <p>{isScanning ? "发现的视频会立即出现在这里。" : "当前文件夹及子文件夹中没有支持的视频格式。"}</p>
            </div>
          )}

          {bridgeReady && items.length > 0 && filteredItems.length === 0 && (
            <div className="empty-state">
              <h1>没有匹配结果</h1>
              <p>换一个关键词、文件夹或筛选条件试试。</p>
            </div>
          )}

          {bridgeReady && filteredItems.length > 0 && viewMode === "grid" && (
            <div className={gridClass}>
              {filteredItems.map((item) => (
                <article
                  key={item.id}
                  className={`video-card ${selectedId === item.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedId(item.id);
                    setMenu({ x: event.clientX, y: event.clientY, item });
                  }}
                >
                  <div className="thumb">
                    {item.thumbnailPath && item.thumbnailStatus === "ready" ? (
                      <img src={item.thumbnailPath} alt="" loading="lazy" />
                    ) : (
                      <div className="thumb-placeholder">
                        <span>{item.thumbnailStatus === "failed" ? "封面失败" : "生成中"}</span>
                      </div>
                    )}
                    <span className="duration">{formatDuration(item.duration)}</span>
                  </div>
                  <div className="card-body">
                    <div className="file-name" title={item.fileName}>{item.fileName}</div>
                    <div className="meta-line">
                      <span>{formatBytes(item.size)}</span>
                      <span>{formatDate(item.modifiedAt)}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}

          {bridgeReady && filteredItems.length > 0 && viewMode === "list" && (
            <div className="video-list" role="table" aria-label="视频列表">
              <div className="video-list-header" role="row">
                {sortableListColumns.slice(0, 3).map((column) => (
                  <button key={column.key} className="list-sort-button" onClick={() => changeListSort(column.key)}>
                    {column.label}{sortIndicator(column.key)}
                  </button>
                ))}
                <span>分辨率</span>
                <button className="list-sort-button" onClick={() => changeListSort("modifiedAt")}>
                  修改时间{sortIndicator("modifiedAt")}
                </button>
                <span>所在文件夹</span>
              </div>
              {filteredItems.map((item) => (
                <button
                  key={item.id}
                  className={`video-row ${selectedId === item.id ? "selected" : ""}`}
                  onClick={() => setSelectedId(item.id)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setSelectedId(item.id);
                    setMenu({ x: event.clientX, y: event.clientY, item });
                  }}
                  title={item.filePath}
                >
                  <span className="row-name">{item.fileName}</span>
                  <span>{formatDuration(item.duration)}</span>
                  <span>{formatBytes(item.size)}</span>
                  <span>{item.width && item.height ? `${item.width} × ${item.height}` : "未读取"}</span>
                  <span>{formatDate(item.modifiedAt)}</span>
                  <span>{getRelativeDirectory(folderPath, item.directory)}</span>
                </button>
              ))}
            </div>
          )}
        </section>

        <aside className="detail-pane">
          <h2>详情</h2>
          {selectedItem ? (
            <dl>
              <dt>文件名</dt>
              <dd title={selectedItem.fileName}>{selectedItem.fileName}</dd>
              <dt>完整路径</dt>
              <dd title={selectedItem.filePath}>{selectedItem.filePath}</dd>
              <dt>所在文件夹</dt>
              <dd title={selectedItem.directory}>{selectedItem.directory}</dd>
              <dt>大小</dt>
              <dd>{formatBytes(selectedItem.size)}</dd>
              <dt>时长</dt>
              <dd>{formatDuration(selectedItem.duration)}</dd>
              <dt>修改时间</dt>
              <dd>{formatDate(selectedItem.modifiedAt)}</dd>
              <dt>分辨率</dt>
              <dd>{selectedItem.width && selectedItem.height ? `${selectedItem.width} × ${selectedItem.height}` : "未读取"}</dd>
              {selectedItem.error && (
                <>
                  <dt>错误</dt>
                  <dd className="error-text" title={selectedItem.error}>{selectedItem.error}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="muted">点击一个视频查看基础信息。</p>
          )}
        </aside>
      </main>

      <footer className="statusbar">
        <span className="path" title={folderPath}>{folderPath || "未选择文件夹"}</span>
        <span>视频 {items.length}</span>
        <span>显示 {filteredItems.length}</span>
        <span>{progress.message ?? "空闲"}</span>
        <span>封面 {progress.thumbnailsReady}/{progress.found}</span>
        <span>失败 {progress.failures}</span>
        {dependencyStatus && <span>{dependencyStatus.ffmpeg.available ? "ffmpeg 正常" : "缺少 ffmpeg"}</span>}
        {dependencyStatus && <span>{dependencyStatus.ffprobe.available ? "ffprobe 正常" : "缺少 ffprobe"}</span>}
        {notice && <span className="notice">{notice}</span>}
      </footer>

      {menu && (
        <div className="context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
          <button onClick={() => void runContextAction("showInFolder", menu.item)}>打开所在目录</button>
          <button onClick={() => void runContextAction("openVideo", menu.item)}>用默认播放器打开</button>
          <button onClick={() => void runContextAction("copyPath", menu.item)}>复制完整路径</button>
          <button onClick={() => void runContextAction("regenerateThumbnail", menu.item)}>重新生成封面</button>
        </div>
      )}
    </div>
  );
}
