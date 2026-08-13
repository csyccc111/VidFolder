/**
 * 路径工具：Windows 路径规范化、相对路径、目录包含判断。
 * 大小写不敏感比较，但保留原始路径用于显示与系统操作。
 */

/** 规范化路径用于比较：统一分隔符、去尾部斜杠、转小写。 */
export function normalizePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/\/+$/, "").toLocaleLowerCase();
}

/** 去掉路径尾部分隔符，保留原始大小写。 */
export function trimTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, "");
}

/** 计算 directory 相对 rootPath 的相对路径；相等时为 "."。 */
export function getRelativeDirectory(rootPath: string, directory: string): string {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedDirectory = normalizePath(directory);
  if (!normalizedRoot || normalizedDirectory === normalizedRoot) return ".";
  if (normalizedDirectory.startsWith(`${normalizedRoot}/`)) {
    return directory.slice(trimTrailingSeparators(rootPath).length + 1).replaceAll("\\", "/");
  }
  return directory.replaceAll("\\", "/");
}

/** 由相对路径取显示名；"." 视为根。 */
export function getDirectoryName(relativePath: string): string {
  if (relativePath === ".") return "全部视频";
  const parts = relativePath.split("/").filter(Boolean);
  return parts.at(-1) ?? relativePath;
}

/** itemDirectory 是否位于 selectedDirectory 内（含自身）。 */
export function isWithinDirectory(itemDirectory: string, selectedDirectory: string): boolean {
  if (!selectedDirectory) return true;
  const itemPath = normalizePath(itemDirectory);
  const selectedPath = normalizePath(selectedDirectory);
  return itemPath === selectedPath || itemPath.startsWith(`${selectedPath}/`);
}

/** 规范化路径：用于展开状态、历史记录的键（大小写统一，避免 Windows 大小写差异膨胀）。 */
export function pathKey(value: string): string {
  return normalizePath(value);
}

/** 规范化路径是否相等（Windows 大小写不敏感）。 */
export function isSamePath(a: string, b: string): boolean {
  return normalizePath(a) === normalizePath(b);
}
