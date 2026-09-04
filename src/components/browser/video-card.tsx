import { Film } from "lucide-react";
import type { VideoItem } from "@/shared";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

export type VideoCardProps = {
  item: VideoItem;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onShowInFolder: () => void;
  onCopyPath: () => void;
  onRegenerateThumbnail: () => void;
};

export function VideoCard({
  item,
  selected,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail
}: VideoCardProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          data-video-id={item.id}
          className={cn(
            "group relative overflow-hidden rounded-lg border bg-card text-card-foreground",
            "transition-colors duration-120",
            selected ? "border-ring bg-accent/60" : "border-border hover:border-ring/60 hover:bg-muted/50"
          )}
          onClick={onSelect}
          onDoubleClick={onOpen}
        >
          <div className="relative aspect-video bg-black">
            {item.thumbnailPath && item.thumbnailStatus === "ready" ? (
              <img
                src={item.thumbnailPath}
                alt=""
                loading="lazy"
                className="block h-full w-full object-cover"
                draggable={false}
              />
            ) : (
              <div className="grid h-full w-full place-items-center bg-gradient-to-br from-muted/10 to-muted/40">
                <span
                  className={cn(
                    "flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs",
                    item.thumbnailStatus === "failed"
                      ? "border-destructive/40 bg-background/70 text-destructive"
                      : "border-border bg-background/70 text-muted-foreground"
                  )}
                >
                  <Film className="size-3.5" />
                  {item.thumbnailStatus === "failed" ? "封面失败" : "生成中"}
                </span>
              </div>
            )}

            <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
              {formatDuration(item.duration)}
            </span>
          </div>
          <div className="space-y-1 p-2.5">
            <div className="truncate text-[13px] font-medium" title={item.fileName}>
              {item.fileName}
            </div>
            <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
              <span className="truncate">{formatBytes(item.size)}</span>
              <span className="shrink-0">{formatDate(item.modifiedAt)}</span>
            </div>
          </div>
        </article>
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

export function VideoContextMenuContent({
  item,
  onShowInFolder,
  onOpen,
  onCopyPath,
  onRegenerateThumbnail
}: {
  item: VideoItem;
  onShowInFolder: () => void;
  onOpen: () => void;
  onCopyPath: () => void;
  onRegenerateThumbnail: () => void;
}) {
  return (
    <ContextMenuContent>
      <ContextMenuItem onSelect={onShowInFolder}>打开所在目录</ContextMenuItem>
      <ContextMenuItem onSelect={onOpen}>用默认播放器打开</ContextMenuItem>
      <ContextMenuItem onSelect={onCopyPath}>复制完整路径</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={onRegenerateThumbnail}>重新生成封面</ContextMenuItem>
    </ContextMenuContent>
  );
}
