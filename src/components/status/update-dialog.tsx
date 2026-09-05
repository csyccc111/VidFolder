import { CheckCircle2, CircleArrowUp, Download, Loader2, RotateCcw } from "lucide-react";
import type { UpdateCheckOutcome } from "@/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toggle } from "@/components/ui/toggle";

export type UpdateDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  outcome: UpdateCheckOutcome;
  checking: boolean;
  autoCheckEnabled: boolean;
  onCheck: () => void;
  onIgnore: (version: string) => void;
  onOpenRelease: (url: string) => void;
  onToggleAutoCheck: (enabled: boolean) => void;
};

/** 应用内更新检查面板（v0.10）：只提示与引导下载，不做自动安装。 */
export function UpdateDialog({
  open,
  onOpenChange,
  outcome,
  checking,
  autoCheckEnabled,
  onCheck,
  onIgnore,
  onOpenRelease,
  onToggleAutoCheck
}: UpdateDialogProps) {
  const state = checking ? "checking" : outcome.state;
  const update = outcome.update;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" aria-label="检查更新">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleArrowUp className="size-4" />
            检查更新
          </DialogTitle>
          <DialogDescription>
            {state === "available" || state === "ignored"
              ? "发现新版本，可前往下载页获取（应用不自动安装）。"
              : "检查 GitHub Releases 上的新版本；失败时静默，不打扰使用。"}
          </DialogDescription>
        </DialogHeader>

        <div data-update-state={state} className="min-h-24 rounded-md border border-border p-3 text-xs">
          {state === "checking" && (
            <p className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              正在检查更新…
            </p>
          )}
          {state === "idle" && <p className="text-muted-foreground">尚未检查。点击下方按钮立即检查。</p>}
          {state === "latest" && (
            <p className="flex items-center gap-2 text-emerald-500">
              <CheckCircle2 className="size-4" />
              已是最新版本（v{update?.currentVersion ?? "当前版本"}）。
            </p>
          )}
          {(state === "available" || state === "ignored") && update && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                新版本 v{update.latestVersion}
                <span className="ml-2 font-normal text-muted-foreground">当前 v{update.currentVersion}</span>
              </p>
              {state === "ignored" && <p className="text-amber-500">该版本已被忽略，不再自动提示。</p>}
              {update.releaseNotesExcerpt && (
                <pre className="max-h-32 overflow-auto rounded bg-muted/50 p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap">
                  {update.releaseNotesExcerpt}
                </pre>
              )}
              <div className="flex gap-2">
                <Button size="sm" className="h-7 gap-1 text-xs" onClick={() => onOpenRelease(update.releaseUrl)}>
                  <Download className="size-3.5" />
                  打开下载页
                </Button>
                {state === "available" && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onIgnore(update.latestVersion)}>
                    忽略此版本
                  </Button>
                )}
              </div>
            </div>
          )}
          {state === "disabled" && <p className="text-muted-foreground">启动时自动检查已关闭，可随时手动检查。</p>}
          {state === "error" && (
            <div className="space-y-2">
              <p className="text-muted-foreground">检查失败（网络或 GitHub 访问异常），不影响使用。</p>
              {outcome.error && <p className="truncate font-mono text-[11px] text-muted-foreground/70" title={outcome.error}>{outcome.error}</p>}
              <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onCheck}>
                <RotateCcw className="size-3.5" />
                重试
              </Button>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Toggle
              size="sm"
              pressed={autoCheckEnabled}
              onPressedChange={onToggleAutoCheck}
              aria-label="启动时自动检查更新"
            />
            <span className="text-xs text-muted-foreground">启动时自动检查更新</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            onClick={onCheck}
            disabled={checking}
          >
            {checking ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" />}
            立即检查
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
