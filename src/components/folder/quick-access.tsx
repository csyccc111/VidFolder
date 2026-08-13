import { FolderClock, FolderOpen, Pin, PinOff, Star, Trash2, TriangleAlert } from "lucide-react";
import type { FolderHistoryEntry } from "@/shared";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type QuickAccessProps = {
  history: FolderHistoryEntry[];
  invalidPaths: Set<string>;
  currentPath: string;
  onOpen: (path: string) => void;
  onTogglePin: (path: string) => void;
  onRemove: (path: string) => void;
};

export function QuickAccess({ history, invalidPaths, currentPath, onOpen, onTogglePin, onRemove }: QuickAccessProps) {
  const pinned = history.filter((entry) => entry.pinned);
  const recent = history.filter((entry) => !entry.pinned);

  return (
    <div className="flex min-h-0 flex-col gap-1">
      <SectionTitle
        icon={<Star className="size-3.5" />}
        label="已固定"
        empty={pinned.length === 0}
        emptyText="点击星标固定常用文件夹"
      />
      {pinned.map((entry) => (
        <HistoryRow
          key={entry.path}
          entry={entry}
          invalid={invalidPaths.has(entry.path)}
          active={currentPath === entry.path}
          onOpen={() => onOpen(entry.path)}
          onTogglePin={() => onTogglePin(entry.path)}
          onRemove={() => onRemove(entry.path)}
        />
      ))}
      <SectionTitle
        icon={<FolderClock className="size-3.5" />}
        label="最近使用"
        empty={recent.length === 0}
        emptyText="打开过的文件夹会出现在这里"
        className="mt-2"
      />
      {recent.map((entry) => (
        <HistoryRow
          key={entry.path}
          entry={entry}
          invalid={invalidPaths.has(entry.path)}
          active={currentPath === entry.path}
          onOpen={() => onOpen(entry.path)}
          onTogglePin={() => onTogglePin(entry.path)}
          onRemove={() => onRemove(entry.path)}
        />
      ))}
    </div>
  );
}

function SectionTitle({
  icon,
  label,
  empty,
  emptyText,
  className
}: {
  icon: React.ReactNode;
  label: string;
  empty: boolean;
  emptyText: string;
  className?: string;
}) {
  return (
    <div className={cn("px-1.5 pt-1", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      {empty && <p className="mt-1 px-0.5 text-[11px] text-muted-foreground/70">{emptyText}</p>}
    </div>
  );
}

function HistoryRow({
  entry,
  invalid,
  active,
  onOpen,
  onTogglePin,
  onRemove
}: {
  entry: FolderHistoryEntry;
  invalid: boolean;
  active: boolean;
  onOpen: () => void;
  onTogglePin: () => void;
  onRemove: () => void;
}) {
  const name = entry.path.split(/[\\/]/).filter(Boolean).at(-1) ?? entry.path;
  return (
    <div
      className={cn(
        "group flex h-7 items-center gap-1 rounded-md px-1.5 text-[13px]",
        active ? "bg-accent text-accent-foreground" : "hover:bg-muted"
      )}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={onOpen}
            aria-label={`打开文件夹 ${entry.path}`}
          >
            <TriangleAlert className={cn("size-3.5 shrink-0", invalid ? "text-destructive" : "hidden")} />
            <FolderOpen
              className={cn(
                "size-3.5 shrink-0",
                invalid ? "text-muted-foreground/50" : "text-muted-foreground"
              )}
            />
            <span
              className={cn(
                "truncate",
                invalid ? "text-muted-foreground/60 line-through decoration-destructive/60" : ""
              )}
            >
              {name}
            </span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right" align="start">
          <div className="max-w-80">
            {invalid && <p className="mb-1 text-xs text-destructive">路径无效，已不存在或无法访问</p>}
            <p className="truncate font-mono text-[11px]">{entry.path}</p>
          </div>
        </TooltipContent>
      </Tooltip>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onTogglePin}
          aria-label={entry.pinned ? "取消固定" : "固定"}
          title={entry.pinned ? "取消固定" : "固定"}
        >
          {entry.pinned ? <PinOff className="size-3" /> : <Pin className="size-3" />}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onRemove}
          aria-label="从列表移除"
          title="从列表移除（不影响文件）"
        >
          <Trash2 className="size-3" />
        </Button>
      </div>
    </div>
  );
}
