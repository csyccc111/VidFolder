# Vid Folder Browser / 视频文件浏览器

一个轻量级桌面应用，用于选择本地文件夹后递归浏览其中的视频文件，并展示封面、文件名、大小、时长、修改时间和基础详情。

它的定位是“带封面预览的视频文件夹浏览器”：不是播放器，也不是复杂素材管理器。

## 功能

- 选择本地文件夹，并记住上次选择的路径
- 递归扫描 `.mp4`、`.mkv`、`.avi`、`.mov`、`.wmv`、`.flv`、`.webm`、`.m4v`
- 扫描过程增量显示结果，不必等待全部扫描完成
- 使用 `ffprobe` 读取视频时长、分辨率
- 使用 `ffmpeg` 生成 16:9 缩略图，并缓存在应用数据目录
- 基于文件路径、大小和修改时间判断缓存是否失效
- 支持搜索、排序、升降序切换、缩略图小/中/大切换
- 支持左侧文件夹筛选，快速查看某个子目录及其子目录中的视频
- 支持网格视图和列表视图切换
- 支持按格式、时长、画面方向/分辨率筛选
- 记住上次使用的视图模式、排序方式、排序方向和缩略图大小
- 左侧文件夹数量显示该目录及其子目录中的累计视频数
- 列表视图支持点击表头按文件名、时长、大小、修改时间排序
- 启动时检测 `ffmpeg` / `ffprobe` 可用性，并在界面中提示依赖状态
- 支持右键菜单：打开所在目录、用默认播放器打开、复制完整路径、重新生成封面
- 提供右侧详情面板和底部状态栏

## 下载使用

发布版会放在 GitHub Releases 页面：

https://github.com/csyccc111/VidFolder/releases

下载 `Vid Folder Browser-*-win-x64.zip` 后解压，运行其中的 `Vid Folder Browser.exe`。

当前版本依赖本机已安装的 `ffmpeg` 和 `ffprobe`。请确保它们可以在系统 `PATH` 中直接执行。

应用启动时会自动检测 `ffmpeg` 和 `ffprobe`：

- `ffmpeg` 用于生成新视频封面。
- `ffprobe` 用于读取视频时长和分辨率。
- 如果缺少其中之一，应用仍可打开并扫描文件，已有缓存封面和元信息仍会展示，但新视频的封面或元信息可能无法生成。

## 运行要求

开发或从源码运行需要：

- Node.js 和 npm
- ffmpeg 和 ffprobe
- Windows 系统，当前打包目标为 Windows x64 zip

## 开发运行

```bash
npm install
npm run dev
```

如果在 PowerShell 中遇到 `npm.ps1` 执行策略限制，可以改用：

```bash
npm.cmd run dev
```

## 构建

生成前端和 Electron 主进程构建产物：

```bash
npm run build
```

生成 Windows zip 发布包：

```bash
npm run dist:zip
```

构建产物会生成到：

- `dist/`：前端构建结果
- `dist-electron/`：Electron 主进程构建结果
- `release/`：electron-builder 生成的发布包

这些目录是构建产物，不提交到源码仓库。

## 发布 Release

1. 确认 `package.json` 中的 `version` 是要发布的版本。
2. 运行：

   ```bash
   npm run dist:zip
   ```

3. 打开 GitHub Releases 页面：

   https://github.com/csyccc111/VidFolder/releases

4. 创建新 Release，Tag 建议使用 `v版本号`，例如 `v0.1.0`。
5. 上传 `release/` 目录中的 zip 文件。
6. 发布 Release。

源码仓库只保存代码、配置和文档；安装包、zip、exe 等大文件通过 GitHub Releases 分发。

## 缓存位置

缩略图和元信息保存在 Electron 的应用数据目录下：

- `cache/`：缩略图
- `metadata-cache.json`：视频元信息和缩略图状态
- `settings.json`：上次选择的文件夹，以及视图模式、排序方式、缩略图大小等界面偏好

## 非目标功能

当前版本刻意不包含以下功能：

- 内置视频播放器
- 删除、移动、重命名视频
- 标签、收藏、评论
- 批量管理或复杂素材库功能
- 云同步或登录系统

## 开发背景

初始需求和范围说明(ai提示词)见 [VIDEO_BROWSER_PROMPT.md](./VIDEO_BROWSER_PROMPT.md)。
