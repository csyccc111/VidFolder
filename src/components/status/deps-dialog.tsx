import { useState } from "react";
import { Download, Loader2, RefreshCw, RotateCcw } from "lucide-react";
import type { DependencyDownloadState, DependencyStatus, DependencyTool, ToolStatus } from "@/shared";
import { FFMPEG_DOWNLOAD_MANIFEST } from "@/lib/deps-core";
import { formatBytes } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

const sourceLabels: Record<NonNullable<ToolStatus["source"]>, string> = {
  vendor: "应用内",
  custom: "手动指定",
  path: "系统 PATH",
  common: "常见位置"
};

const phaseLabels: Record<DependencyDownloadState["phase"], string> = {
  idle: "等待开始",
  downloading: "下载中",
  verifying: "校验中",
  extracting: "解压中",
  done: "完成",
  failed: "失败",
  cancelled: "已取消"
};

export type DepsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dependencyStatus?: DependencyStatus;
  downloadState: DependencyDownloadState;
  onRedetect: () => void;
  onStartDownload: () => void;
  onCancelDownload: () => void;
  onRestoreSystem: () => void;
  onEnableVendor: () => void;
  onSetCustomPath: (tool: DependencyTool, filePath: string | undefined) => void;
};

/** 依赖管理对话框（v0.9）：来源/版本展示、按需下载、系统版本切换、手动指定路径。 */
export function DepsDialog({
  open,
  onOpenChange,
  dependencyStatus,
  downloadState,
  onRedetect,
  onStartDownload,
  onCancelDownload,
  onRestoreSystem,
  onEnableVendor,
  onSetCustomPath
}: DepsDialogProps) {
  const isDownloading = downloadState.phase === "downloading" || downloadState.phase === "verifying" || downloadState.phase === "extracting";
  const anyMissing = dependencyStatus ? !dependencyStatus.ffmpeg.available || !dependencyStatus.ffprobe.available : false;
  const downloadPercent =
    downloadState.totalBytes > 0 ? Math.min(100, Math.round((downloadState.receivedBytes / downloadState.totalBytes) * 100)) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl" aria-label="依赖管理">
        <DialogHeader>
          <DialogTitle>依赖管理</DialogTitle>
          <DialogDescription>
            ffmpeg / ffprobe 用于读取视频信息与生成封面；缺失时可在应用内下载（不随安装包分发）。
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <ToolRow tool="ffmpeg" label="ffmpeg" status={dependencyStatus?.ffmpeg} />
          <ToolRow tool="ffprobe" label="ffprobe" status={dependencyStatus?.ffprobe} />
        </div>

        {dependencyStatus?.vendor && !dependencyStatus.vendor.active && (
          <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            <span>应用内版本 {dependencyStatus.vendor.version} 已停用（当前使用系统版本）</span>
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onEnableVendor}>
              <RotateCcw className="size-3.5" />
              启用应用内版本
            </Button>
          </div>
        )}

        <div className="space-y-2 rounded-md border border-border p-3">
          {isDownloading ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5">
                  <Loader2 className="size-3.5 animate-spin" />
                  {phaseLabels[downloadState.phase]}
                </span>
                <span className="font-mono text-muted-foreground">
                  {formatBytes(downloadState.receivedBytes)}
                  {downloadState.totalBytes > 0 ? ` / ${formatBytes(downloadState.totalBytes)}` : ""}
                  {downloadState.bytesPerSecond > 0 ? ` · ${formatBytes(downloadState.bytesPerSecond)}/s` : ""}
                </span>
              </div>
              <Progress value={downloadState.phase === "downloading" ? downloadPercent : undefined} className="h-2" />
              <div className="flex justify-end">
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCancelDownload}>
                  取消下载
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">关闭此窗口不会中断下载，可稍后重新打开查看进度。</p>
            </div>
          ) : downloadState.phase === "failed" ? (
            <div className="space-y-2">
              <p className="text-xs text-destructive">{downloadState.error?.message ?? "下载失败"}</p>
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onStartDownload}>
                <Download className="size-3.5" />
                重试下载
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-muted-foreground">
                {downloadState.phase === "done"
                  ? "下载完成，已启用应用内版本。"
                  : downloadState.phase === "cancelled"
                    ? "下载已取消，可随时重试。"
                    : anyMissing
                      ? "检测到依赖缺失，可下载应用内版本。"
                      : `应用内版本（${FFMPEG_DOWNLOAD_MANIFEST.version}）可随时下载备用。`}
              </div>
              <Button size="sm" className="h-7 gap-1 text-xs" onClick={onStartDownload}>
                <Download className="size-3.5" />
                下载 ffmpeg（约 {formatBytes(FFMPEG_DOWNLOAD_MANIFEST.bytes)}）
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <CustomPathInput
            tool="ffmpeg"
            status={dependencyStatus?.ffmpeg}
            disabled={isDownloading}
            onSetCustomPath={onSetCustomPath}
          />
          <CustomPathInput
            tool="ffprobe"
            status={dependencyStatus?.ffprobe}
            disabled={isDownloading}
            onSetCustomPath={onSetCustomPath}
          />
        </div>

        <div className="flex items-center justify-between">
          <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onRedetect} disabled={isDownloading}>
            <RefreshCw className="size-3.5" />
            重新检测
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={onRestoreSystem}
            disabled={isDownloading || !dependencyStatus?.vendor?.active}
            title="停用应用内版本，改用系统安装的 ffmpeg（应用内文件保留，可再次启用）"
          >
            恢复系统版本
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ToolRow({ tool, label, status }: { tool: DependencyTool; label: string; status?: ToolStatus }) {
  return (
    <div
      data-dep-tool={tool}
      className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-xs"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className={cn("font-medium", status?.available ? "text-emerald-500" : "text-destructive")}>
          {status?.available ? "正常" : "未检测到"}
        </span>
        <span className="font-mono">{label}</span>
      </span>
      <span className="flex min-w-0 items-center gap-2 text-muted-foreground">
        {status?.source && <span className="rounded border border-border px-1.5 py-0.5">{sourceLabels[status.source]}</span>}
        {status?.version && (
          <span className="max-w-44 truncate font-mono" title={status.version}>
            {status.version}
          </span>
        )}
        {status?.resolvedPath && (
          <span className="hidden max-w-52 truncate md:inline" title={status.resolvedPath}>
            {status.resolvedPath}
          </span>
        )}
      </span>
    </div>
  );
}

function CustomPathInput({
  tool,
  status,
  disabled,
  onSetCustomPath
}: {
  tool: DependencyTool;
  status?: ToolStatus;
  disabled?: boolean;
  onSetCustomPath: (tool: DependencyTool, filePath: string | undefined) => void;
}) {
  const [value, setValue] = useState("");
  const [dirty, setDirty] = useState(false);

  function commit() {
    setDirty(true);
    onSetCustomPath(tool, value.trim() || undefined);
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 shrink-0 text-muted-foreground">{tool} 路径</span>
      <Input
        value={dirty ? value : status?.source === "custom" ? status.resolvedPath ?? "" : value}
        onChange={(event) => {
          setDirty(true);
          setValue(event.target.value);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
        placeholder="留空则自动探测（可指定 ffmpeg.exe / ffprobe.exe 绝对路径）"
        className="h-7 text-xs"
        disabled={disabled}
        aria-label={`${tool} 自定义路径`}
      />
    </div>
  );
}
