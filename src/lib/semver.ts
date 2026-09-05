/**
 * 语义化版本比较（v0.10 更新检查用）：只比较数字主版本段，忽略前导 v 与预发布后缀。
 * 规则：v0.10.0 > v0.9.9 > v0.9.0；段数不足按 0 补齐；非数字段按 0 处理（预发布标签不影响大小判断，
 * 预发布提示与否由 Release 的 prerelease 字段决定，与本函数无关）。
 */

/** 解析 "v1.2.3-beta.1" → [1, 2, 3]；无法解析返回 undefined。 */
export function parseVersionParts(version: string): number[] | undefined {
  const trimmed = version.trim().replace(/^v/i, "");
  const core = trimmed.split("-")[0].split("+")[0];
  if (!/^(\d+\.)*\d+$/.test(core)) return undefined;
  return core.split(".").map((part) => Number.parseInt(part, 10));
}

/** a 是否比 b 更新（仅数字段比较）。任一无法解析返回 false。 */
export function isNewerVersion(a: string, b: string): boolean {
  const pa = parseVersionParts(a);
  const pb = parseVersionParts(b);
  if (!pa || !pb) return false;
  const length = Math.max(pa.length, pb.length);
  for (let index = 0; index < length; index += 1) {
    const va = pa[index] ?? 0;
    const vb = pb[index] ?? 0;
    if (va !== vb) return va > vb;
  }
  return false;
}
