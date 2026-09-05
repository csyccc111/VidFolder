/* eslint-disable */
// 校验 git tag 与 package.json version 一致（CI fail-fast 用）。
// 用法：node scripts/verify-tag-version.cjs v0.10.0
// 退出码：0 一致；1 不一致或入参非法。
const fs = require("node:fs");
const path = require("node:path");

const tag = process.argv[2];
if (!tag || !/^v\d+/i.test(tag)) {
  console.error(`::error::非法 tag：${tag ?? "(未提供)"}（期望形如 v0.10.0）`);
  process.exit(1);
}
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const tagVersion = tag.replace(/^v/i, "");
if (tagVersion !== pkg.version) {
  console.error(`::error::tag ${tag} 与 package.json version ${pkg.version} 不一致，请先同步版本号再打 tag。`);
  process.exit(1);
}
console.log(`OK: tag ${tag} == package.json ${pkg.version}`);
