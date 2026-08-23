import { ChevronDown, LocateFixed, X } from "lucide-react";
import type { VideoItem } from "@/shared";
import { formatBytes, formatDate, formatDuration } from "@/lib/format";
import { formatAudioTrackText, formatFrameRateText, formatKbpsText } from "@/lib/media-info";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

export type DetailPanelProps = {
  item: VideoItem | undefined;
  rootPath: string;
  open: boolean;
  onToggleOpen: () => void;
  onRevealInTree: (item: VideoItem) => void;
  /** 窄窗口时用 Sheet 覆盖层。 */
  variant?: "pane" | "sheet";
  sheetOpen?: boolean;
  onSheetOpenChange?: (open: boolean) => void;
};

function DetailBody({
  item,
  rootPath,
  onRevealInTree
}: {
  item: VideoItem | undefined;
  rootPath: string;
  onRevealInTree: (item: VideoItem) => void;
}) {
  if (!item) {
    return (
      <div className="grid h-full min-h-40 place-items-center p-4">
        <p className="text-sm text-muted-foreground">点击一个视频查看基础信息。</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {rootPath && (
        <Button variant="outline" size="sm" className="h-7 w-full gap-1.5 text-xs" onClick={() => onRevealInTree(item)}>
          <LocateFixed />
          在文件夹树中定位
        </Button>
      )}
      <dl className="m-0 space-y-2.5">
        <Field label="文件名" value={item.fileName} />
        <Field label="完整路径" value={item.filePath} mono />
        <Field label="所在文件夹" value={item.directory} mono />
        <Field label="大小" value={formatBytes(item.size)} />
        <Field label="时长" value={formatDuration(item.duration)} />
        <Field label="修改时间" value={formatDate(item.modifiedAt)} />
        <Field
          label="分辨率"
          value={item.width && item.height ? `${item.width} × ${item.height}` : "未读取"}
        />
        {item.metadataStatus === "ready" && <TechnicalSection item={item} />}
        {item.metadataError && (
          <div title={item.metadataError.detail ?? item.metadataError.message}>
            <dt className="text-[11px] text-destructive">元信息错误</dt>
            <dd className="mt-1 break-words text-[13px] text-destructive/90">{item.metadataError.message}</dd>
          </div>
        )}
        {item.thumbnailError && (
          <div title={item.thumbnailError.detail ?? item.thumbnailError.message}>
            <dt className="text-[11px] text-destructive">封面错误</dt>
            <dd className="mt-1 break-words text-[13px] text-destructive/90">{item.thumbnailError.message}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd
        title={value}
        className={cn("mt-0.5 line-clamp-3 break-words text-[13px] text-foreground", mono && "font-mono text-xs")}
      >
        {value}
      </dd>
    </div>
  );
}

/** v0.8 技术信息折叠区块：容器 / 编码 / 码率 / 帧率 / 音轨，全部字段按"未知"兜底。 */
function TechnicalSection({ item }: { item: VideoItem }) {
  // key=item.id：切换选中视频时重置折叠状态（默认收起）。
  return (
    <Collapsible key={item.id} defaultOpen={false}>
      <CollapsibleTrigger asChild>
        <button className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground">
          技术信息
          <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-2.5">
        <Field label="容器" value={item.container ?? "未知"} />
        <Field label="视频编码" value={item.videoCodec ?? "未知"} />
        <Field label="码率（容器）" value={formatKbpsText(item.containerBitrate, item.bitrateEstimated) ?? "未知"} />
        <Field label="码率（视频流）" value={formatKbpsText(item.videoBitrate) ?? "未知"} />
        <Field label="帧率" value={formatFrameRateText(item.frameRate) ?? "未知"} />
        <div>
          <dt className="text-[11px] text-muted-foreground">音轨</dt>
          {item.audioTracks && item.audioTracks.length > 0 ? (
            item.audioTracks.map((track, index) => (
              <dd key={index} className="mt-0.5 text-[13px] text-foreground">
                {formatAudioTrackText(track)}
              </dd>
            ))
          ) : (
            <dd className="mt-0.5 text-[13px] text-foreground">{item.audioTracks ? "无音轨" : "未知"}</dd>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DetailPanel({
  item,
  rootPath,
  open,
  onToggleOpen,
  onRevealInTree,
  variant,
  sheetOpen = false,
  onSheetOpenChange = () => {}
}: DetailPanelProps) {
  if (variant === "sheet") {
    return (
      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetContent side="right" className="w-80 sm:w-96">
          <SheetHeader>
            <SheetTitle>详情</SheetTitle>
          </SheetHeader>
          <ScrollArea className="h-full pr-4">
            <DetailBody item={item} rootPath={rootPath} onRevealInTree={onRevealInTree} />
          </ScrollArea>
        </SheetContent>
      </Sheet>
    );
  }

  return (
    <aside className={cn("relative min-w-0 border-l bg-sidebar", open ? "w-72" : "w-0 border-l-0")}>
      <div className={cn("flex h-full min-w-72 flex-col", !open && "hidden")}>
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <h2 className="m-0 text-sm font-semibold">详情</h2>
          <Button variant="ghost" size="icon-xs" onClick={onToggleOpen} aria-label="收起详情面板">
            <X />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
          <DetailBody item={item} rootPath={rootPath} onRevealInTree={onRevealInTree} />
        </ScrollArea>
      </div>
    </aside>
  );
}
