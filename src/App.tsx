import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ContextAction,
  DependencyStatus,
  FolderHistoryEntry,
  FolderTreeNode,
  ItemError,
  PreviewCacheStats,
  PreviewFrame,
  PreviewResult,
  PreviewState,
  ScanProgress,
  VideoItem
} from "@/shared";
import {
  DurationFilter,
  FilterState,
  ResolutionFilter,
  SortKey,
  ThumbSize,
  ViewMode,
  filterAndSortItems,
  isFilterActive
} from "@/lib/filter";
import { normalizePath, pathKey, trimTrailingSeparators, getRelativeDirectory } from "@/lib/path";
import {
  addHistoryEntry,
  removeHistoryEntry,
  sanitizeExpandedFoldersByRoot,
  sanitizeExpandedKeys,
  toggleExpandedKey,
  togglePin
} from "@/lib/history";
import { buildFolderTree, collectAncestorKeys, findTreeNode } from "@/lib/tree";
import { Toolbar } from "@/components/browser/toolbar";
import { VideoGrid } from "@/components/browser/video-grid";
import { VideoList } from "@/components/browser/video-list";
import { EmptyState, EmptyStateKind } from "@/components/browser/empty-state";
import { DetailPanel } from "@/components/details/detail-panel";
import { StatusBar } from "@/components/status/status-bar";
import { ScanNotices } from "@/components/status/scan-notices";
import { Sidebar, SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@/components/layout/sidebar";
import type { PreviewSessionInfo } from "@/components/browser/video-card";

const emptyProgress: ScanProgress = {
  state: "idle",
  found: 0,
  processed: 0,
  thumbnailsReady: 0,
  failures: 0,
  warningCount: 0,
  warnings: []
};

const NARROW_WINDOW_WIDTH = 1100;

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
  const [notice, setNotice] = useState("");
  const [bridgeReady, setBridgeReady] = useState(true);
  const [dependencyStatus, setDependencyStatus] = useState<DependencyStatus>();
  const [recentFolders, setRecentFolders] = useState<FolderHistoryEntry[]>([]);
  const [invalidPaths, setInvalidPaths] = useState<Set<string>>(new Set());
  const [expandedByRoot, setExpandedByRoot] = useState<Record<string, string[]>>({});
  const [revealRequest, setRevealRequest] = useState<{ key: string; nonce: number }>();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT_WIDTH);
  const [detailPaneOpen, setDetailPaneOpen] = useState(true);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [isNarrow, setIsNarrow] = useState(() => window.innerWidth < NARROW_WINDOW_WIDTH);
  const [dragState, setDragState] = useState<"folder" | "invalid">();
  const [hoverPreviewEnabled, setHoverPreviewEnabled] = useState(true);
  const [previewSession, setPreviewSession] = useState<PreviewSessionInfo>();
  const previewRequests = useRef(new Map<string, string>());

  const initialized = useRef(false);
  const settingsLoaded = useRef(false);
  const dragDepth = useRef(0);
  const noticeTimer = useRef<number | undefined>(undefined);

  const rootKey = useMemo(() => (folderPath ? pathKey(folderPath) : ""), [folderPath]);
  const expandedKeys = useMemo(
    () => (rootKey ? expandedByRoot[rootKey] ?? [rootKey] : []),
    [expandedByRoot, rootKey]
  );

  useEffect(() => {
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_WINDOW_WIDTH);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const disposeProgress = window.videoBrowser.onProgress((next) => {
      setProgress(next);
      if (next.rootPath) setFolderPath(next.rootPath);
      if (next.state === "complete") {
        // 扫描成功才写入最近记录；对话框取消、扫描失败不写。
        if (next.rootPath) recordSuccessfulOpen(next.rootPath);
      }
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
    const disposePreview = window.videoBrowser.onPreviewResult((result) => {
      previewRequests.current.delete(result.videoId);
      setPreviewSession((current) => {
        // 陈旧响应隔离：只接受仍与当前会话匹配的结果。
        if (!current || current.requestId !== result.requestId) return current;
        return {
          videoId: result.videoId,
          requestId: result.requestId,
          state: result.state,
          frames: result.frames,
          error: result.error
        };
      });
    });
    if (!initialized.current) {
      initialized.current = true;
      window.videoBrowser.getSettings().then((settings) => {
        if (settings.viewMode) setViewMode(settings.viewMode);
        if (settings.sortKey) setSortKey(settings.sortKey);
        if (typeof settings.ascending === "boolean") setAscending(settings.ascending);
        if (settings.thumbSize) setThumbSize(settings.thumbSize);
        if (typeof settings.sidebarOpen === "boolean") setSidebarOpen(settings.sidebarOpen);
        if (typeof settings.sidebarWidth === "number" && settings.sidebarWidth > 0) {
          setSidebarWidth(Math.min(Math.max(settings.sidebarWidth, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH));
        }
        if (typeof settings.detailPaneOpen === "boolean") setDetailPaneOpen(settings.detailPaneOpen);
        if (typeof settings.hoverPreviewEnabled === "boolean") setHoverPreviewEnabled(settings.hoverPreviewEnabled);
        setRecentFolders(settings.recentFolders ?? []);
        setExpandedByRoot(sanitizeExpandedFoldersByRoot(settings.expandedFoldersByRoot));
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
      disposePreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 界面偏好 + 布局状态节流写入 settings。
  useEffect(() => {
    if (!bridgeReady || !settingsLoaded.current || !window.videoBrowser) return;
    const timer = window.setTimeout(() => {
      void window.videoBrowser.updateSettings({
        viewMode,
        sortKey,
        ascending,
        thumbSize,
        sidebarOpen,
        sidebarWidth,
        detailPaneOpen,
        hoverPreviewEnabled,
        expandedFoldersByRoot: expandedByRoot
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    bridgeReady,
    viewMode,
    sortKey,
    ascending,
    thumbSize,
    sidebarOpen,
    sidebarWidth,
    detailPaneOpen,
    hoverPreviewEnabled,
    expandedByRoot
  ]);

  // 最近记录加载后校验路径有效性（异步、低干扰）。
  useEffect(() => {
    if (!bridgeReady || !window.videoBrowser) return;
    let cancelled = false;
    const validate = async () => {
      const invalid = new Set<string>();
      for (const entry of recentFolders) {
        if (cancelled) return;
        const result = await window.videoBrowser!.validateFolder(entry.path);
        if (!result.exists || !result.isDirectory) invalid.add(entry.path);
      }
      if (!cancelled) setInvalidPaths(invalid);
    };
    void validate();
    return () => {
      cancelled = true;
    };
  }, [recentFolders, bridgeReady]);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    };
  }, []);

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(""), 1800);
  }

  async function recordSuccessfulOpen(path: string) {
    if (!window.videoBrowser) return;
    setRecentFolders((current) => {
      const next = addHistoryEntry(current, { path, lastOpenedAt: Date.now(), pinned: false });
      // 成功打开记录即时落盘，避免应用退出时丢失。
      void window.videoBrowser!.updateSettings({ recentFolders: next });
      return next;
    });
  }

  async function startScan(path: string) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    setItems([]);
    setSelectedId(undefined);
    setSelectedDirectory("");
    setRevealRequest(undefined);
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

  async function openFolderFromHistory(path: string) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const result = await window.videoBrowser.validateFolder(path);
    if (!result.exists || !result.isDirectory) {
      showNotice("该文件夹路径已失效，无法打开");
      return;
    }
    setFolderPath(path);
    await startScan(path);
  }

  async function openDroppedFile(file: File) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const path = window.videoBrowser.getPathForFile(file);
    if (!path) {
      showNotice("无法读取拖入的路径");
      return;
    }
    const result = await window.videoBrowser.validateFolder(path);
    if (!result.exists || !result.isDirectory) {
      showNotice("请拖入文件夹而不是单个文件");
      return;
    }
    setFolderPath(path);
    await startScan(path);
  }

  // 窗口级拖入文件夹（仅接受单个目录）。
  useEffect(() => {
    const onDragEnter = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current += 1;
      updateDragState(event);
    };
    const onDragOver = (event: DragEvent) => {
      event.preventDefault();
      updateDragState(event);
    };
    const onDragLeave = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragState(undefined);
    };
    const onDrop = (event: DragEvent) => {
      event.preventDefault();
      dragDepth.current = 0;
      setDragState(undefined);
      const file = event.dataTransfer?.files?.[0];
      if (!file) return;
      void openDroppedFile(file);
    };
    const updateDragState = (event: DragEvent) => {
      const items = event.dataTransfer?.items ?? [];
      if (items.length !== 1 || items[0].kind !== "file") {
        setDragState("invalid");
        return;
      }
      setDragState("folder");
    };
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const directories = useMemo(() => {
    const root = trimTrailingSeparators(folderPath);
    const directoryCounts = new Map<string, { path: string; relativePath: string; count: number }>();
    for (const item of items) {
      if (!root) continue;
      const relativePath = getRelativeDirectory(root, item.directory);
      if (relativePath === ".") continue;
      const parts = relativePath.split("/").filter(Boolean);
      for (let index = 0; index < parts.length; index += 1) {
        const ancestorRelativePath = parts.slice(0, index + 1).join("/");
        const ancestorPath = `${root}\\${ancestorRelativePath.replaceAll("/", "\\")}`;
        const key = normalizePath(ancestorPath);
        const existing = directoryCounts.get(key);
        directoryCounts.set(key, {
          path: ancestorPath,
          relativePath: ancestorRelativePath,
          count: (existing?.count ?? 0) + 1
        });
      }
    }
    return [...directoryCounts.values()];
  }, [folderPath, items]);

  const treeRoot = useMemo(() => buildFolderTree(folderPath, directories), [folderPath, directories]);

  const extensionOptions = useMemo(() => {
    return [...new Set(items.map((item) => item.extension).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, "zh-CN", { numeric: true })
    );
  }, [items]);

  const filterState: FilterState = useMemo(
    () => ({ query, selectedDirectory, extensionFilter, durationFilter, resolutionFilter }),
    [query, selectedDirectory, extensionFilter, durationFilter, resolutionFilter]
  );

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (extensionFilter !== "all") count += 1;
    if (durationFilter !== "all") count += 1;
    if (resolutionFilter !== "all") count += 1;
    return count;
  }, [extensionFilter, durationFilter, resolutionFilter]);

  const filteredItems = useMemo(
    () => filterAndSortItems(items, filterState, sortKey, ascending),
    [items, filterState, sortKey, ascending]
  );

  const selectedItem = items.find((item) => item.id === selectedId);
  const isScanning = progress.state === "scanning";

  function changeListSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setAscending((value) => !value);
    } else {
      setSortKey(nextKey);
      setAscending(nextKey === "fileName");
    }
  }

  function clearAllFilters() {
    setQuery("");
    setSelectedDirectory("");
    setExtensionFilter("all");
    setDurationFilter("all");
    setResolutionFilter("all");
  }

  async function runContextAction(action: ContextAction, item: VideoItem) {
    if (!window.videoBrowser) {
      setBridgeReady(false);
      return;
    }
    const updated = await window.videoBrowser.contextAction(action, item.filePath);
    if (updated) {
      setItems((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
      if (action === "regenerateThumbnail") {
        showNotice(updated.thumbnailStatus === "ready" ? "封面已重新生成" : "封面重新生成失败，请查看详情面板");
      }
    } else if (action === "copyPath") {
      showNotice("路径已复制");
    }
  }

  function handleToggleExpand(key: string) {
    if (!rootKey) return;
    setExpandedByRoot((current) => {
      const currentKeys = current[rootKey] ?? [rootKey];
      return { ...current, [rootKey]: toggleExpandedKey(currentKeys, key) };
    });
  }

  function handleSelectDirectory(node: FolderTreeNode) {
    setSelectedDirectory(node.path);
    if (!treeRoot) return;
    const ancestors = collectAncestorKeys(treeRoot, node.path);
    setExpandedByRoot((current) => {
      const currentKeys = current[rootKey] ?? [rootKey];
      return { ...current, [rootKey]: [...new Set([...currentKeys, ...ancestors])] };
    });
  }

  function handleCollapseAll() {
    if (!rootKey) return;
    setExpandedByRoot((current) => ({ ...current, [rootKey]: [rootKey] }));
    setRevealRequest(undefined);
  }

  function handleRevealInTree(item: VideoItem) {
    setSelectedDirectory(item.directory);
    if (treeRoot) {
      const node = findTreeNode(treeRoot, item.directory);
      if (node) {
        const ancestors = collectAncestorKeys(treeRoot, node.id);
        setExpandedByRoot((current) => ({
          ...current,
          [rootKey]: [...new Set([...current[rootKey] ?? [rootKey], ...ancestors])]
        }));
      }
    }
    const key = pathKey(item.directory);
    setRevealRequest({ key, nonce: Date.now() });
  }

  function handleTogglePin(path: string) {
    setRecentFolders((current) => {
      const next = togglePin(current, path);
      void window.videoBrowser!.updateSettings({ recentFolders: next });
      return next;
    });
  }

  function handleRemoveHistory(path: string) {
    setRecentFolders((current) => {
      const next = removeHistoryEntry(current, path);
      void window.videoBrowser!.updateSettings({ recentFolders: next });
      return next;
    });
    setInvalidPaths((current) => {
      const next = new Set(current);
      next.delete(path);
      return next;
    });
  }

  function handleVideoKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    if (event.key === "Enter" && selectedItem) {
      event.preventDefault();
      void runContextAction("openVideo", selectedItem);
    } else if (event.key.toLowerCase() === "c" && (event.ctrlKey || event.metaKey) && selectedItem) {
      event.preventDefault();
      void runContextAction("copyPath", selectedItem);
    }
  }

  function handleToggleDetail() {
    if (isNarrow) {
      setDetailSheetOpen((value) => !value);
    } else {
      setDetailPaneOpen((value) => !value);
    }
  }

  // ---- v0.6 悬停多帧预览会话 ----

  function handlePreviewStart(item: VideoItem) {
    if (!hoverPreviewEnabled || !window.videoBrowser) return;
    const requestId = crypto.randomUUID();
    previewRequests.current.set(item.id, requestId);
    setPreviewSession({ videoId: item.id, requestId, state: "loading", frames: [] });
    void window.videoBrowser.previewRequest({ requestId, videoId: item.id, filePath: item.filePath });
  }

  function handlePreviewLeave(videoId: string) {
    const requestId = previewRequests.current.get(videoId);
    if (requestId && window.videoBrowser) {
      void window.videoBrowser.previewCancel(requestId);
    }
    previewRequests.current.delete(videoId);
    setPreviewSession((current) => (current?.videoId === videoId ? undefined : current));
  }

  function refreshPreviewStats(): Promise<PreviewCacheStats> {
    return window.videoBrowser?.previewGetStats() ?? Promise.resolve({ bytes: 0, videoCount: 0, frameCount: 0 });
  }

  async function clearPreviewCache(): Promise<PreviewCacheStats> {
    // 协调进行中的预览：先取消当前会话与全部未完成请求。
    for (const requestId of previewRequests.current.values()) {
      void window.videoBrowser?.previewCancel(requestId);
    }
    previewRequests.current.clear();
    setPreviewSession(undefined);
    return window.videoBrowser?.previewClear() ?? { bytes: 0, videoCount: 0, frameCount: 0 };
  }

  function emptyStateKind(): EmptyStateKind {
    if (!bridgeReady) return "no-bridge";
    if (!folderPath) return "no-folder";
    if (items.length === 0) {
      if (progress.state === "cancelled") return "cancelled";
      if (progress.state === "error") return "error";
      if (isScanning) return "scanning";
      return "no-videos";
    }
    return "no-match";
  }

  const revealKey = revealRequest?.key;
  const revealSignature = revealRequest ? `${revealRequest.key}#${revealRequest.nonce}` : undefined;

  return (
    <div
      className="flex h-screen flex-col overflow-hidden bg-background text-foreground"
      onKeyDown={handleVideoKeyDown}
    >
      <Toolbar
        disabled={!folderPath}
        isScanning={isScanning}
        query={query}
        onQueryChange={setQuery}
        sortKey={sortKey}
        onSortKeyChange={setSortKey}
        ascending={ascending}
        onToggleAscending={() => setAscending((value) => !value)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        thumbSize={thumbSize}
        onThumbSizeChange={setThumbSize}
        extensionOptions={extensionOptions}
        extensionFilter={extensionFilter}
        onExtensionFilterChange={setExtensionFilter}
        durationFilter={durationFilter}
        onDurationFilterChange={setDurationFilter}
        resolutionFilter={resolutionFilter}
        onResolutionFilterChange={setResolutionFilter}
        activeFilterCount={activeFilterCount}
        onClearFilters={clearAllFilters}
        onChooseFolder={() => void chooseFolder()}
        onRefresh={() => void startScan(folderPath)}
        detailOpen={isNarrow ? detailSheetOpen : detailPaneOpen}
        onToggleDetail={handleToggleDetail}
        hoverPreviewEnabled={hoverPreviewEnabled}
        onToggleHoverPreview={() => setHoverPreviewEnabled((value) => !value)}
        hoverPreviewDisabledReason={
          dependencyStatus && !dependencyStatus.ffmpeg.available ? "缺少 ffmpeg，无法生成悬停预览" : undefined
        }
        onRefreshPreviewStats={refreshPreviewStats}
        onClearPreviewCache={clearPreviewCache}
      />

      <ScanNotices dependencyStatus={dependencyStatus} progress={progress} />

      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          width={sidebarWidth}
          history={recentFolders}
          invalidPaths={invalidPaths}
          currentPath={folderPath}
          treeRoot={treeRoot}
          selectedDirectory={selectedDirectory}
          expandedKeys={expandedKeys}
          revealKey={revealSignature}
          onToggleSidebar={() => setSidebarOpen((value) => !value)}
          onResizeWidth={setSidebarWidth}
          onOpenHistory={(path) => void openFolderFromHistory(path)}
          onTogglePin={handleTogglePin}
          onRemoveHistory={handleRemoveHistory}
          onToggleExpand={handleToggleExpand}
          onSelectDirectory={handleSelectDirectory}
          onCollapseAll={handleCollapseAll}
          onOpenInExplorer={(path) => void window.videoBrowser?.showFolderInExplorer(path)}
        />

        <main className="relative min-w-0 flex-1 overflow-auto" role="main">
          {isNarrow ? (
            <DetailPanel
              item={selectedItem}
              rootPath={folderPath}
              open={detailPaneOpen}
              onToggleOpen={() => setDetailPaneOpen((value) => !value)}
              onRevealInTree={handleRevealInTree}
              variant="sheet"
              sheetOpen={detailSheetOpen}
              onSheetOpenChange={setDetailSheetOpen}
            />
          ) : null}
          {!bridgeReady && <EmptyState kind="no-bridge" />}
          {bridgeReady && !folderPath && <EmptyState kind="no-folder" onChooseFolder={() => void chooseFolder()} />}
          {bridgeReady && folderPath && items.length === 0 && (
            <EmptyState kind={emptyStateKind()} scanErrorDetail={progress.scanError?.detail} />
          )}
          {bridgeReady && items.length > 0 && filteredItems.length === 0 && <EmptyState kind="no-match" />}
          {bridgeReady && filteredItems.length > 0 && viewMode === "grid" && (
            <VideoGrid
              items={filteredItems}
              selectedId={selectedId}
              thumbSize={thumbSize}
              hoverPreviewEnabled={hoverPreviewEnabled}
              previewSession={previewSession}
              onSelect={setSelectedId}
              onOpenItem={(item) => void runContextAction("openVideo", item)}
              onShowInFolder={(item) => void runContextAction("showInFolder", item)}
              onCopyPath={(item) => void runContextAction("copyPath", item)}
              onRegenerateThumbnail={(item) => void runContextAction("regenerateThumbnail", item)}
              onPreviewStart={handlePreviewStart}
              onPreviewLeave={handlePreviewLeave}
            />
          )}
          {bridgeReady && filteredItems.length > 0 && viewMode === "list" && (
            <VideoList
              items={filteredItems}
              selectedId={selectedId}
              rootPath={folderPath}
              sortKey={sortKey}
              ascending={ascending}
              onSelect={setSelectedId}
              onChangeSort={changeListSort}
              onOpenItem={(item) => void runContextAction("openVideo", item)}
              onShowInFolder={(item) => void runContextAction("showInFolder", item)}
              onCopyPath={(item) => void runContextAction("copyPath", item)}
              onRegenerateThumbnail={(item) => void runContextAction("regenerateThumbnail", item)}
            />
          )}
        </main>

        {!isNarrow && (
          <DetailPanel
            item={selectedItem}
            rootPath={folderPath}
            open={detailPaneOpen}
            onToggleOpen={() => setDetailPaneOpen((value) => !value)}
            onRevealInTree={handleRevealInTree}
          />
        )}
      </div>

      <StatusBar
        folderPath={folderPath}
        progress={progress}
        shownCount={filteredItems.length}
        dependencyStatus={dependencyStatus}
        notice={notice}
      />

      {dragState && (
        <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-background/70 backdrop-blur-[1px]">
          <div
            className={`rounded-xl border-2 px-8 py-6 text-center ${
              dragState === "folder"
                ? "border-primary bg-primary/10 text-primary"
                : "border-destructive bg-destructive/10 text-destructive"
            }`}
          >
            <p className="m-0 text-lg font-semibold">
              {dragState === "folder" ? "释放以打开此文件夹" : "仅支持拖入单个文件夹"}
            </p>
            <p className="m-0 mt-1 text-sm opacity-80">不会修改目录中的任何文件</p>
          </div>
        </div>
      )}
    </div>
  );
}
