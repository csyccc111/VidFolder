import { useEffect, useMemo, useRef, useState } from "react";
import type { ContextAction, ScanProgress, VideoItem } from "./shared";

type SortKey = "fileName" | "modifiedAt" | "size" | "duration";
type ThumbSize = "small" | "medium" | "large";

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

export default function App() {
  const [folderPath, setFolderPath] = useState("");
  const [items, setItems] = useState<VideoItem[]>([]);
  const [progress, setProgress] = useState<ScanProgress>(emptyProgress);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("modifiedAt");
  const [ascending, setAscending] = useState(false);
  const [thumbSize, setThumbSize] = useState<ThumbSize>("medium");
  const [selectedId, setSelectedId] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number; item: VideoItem }>();
  const [notice, setNotice] = useState("");
  const [bridgeReady, setBridgeReady] = useState(true);
  const initialized = useRef(false);

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
        if (settings.lastFolder) {
          setFolderPath(settings.lastFolder);
          void startScan(settings.lastFolder);
        }
      });
    }
    return () => {
      disposeProgress();
      disposeItem();
    };
  }, []);

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

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase();
    return items
      .filter((item) => (keyword ? item.fileName.toLocaleLowerCase().includes(keyword) : true))
      .sort((a, b) => (ascending ? 1 : -1) * compareItems(a, b, sortKey));
  }, [items, query, sortKey, ascending]);

  const selectedItem = items.find((item) => item.id === selectedId);
  const gridClass = `video-grid ${thumbSize}`;
  const isScanning = progress.state === "scanning";

  return (
    <div className="app-shell">
      <header className="toolbar">
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
        <div className="segmented" aria-label="缩略图大小">
          {(["small", "medium", "large"] as const).map((size) => (
            <button
              key={size}
              className={thumbSize === size ? "active" : ""}
              title={`缩略图${size === "small" ? "小" : size === "medium" ? "中" : "大"}`}
              onClick={() => setThumbSize(size)}
            >
              {size === "small" ? "小" : size === "medium" ? "中" : "大"}
            </button>
          ))}
        </div>
      </header>

      <main className="content">
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
              <p>换一个文件名关键词试试。</p>
            </div>
          )}

          {bridgeReady && filteredItems.length > 0 && (
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
