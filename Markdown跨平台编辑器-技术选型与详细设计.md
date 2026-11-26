% Markdown 跨平台编辑器技术选型与详细设计
% 版本 v1.0 · 2026-11-25
% 适用平台：Windows / macOS / Linux

## 0 文档说明

| 项目 | 内容 |
| --- | --- |
| 文档目的 | 为"跨平台 Markdown 编辑与查看器"确定技术栈，并给出可直接进入开发阶段的详细设计 |
| 目标读者 | 产品负责人、客户端开发、测试、运维/发布 |
| 文档范围 | 技术选型论证、系统架构、模块级详细设计、非功能指标、工程化与交付、实施计划、风险清单 |
| 不在范围 | 商业定价、市场推广、服务端协同编辑后端（仅在"未来演进"中简述） |
| 关联产物 | 本设计落地后的仓库脚手架、接口定义（TypeScript 类型文件）、UI 原型 |

术语约定：**主进程（Main）**指桌面壳的宿主进程；**渲染进程（Renderer）**指承载编辑界面与预览的 Web 容器；**文档**指一个被打开的 `.md` 文件实例；**工作区**指用户选择的根目录。

## 1 需求与约束

### 1.1 产品定位

一款**本地优先（local-first）**、无需登录、可直接双击文件打开的 Markdown 编辑器/查看器。核心体验目标：打开快、输入跟手、预览准、不乱改用户文件。对标体验参照 Typora、Obsidian、VS Code 的 Markdown 预览，但不做知识库/双链等重功能（P2 再议）。

### 1.2 功能分级

| 优先级 | 功能 |
| --- | --- |
| P0（MVP） | 打开/编辑/保存单个 `.md`；多标签；源码编辑 + 分栏实时预览；GFM 语法（表格、任务列表、删除线、自动链接）；代码块语法高亮；大纲导航；查找替换；浅色/深色主题；拖拽打开文件；最近文件；未保存保护；Windows/macOS/Linux 三端安装包 |
| P1 | 行内即时预览（隐藏标记符的"类 Typora"模式）；KaTeX 数学公式；Mermaid 图表；Front-Matter 元信息面板；文件夹工作区 + 全库搜索；自动保存与崩溃恢复；导出 HTML/PDF；图片粘贴自动落盘；自定义 CSS；多语言（中/英） |
| P2 | WYSIWYG 富文本模式；DOCX/EPUB 导出；插件体系；标签/双链；云同步；协同编辑 |

### 1.3 硬约束

1. 三端功能对等，同一份代码库交付，不允许分平台维护两套 UI。
2. 安装包体积目标 ≤ 120 MB（Windows x64 安装包），冷启动 ≤ 1.5 s（SSD、无插件）。
3. 纯离线可用，不依赖网络与账号；不上传用户文档内容。
4. 编辑采用 UTF-8 内部表示，**保存时必须保留原文件的编码、换行符（LF/CRLF）与末尾换行状态**，避免"打开再保存就产生全文件 diff"——这是 Markdown 用户最敏感的问题。
5. macOS 需通过 Gatekeeper（签名 + 公证），Windows 需 Authenticode 签名，否则会被拦截。

## 2 技术选型

### 2.1 候选方案

| 方案 | 形态 | 编辑器内核可得性 | 包体积（≈） | 空闲内存（≈） | 跨端一致性 |
| --- | --- | --- | --- | --- | --- |
| **A Electron + Web 前端** | Chromium 自带 | CodeMirror 6 / Monaco 全量可用 | 90–150 MB | 120–200 MB | 高（同一 Chromium 版本） |
| **B Tauri 2 + Rust + Web 前端** | 系统 WebView | 同上（受 WebView 能力限制） | 8–30 MB | 40–90 MB | 中（WebView2 / WKWebView / WebKitGTK 三套引擎） |
| C Qt 6 + QML/C++ | 原生 | 需自建编辑控件或嵌 QtWebEngine（≈ Chromium） | 60–120 MB | 80–150 MB | 中 |
| D Avalonia (.NET) | 原生 | 需自建编辑控件（AvaloniaEdit） | 60–100 MB | 100–160 MB | 中 |
| E Flutter Desktop | 自绘引擎 | 文本编辑控件能力弱，需大量自研 | 40–80 MB | 80–140 MB | 高 |
| F Compose Desktop (JVM) | 自绘/Skia | 同上 | 60–110 MB（含 JRE） | 150–250 MB | 高 |

### 2.2 评分矩阵

权重依据：Markdown 编辑器的成本 80% 落在"文本编辑 + 富文本渲染"这两块，而这两块在 Web 前端已有成熟内核；因此"编辑/渲染生态"和"跨端一致性"权重最高。体积与内存属于可接受代价，不是决定项。

| 维度（权重） | A Electron | B Tauri | C Qt | D Avalonia | E Flutter | F Compose |
| --- | --- | --- | --- | --- | --- | --- |
| 启动速度与内存（20%） | 3 | 4.5 | 5 | 3 | 4 | 2 |
| 编辑/渲染生态成熟度（20%） | 5 | 4 | 2 | 3 | 3.5 | 2.5 |
| 跨端一致性（15%） | 5 | 3 | 4 | 3 | 4.5 | 4.5 |
| 包体积与分发（10%） | 2 | 5 | 3 | 3.5 | 3 | 2 |
| 开发效率与迭代速度（15%） | 5 | 4 | 2 | 3 | 3 | 3 |
| 长期维护与招人（10%） | 5 | 4 | 3 | 3 | 3.5 | 3 |
| 安全基线（10%） | 3 | 5 | 4 | 4 | 3 | 3 |
| **加权总分** | **4.50** | **4.15** | 3.30 | 3.15 | 3.10 | 2.83 |

