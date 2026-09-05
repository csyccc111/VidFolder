# 发布流程清单（v0.10 起：打 tag 即发布）

版本：v0.10 重写 | 编制：GLM-5.3-Flash（agent: ZCode），2026-09-05

## 标准流程（CI 自动发布）

1. [ ] `package.json` `version` 已更新（`npm version <ver> --no-git-tag-version`）
2. [ ] `docs/RELEASE-NOTES-v<版本>.md` 已提交（**缺失时 CI 直接失败**）
3. [ ] README 版本徽章已同步
4. [ ] 提交后打 tag 并推送：

   ```bash
   git tag v<版本> && git push origin main v<版本>
   ```

5. CI（`.github/workflows/release.yml`，windows-latest）自动执行：
   - tag 与 package.json 一致性校验（不一致 fail-fast）
   - `npm ci` → typecheck → test → build
   - `electron-builder --win zip nsis` 产出双产物
   - SHA-256 写入 step summary
   - 以 `docs/RELEASE-NOTES-v<版本>.md` 创建 GitHub Release 并上传
   - API 核验两个资产 size 与本地一致（不一致标记失败）
6. [ ] 检查 Actions 运行结果与 Release 页资产（zip + Setup exe）

## 本地手动构建（兜底 / 调试）

- [ ] `npm run dist:zip`（仅 zip）；双产物：`NODE_OPTIONS="--use-system-ca" npx electron-builder --win zip nsis --config.electronDist=node_modules/electron/dist`（本机 shim/锁目录规避参数，CI 不需要）
- [ ] 产物命名：`Vid.Folder.Browser-<版本>-win-x64.zip`、`Vid.Folder.Browser-Setup-<版本>-win-x64.exe`
- [ ] `certutil -hashfile <产物> SHA256` 与线上资产逐位比对（API 获取 digest）

## 试跑（不发布）

- [ ] Actions 页手动触发 `Release` workflow，勾选 `dry_run`：完整走构建与校验，跳过发布步骤

## 完成

- [ ] 线上 zip 与 Setup exe 名称、大小、哈希三者均与本地一致
- [ ] Release 已被 GitHub 标记为 Latest
- [ ] 项目记忆已更新（注明实施模型与日期）
