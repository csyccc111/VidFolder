# v0.10 发布与更新 Prompt（CI/CD 自动构建发布 + 自动更新检查）

规划与提示词：DeepSeek-V4 Flash（agent: opencode），2026-08-23。

## 背景

你是一名资深 Electron + React + TypeScript 桌面应用工程师。请在现有 Vid Folder Browser 项目上进行 v0.10 增量开发。

当前发布流程完全手动（本地构建 zip → 算 SHA-256 → 手工建 Release → API 核验），历史上已多次发布断档。本版本做两件事：

1. **GitHub Actions 自动构建 + 发布**：打 tag 即自动构建、校验、发布到 GitHub Releases。
2. **应用内自动更新检查**：启动延迟检查与手动按钮，发现新版本后提示并引导下载。

重要规则：

- 开始前阅读 `PROJECT_MEMORY.md`、`PROMPT_VERSIONING.md`、`docs/release-checklist.md`、README 和当前实现。
- 自动发布必须保留现有质量门槛：typecheck + 单测 + build 全绿才产出；产物命名、SHA-256、Release notes 全部自动。
- CI 用 GitHub 官方托管的 windows-latest runner（干净环境，无本机 WorkBuddy shim 与 electronDist 锁文件问题）。
- 自动更新检查只提示与引导下载，**不做自动替换安装**（zip 便携版 + exe 占用风险）。
- 中文内容和源码统一使用 UTF-8。

## 当前已实现功能

- v0.1-v0.9 全部能力（v0.9 后依赖缺失已可引导下载）。
- package.json `build` 配置：artifactName 已统一为 `Vid.Folder.Browser-${version}-win-${arch}.${ext}`；`dist:zip` 脚本存在。
- `docs/release-checklist.md` 记录手动发布流程；`CHANGELOG.md` 已按版本维护更新内容。
- 版本号在 package.json `version` 字段；git tag 形如 `v0.6.0`。

本版本的重新实现目标：无（纯增量 + 基础设施）。

## 本版本目标

- `git push --tags` 后自动完成：构建 → 测试 → 打包 zip → 生成 SHA-256 → 从 CHANGELOG 生成 Release notes → 创建 Release 并上传资产 → API 核验。
- 发布流程从"手动 6 步"变成"一条命令"；任何人不再需要本机 Electron 环境即可发布。
- 应用内可检查新版本：启动后延迟检查 + 工具栏"检查更新"；有新版时展示版本与更新摘要，可一键打开下载页。
- 版本一致性防护：tag 与 package.json version 不一致时 workflow 直接失败。

## 交互与行为定义

### 1. GitHub Actions 工作流（`.github/workflows/release.yml`）

- 触发：`push` 且 tag 匹配 `v*`；同时支持 `workflow_dispatch` 手动选择版本（读取 package.json version）。
- Job（windows-latest，步骤顺序）：
  1. `actions/checkout@v4`（fetch-depth 0，便于 CHANGELOG 截取与 tag 判断）。
  2. `actions/setup-node@v4`（node 22，npm cache 启用）。
  3. 一致性校验：tag 版本（去 `v` 前缀）必须等于 package.json `version`，不等则 fail-fast 退出。
  4. `npm ci`（含 postinstall 下载 electron；CI 网络正常无代理问题）。
  5. `npm run typecheck` && `npm test` && `npm run build`（任一失败即不发布）。
  6. `npx electron-builder --win zip`（产物 `release/Vid.Folder.Browser-<version>-win-x64.zip`）。
  7. `Get-FileHash` 计算 SHA-256 并写入 step summary（发布后人工核验用）。
  8. 从 `CHANGELOG.md` 按 tag 版本截取对应小节生成 `notes.md`（脚本：正则匹配 `## v<ver> ` 到下一个 `## v` 或文件尾；找不到则失败并提示先更新 CHANGELOG）。
  9. `gh release create v<ver> --title "Vid Folder Browser v<ver>" --notes-file notes.md --assets <zip>`（`gh` 在 windows-latest 预装，`GITHUB_TOKEN` 自动注入，权限 `contents: write`）。
  10. 核验步骤：`gh release view v<ver> --json assets` 断言资产存在且 `size` 与本地一致；不一致 step 标记失败。
- 约定：Release 由 workflow 创建（不预先手动建）；重复 tag 推送（如重试）时 `gh release` 幂等处理（已存在则更新资产或先失败，二选一并在实现时固定行为）。
- 可选：`actions/cache` 缓存 electron 下载与 node_modules，缩短重复构建时间（安全哈希键）。