### 2.3 结论

**主方案：Electron（Chromium 自带）+ TypeScript/React + CodeMirror 6 编辑器内核 + markdown-it 渲染管线。**

理由：

1. **同赛道已被验证**：Typora、Obsidian、VS Code 的 Markdown 能力都跑在同一套组合上，说明"富文本渲染 + 超大文件 + 中文输入法"这些坑都有人踩过并沉淀了解法。
2. **跨端像素级一致**：自带 Chromium，三端 WebView 版本差异问题不存在，直接消灭了 Tauri 方案最大的不确定性（Linux WebKitGTK 的 CSS/字体/滚动行为差异）。
3. 包体积 100 MB 级对"桌面生产力工具"不是门槛（VS Code 同量级），而换来的是编辑器内核、渲染插件、语法高亮、公式、图表全套现成能力。
4. 团队若为前端背景，学习成本几乎为零，可以把资源全部投入到产品体验而非搭建文本编辑基础设施。

**备选方案：Tauri 2**，触发条件（任一满足即切换评估）：产品明确以"极轻量安装包/低内存占用"作为核心卖点；或发行渠道对安装包体积有硬限制（如应用商店限制、内网分发带宽）；或需要后续扩展移动端。切换代价约 3–4 周（含 Linux WebView 兼容调试），代价可接受，因此架构设计上**第 3 章的分层刻意让 Web 前端与宿主壳解耦**，保留可迁移性。

**不推荐 Qt / Flutter / Compose**：Markdown 渲染与编辑内核需要从零自研（语法高亮、增量解析、行内装饰、表格编辑、公式），投入产出比极差，且中文 IME 与复杂文本排版在三者上都更容易出问题。

### 2.4 子系统选型

| 子系统 | 选型 | 备选 | 选择理由 |
| --- | --- | --- | --- |
| 桌面壳 | Electron 3x（发布时最新稳定版，锁定版本、每 2 个大版本升级一次） | Tauri 2 | 见 2.3 |
| 构建工具 | electron-vite（Vite 5）+ electron-builder | Electron Forge | electron-vite 提供主/预加载/渲染三端统一构建与热更新；builder 在签名、公证、多目标产物上最成熟 |
| UI 框架 | React 18 + TypeScript（strict） | Vue 3 | 生态、类型支持、团队熟悉度 |
| 状态管理 | Zustand（轻量、无 Provider 嵌套） | Redux Toolkit | 编辑器状态量大且高频，Zustand 的不可变更新与订阅更省开销 |
| 编辑器内核 | **CodeMirror 6** | Monaco | CM6 核心约 200 KB 级、基于 StateField/Decoration 的扩展模型天生适合"行内即时预览"；Monaco 体积 3 MB+ 且面向纯代码，Markdown 装饰能力弱 |
| Markdown 解析 | **markdown-it** + 插件族 | unified/remark、comrak(WASM) | 速度最快、插件生态最全（脚注、任务列表、属性、公式），且支持按块缓存做增量渲染；remark 的 AST 更规整但性能开销约 2 倍 |
| HTML 消毒 | DOMPurify（白名单模式） | sanitize-html | 与 markdown-it 输出契合，防 XSS 必需 |
| 代码高亮 | **Shiki**（按需懒加载语言）+ 大代码块降级 highlight.js | Prism | Shiki 使用 TextMate 语法，配色与 VS Code 一致，质量最高；懒加载控制体积 |
| 数学公式 | KaTeX | MathJax | 渲染速度数量级领先，适合实时预览 |
| 图表 | Mermaid 11（懒加载 + 结果缓存） | — | 唯一成熟方案；必须在防抖后异步渲染 |
| 文件监听 | chokidar | fs.watch | 跨端行为一致，能处理编辑器/IDE 的原子替换式保存 |
| 编码探测 | jschardet + BOM 检测 | — | 覆盖 GBK/Shift-JIS 等常见编码，避免中文乱码 |
| 全局搜索 | ripgrep 侧车二进制（按平台打包） | 纯 JS 递归遍历 | 万级文件工作区下速度差 10 倍以上；降级方案为 Node 端并发遍历 |
| PDF 导出 | Electron 隐藏窗口 `webContents.printToPDF` | 系统打印、headless Chromium | 零额外依赖，与预览渲染完全一致 |
| HTML 导出 | 自包含单文件（内联 CSS + 图片 base64 可选） | — | 便于分享 |
| 自动更新 | electron-updater（GitHub Releases / 自建 S3）+ 差分更新 | — | 支持三端，Windows 用 NSIS 差分、mac 用 zip 差分 |
| 日志 | electron-log（本地轮转）+ OpenTelemetry 可选匿名上报 | — | 用户可一键关闭上报 |
| 单元测试 | Vitest | Jest | 与 Vite 同源，速度快 |
| E2E 测试 | Playwright（Electron 支持）+ WebdriverIO/wdio-electron-service | — | 覆盖真实 Electron 进程，可注入 IPC |
| 代码质量 | ESLint + Prettier + TypeScript strict + `cargo`/无 | — | — |

### 2.5 平台基线

| 平台 | 最低版本 | 产物 | 备注 |
| --- | --- | --- | --- |
| Windows | Windows 10 1809+ / x64、arm64 | NSIS 安装包 + 便携版 zip | Windows 7/8 不支持（Chromium 已停止支持） |
| macOS | macOS 11+，Universal（Intel + Apple Silicon） | dmg（签名 + 公证）+ zip（供自动更新） | 需 Developer ID 证书与 notarytool |
| Linux | glibc 2.28+ / x64、arm64 | AppImage + deb（可选 rpm、snap） | Wayland 下需 `--ozone-platform-hint=auto`；部分发行版需 `--no-sandbox` 说明（AppImage 已处理） |

