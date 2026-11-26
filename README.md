# MarkScape

MarkScape 是一款本地优先的跨平台 Markdown 编辑器。可以直接编辑磁盘上的文档，在分栏里预览公式、图表和任务列表，也可以打开整个文件夹进行搜索。编辑和预览均可离线使用，无需账号。文档和恢复快照保存在本机。

## macOS 安装

当前工作区已生成 **MarkScape 0.1.0** 的 Apple Silicon（M 系列）安装包，要求 macOS 13 或更高版本。

1. 在本地项目的 `dist/` 目录中双击 `MarkScape-0.1.0-arm64.dmg`。
2. 将 **MarkScape** 拖到 **Applications（应用程序）**。
3. 从「应用程序」启动 MarkScape，随后可在 Finder 中推出安装映像。

此 DMG 使用本地临时签名，未经 Apple 公证。安装包是本机构建产物，源码仓库忽略 `dist/`。从源码开始请参阅下方「开发与验证」，其他平台的安装包格式见「打包与发行」。

## 第一次使用

- 在欢迎页选择 **打开文档**，或把 Markdown 文件拖入窗口。选择「打开示例，探索 MarkScape」可以直接体验编辑和实时预览。
- 在左侧「文件」中选择 **打开文件夹**，即可浏览目录树、在「全库搜索」中查找文本，并点击结果跳到对应行。「文档大纲」可以按标题跳转。
- 点击标题栏的 **收起侧栏** 扩大编辑区，再点「展开侧栏」恢复。应用会记住这个选择。文档工具栏可以切换源码、分栏、预览和即时预览四种模式。
- 首次 **保存** 新文档时选择文件位置。默认在切换标签或窗口失去焦点时自动保存已命名的可写文档，策略可在设置中修改。在文档的导出菜单可生成 HTML 或 PDF。

### 常用快捷键

| 操作 | macOS | Windows / Linux |
| --- | --- | --- |
| 新建 / 打开文档 | `⌘N` / `⌘O` | `Ctrl+N` / `Ctrl+O` |
| 打开文件夹 | `⌘⌥O` | `Ctrl+Alt+O` |
| 保存 / 另存为 | `⌘S` / `⌘⇧S` | `Ctrl+S` / `Ctrl+Shift+S` |
| 查找 / 替换 | `⌘F` / `⌘⌥F` | `Ctrl+F` / `Ctrl+H` |
| 切换视图 | `⌘⇧V` | `Ctrl+Shift+V` |
| 打开文档大纲 | `⌘⇧O` | `Ctrl+Shift+O` |

## 开发与验证

项目使用 Electron 45.5.0、React、TypeScript、CodeMirror 6 和 markdown-it。建议使用与 CI 一致的 Node.js 22（22.12 或更高的 22.x 版本）及 npm 10 或更高版本。在项目根目录运行：

```bash
npm ci
npm run dev
```

| 命令 | 用途 |
| --- | --- |
| `npm run lint` / `npm run typecheck` | 检查代码风格和 TypeScript 类型 |
| `npm test` | 运行文件读写、路径授权、会话、搜索和 Markdown 渲染回归测试 |
| `npm run build` | 检查类型并在 `out/` 生成主进程、预加载脚本和渲染进程的生产构建 |
| `npm run preview` | 启动上一步生成的生产构建 |
| `npm run test:e2e` | 构建后运行 Playwright 桌面测试，覆盖打开、编辑、保存、恢复和导出 |
| `npm run bench:open` | 构建后测量启动与打开文档的耗时 |

