import { useCallback, useEffect } from "react";
import { ArrowDown, ArrowUp, Film, Loader2 } from "lucide-react";
import type { VideoItem } from "@/shared";
import type { SortKey } from "@/lib/filter";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { getRelativeDirectory } from "@/lib/path";
import { VideoContextMenuContent } from "./video-card";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

type VideoListProps = {
  items: VideoItem[];
  selectedId?: string;
  rootPath: string;
  sortKey: SortKey;
  ascending: boolean;
  showCodecColumn: boolean;
  onSelect: (id: string) => void;
  onChangeSort: (key: SortKey) => void;
  onOpenItem: (item: VideoItem) => void;
  onShowInFolder: (item: VideoItem) => void;
  onCopyPath: (item: VideoItem) => void;
  onRegenerateThumbnail: (item: VideoItem) => void;
};

const baseColumns = ["文件名", "时长", "大小", "分辨率", "修改时间", "所在文件夹"] as const;
const sortableColumns: Array<{ key: SortKey; label: string }> = [
  { key: "fileName", label: "文件名" },
  { key: "duration", label: "时长" },
  { key: "size", label: "大小" },
  { key: "modifiedAt", label: "修改时间" }
];

const baseGridTemplate = "minmax(220px,2fr) 86px 92px 108px 146px minmax(180px,1fr)";
/** 编码列插入"分辨率"之后：文件名 时长 大小 分辨率 编码 修改时间 所在文件夹。 */
const codecGridTemplate = "minmax(220px,2fr) 86px 92px 108px 78px 146px minmax(180px,1fr)";

export function VideoList({
  items,
  selectedId,
  rootPath,
  sortKey,
  ascending,
  showCodecColumn,
  onSelect,
  onChangeSort,
  onOpenItem,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail
}: VideoListProps) {
  const columns = showCodecColumn
    ? ["文件名", "时长", "大小", "分辨率", "编码", "修改时间", "所在文件夹"]
    : [...baseColumns];
  const gridTemplate = showCodecColumn ? codecGridTemplate : baseGridTemplate;

  useEffect(() => {
    if (!selectedId) return;
    document
      .querySelector(`[data-video-id="${CSS.escape(selectedId)}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const moveSelection = useCallback(
    (delta: number) => {
      const index = items.findIndex((item) => item.id === selectedId);
      if (index === -1) return;
      const next = Math.max(0, Math.min(items.length - 1, index + delta));
      onSelect(items[next].id);
    },
    [items, selectedId, onSelect]
  );

  function handleKeyDown(event: React.KeyboardEvent) {
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable)) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      moveSelection(-1);
    }
  }

  return (
    <div
      role="table"
      aria-label="视频列表"
      onKeyDown={handleKeyDown}
      className="m-4 min-w-760 rounded-lg border"
    >
      <div role="row" className="grid h-9 items-center gap-3 border-b bg-muted/60 px-3 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: gridTemplate }}>
        {columns.map((label, index) => {
          const sortable = sortableColumns.find((entry) => entry.label === label);
          if (!sortable) {
            return <span key={label}>{label}</span>;
          }
          const isActive = sortKey === sortable.key;
          return (
            <button
              key={label}
              className={cn(
                "flex items-center gap-1 text-left hover:text-foreground",
                isActive && "text-foreground"
              )}
              onClick={() => onChangeSort(sortable.key)}
            >
              {label}
              {isActive && (ascending ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
            </button>
          );
        })}
      </div>
      {items.map((item) => (
        <ListRow
          key={item.id}
          item={item}
          selected={selectedId === item.id}
          rootPath={rootPath}
          showCodecColumn={showCodecColumn}
          gridTemplate={gridTemplate}
          onSelect={() => onSelect(item.id)}
          onOpen={() => onOpenItem(item)}
          onShowInFolder={() => onShowInFolder(item)}
          onCopyPath={() => onCopyPath(item)}
          onRegenerateThumbnail={() => onRegenerateThumbnail(item)}
        />
      ))}
    </div>
  );
}

function ListRow({
  item,
  selected,
  rootPath,
  showCodecColumn,
  gridTemplate,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail
}: {
  item: VideoItem;
  selected: boolean;
  rootPath: string;
  showCodecColumn: boolean;
  gridTemplate: string;
  onSelect: () => void;
  onOpen: () => void;
  onShowInFolder: () => void;
  onCopyPath: () => void;
  onRegenerateThumbnail: () => void;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          data-video-id={item.id}
          role="row"
          tabIndex={selected ? 0 : -1}
          aria-selected={selected}
          className={cn(
            "relative grid min-h-9 cursor-pointer items-center gap-3 border-b border-muted/40 px-3 text-[13px] outline-none last:border-b-0",
            "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60",
            selected && "bg-accent text-accent-foreground"
          )}
          style={{ gridTemplateColumns: gridTemplate }}
          onClick={onSelect}
          onDoubleClick={onOpen}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="relative h-9 w-16 shrink-0 overflow-hidden rounded bg-black">
              {item.thumbnailPath && item.thumbnailStatus === "ready" ? (
                <img
                  src={item.thumbnailPath}
                  alt=""
                  loading="lazy"
                  className="block h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <span className="grid h-full w-full place-items-center">
                  {item.thumbnailStatus === "failed" ? (
                    <Film className="size-3.5 text-destructive" />
                  ) : (
                    <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                  )}
                </span>
              )}
            </span>
            <span className="truncate font-medium" title={item.filePath}>
              {item.fileName}
            </span>
          </span>
          <span className="truncate">{formatDuration(item.duration)}</span>
          <span className="truncate">{formatBytes(item.size)}</span>
          <span className="truncate">{item.width && item.height ? `${item.width} × ${item.height}` : "未读取"}</span>
          {showCodecColumn && (
            <span className="truncate" title={item.videoCodec}>
              {item.codecShortName ?? "未读取"}
            </span>
          )}
          <span className="truncate">{formatDate(item.modifiedAt)}</span>
          <span className="truncate text-muted-foreground" title={item.directory}>
            {getRelativeDirectory(rootPath, item.directory)}
          </span>
        </div>
      </ContextMenuTrigger>
      <VideoContextMenuContent
        item={item}
        onShowInFolder={onShowInFolder}
        onOpen={onOpen}
        onCopyPath={onCopyPath}
        onRegenerateThumbnail={onRegenerateThumbnail}
      />
    </ContextMenu>
  );
}
