import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Database, Eye, EyeOff, FolderOpen, LayoutGrid, List, PanelRight, RefreshCw, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
import type { DurationFilter, ResolutionFilter, SortKey, ThumbSize, ViewMode } from "@/lib/filter";
import type { PreviewCacheStats } from "@/shared";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export const sortLabels: Record<SortKey, string> = {
  fileName: "文件名",
  modifiedAt: "修改时间",
  size: "文件大小",
  duration: "时长"
};

export const durationLabels: Record<DurationFilter, string> = {
  all: "全部时长",
  short: "1 分钟内",
  medium: "1-20 分钟",
  long: "20 分钟以上"
};

export const resolutionLabels: Record<ResolutionFilter, string> = {
  all: "全部画面",
  landscape: "横屏",
  portrait: "竖屏",
  square: "方形",
  hd: "720p+",
  fhd: "1080p+",
  uhd: "4K+"
};

type ToolbarProps = {
  disabled: boolean;
  isScanning: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  sortKey: SortKey;
  onSortKeyChange: (value: SortKey) => void;
  ascending: boolean;
  onToggleAscending: () => void;
  viewMode: ViewMode;
  onViewModeChange: (value: ViewMode) => void;
  thumbSize: ThumbSize;
  onThumbSizeChange: (value: ThumbSize) => void;
  extensionOptions: string[];
  extensionFilter: string;
  onExtensionFilterChange: (value: string) => void;
  durationFilter: DurationFilter;
  onDurationFilterChange: (value: DurationFilter) => void;
  resolutionFilter: ResolutionFilter;
  onResolutionFilterChange: (value: ResolutionFilter) => void;
  activeFilterCount: number;
  onClearFilters: () => void;
  onChooseFolder: () => void;
  onRefresh: () => void;
  detailOpen: boolean;
  onToggleDetail: () => void;
  hoverPreviewEnabled: boolean;
  onToggleHoverPreview: () => void;
  hoverPreviewDisabledReason?: string;
  showCodecColumn: boolean;
  onToggleCodecColumn: () => void;
  onRefreshPreviewStats: () => Promise<PreviewCacheStats>;
  onClearPreviewCache: () => Promise<PreviewCacheStats>;
};