Linux CI 使用 `xvfb-run --auto-servernum npm run test:e2e` 提供图形环境。Electron 下载受限时，可在 macOS 或 Linux 上使用 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npm ci` 指定 Electron 镜像。

### 打开速度

基准脚本每轮用独立的临时配置目录启动 Electron 并打开小文档，随后在同一窗口打开一份约 5,000 行、333 KiB 的 Markdown 文档。下表是同一台 Apple Silicon Mac 上各运行 7 轮的中位数。预览耗时计至首个标题出现，磁盘缓存沿用系统状态。

| 场景 | 优化前 | 当前版本 |
| --- | ---: | ---: |
| 启动并打开小文档，编辑器可输入 | 803 ms | 570 ms |
| 启动并打开小文档，预览标题出现 | 921 ms | 606 ms |
| 应用内打开长文档，编辑器可输入 | 24 ms | 21 ms |
| 应用内打开长文档，预览标题出现 | 197 ms | 68 ms |

默认运行 7 轮。要在自己的机器上采集更多样本，可执行：

```bash
npm run build
npm run bench:open -- 15
```

## 已实现功能

- 多标签、拖拽打开、最近文件、系统文件关联与 `mdview://open?path=` 深链接。
- CodeMirror 6 编辑、撤销/重做、查找替换（正则、全词、大小写）、格式快捷键。
- 源码、分栏、预览、即时预览四种模式；标签独立保留选区、撤销栈和滚动位置。
- GFM 表格、任务列表、删除线、自动链接、脚注、标题属性、KaTeX、Mermaid、Shiki 高亮。
- 可点击任务复选框、标题大纲、Front Matter、基于源码行号的双向滚动同步。
- 工作区懒加载目录树、全库搜索、文件重命名、回收站删除、文件管理器定位。
- 自动保存、每 10 秒恢复快照、重启恢复、未保存退出保护、外部修改提示与冲突拦截。
- UTF-8 / BOM / GBK / UTF-16 LE/BE / Shift-JIS；保存保留 BOM、换行与末尾换行状态；不修改的文件保存时保持原始字节，包括混合换行。
- 状态栏可选择编码重新读取；短文本的旧编码可能存在歧义，选择后仍经过无损编码检查。
- 同目录临时文件、`fsync`、原子替换；内容摘要与 mtime 双重冲突校验；无法无损编码时拒绝保存，提示另存 UTF-8。
- HTML/PDF 导出共享预览 HTML 和 CSS，图片与字体内联；PNG 剪贴板图片保存到文档旁的 `assets/`。
- 系统、浅色、深色、暖纸主题，中/英界面，自定义预览 CSS、字号与编辑选项。
- 超过 5 MB 的文档降级为源码模式；超过 50 MB 的文档按页只读加载。

## 项目结构

```text
src/main/                 窗口、菜单、IPC 校验与原生功能
src/main/services/        文件、路径授权、工作区搜索、会话、导出
src/preload/              白名单桥接接口 window.md
src/shared/               TypeScript 契约、Zod schema、错误与默认设置
src/renderer/src/editor/  CodeMirror 文档状态与即时预览扩展
src/renderer/src/markdown/ Markdown 解析、HTML 净化、按需加载高亮和图表
src/renderer/src/components/ 编辑器、预览、文件树和设置界面
src/renderer/src/stores/  Zustand 管理的标签与界面状态
tests/unit/               自动化回归测试
tests/e2e/                Playwright Electron 测试
resources/                打包资源与 macOS entitlement
.github/workflows/        三端验证、开发包、手动安装包工作流
```

设置、最近文件与会话存储于 Electron `app.getPath('userData')`：macOS 的 `~/Library/Application Support/markscape`，Windows 的 `%APPDATA%/markscape`，Linux 的 `~/.config/markscape`。文件名为 `settings.json`、`recent.json`、`session.json`。测试可用 `MARKSCAPE_USER_DATA` 隔离数据。

## 安全与数据保护

Renderer 使用 sandbox、contextIsolation，关闭 Node 集成与 webview。所有 IPC 在 Main 验证来源与 Zod 参数。路径以 `realpath` 规范化后检查授权根，阻止相邻目录前缀碰撞和符号链接越权。授权来自原生打开/保存/工作区对话框、文件关联、持久化最近文件；拖入尚未授权目录的文件会显示原生确认。