## 3 系统架构

### 3.1 分层视图

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer（Web，sandbox + contextIsolation）                   │
│  ├ UI 层        React 组件：标签栏/侧栏/工具栏/设置/对话框      │
│  ├ 编辑层      CodeMirror 6：State、Extensions、Decorations   │
│  ├ 渲染层      markdown-it 管线 → 防抖 → 分段渲染 → 消毒      │
│  └ 状态层      Zustand stores：workspace / tabs / settings    │
└───────────────────────┬──────────────────────────────────────┘
                        │ contextBridge 暴露的窄接口（window.md）
┌───────────────────────┴──────────────────────────────────────┐
│ Preload（唯一桥接面，不做业务逻辑）                            │
└───────────────────────┬──────────────────────────────────────┘
                        │ IPC（invoke/handle，带 schema 校验）
┌───────────────────────┴──────────────────────────────────────┐
│ Main（Node，无 UI）                                          │
│  ├ 文件服务   读写/原子替换/编码与换行探测/Watch/回收站删除     │
│  ├ 工作区服务 目录树、ripgrep 搜索、最近文件、路径白名单        │
│  ├ 导出服务   PDF/HTML/DOCX（隐藏窗口或文档生成库）            │
│  ├ 平台服务   菜单、窗口、托盘、文件关联、深链接、单实例        │
│  ├ 会话服务   自动保存、崩溃恢复、草稿、快照                   │
│  └ 基础设施   日志、设置持久化(electron-store)、更新、崩溃上报  │
└──────────────────────────────────────────────────────────────┘
```

要点：**所有文件系统与进程能力只在 Main**；Renderer 永远拿不到 `fs`。Preload 只做参数整形与前向转发，接口面控制在 30 个方法以内，便于审计。

### 3.2 进程与线程模型

| 载体 | 职责 | 约束 |
| --- | --- | --- |
| Main | 窗口生命周期、菜单、文件 IO、搜索、导出、更新 | 同步 IO 一律禁止；大文件读取走流式 + 分片回传 |
| Renderer（每窗口 1 个） | UI、编辑器、预览 | 打开 `sandbox: true`、`nodeIntegration: false`、`contextIsolation: true` |
| 预览窗口（隐藏，复用） | PDF/HTML 导出渲染 | 与主窗口共享渲染管线代码，导出时禁用动画 |
| Utility Process / Worker | 大文件解析、全文搜索后处理、Mermaid 预热 | 避免阻塞主进程与 UI 线程 |

### 3.3 目录结构

```
md-editor/
├─ electron.vite.config.ts
├─ electron-builder.yml
├─ src/
│  ├─ main/
│  │  ├─ index.ts                 # app 生命周期、单实例、窗口管理
│  │  ├─ ipc/                     # 每个域一个 handler 文件 + zod schema
│  │  ├─ services/
│  │  │  ├─ file-service.ts       # 读/写/原子替换/编码探测
│  │  │  ├─ watcher-service.ts
│  │  │  ├─ workspace-service.ts
│  │  │  ├─ search-service.ts     # ripgrep 封装
│  │  │  ├─ export-service.ts
│  │  │  ├─ session-service.ts    # 自动保存/恢复
│  │  │  └─ settings-service.ts
│  │  └─ platform/                # menu / tray / single-instance / protocol
│  ├─ preload/
│  │  └─ index.ts                 # contextBridge.exposeInMainWorld('md', api)
│  ├─ shared/                     # 主/渲染共用：类型、常量、IPC 通道名
│  │  ├─ types.ts
│  │  ├─ ipc-contract.ts
│  │  └─ errors.ts
│  └─ renderer/
│     ├─ app/                     # 入口、路由、主题
│     ├─ components/              # TabBar / Sidebar / Outline / StatusBar …
│     ├─ editor/                  # CM6 extensions、commands、decorations
│     ├─ markdown/                # markdown-it 装配、插件、缓存、消毒
│     ├─ stores/                  # zustand
│     └─ styles/                  # 主题 token（CSS 变量）
├─ resources/                     # 图标、ripgrep 二进制、模板 CSS
└─ tests/                         # unit / e2e / fixtures（黄金样本）
```

### 3.4 核心数据流

打开文件 → 编辑 → 预览 → 保存：

1. Renderer 发起 `file:open(path)`；Main 校验路径 → 读流 → 探测 BOM/编码/换行 → 归一化为 UTF-8 文本 + `FileMeta` 返回。
2. Renderer 创建 `EditorState`（CM6）+ `DocumentModel`；同时把文本灌入 markdown-it 管线做**首屏只渲染可视区块**。
3. 用户输入：CM6 事务直接改文档（本地、零 IPC）；每隔 120 ms 空闲将"变更行区间"发给预览调度器。
4. 预览调度器按块 hash 命中缓存，仅重渲染脏块，增量 patch 到 DOM（保留滚动锚点与已渲染的 Mermaid/KaTeX 结果）。
5. 保存：`file:save(path, text, expectMtime)` → Main 复核 mtime（冲突则返回 `CONFLICT`）→ 写临时文件 → `fsync` → `rename` 原子替换 → 回写元数据。

## 4 详细设计

### 4.1 数据模型

```ts
// shared/types.ts
export type Eol = 'lf' | 'crlf';
export type Encoding = 'utf8' | 'utf8-bom' | 'gbk' | 'utf16le' | 'utf16be' | 'shift_jis';