export function Toolbar({
  disabled,
  isScanning,
  query,
  onQueryChange,
  sortKey,
  onSortKeyChange,
  ascending,
  onToggleAscending,
  viewMode,
  onViewModeChange,
  thumbSize,
  onThumbSizeChange,
  extensionOptions,
  extensionFilter,
  onExtensionFilterChange,
  durationFilter,
  onDurationFilterChange,
  resolutionFilter,
  onResolutionFilterChange,
  activeFilterCount,
  onClearFilters,
  onChooseFolder,
  onRefresh,
  detailOpen,
  onToggleDetail,
  hoverPreviewEnabled,
  onToggleHoverPreview,
  hoverPreviewDisabledReason,
  showCodecColumn,
  onToggleCodecColumn,
  onRefreshPreviewStats,
  onClearPreviewCache
}: ToolbarProps) {
  const thumbSizes: Array<{ value: ThumbSize; label: string }> = [
    { value: "small", label: "小" },
    { value: "medium", label: "中" },
    { value: "large", label: "大" }
  ];

  const [cachePopoverOpen, setCachePopoverOpen] = useState(false);
  const [previewStats, setPreviewStats] = useState<PreviewCacheStats>();
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (cachePopoverOpen) {
      void onRefreshPreviewStats().then(setPreviewStats);
    }
  }, [cachePopoverOpen, onRefreshPreviewStats]);

  const hoverToggle = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={hoverPreviewEnabled ? "secondary" : "outline"}
          size="icon"
          onClick={onToggleHoverPreview}
          disabled={Boolean(hoverPreviewDisabledReason)}
          aria-label="切换悬停预览"
          aria-pressed={hoverPreviewEnabled}
        >
          {hoverPreviewEnabled ? <Eye /> : <EyeOff />}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {hoverPreviewDisabledReason ?? (hoverPreviewEnabled ? "悬停预览已开启" : "悬停预览已关闭")}
      </TooltipContent>
    </Tooltip>
  );

  return (
    <header className="flex flex-wrap items-center gap-2 border-b bg-sidebar px-3 py-2">
      <Button onClick={onChooseFolder}>
        <FolderOpen data-icon="inline-start" />
        选择文件夹
      </Button>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" disabled={disabled || isScanning} onClick={onRefresh}>
            <RefreshCw data-icon="inline-start" />
            刷新
          </Button>
        </TooltipTrigger>
        <TooltipContent>重新扫描当前文件夹</TooltipContent>
      </Tooltip>

      <Separator orientation="vertical" className="h-6" />

      <div className="relative min-w-0 flex-1 basis-48">
        <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索文件名"
          className="h-8 pl-8"
          aria-label="搜索文件名"
        />
      </div>

      <Tooltip>
        <TooltipTrigger asChild>
          <Select value={sortKey} onValueChange={(value) => onSortKeyChange(value as SortKey)}>
            <SelectTrigger className="h-8 w-32" aria-label="排序字段">
              <SelectValue placeholder="排序" />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(sortLabels).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </TooltipTrigger>
        <TooltipContent>排序字段</TooltipContent>
      </Tooltip>
      <Button
        variant="outline"
        size="icon"
        onClick={onToggleAscending}
        title={ascending ? "升序" : "降序"}
        aria-label={ascending ? "切换为降序" : "切换为升序"}
      >
        {ascending ? <ArrowUp /> : <ArrowDown />}
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <ToggleGroup
        type="single"
        value={viewMode}
        onValueChange={(value) => {
          if (value) onViewModeChange(value as ViewMode);
        }}
        className="gap-0 rounded-lg border"
      >
        <ToggleGroupItem value="grid" className="size-8 rounded-r-none rounded-l-lg" aria-label="网格视图" title="网格视图">
          <LayoutGrid />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" className="size-8 rounded-l-none rounded-r-lg" aria-label="列表视图" title="列表视图">
          <List />
        </ToggleGroupItem>
      </ToggleGroup>

      <ToggleGroup
        type="single"
        value={viewMode === "list" ? thumbSize : thumbSize}
        onValueChange={(value) => {
          if (value) onThumbSizeChange(value as ThumbSize);
        }}
        className="gap-0 rounded-lg border"
        aria-label="缩略图大小"
      >
        {thumbSizes.map((size, index) => (
          <ToggleGroupItem
            key={size.value}
            value={size.value}
            disabled={viewMode === "list"}
            className={cn(
              "h-8 px-2 text-xs",
              index === 0 ? "rounded-l-lg rounded-r-none" : index === thumbSizes.length - 1 ? "rounded-l-none rounded-r-lg" : "rounded-none"
            )}
            aria-label={`缩略图${size.label}`}
            title={`缩略图${size.label}`}
          >
            {size.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <Separator orientation="vertical" className="h-6" />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="relative" title="筛选">
            <SlidersHorizontal data-icon="inline-start" />
            筛选
            {activeFilterCount > 0 && (
              <span className="ml-1 grid min-w-4 place-items-center rounded-full bg-primary px-1 text-[10px] leading-4 text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">筛选条件</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={activeFilterCount === 0}
              onClick={onClearFilters}
            >
              <X />
              清除
            </Button>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">格式</label>
            <Select value={extensionFilter} onValueChange={onExtensionFilterChange}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="全部格式" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部格式</SelectItem>
                {extensionOptions.map((extension) => (
                  <SelectItem key={extension} value={extension}>
                    {extension.replace(".", "").toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">时长</label>
            <Select
              value={durationFilter}
              onValueChange={(value) => onDurationFilterChange(value as DurationFilter)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(durationLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">画面</label>
            <Select
              value={resolutionFilter}
              onValueChange={(value) => onResolutionFilterChange(value as ResolutionFilter)}
            >
              <SelectTrigger className="h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(resolutionLabels).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <label className="text-xs text-muted-foreground">显示编码列</label>
            <Toggle
              pressed={showCodecColumn}
              onPressedChange={onToggleCodecColumn}
              aria-label="列表视图显示编码列"
              title="在列表视图中显示视频编码列"
            >
              编码
            </Toggle>
          </div>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-6" />

      {hoverToggle}

      <Popover open={cachePopoverOpen} onOpenChange={setCachePopoverOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="icon" title="预览缓存" aria-label="预览缓存管理">
            <Database />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">悬停预览缓存</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-xs"
              disabled={clearing || !previewStats || previewStats.videoCount === 0}
              onClick={async () => {
                setClearing(true);
                try {
                  const stats = await onClearPreviewCache();
                  setPreviewStats(stats);
                } finally {
                  setClearing(false);
                }
              }}
            >
              <Trash2 />
              清理
            </Button>
          </div>
          {previewStats ? (
            <dl className="space-y-1 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">占用空间</dt>
                <dd className="m-0 font-mono">{formatBytes(previewStats.bytes)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">视频组</dt>
                <dd className="m-0 font-mono">{previewStats.videoCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">帧总数</dt>
                <dd className="m-0 font-mono">{previewStats.frameCount}</dd>
              </div>
            </dl>
          ) : (
            <p className="text-xs text-muted-foreground">读取中…</p>
          )}
          <p className="text-[11px] text-muted-foreground">
            悬停网格封面时按需生成预览帧，仅存于应用数据目录，可随时清理。
          </p>
        </PopoverContent>
      </Popover>

      <Separator orientation="vertical" className="h-6" />

      <Button
        variant={detailOpen ? "secondary" : "outline"}
        size="icon"
        onClick={onToggleDetail}
        title={detailOpen ? "收起详情" : "打开详情"}
        aria-label="切换详情面板"
        aria-pressed={detailOpen}
      >
        <PanelRight />
      </Button>
    </header>
  );
}
