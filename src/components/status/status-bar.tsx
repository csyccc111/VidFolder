import type { DependencyStatus, ScanProgress } from "@/shared";
import { Progress } from "@/components/ui/progress";

export type StatusBarProps = {
  folderPath: string;
  progress: ScanProgress;
  shownCount: number;
  dependencyStatus?: DependencyStatus;
  notice?: string;
};

export function StatusBar({ folderPath, progress, shownCount, dependencyStatus, notice }: StatusBarProps) {
  const isScanning = progress.state === "scanning";
  const percent =
    isScanning && progress.found > 0
      ? Math.min(100, Math.round((progress.processed / progress.found) * 100))
      : progress.found > 0
        ? 100
        : 0;

  return (
    <footer className="flex h-8 shrink-0 items-center gap-4 border-t bg-sidebar px-3 text-xs text-muted-foreground">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="truncate font-mono" title={folderPath}>
          {folderPath || "未选择文件夹"}
        </span>
        {isScanning && (
          <span className="flex w-40 shrink-0 items-center gap-2">
            <Progress value={percent} className="h-1.5 w-24" />
            <span className="whitespace-nowrap">{progress.processed}/{progress.found}</span>
          </span>
        )}
      </div>
      <span className="shrink-0">视频 {progress.found}</span>
      <span className="shrink-0">显示 {shownCount}</span>
      <span className="shrink-0">{progress.message ?? "空闲"}</span>
      <span className="shrink-0">封面 {progress.thumbnailsReady}/{progress.found}</span>
      {progress.failures > 0 && <span className="shrink-0 text-destructive">失败 {progress.failures}</span>}
      {dependencyStatus && (
        <>
          <span className="shrink-0">
            <span className={dependencyStatus.ffmpeg.available ? "text-emerald-400" : "text-destructive"}>
              {dependencyStatus.ffmpeg.available ? "ffmpeg 正常" : "缺少 ffmpeg"}
            </span>
          </span>
          <span className="shrink-0">
            <span className={dependencyStatus.ffprobe.available ? "text-emerald-400" : "text-destructive"}>
              {dependencyStatus.ffprobe.available ? "ffprobe 正常" : "缺少 ffprobe"}
            </span>
          </span>
        </>
      )}
      {notice && <span className="shrink-0 text-emerald-400">{notice}</span>}
    </footer>
  );
}
