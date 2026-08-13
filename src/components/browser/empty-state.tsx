import { FolderOpen, SearchX, VideoOff } from "lucide-react";
import { Button } from "@/components/ui/button";

export type EmptyStateKind = "no-folder" | "no-videos" | "scanning" | "cancelled" | "error" | "no-match" | "no-bridge";

const content: Record<EmptyStateKind, { title: string; description: string }> = {
  "no-folder": { title: "选择一个视频文件夹", description: "递归扫描本地视频文件，生成封面并缓存基础信息。" },
  "no-videos": { title: "没有找到视频", description: "当前文件夹及子文件夹中没有支持的视频格式。" },
  scanning: { title: "正在扫描", description: "发现的视频会立即出现在这里。" },
  cancelled: { title: "扫描已取消", description: "本次扫描已停止，可点击「刷新」重新扫描。" },
  error: { title: "扫描失败", description: "查看顶部错误提示获取原因。" },
  "no-match": { title: "没有匹配结果", description: "换一个关键词、文件夹或筛选条件试试。" },
  "no-bridge": { title: "Electron 桥接未加载", description: "请重新运行开发服务；如果仍出现此提示，preload 没有被 Electron 正确加载。" }
};

export function EmptyState({
  kind,
  scanErrorDetail,
  onChooseFolder
}: {
  kind: EmptyStateKind;
  scanErrorDetail?: string;
  onChooseFolder?: () => void;
}) {
  const text = content[kind];
  const Icon = kind === "no-match" ? SearchX : kind === "no-videos" ? VideoOff : FolderOpen;
  return (
    <div className="grid h-full min-h-64 place-items-center gap-2 p-8 text-center">
      <div className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-6" />
      </div>
      <h1 className="m-0 text-xl font-semibold">{text.title}</h1>
      <p className="m-0 max-w-sm text-sm text-muted-foreground" title={kind === "error" ? scanErrorDetail : undefined}>
        {text.description}
      </p>
      {kind === "no-folder" && onChooseFolder && (
        <Button className="mt-2" onClick={onChooseFolder}>
          选择文件夹
        </Button>
      )}
    </div>
  );
}
