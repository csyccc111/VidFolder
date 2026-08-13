import { useEffect, useRef, useState } from "react";
import { Film, Loader2 } from "lucide-react";
import type { ItemError, PreviewFrame, PreviewState, VideoItem } from "@/shared";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

/** 悬停 400ms 后激活预览；指针移动更新帧的节流间隔。 */
export const PREVIEW_ACTIVATE_DELAY_MS = 400;
const PREVIEW_MOVE_THROTTLE_MS = 60;

export type PreviewSessionInfo = {
  requestId: string;
  videoId: string;
  state: PreviewState;
  frames: PreviewFrame[];
  error?: ItemError;
};

export type VideoCardProps = {
  item: VideoItem;
  selected: boolean;
  hoverPreviewEnabled: boolean;
  previewSession?: PreviewSessionInfo;
  onSelect: () => void;
  onOpen: () => void;
  onShowInFolder: () => void;
  onCopyPath: () => void;
  onRegenerateThumbnail: () => void;
  onPreviewStart: (item: VideoItem) => void;
  onPreviewLeave: (videoId: string) => void;
};

export function VideoCard({
  item,
  selected,
  hoverPreviewEnabled,
  previewSession,
  onSelect,
  onOpen,
  onShowInFolder,
  onCopyPath,
  onRegenerateThumbnail,
  onPreviewStart,
  onPreviewLeave
}: VideoCardProps) {
  const [hoverActive, setHoverActive] = useState(false);
  const [frameIndex, setFrameIndex] = useState(0);
  const timerRef = useRef<number | undefined>(undefined);
  const lastMoveRef = useRef(0);

  const sessionForThis = previewSession?.videoId === item.id ? previewSession : undefined;
  const frames = sessionForThis?.frames ?? [];
  const previewFailed = sessionForThis?.state === "failed";
  const showPreview = hoverActive && !previewFailed;
  const currentFrame = frames[frameIndex] ?? frames[0];

  // 悬停激活时预加载全部帧，缓存命中即时切换；离开时释放引用。
  useEffect(() => {
    if (!showPreview || frames.length === 0) return;
    const images = frames.map((frame) => {
      const image = new Image();
      image.src = frame.imageUrl;
      return image;
    });
    return () => {
      for (const image of images) image.src = "";
    };
  }, [showPreview, frames]);

  // 组件卸载时清理计时器与悬停状态。
  useEffect(() => {
    return () => {
      if (timerRef.current !== undefined) window.clearTimeout(timerRef.current);
    };
  }, []);

  // 同一时刻只允许一个可见预览：本卡片的会话结束（切换到他卡片）时立即恢复静态封面。
  useEffect(() => {
    if (!sessionForThis && hoverActive) setHoverActive(false);
  }, [sessionForThis, hoverActive]);

  function handlePointerEnter() {
    // 已有本卡片的会话或未启用时不重复启动；其他卡片的会话由新请求自然接管。
    if (!hoverPreviewEnabled || sessionForThis) return;
    timerRef.current = window.setTimeout(() => {
      setHoverActive(true);
      setFrameIndex(0);
      onPreviewStart(item);
    }, PREVIEW_ACTIVATE_DELAY_MS);
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!hoverActive || frames.length === 0) return;
    const now = performance.now();
    if (now - lastMoveRef.current < PREVIEW_MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.min(frames.length - 1, Math.floor(fraction * frames.length));
    if (index !== frameIndex) setFrameIndex(index);
  }

  function handlePointerLeave() {
    if (timerRef.current !== undefined) {
      window.clearTimeout(timerRef.current);
      timerRef.current = undefined;
    }
    setHoverActive(false);
    setFrameIndex(0);
    onPreviewLeave(item.id);
  }

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
          onPointerEnter={handlePointerEnter}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          <div className="relative aspect-video bg-black">
            {item.thumbnailPath && item.thumbnailStatus === "ready" ? (
              <img
                src={item.thumbnailPath}
                alt=""
                loading="lazy"
                className={cn("block h-full w-full object-cover", showPreview && "opacity-0")}
                draggable={false}
              />
            ) : (
              <div
                className={cn(
                  "grid h-full w-full place-items-center bg-gradient-to-br from-muted/10 to-muted/40",
                  showPreview && "opacity-0"
                )}
              >
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

            {/* 悬停多帧预览层：不改变布局，不拦截指针事件。 */}
            {showPreview && (
              <div className="pointer-events-none absolute inset-0">
                {currentFrame ? (
                  <img
                    key={`${currentFrame.imageUrl}-${currentFrame.timestamp}`}
                    src={currentFrame.imageUrl}
                    alt=""
                    className="h-full w-full object-cover"
                    draggable={false}
                  />
                ) : (
                  <div className="grid h-full w-full place-items-center bg-black/40">
                    <Loader2 className="size-5 animate-spin text-white/80" />
                  </div>
                )}
              </div>
            )}

            <span className="absolute right-1.5 bottom-1.5 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[11px] text-white">
              {showPreview && currentFrame ? formatDuration(currentFrame.timestamp) : formatDuration(item.duration)}
            </span>
            {hoverActive && previewFailed && (
              <span className="absolute top-1.5 left-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] text-amber-300">
                预览不可用
              </span>
            )}
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
