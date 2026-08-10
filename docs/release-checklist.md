# v0.4 发布流程清单

版本：v0.4 | 编制：DeepSeek-V4 Flash，2026-08-10

## 前置

- [ ] `package.json` 的 `version` 已为待发布版本（如 0.4.0）
- [ ] 代码已通过 `npm run typecheck` 与 `npm run build`
- [ ] 已按 `docs/smoke-test-checklist.md` 完成冒烟测试且全部通过
- [ ] 大目录性能基准与缓存验证记录已归档（如执行）

## 构建

1. 构建 Windows zip：

   ```bash
   npm run dist:zip
   ```

   > 本机注意：WorkBuddy 沙箱的 safe-delete shim 会干扰构建中的删除环节，
   > 如遇"先删后建"失败，可改用：
   >
   > ```bash
   > NODE_OPTIONS="--use-system-ca" npx electron-builder --win zip --config.directories.output=release-v040 --config.electronDist=node_modules/electron/dist
   > ```
   >
   > 该命令跳过了 electron 解压/rename 环节（本机 `default_app.asar` 常被锁定）。

2. 确认产物文件名格式：

   ```text
   Vid.Folder.Browser-0.4.0-win-x64.zip
   ```

## 产物核验（发布前）

3. 计算 SHA-256：

   ```bash
   certutil -hashfile "release-v040/Vid.Folder.Browser-0.4.0-win-x64.zip" SHA256
   ```

   记录哈希值（后续与线上比对）。

4. 记录文件大小（字节）。

## 发布

5. 在 https://github.com/csyccc111/VidFolder/releases 创建新 Release：
   - Tag：`v0.4.0`（与 package.json 版本一致）
   - 标题：`Vid Folder Browser v0.4.0`
   - 说明：简述本版内容（错误提示统一、扫描/缓存可靠性、性能基准、发布流程固化）
6. 上传 zip 资产，发布 Release。

## 发布后核验（以 API 为准，勿依赖页面缓存）

7. 用 GitHub API 核验：

   ```bash
   curl -s https://api.github.com/repos/csyccc111/VidFolder/releases/tags/v0.4.0
   ```

   - 确认存在名为 `Vid.Folder.Browser-0.4.0-win-x64.zip` 的资产。
   - 对比 `size` 与本地记录一致。
   - 下载后 `certutil -hashfile ... SHA256` 与本地哈希一致。
8. 确认 Git tag `v0.4.0` 与 Release 关联。

## 完成

- [ ] 线上资产名称、大小、哈希三者均与本地一致
- [ ] 项目记忆已更新（注明实施模型与日期）