export interface FileMeta {
  path: string;            // 绝对路径
  mtimeMs: number;         // 用于冲突检测
  size: number;
  encoding: Encoding;      // 原文件编码，保存时还原
  eol: Eol;                // 原文件换行符
  hasTrailingNewline: boolean;
  readonly: boolean;       // 权限只读或用户锁定
}

export interface FileDoc { meta: FileMeta; text: string; }

export interface TabState {
  id: string;
  path: string | null;     // null = 未命名草稿
  dirty: boolean;
  cursor: { line: number; ch: number; scrollTop: number };
  viewMode: 'source' | 'split' | 'preview' | 'inline';  // inline = 行内即时预览
  previewScrollRatio: number;
  lastSavedAt: number | null;
}

export interface WorkspaceState {
  root: string | null;
  tabs: TabState[];
  activeTabId: string | null;
  recentFiles: string[];   // 上限 20，去重
}

export interface Settings {
  theme: 'system' | 'light' | 'dark' | 'sepia';
  fontSize: number; lineHeight: number; fontFamily: string;
  editor: { lineNumbers: boolean; wordWrap: boolean; tabSize: number; autoPairs: boolean };
  preview: { math: boolean; mermaid: boolean; htmlPassthrough: boolean; codeLineNumbers: boolean };
  files: { autoSave: 'off' | 'onFocusChange' | 'afterDelay'; delayMs: number; atomicWrite: boolean };
  export: { pdfPageSize: 'A4' | 'Letter'; htmlStandalone: boolean; embedImages: boolean };
  privacy: { telemetry: boolean };
}
```

状态归属原则：**文本内容只存在 CM6 的 `EditorState` 中**，Zustand 只存 UI 状态与元信息；避免同一份文本两处副本导致的同步 bug 和内存翻倍。

### 4.2 IPC 契约

通道命名 `域:动作`，全部走 `ipcRenderer.invoke`，参数与返回值用 zod 在 Main 入口校验（防止渲染层被注入后越权访问任意路径）。

| 通道 | 入参 | 返回 | 说明 / 错误码 |
| --- | --- | --- | --- |
| `file:open` | `{ path }` | `FileDoc` | `ENOENT` `EACCES` `EISDIR` `ETOOBIG`（> 50 MB 走只读大文件模式） |
| `file:read-dropped` | `{ path }` | `FileDoc` | 拖拽/文件关联入口 |
| `file:save` | `{ path, text, meta }` | `FileMeta` | `CONFLICT`（mtime 变化）、`EACCES` |
| `file:save-as` | `{ path, text }` | `FileMeta` | 另存为，重算编码 |
| `file:rename` / `file:trash` | `{ path, newPath? }` | `void` | 删除走系统回收站 |
| `file:reveal` | `{ path }` | `void` | 在 Finder/资源管理器定位 |
| `fs:stat` | `{ path }` | `{ exists, isDir, size, mtimeMs }` | — |
| `file:write-attachment` | `{ dir, name, base64 }` | `{ relPath }` | 粘贴图片落盘，自动去重命名 |
| `watch:start` / `watch:stop` | `{ path }` | `void` / 事件流 `file:changed` | 外部修改提示 |
| `workspace:list` | `{ root, depth }` | `TreeNode[]` | 懒加载，单次 ≤ 5 万节点 |
| `search:files` | `{ root, query, globs, isRegex, maxResults }` | `Match[]` | 基于 ripgrep |
| `search:in-document` | — | — | **不走 IPC**，CM6 内置 Search 扩展 |
| `export:pdf` | `{ html, options }` | `{ path }` | 隐藏窗口 printToPDF |
| `export:html` | `{ markdown, options }` | `{ path }` | 自包含 HTML |
| `export:docx` | `{ markdown, options }` | `{ path }` | P2，AST→docx |
| `app:open-external` | `{ url }` | `void` | 仅 http/https/mailto 白名单 |
| `settings:get` / `settings:set` | `Settings` 片段 | `Settings` | electron-store 持久化 |
| `session:save` / `session:restore` | `SessionSnapshot` | — | 崩溃恢复 |
| `update:check` / `update:install` | — | `UpdateInfo` | 用户确认后安装 |
| `window:state` | — | `{ maximized, focused, fullscreen }` | — |

安全约定：

1. Main 侧维护"允许访问根集合"= 已打开文件所在目录 + 已授权工作区 + 最近文件目录；`fs` 操作前必须做 `realpath` 归一后前缀匹配，防止符号链接穿越。
2. 拒绝所有非 `file:` 绝对路径与 UNC 之外的输入；`file://` 不由渲染层直接使用。
3. `app:open-external` 强制协议白名单，`javascript:`、`data:`、`file:` 一律丢弃。

### 4.3 文件服务

核心难点是"不破坏用户文件"，实现约束如下。

```ts
// main/services/file-service.ts —— 原子写 + 元信息还原
async function save(path: string, text: string, meta: FileMeta) {
  const stat = await fs.stat(path);
  if (Math.abs(stat.mtimeMs - meta.mtimeMs) > 1000) throw new ConflictError(path);

  // 1) 还原换行符与末尾换行
  let out = meta.eol === 'crlf' ? text.replace(/\n/g, '\r\n') : text;
  if (meta.hasTrailingNewline && !out.endsWith(meta.eol === 'crlf' ? '\r\n' : '\n')) out += '\n';
  if (!meta.hasTrailingNewline) out = out.replace(/(\r?\n)+$/, '');

  // 2) 还原编码（非 UTF-8 时用 iconv-lite 编码）
  const buf = encode(out, meta.encoding);

  // 3) 临时文件 + fsync + 原子 rename
  const tmp = `${path}.${process.pid}.tmp`;
  await fs.writeFile(tmp, buf);
  const fh = await fs.open(tmp, 'r+'); await fh.sync(); await fh.close();
  await fs.rename(tmp, path);                 // 同分区内原子
  return buildMeta(path, meta.encoding, /* 重新探测 */);
}
```