Markdown 默认禁用原始 HTML；开启后仍经 DOMPurify。图片不直接暴露 `file://`，本地图片通过 `mdasset://` 校验读取；远程图片被禁用，避免文档触发跟踪请求。链接仅允许 `https:`、`http:`、`mailto:`。Shiki 使用 JavaScript 正则引擎，不放宽 CSP 到 `unsafe-eval`。

快照总正文预算 200 MB。磁盘版本与快照不一致时，恢复为未命名副本，保留双方内容。正常退出逐份询问保存/放弃/取消。自动保存遇到冲突不会覆盖磁盘；“保留我的”只保留内存编辑，后续保存仍检查磁盘版本。

## 打包与发行

在目标平台运行以下命令，产物写入 `dist/`：

| 命令 | 产物 |
| --- | --- |
| `npm run pack` | 可直接启动的应用目录，适合验证打包后的行为 |
| `npm run dist -- --publish never` | 当前平台配置的安装包和归档文件，仅在本地生成 |
| `npm run dist -- --mac dmg --arm64 --publish never` | 在 macOS 上单独构建 Apple Silicon DMG |

默认发行目标为 macOS Universal DMG 和 ZIP、Windows x64/arm64 NSIS 和 ZIP、Linux x64/arm64 AppImage 和 DEB。[打包配置](electron-builder.yml)

CI 在 Windows、macOS、Linux 上运行验证并产出开发目录包。手动触发 `Build signed installers` 可将安装包保存为工作流产物。[持续集成](.github/workflows/ci.yml) · [发行工作流](.github/workflows/release.yml)

正式工作流使用 `release-windows`、`release-macos`、`release-linux` 三个 GitHub Environment。Windows/macOS 分别提供对应证书的 `CSC_LINK`、`CSC_KEY_PASSWORD`；macOS 还需 `APPLE_API_KEY_BASE64`（`.p8` 内容的 base64）、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`。脚本会将公证密钥写入 Runner 临时目录，缺少凭据时明确失败。未配置证书不能宣称通过 Gatekeeper / Authenticode 验收。

自动更新使用 electron-updater，默认不主动联网。在设置中手动检查；只有打包配置了可信 HTTPS 更新源、生成 `app-update.yml` 后才启用。下载前询问用户，下载完成后下次正常退出安装。

搜索可在 `resources/bin/` 放入对应目标平台的可信 `rg` / `rg.exe`。没有二进制时使用 Node 遍历，界面显示 `Node fallback`。不要将单一架构的二进制混入其他平台安装包。

## 验收边界

当前版本为 **0.1.0 开发版本**。正式 1.0 发布前仍需完成：

- 三端安装/卸载、签名公证、系统文件关联及各发行版兼容性实测。
- 按设计硬件基线测量冷启动、输入延迟、万文件搜索、空闲内存与 Windows 安装包体积。
- 中文 IME、125%/150% 缩放、Wayland/X11 的人工验证。
- 配置并验证真实更新源；灰度分发与双次崩溃自动回滚尚未实现。
- 预览当前整篇解析以保证跨块引用/脚注正确，DOM 复用未改变的块，代码和图表按可见区域懒加载；Worker 解析与真正的增量语法缓存仍需性能优化。
- 即时预览支持标题、强调、链接、行内代码标记隐藏，光标行显示源码；图片内嵌编辑、表格富文本编辑属于后续完善。
- 大文件查看为显式分页，不是无限滚动；超过 5 MB 关闭预览。工作区搜索目前支持文本与大小写切换，不支持全库正则/自定义 glob；文档内查找支持正则。
- P2 的 WYSIWYG、DOCX/EPUB、插件、双链、同步与协同按设计留待后续。

架构选型、详细设计及验收指标见[技术选型与详细设计](Markdown跨平台编辑器-技术选型与详细设计.md)。

## 许可证

[MIT License](LICENSE)
