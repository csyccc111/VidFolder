import { useCallback, useEffect } from "react";
import type { VideoItem } from "@/shared";
import type { SortKey } from "@/lib/filter";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { getRelativeDirectory } from "@/lib/path";
import { VideoContextMenuContent } from "./video-card";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";

type VideoListProps = {
  items: VideoItem[];
  selectedId?: string;
  rootPath: string;
  sortKey: SortKey;
  ascending: boolean;
  onSelect: (id: string) => void;
  onChangeSort: (key: SortKey) => void;
  onOpenItem: (item: VideoItem) => void;
  onShowInFolder: (item: VideoItem) => void;
  onCopyPath: (item: VideoItem) => void;
  onRegenerateThumbnail: (item: VideoItem) => void;
};

const columns = ["文件名", "时长", "大小", "分辨率", "修改时间", "所在文件夹"] as const;
const sortableIndexes: Array<{ key: SortKey; index: number }> = [
  { key: "fileName", index: 0 },
  { key: "duration", index: 1 },
  { key: "size", index: 2 },
  { key: "modifiedAt", index: 4 }
];

export function VideoList({
  items,
  selectedId,
  rootPath,
  sortKey,
  ascending,
  onSelect,
  onChangeSort,
  onOpenItem,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail
}: VideoListProps) {
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
      className="m-4 min-w-760 overflow-hidden rounded-lg border bg-card"
    >
      <div role="row" className="grid h-9 items-center gap-3 border-b bg-muted/60 px-3 text-xs font-medium text-muted-foreground" style={{ gridTemplateColumns: "minmax(220px,2fr) 86px 92px 108px 146px minmax(180px,1fr)" }}>
        {columns.map((label, index) => {
          const sortable = sortableIndexes.find((entry) => entry.index === index);
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
      {items.map((item) => {
        const selected = selectedId === item.id;
        return (
          <ContextMenu key={item.id}>
            <ContextMenuTrigger asChild>
              <div
                data-video-id={item.id}
                role="row"
                tabIndex={selected ? 0 : -1}
                aria-selected={selected}
                className={cn(
                  "grid min-h-9 cursor-pointer items-center gap-3 border-b border-muted/40 px-3 text-[13px] outline-none last:border-b-0",
                  "hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring/60",
                  selected && "bg-accent text-accent-foreground"
                )}
                style={{ gridTemplateColumns: "minmax(220px,2fr) 86px 92px 108px 146px minmax(180px,1fr)" }}
                onClick={() => onSelect(item.id)}
                onDoubleClick={() => onOpenItem(item)}
              >
                <span className="truncate font-medium" title={item.filePath}>
                  {item.fileName}
                </span>
                <span className="truncate">{formatDuration(item.duration)}</span>
                <span className="truncate">{formatBytes(item.size)}</span>
                <span className="truncate">{item.width && item.height ? `${item.width} × ${item.height}` : "未读取"}</span>
                <span className="truncate">{formatDate(item.modifiedAt)}</span>
                <span className="truncate text-muted-foreground" title={item.directory}>
                  {getRelativeDirectory(rootPath, item.directory)}
                </span>
              </div>
            </ContextMenuTrigger>
            <VideoContextMenuContent
              item={item}
              onShowInFolder={() => onShowInFolder(item)}
              onOpen={() => onOpenItem(item)}
              onCopyPath={() => onCopyPath(item)}
              onRegenerateThumbnail={() => onRegenerateThumbnail(item)}
            />
          </ContextMenu>
        );
      })}
    </div>
  );
}
