import { AlertCircle, AlertTriangle, Download, Wrench } from "lucide-react";
import type { DependencyStatus, ScanProgress } from "@/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export type ScanNoticesProps = {
  dependencyStatus?: DependencyStatus;
  progress: ScanProgress;
  onOpenDependencies?: () => void;
};

export function ScanNotices({ dependencyStatus, progress, onOpenDependencies }: ScanNoticesProps) {
  const missingTools = [
    dependencyStatus?.ffmpeg.available === false ? "ffmpeg" : undefined,
    dependencyStatus?.ffprobe.available === false ? "ffprobe" : undefined
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-1.5 px-3 pb-2">
      {missingTools.length > 0 && (
        <Alert className="border-amber-500/40 bg-amber-500/10 py-2 text-amber-300">
          <Wrench className="size-4" />
          <AlertTitle className="text-xs">缺少 {missingTools.join("、")}</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-2 text-xs text-amber-300/90">
            <span>已有缓存仍可浏览，但新视频的封面或时长/分辨率可能无法生成。</span>
            {onOpenDependencies && (
              <Button
                size="sm"
                variant="outline"
                className="h-6 shrink-0 gap-1 border-amber-500/40 px-2 text-xs text-amber-300 hover:bg-amber-500/10 hover:text-amber-200"
                onClick={onOpenDependencies}
              >
                <Download className="size-3.5" />
                下载 ffmpeg
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {progress.state === "error" && progress.scanError && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="size-4" />
          <AlertTitle className="text-xs">扫描失败：{progress.scanError.message}</AlertTitle>
          {progress.scanError.detail && (
            <AlertDescription className="text-xs" title={progress.scanError.detail}>
              悬停查看技术详情
            </AlertDescription>
          )}
        </Alert>
      )}
      {progress.warningCount > 0 && (
        <Alert className="border-yellow-500/40 bg-yellow-500/10 py-2 text-yellow-300">
          <AlertTriangle className="size-4" />
          <AlertTitle className="text-xs">
            扫描期间有 {progress.warningCount} 个文件夹无法访问，已跳过；其它视频不受影响。
          </AlertTitle>
          {progress.warnings.length > 0 && (
            <AlertDescription className="max-h-24 overflow-auto text-xs text-yellow-300/90" title={progress.warnings.join("\n")}>
              {progress.warnings.join("、")}
            </AlertDescription>
          )}
        </Alert>
      )}
    </div>
  );
}