其他规则：

- **编码探测顺序**：BOM → UTF-16 → 能否按 UTF-8 严格解码 → jschardet 置信度最高者 → 兜底 UTF-8；探测结果在 UI 状态栏显示，允许用户手动切换并触发一次全量重读。
- **换行探测**：统计首个 CRLF 与裸 LF 出现次数，以多数为准；单行文件默认继承系统 EOL。
- **超大文件**：> 5 MB 关闭行内即时预览并降级为按需渲染；> 50 MB 进入只读查看模式（虚拟滚动 + 分片加载），顶部提示"只读模式，可用外部编辑器修改"。
- **只读文件**：`open` 时检测 `mode` 与可写性，UI 进入只读态，保存按钮禁用并提示原因。
- **外部修改冲突**：watcher 触发 `file:changed` 时，若当前 dirty 则弹三选一（重新加载 / 保留我的 / 另存为副本），绝不静默覆盖。

### 4.4 编辑器模块（CodeMirror 6）

扩展清单（按依赖顺序）：

| 扩展 | 作用 | 备注 |
| --- | --- | --- |
| `basicSetup`（裁剪版） | 基础编辑能力 | 关掉不需要的 lint/自动补全以降开销 |
| `markdown({ base: markdownLanguage, codeLanguages })` | Markdown 语法解析与代码块内嵌高亮 | 语言按需注册 |
| `EditorView.lineWrapping` | 软换行 | 用户可关 |
| `history()` + `historyKeymap` | 撤销栈 | 与自动保存节流配合 |
| `keymap.of(markdownKeymap)` | 列表续行、粗体/斜体/标题切换快捷键 | Tab 缩进按上下文（列表内缩进、代码块内插空格） |
| `Search`（`@codemirror/search`） | 文档内查找替换 | 支持正则、全词、大小写 |
| `custom: PasteImage` | 粘贴剪贴板图片 → `file:write-attachment` → 插入 `![](rel)` | 需主进程配合 |
| `custom: InlinePreview` | StateField + Decoration 行内即时预览 | 见 4.5 |
| `custom: SyncScroll` | 源码↔预览滚动同步 | 见 4.7 |
| `custom: LargeDoc` | >5 MB 时关闭装饰层 | 视口外不渲染装饰 |

行内即时预览（P1）实现要点：基于 `syntaxTree` 遍历当前**视口内**可见区间，对标题标记 `#`、强调 `*`、链接 URL 部分、图片语法生成 `Decoration.replace` 隐藏，对内容加 `Decoration.mark` 套用字号/颜色；光标所在行不隐藏标记（`selection` 变化时重算该行），保证"可编辑且可读"。装饰只在 `ViewportChanged` 时重建，避免全文档遍历。

### 4.5 渲染管线

```
CM6 文本变更
  → debounce 120ms（输入中不渲染）
  → 按空行/标题切分为 Block[]（含行号区间 + 内容 hash）
  → 脏块筛选（hash 变化 ∪ 依赖块变化，如引用定义、脚注）
  → markdown-it 逐块 render（共享 env，保证脚注/链接定义跨块生效）
  → DOMPurify 消毒（白名单标签/属性）
  → 组装 HTML，patch 到 #preview（按块 id 做最小 diff）
  → 后处理：KaTeX（异步队列）→ Mermaid（防抖 400ms，渲染结果按 hash 缓存 SVG）
  → 可见性回调：只有进入视口的代码块才触发 Shiki 高亮
```

markdown-it 装配：

```ts
const md = markdownit({ html: settings.preview.htmlPassthrough, linkify: true, breaks: false })
  .use(markdownitFootnote)
  .use(markdownitTaskLists, { enabled: true })
  .use(markdownitAttrs)            // 支持 {.class} 与 {#id}
  .use(mathPlugin, { engine: katex, throwOnError: false })
  .use(mermaidPlugin, { lazy: true })
  .use(tablePlugin);

// 代码高亮：交给 Shiki（异步），同步阶段仅输出 <pre data-lang>，由后处理填充
md.renderer.rules.fence = (tokens, idx) => fenceToPlaceholder(tokens[idx]);
```

渲染一致性要求：预览必须与导出使用**同一套 markdown-it 配置与 CSS**（导出时注入同一份 `preview.css`），否则会出现"预览正常、导出错版"的经典问题。

### 4.6 安全设计（预览侧）

Markdown 允许内联 HTML，是编辑器最大的攻击面（恶意 `.md` 文件 = 本地 XSS = 拿到用户目录的读权限）。

| 风险 | 对策 |
| --- | --- |
| 内联 HTML/脚本 | 默认关闭原始 HTML 直通；开启时经 DOMPurify 白名单，移除 `script`、`iframe`、`on*`、`javascript:` |
| 链接钓鱼 / 协议滥用 | 预览内全部链接拦截，交 `app:open-external` 校验协议白名单后在系统浏览器打开 |
| 本地图片越权读取 | 不暴露 `file://`；注册自定义协议 `mdasset://`（Main 侧校验路径属于文档目录/工作区后才返回字节） |
| CSP | 渲染页设置 `default-src 'self'; img-src 'self' mdasset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'`（KaTeX/Shiki 均为本地包，不需外部 CDN） |
| 渲染进程逃逸 | `sandbox: true` + 关闭 `nodeIntegration` + 禁止 `webview` 标签 + `setWindowOpenHandler` 一律 deny |
| 自动更新投毒 | 更新包签名校验（Windows Authenticode / macOS 公证 + Electron 内置签名校验），HTTPS + 固定域名 |
| 隐私 | 默认关闭遥测；日志不记录文档正文，只记录路径 hash 与耗时 |

