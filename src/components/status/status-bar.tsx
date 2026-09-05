import type { DependencyStatus, ScanProgress, ToolStatus } from "@/shared";
import { Progress } from "@/components/ui/progress";

export type StatusBarProps = {
  folderPath: string;
  progress: ScanProgress;
  shownCount: number;
  dependencyStatus?: DependencyStatus;
  notice?: string;
  onOpenDependencies?: () => void;
};

const sourceLabels: Record<NonNullable<ToolStatus["source"]>, string> = {
  vendor: "应用内",
  custom: "手动指定",
  path: "系统",
  common: "常见位置"
};

/** 依赖徽标文案：应用内 n8.1.2 / 系统 7.1.1 / 未检测到（v0.9 细化）。 */
function dependencyLabel(name: string, status: ToolStatus): string {
  if (!status.available) return `缺少 ${name}`;
  const source = status.source ? sourceLabels[status.source] : "";
  return [name, source, status.version].filter(Boolean).join(" ");
}

export function StatusBar({ folderPath, progress, shownCount, dependencyStatus, notice, onOpenDependencies }: StatusBarProps) {
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
        <button
          type="button"
          className="flex shrink-0 items-center gap-3 rounded px-1 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
          onClick={onOpenDependencies}
          title="查看依赖详情与下载选项"
          aria-label="依赖管理"
        >
          <span className={dependencyStatus.ffmpeg.available ? "text-emerald-400" : "text-destructive"}>
            {dependencyLabel("ffmpeg", dependencyStatus.ffmpeg)}
          </span>
          <span className={dependencyStatus.ffprobe.available ? "text-emerald-400" : "text-destructive"}>
            {dependencyLabel("ffprobe", dependencyStatus.ffprobe)}
          </span>
        </button>
      )}
      {notice && <span className="shrink-0 text-emerald-400">{notice}</span>}
    </footer>
  );
}
