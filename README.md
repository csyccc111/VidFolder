# 视频文件浏览器

一个轻量级桌面应用，用于选择本地文件夹后递归浏览其中的视频文件，并展示封面、文件名、大小、时长、修改时间和基础详情。

## 当前功能

- Electron + React + TypeScript + Vite 项目结构
- 选择文件夹并记住上次路径
- 递归扫描 `.mp4`、`.mkv`、`.avi`、`.mov`、`.wmv`、`.flv`、`.webm`、`.m4v`
- 扫描过程增量推送结果，不等待全部完成
- 使用 `ffprobe` 读取时长、分辨率
- 使用 `ffmpeg` 生成 16:9 缩略图，并缓存在应用数据目录
- JSON 缓存基于文件路径、大小和修改时间失效
- 搜索、排序、升降序、缩略图小/中/大切换
- 右键菜单：打开所在目录、默认播放器打开、复制完整路径、重新生成封面
- 右侧详情面板和底部状态栏

## 运行要求

需要本机安装：

- Node.js 和 npm
- ffmpeg 和 ffprobe，并确保它们在系统 `PATH` 中可执行

后续打包时可以把 ffmpeg/ffprobe 一起随应用分发，当前开发版先读取系统 PATH。

## 开发运行

```bash
npm install
npm run dev
```

## 构建

```bash
npm run build
```

这个命令会生成前端 `dist/` 和 Electron 主进程 `dist-electron/`。安装包制作后续再接入 electron-builder 或 Forge。

## 缓存位置

缩略图和元信息保存在 Electron 的应用数据目录下：

- `cache/`：缩略图
- `metadata-cache.json`：视频元信息和缩略图状态
- `settings.json`：上次选择的文件夹

## 说明

这不是播放器，也不是素材管理器。当前版本刻意不包含删除、移动、重命名、标签、收藏、内置播放等功能。