### 4.7 滚动同步与预览交互

- 采用"行号锚点映射"而非比例同步：渲染时为每个块记录 `data-line-start`，滚动时把视口顶部块映射回源码行号并 `scrollIntoView`，比例仅作兜底。双向同步需加"程序化滚动锁"（200 ms）防止回环抖动。
- 预览内复选框（任务列表）可点击 → 反查源码行 → 通过 CM6 事务改写 `[ ]`/`[x]`，走同一撤销栈。
- 目录跳转、脚注回链、标题锚点点击 → 定位到源码行 / 滚动到块。

### 4.8 会话、自动保存与崩溃恢复

| 场景 | 策略 |
| --- | --- |
| 自动保存 | 默认 `onFocusChange`（切标签/失焦时），可选 `afterDelay 3s`；仅对已存在磁盘路径的文档自动保存，未命名草稿不落盘 |
| 草稿快照 | 每 10 s（且有变更时）把 dirty 文档写入 `appData/snapshots/<hash>.json`（文本 + meta + 时间戳），单文档单文件，总量上限 200 MB 后按 LRU 清理 |
| 崩溃恢复 | 启动时扫描 snapshots，与磁盘 mtime 对比：磁盘更新则丢弃快照；否则提示"恢复 N 个未保存文档" |
| 正常退出 | 清理该会话快照；未保存文档弹窗（保存 / 放弃 / 取消） |
| 标签恢复 | 退出时持久化 `WorkspaceState`（含光标位置与滚动位置），下次启动还原 |

### 4.9 工作区与搜索

- 目录树懒加载：首屏只列 root 一层，展开时按需读；忽略 `.git`、`node_modules`、`.DS_Store`，规则可在设置中编辑（后续兼容 `.gitignore`）。
- 全库搜索走 ripgrep 侧车：`rg --json --max-count 20 --glob '*.md'`，结果流式回传，UI 分批渲染；搜索请求需可取消（发送 SIGTERM 到子进程）。**该二进制按平台分别打包进 `resources/`，启动前做一次可执行校验，缺失时降级为 Node 遍历并提示性能下降。**
- 搜索命中项点击 → 打开文件并定位行（复用 `file:open` + 一次性跳转参数）。

### 4.10 导出

| 格式 | 实现 | 注意点 |
| --- | --- | --- |
| HTML | markdown-it 渲染 + 注入 `preview.css` + 可选图片 base64 内联 | 生成单文件，文件名默认同名 |
| PDF | 创建隐藏 `BrowserWindow`（关闭 GPU、动画），加载内联 HTML，`printToPDF({ pageSize, printBackground: true, margins })` | 必须等 Mermaid/图片 `load` 完成（信号量 + 超时 3 s）再打印，否则出现空白图 |
| DOCX（P2） | markdown-it token → 中间 AST → `docx` 库生成 OOXML | 不打包 pandoc（150 MB 级，破坏体积目标）；表格/代码块样式需自定义映射 |

导出统一入口：`export:*` 全部复用预览管线产出的 HTML，避免"两套渲染造成样式漂移"。

### 4.11 主题与排版

- 主题以 CSS 变量（`--bg`, `--fg`, `--accent`, `--code-bg`…）为唯一出口，编辑器主题（CM6 `EditorView.theme`）、预览、UI 三处共用同一 token 表，保证三处配色一致。
- 提供 `system` 跟随系统（监听 `nativeTheme`），并支持自定义 JSON 主题（P1）。
- 排版默认：正文字号 16px、行高 1.7、`font-family` 按平台推荐（Win: "Microsoft YaHei UI, Segoe UI"；mac: "-apple-system, PingFang SC"；Linux: "Noto Sans CJK SC"），代码字体 JetBrains Mono（内置打包，避免 Linux 缺字体）。
- 印刷式排版（PDF/导出）使用独立 `print.css`：A4 边距 20 mm、标题分页控制（`break-after: avoid`）、代码块不跨页断行。

### 4.12 快捷键与无障碍

| 操作 | Windows/Linux | macOS |
| --- | --- | --- |
| 新建/打开/保存/另存 | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | `⌘N` / `⌘O` / `⌘S` / `⌘⇧S` |
| 查找/替换 | `Ctrl+F` / `Ctrl+H` | `⌘F` / `⌥⌘F` |
| 切换视图（源码/分栏/预览） | `Ctrl+Shift+V` 循环 | `⌘⇧V` |
| 加粗/斜体/行内代码 | `Ctrl+B` / `Ctrl+I` / `Ctrl+E` | `⌘B` / `⌘I` / `⌘E` |
| 大纲开关 / 专注模式 | `Ctrl+Shift+O` / `F11` | `⌘⇧O` / `⌃⌘F` |

无障碍：全部交互可通过键盘完成，焦点环可见；预览区图片必须有 `alt`（缺失时从文件名生成）；编译产物包含 `aria-label`；对比度满足 WCAG AA（深色主题正文对比度 ≥ 4.5:1）。

### 4.13 平台集成

| 能力 | 实现 |
| --- | --- |
| 文件关联 | 安装时注册 `.md/.markdown/.mdown/.mkd`；单实例锁 + 二次启动参数转发（`requestSingleInstanceLock` + `second-instance`） |
| macOS 菜单栏 | 原生菜单 + "服务"项；关闭窗口不退出（`window-all-closed` 平台判断） |
| 深链接 | `mdview://open?path=`，Main 侧校验路径合法后打开 |
| 托盘/最近文件 | 系统 JumpList / macOS Dock 最近文档（`app.addRecentDocument`） |
| 高 DPI | 使用矢量图标（SVG/PDF），不依赖位图缩放 |