### 2. 自动更新检查

- 检查时机：应用启动后延迟约 3 秒静默检查一次；工具栏/菜单提供"检查更新"按钮（可随时手动检查，间隔小于 10 分钟时提示"刚刚检查过"或直接复用结果）。
- 数据源：`GET https://api.github.com/repos/csyccc111/VidFolder/releases/latest`（带 `User-Agent`；GitHub API 未认证限流 60 次/时，应用低频调用足够）。
- 版本比较：解析 tag（`v1.2.3`）与当前 package.json version 语义比较；仅当"新版本号更大"才提示；预发布（`prerelease: true`）不提示。
- 提示 UI：非阻塞 Toast/对话框：新版本号、更新摘要（取 Release body 前几行）、按钮"下载新版本"（打开资产下载页或直接下载 zip 到系统下载目录）与"忽略此版本"（忽略列表持久化）。
- 网络失败 / API 限流 / JSON 异常：静默失败，不弹错误框（可留调试日志）。
- 新增设置项："检查更新"开关（默认开）。

## 本版本只做

1. `release.yml` 工作流 + 配套脚本（`scripts/release-notes.cjs`、`scripts/verify-tag-version.cjs` 等，放 scripts/ 便于本机复用）。
2. 更新检查模块（主进程：请求、解析、版本比较、忽略列表；IPC 与 preload 最小暴露）。
3. 更新提示 UI 与"忽略此版本"。
4. 设置项（检查更新开关）与持久化。
5. README 发布流程改写（从手动清单改为"打 tag 即发布"），保留 SHA-256 核验说明。
6. `docs/release-checklist.md` 更新为新流程。

## 本版本不做

- 不做自动下载 + 解压替换安装（便携 zip 的 exe 占用与安全风险，明确排除）。
- 不做增量更新 / delta 更新 / Windows 服务。
- 不做强制更新或静默更新。
- 不做多架构（arm64）或 macOS/Linux 的构建发布。
- 不改动既有的本地手动构建能力（`npm run dist:zip` 保留）。
- 不在 CI 中执行冒烟/性能基准（测试素材与 GUI 环境的复杂性，保持构建级门槛）。

## 涉及模块建议

- `.github/workflows/release.yml`。
- `scripts/release-notes.cjs`、`scripts/verify-tag-version.cjs`。
- `electron/updater.ts`（主进程更新检查模块）、`src/shared.ts`（更新状态类型）、`electron/preload.cts`。
- 工具栏"检查更新"入口与更新提示组件。
- `README.md`、`docs/release-checklist.md`、`PROJECT_MEMORY.md`。

## 实现要求

- 工作流所有命令使用参数数组/非交互模式；不依赖 shell 别名。
- 版本比较用语义化规则（v0.10.0 > v0.9.9 > v0.9.0-beta.1），实现为纯函数并单测。
- 更新检查请求在主进程执行（避免渲染进程 CORS）；响应解析容错（字段缺失不抛错）。
- 忽略版本列表持久化到 settings.json 或独立小文件，按版本号存储。
- 更新检查不阻塞启动、扫描或任何交互；不创建多余网络请求（单飞，避免并发重复检查）。
- 工作流失败要便于排查：关键步骤加 `::error::` 输出与 step summary。

## 验收标准

- 本地运行 `scripts/verify-tag-version.cjs` 对 tag/version 一致与不一致两种情况行为正确。
- `scripts/release-notes.cjs` 能从 CHANGELOG.md 正确截取任意已存在版本段落，缺失时报错。
- 工作流在 windows-latest 模拟跑通（可先在分支上以 `workflow_dispatch` 试跑，不真实发布）：构建、打包、notes、核验逻辑全绿。
- 应用内：启动后延迟检查不打扰；手动按钮有效；新版本提示含版本号与摘要；"忽略此版本"后不再提示；断网/404/限流时静默。
- 版本比较单测覆盖：正常升级、同版本、降级（不提示）、预发布（不提示）。
- `npm run typecheck`、`npm run build`、相关单测通过。

## 回归检查

- 本地 `npm run dist:zip` 仍可构建（CI 是新增路径，不影响本地）。
- 启动、扫描、缓存、预览、进度记忆、详情、依赖下载（v0.9）全部正常。
- 设置读写正常（新增开关不影响既有字段）。
- 中文、空格、长路径正常。
- Windows x64 构建可启动和退出。

## 交付物

- 工作流文件与配套脚本。
- 更新检查模块与单测。
- 发布流程文档更新。
- README、项目记忆和版本记录更新，注明实施模型和日期。
