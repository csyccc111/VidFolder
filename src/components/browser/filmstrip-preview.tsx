import type { PreviewFrame } from "@/shared";
import { formatDuration } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 列表视图悬停预览的胶片预览条浮层（v0.7）：
 * 8 帧一排横向排列，当前帧高亮，底部显示当前帧时间。
 * 帧切换由父级行组件根据鼠标水平位置驱动（本组件只负责展示与高亮）。
 */
export type FilmstripPreviewProps = {
  frames: PreviewFrame[];
  frameIndex: number;
  /** 是否正在加载（无帧数据时显示占位）。 */
  loading?: boolean;
  failed?: boolean;
  className?: string;
};

export function FilmstripPreview({ frames, frameIndex, loading = false, failed = false, className }: FilmstripPreviewProps) {
  const current = frames[frameIndex] ?? frames[0];
  return (
    <div
      className={cn(
        "pointer-events-auto rounded-lg border border-border bg-card p-1.5 shadow-xl",
        className
      )}
      role="presentation"
    >
      {frames.length > 0 ? (
        <>
          <div className="flex gap-1">
            {frames.map((frame, index) => (
              <img
                key={frame.imageUrl}
                src={frame.imageUrl}
                alt=""
                draggable={false}
                className={cn(
                  "h-12 w-20 rounded object-cover",
                  index === frameIndex ? "ring-2 ring-sky-400" : "opacity-80 hover:opacity-100"
                )}
              />
            ))}
          </div>
          <div className="mt-1 flex items-center justify-between px-0.5 text-[11px]">
            <span className="font-mono text-foreground">
              {current ? formatDuration(current.timestamp) : "--:--"}
            </span>
            <span className="text-muted-foreground">悬停切换帧</span>
          </div>
        </>
      ) : (
        <div className="grid h-14 w-56 place-items-center text-xs text-muted-foreground">
          {failed ? "预览不可用" : loading ? "正在生成预览帧…" : ""}
        </div>
      )}
    </div>
  );
}
