import { useCallback, useEffect, useRef, useState } from "react";
import type { VideoItem } from "@/shared";
import { VideoCard, type PreviewSessionInfo } from "./video-card";
import { cn } from "@/lib/utils";

type VideoGridProps = {
  items: VideoItem[];
  selectedId?: string;
  thumbSize: "small" | "medium" | "large";
  hoverPreviewEnabled: boolean;
  previewSession?: PreviewSessionInfo;
  onSelect: (id: string) => void;
  onOpenItem: (item: VideoItem) => void;
  onShowInFolder: (item: VideoItem) => void;
  onCopyPath: (item: VideoItem) => void;
  onRegenerateThumbnail: (item: VideoItem) => void;
  onPreviewStart: (item: VideoItem) => void;
  onPreviewLeave: (videoId: string) => void;
};

const thumbMinWidths: Record<string, number> = {
  small: 180,
  medium: 230,
  large: 300
};

export function VideoGrid({
  items,
  selectedId,
  thumbSize,
  hoverPreviewEnabled,
  previewSession,
  onSelect,
  onOpenItem,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail,
  onPreviewStart,
  onPreviewLeave
}: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(4);

  // 计算实际列数（跟随容器宽度与缩略图尺寸），供键盘方向键使用。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => {
      const computed = getComputedStyle(container);
      const count = computed.gridTemplateColumns.split(" ").filter((value) => value.trim() !== "").length;
      if (count > 0) setColumns(count);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [thumbSize, items.length]);

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
    if (isEditingTarget(event.target)) return;
    const handled = (action: () => void) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    switch (event.key) {
      case "ArrowRight":
        handled(() => moveSelection(1));
        break;
      case "ArrowLeft":
        handled(() => moveSelection(-1));
        break;
      case "ArrowDown":
        handled(() => moveSelection(columns));
        break;
      case "ArrowUp":
        handled(() => moveSelection(-columns));
        break;
    }
  }

  return (
    <div
      ref={containerRef}
      role="grid"
      aria-label="视频网格"
      tabIndex={items.length > 0 ? 0 : -1}
      className={cn(
        "grid gap-3.5 p-4 outline-none",
        thumbSize === "small" && "grid-cols-[repeat(auto-fill,minmax(180px,1fr))]",
        thumbSize === "medium" && "grid-cols-[repeat(auto-fill,minmax(230px,1fr))]",
        thumbSize === "large" && "grid-cols-[repeat(auto-fill,minmax(300px,1fr))]"
      )}
      onKeyDown={handleKeyDown}
      style={{ minWidth: thumbMinWidths[thumbSize] }}
    >
      {items.map((item) => (
        <div key={item.id} role="gridcell" className={cn("outline-none", selectedId === item.id && "ring-2 ring-ring ring-offset-2 ring-offset-background rounded-lg")}>
          <VideoCard
            item={item}
            selected={selectedId === item.id}
            hoverPreviewEnabled={hoverPreviewEnabled}
            previewSession={previewSession}
            onSelect={() => onSelect(item.id)}
            onOpen={() => onOpenItem(item)}
            onShowInFolder={() => onShowInFolder(item)}
            onCopyPath={() => onCopyPath(item)}
            onRegenerateThumbnail={() => onRegenerateThumbnail(item)}
            onPreviewStart={onPreviewStart}
            onPreviewLeave={onPreviewLeave}
          />
        </div>
      ))}
    </div>
  );
}

/** 键盘操作在输入类控件中不触发。 */
export function isEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}
