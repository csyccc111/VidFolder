/* eslint-disable */
// 定位版本对应的 Release notes 文件（CI 发布用）。
// 用法：node scripts/release-notes.cjs 0.10.0
// 约定：docs/RELEASE-NOTES-v<version>.md 逐版本维护（仓库无 CHANGELOG.md）。
// 输出：notes 文件绝对路径（供 gh release create --notes-file 使用）；缺失则退出码 1。
const fs = require("node:fs");
const path = require("node:path");

const version = process.argv[2];
if (!version || !/^\d/.test(version)) {
  console.error(`::error::非法版本号：${version ?? "(未提供)"}（期望形如 0.10.0）`);
  process.exit(1);
}
const notesPath = path.join(__dirname, "..", "docs", `RELEASE-NOTES-v${version}.md`);
if (!fs.existsSync(notesPath)) {
  console.error(`::error::缺少发布说明：${notesPath}。发布前必须先提交 docs/RELEASE-NOTES-v${version}.md。`);
  process.exit(1);
}
console.log(notesPath);