## 5 非功能设计

### 5.1 性能指标与预算

| 指标 | 目标 | 测量方式 |
| --- | --- | --- |
| 冷启动到可输入 | ≤ 1.5 s（P95，SSD，Win10 i5） | 启动打点（`app ready` → 首帧可编辑） |
| 打开 1 MB 文件 | ≤ 400 ms | 基准脚本，20 次取 P95 |
| 输入延迟 | ≤ 50 ms（10 万字符文档） | CM6 事务耗时埋点 |
| 预览刷新（单块） | ≤ 30 ms；整篇 5000 行首屏 ≤ 600 ms | 渲染管线埋点 |
| 滚动帧率 | ≥ 50 FPS（1080p、5000 行） | PerformanceObserver 长任务统计 |
| 空闲内存 | ≤ 200 MB（单窗口 + 1 文档） | 三端实测，CI 不做硬门禁但做趋势记录 |
| 安装包 | Windows ≤ 120 MB（x64） | 构建产物记录 |

优化手段（按收益排序）：预览按块缓存 + 视口高亮；解析与高亮懒加载；关闭未使用扩展；Mermaid 只在可见且稳定 400 ms 后渲染；启动时预热 CM6 与 markdown-it（并行 with 窗口创建）；`app.commandLine` 关闭不需要的 Chromium 特性（谨慎，逐项验证）。

### 5.2 内存与资源

- 每个标签共享同一 markdown-it 实例、同一 Shiki 高亮器（语言按需加载，LRU 上限 8 种）。
- 关闭标签时显式销毁 `EditorState`、清理 Mermaid SVG 缓存与图片 blob URL。
- 图片预览使用 `URL.createObjectURL` 并在卸载时 `revokeObjectURL`，避免泄漏。

### 5.3 可靠性与日志

- 全局 `uncaughtException` / `unhandledRejection`：写日志 + 弹非阻塞提示 + 尝试保存会话快照，不直接崩溃退出。
- 日志：`electron-log`，按天轮转，保留 7 天，单文件 ≤ 10 MB；正文内容永不入日志。
- 错误码统一在 `shared/errors.ts` 定义，UI 层做可读文案映射（含"复制诊断信息"按钮）。

### 5.4 隐私

默认关闭遥测；开启时仅上报匿名聚合事件（启动耗时、崩溃栈的符号化帧、功能使用计数），不含路径、文件名、正文。首次启动展示一次性说明，设置中可随时关闭。

## 6 工程化、测试与交付

### 6.1 构建与 CI

- 本地：`npm run dev`（electron-vite watch）→ `npm run build` → `npm run dist`（electron-builder）。
- CI（GitHub Actions 矩阵）：`windows-latest` / `macos-14`（Universal）/ `ubuntu-22.04`，每平台跑 `lint → typecheck → unit → build → e2e(smoke) → 签名 → 产物上传`。
- 签名凭据放 Secrets：Windows（Authenticode 证书或 Azure Trusted Signing）、macOS（Developer ID .p12 + App Store Connect API Key 用于 notarytool）。
- Linux 在 `ubuntu-22.04` 构建以兼容较老 glibc；AppImage 额外验证在 24.04 与 Debian 12 上可启动。

### 6.2 测试策略

| 层次 | 工具 | 覆盖重点 |
| --- | --- | --- |
| 单元 | Vitest | 编码/换行还原、原子写、块切分与缓存键、markdown-it 配置、路径校验、快捷键映射 |
| 黄金样本（渲染回归） | Vitest + 快照 HTML | `tests/fixtures` 中 30+ 份畸形/边界 Markdown（嵌套表格、超长行、未闭合代码块、BOM、CRLF、中文标点、emoji、脚注交叉引用）；HTML 快照变更必须人工 review |
| E2E | Playwright(Electron) | 打开→编辑→保存→外部修改检测→崩溃恢复→导出 PDF 全链路；三端各跑冒烟 |
| 兼容性 | 手工矩阵 | Windows 10/11、macOS 12/13/14/15（Intel + M 系列）、Ubuntu 22.04/24.04、Fedora、Debian 12；含 125%/150% 缩放、Wayland 与 X11 |
| 性能 | 基准脚本 + CI 趋势 | 5.1 各指标，超阈值 15% 报警 |

### 6.3 打包与发布

| 项 | 说明 |
| --- | --- |
| Windows | NSIS（per-user 安装，无需管理员）；便携版 zip |
| macOS | dmg + zip（更新用）；Universal binary；公证必需 |
| Linux | AppImage（主力）+ deb；可选 rpm |
| 更新通道 | `stable` / `beta` 双通道，灰度按 10%→50%→100% 分批放量 |
| 版本 | SemVer；CHANGELOG 由 conventional commits 生成 |
| 回滚 | 更新包保留上一版本，启动崩溃连续 2 次自动回退并停用该版本 |

## 7 实施计划

| 阶段 | 周期 | 交付物 | 出口条件 |
| --- | --- | --- | --- |
| M0 脚手架 | 2 周 | 工程骨架、CI、三端空壳可启动、签名链路打通 | 三端安装包能装能卸，Gatekeeper/Defender 不拦 |
| M1 编辑核心 | 4 周 | 打开/编辑/保存/编码还原、多标签、撤销、快捷键 | 4.3 的元信息还原用例全绿 |
| M2 预览与扩展语法 | 3 周 | markdown-it 管线、GFM、代码高亮、公式、图表、消毒 | 黄金样本渲染快照通过 |
| M3 工作区能力 | 3 周 | 目录树、全库搜索、查找替换、大纲、滚动同步 | 1 万文件工作区搜索 < 2 s |
| M4 稳定性与体验 | 3 周 | 自动保存、崩溃恢复、设置、主题、i18n、导出 PDF/HTML | 恢复用例 + 导出样式一致 |
| M5 打磨与发布 | 2 周 | 性能达标、E2E 全绿、文档、1.0 发布 | 5.1 指标达成，热修复流程演练通过 |

合计约 17 周。人力建议：前端/桌面 2 人、测试 1 人（可兼）、设计 0.5 人（可外包）。若只做 P0 可压缩至 10–11 周。

## 8 风险登记

| 风险 | 概率 | 影响 | 对策 |
| --- | --- | --- | --- |
| 大文件（>10 MB）导致卡顿 | 中 | 高 | 分级降级策略（5 MB 关装饰、50 MB 只读分片）；M1 就做压力基准 |
| 中文输入法在 CM6 组合输入时装饰错位 | 中 | 高 | 装饰层感知 `compositionstart/end`，输入期间暂停行内隐藏；Windows 微软拼音、macOS 拼音、Linux fcitx5 各做专项用例 |
| 文件编码/换行还原出现回归 | 中 | 高 | 元信息用例作为合并门禁；黄金样本含 GBK、UTF-16、混合换行 |
| Mermaid 大图渲染阻塞 | 中 | 中 | 延迟 + 缓存 + 视口渲染；超 200 节点提示"暂不渲染" |
| Linux 发行版兼容（字体/沙箱/AppImage） | 中 | 中 | 打包字体；文档化 `--no-sandbox` 场景；三发行版实测 |
| 签名证书成本与流程 | 低 | 高 | 提前 4 周采购 EV/Trusted Signing；macOS 公证流程在 M0 打通 |
| 自动更新失败致应用不可用 | 低 | 高 | 差分更新 + 完整性校验 + 双次崩溃自动回退 + 手动下载兜底 |
| 恶意 Markdown 触发本地 XSS | 低 | 高 | 4.6 全套措施；E2E 加入恶意样本回归 |
| 前端/桌面人手不足导致延期 | 中 | 中 | P0/P1 切分，M2 结束即可发布"仅查看 + 基础编辑"预览版 |

## 9 关键决策记录（ADR 摘要）

| 编号 | 决策 | 备选 | 结论与代价 |
| --- | --- | --- | --- |
| ADR-01 | 采用 Electron 而非 Tauri | Tauri 2 | 换取一致性与生态，接受 100 MB 级包体；前端与壳解耦，保留迁移可能 |
| ADR-02 | 编辑器内核选 CM6 而非 Monaco | Monaco | 体积小一个数量级、装饰模型适配行内预览；放弃 Monaco 的多光标高级特性（CM6 已具备基础多光标） |
| ADR-03 | 解析用 markdown-it 而非 remark | unified/remark | 性能与插件成熟度优先；放弃 remark 的 AST 生态（DOCX 导出时自建 token→AST 转换） |
| ADR-04 | 不打包 pandoc | pandoc 侧车 | 保体积；DOCX 导出用 `docx` 库自实现，接受格式保真度略低 |
| ADR-05 | 文本状态只存于 CM6 | 双写 store | 消除双份真值带来的同步 bug 与内存翻倍 |
| ADR-06 | 预览按块增量而非全量重渲 | 全量 | 换取输入流畅度；代价是需要块切分与依赖块（引用/脚注）失效分析 |

## 10 附录

### 10.1 依赖清单（核心）

| 类别 | 包 | 用途 |
| --- | --- | --- |
| 壳 | `electron`, `electron-builder`, `electron-updater`, `electron-log`, `electron-store` | 生命周期/打包/更新/日志/设置 |
| 构建 | `electron-vite`, `vite`, `typescript`, `eslint`, `prettier` | 构建与质量 |
| UI | `react`, `react-dom`, `zustand` | 界面与状态 |
| 编辑 | `@codemirror/*`（state/view/commands/language/search/lang-markdown） | 编辑器 |
| 渲染 | `markdown-it` 及插件、`dompurify`, `katex`, `mermaid`, `shiki`, `highlight.js`(降级) | 预览 |
| 文件 | `iconv-lite`, `jschardet`, `chokidar` | 编码/监听 |
| 导出 | `docx`（P2） | DOCX |
| 测试 | `vitest`, `@playwright/test` | 单测/E2E |

### 10.2 验收清单（1.0）

1. 三端安装包可安装、可卸载、可自动更新；macOS 首次打开无"已损坏"提示。
2. 打开 GBK 编码、CRLF 换行的中文文档，保存后 `git diff` 为空。
3. 5000 行文档滚动流畅，输入无明显延迟；10 MB 文档以只读模式可打开。
4. 外部 IDE 修改同一文件时弹出冲突提示，不自动覆盖。
5. 强制杀进程后重启，未保存内容可从快照恢复。
6. 恶意样本（含 `<script>`、`javascript:` 链接、越权图片路径）不执行、不读取目录外文件。
7. 同一份文档的预览与导出 PDF 排版一致（标题层级、代码块、表格换行）。
8. 断网状态下全部 P0 功能可用。

### 10.3 未来演进

- **协同编辑**：CM6 原生支持 Yjs（`y-codemirror.next`），接入 CRDT 后可在不改编辑层的前提下加入多人协作与云同步。
- **插件体系**：以"声明式 manifest + 受限 API（只读文档事件、渲染钩子、命令注册）"起步，禁止插件直接访问文件系统，避免重蹈"编辑器插件即后门"的覆辙。
- **移动端**：CM6 与渲染管线可在 WebView 中复用，为 iOS/Android 预留了同一套前端代码。

> （注：部分内容由豆包 AI 生成）