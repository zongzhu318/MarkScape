import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell } from 'electron';
import type { MenuItemConstructorOptions } from 'electron';
import { access, mkdir, rename, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import chokidar from 'chokidar';
import log from 'electron-log/main';
import { PathService } from './services/path-service';
import { FileService, atomicWrite } from './services/file-service';
import { SessionService } from './services/session-service';
import { WorkspaceService } from './services/workspace-service';
import { ExportService, assetMime } from './services/export-service';
import {
  encodingSchema,
  metaSchema,
  pathSchema,
  sessionSchema,
  settingsSchema,
  textSchema,
} from '../shared/schemas';
import { AppError, errorInfo } from '../shared/errors';
import { MARKDOWN_EXTENSIONS } from '../shared/defaults';
import type { AppCommand, FileDoc } from '../shared/types';

protocol.registerSchemesAsPrivileged([
  { scheme: 'mdasset', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
if (process.env.MARKSCAPE_USER_DATA) app.setPath('userData', process.env.MARKSCAPE_USER_DATA);
const paths = new PathService();
const files = new FileService(paths);
const persistence = new SessionService(app.getPath('userData'));
const exports = new ExportService(paths);
let workspace: WorkspaceService;
let window: BrowserWindow | null = null;
let ready = false,
  allowClose = false,
  quitting = false;
const pending: string[] = [];
const opened = new Set<string>();
const watcher = chokidar.watch([], {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 250, pollInterval: 100 },
});
watcher.on('all', (_event, filename) => {
  window?.webContents.send('event:file-changed', filename);
});
log.initialize();
log.transports.file.maxSize = 10 * 1024 * 1024;
// Do not log filenames, document text or raw exception messages.
process.on('uncaughtException', (error) => log.error('uncaughtException', errorInfo(error).code));
process.on('unhandledRejection', (error) => log.error('unhandledRejection', errorInfo(error).code));

async function registerDocument(doc: FileDoc): Promise<FileDoc> {
  opened.add(doc.meta.path);
  watcher.add(doc.meta.path);
  await persistence.addRecent(doc.meta.path);
  app.addRecentDocument(doc.meta.path);
  return doc;
}
async function trustedOpen(filename: string): Promise<void> {
  if (!ready) {
    pending.push(filename);
    return;
  }
  try {
    const canonical = await paths.grantFile(filename);
    window?.webContents.send('event:open', await registerDocument(await files.read(canonical)));
  } catch (error) {
    await dialog.showMessageBox({
      type: 'error',
      message: '无法打开文档',
      detail: errorInfo(error).message,
    });
  }
}
function handle<T>(channel: string, schema: z.ZodType<T>, action: (input: T) => unknown): void {
  ipcMain.handle(channel, async (event, input: unknown) => {
    try {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new AppError('ACCESS_DENIED', '无效 IPC 来源');
      return { ok: true, value: await action(schema.parse(input)) };
    } catch (error) {
      const info = errorInfo(error);
      log.warn(channel, info.code);
      return { ok: false, error: info };
    }
  });
}
function registerIPC(): void {
  const empty = z.undefined();
  handle('app:bootstrap', empty, async () => {
    const recovery = await persistence.recovery();
    return {
      settings: persistence.settings,
      recent: persistence.recent,
      session: persistence.session,
      recovery,
    };
  });
  handle('app:ready-for-files', empty, async () => {
    ready = true;
    for (const filename of pending.splice(0)) await trustedOpen(filename);
  });
  handle('file:dialog', empty, async () => {
    const result = await dialog.showOpenDialog(window!, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Markdown', extensions: MARKDOWN_EXTENSIONS }],
    });
    const docs: FileDoc[] = [];
    for (const filename of result.filePaths)
      docs.push(await registerDocument(await files.read(await paths.grantFile(filename))));
    return docs;
  });
  handle(
    'file:open',
    z.object({ path: pathSchema, encoding: encodingSchema.optional() }),
    async (input) => registerDocument(await files.read(input.path, input.encoding)),
  );
  handle(
    'file:inspect',
    z.object({ path: pathSchema, encoding: encodingSchema }),
    async (input) => {
      if (!opened.has(input.path)) throw new AppError('ACCESS_DENIED', '文件尚未打开');
      return (await files.read(input.path, input.encoding)).meta;
    },
  );
  handle('file:read-dropped', pathSchema, async (filename) => {
    // A drop may request a new root. Native confirmation prevents forged renderer IPC from granting arbitrary paths.
    try {
      return await registerDocument(await files.read(filename));
    } catch (error) {
      if (!['ACCESS_DENIED'].includes(errorInfo(error).code)) throw error;
    }
    const result = await dialog.showMessageBox(window!, {
      type: 'question',
      message: '打开拖入的文件？',
      detail: filename,
      buttons: ['打开', '取消'],
      defaultId: 0,
      cancelId: 1,
    });
    if (result.response !== 0) throw new AppError('CANCELLED', '已取消打开');
    return registerDocument(await files.read(await paths.grantFile(filename)));
  });
  handle(
    'file:page',
    z.object({
      path: pathSchema,
      offset: z.number().int().nonnegative(),
      encoding: encodingSchema,
    }),
    (input) => files.readPage(input.path, input.offset, input.encoding),
  );
  handle('file:save', z.object({ text: textSchema, meta: metaSchema }), async (input) => {
    if (!opened.has(input.meta.path)) throw new AppError('ACCESS_DENIED', '文件尚未打开');
    return files.save(input.text, input.meta);
  });
  handle(
    'file:save-as',
    z.object({ text: textSchema, name: z.string().max(1000), source: metaSchema.optional() }),
    async (input) => {
      if (input.source && !opened.has(input.source.path))
        throw new AppError('ACCESS_DENIED', '源文件尚未打开');
      const choice = await dialog.showSaveDialog(window!, {
        defaultPath: path.basename(input.name),
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (choice.canceled || !choice.filePath) return null;
      await paths.grantDirectory(path.dirname(choice.filePath));
      const target = await paths.check(choice.filePath, true);
      if (opened.has(target) && target !== input.source?.path)
        throw new AppError('ALREADY_OPEN', '该文件已在其他标签打开，请选择其他文件名');
      const meta = await files.saveAs(target, input.text, input.source);
      await registerDocument({ text: input.text, meta });
      return meta;
    },
  );
  handle('file:close', pathSchema, async (filename) => {
    opened.delete(filename);
    await watcher.unwatch(filename);
  });
  handle('workspace:pick', empty, async () => {
    const result = await dialog.showOpenDialog(window!, { properties: ['openDirectory'] });
    if (result.canceled) return null;
    workspace.root = await paths.grantDirectory(result.filePaths[0]);
    return workspace.root;
  });
  handle('workspace:list', pathSchema, (directory) => workspace.list(directory));
  handle(
    'search:files',
    z.object({ query: z.string().max(500), caseSensitive: z.boolean() }),
    (input) => workspace.search(input.query, input.caseSensitive),
  );
  handle('search:cancel', empty, () => workspace.cancel());
  handle(
    'file:rename',
    z.object({
      path: pathSchema,
      name: z
        .string()
        .min(1)
        .max(255)
        .refine((name) => !/[\\/\0]/.test(name) && !['.', '..'].includes(name)),
    }),
    async (input) => {
      const from = await paths.check(input.path);
      const to = await paths.check(path.join(path.dirname(from), input.name), true);
      if (from === to) return files.read(from);
      if (
        await stat(to).then(
          () => true,
          () => false,
        )
      )
        throw new AppError('EEXIST', '目标文件已存在');
      const result = await dialog.showMessageBox(window!, {
        message: `重命名为 ${input.name}？`,
        buttons: ['重命名', '取消'],
        cancelId: 1,
      });
      if (result.response !== 0) return null;
      await rename(from, to);
      opened.delete(from);
      await watcher.unwatch(from);
      return registerDocument(await files.read(to));
    },
  );
  handle('file:trash', pathSchema, async (filename) => {
    const canonical = await paths.check(filename);
    if (!(await stat(canonical)).isFile()) throw new AppError('EISDIR', '只能删除文件');
    const result = await dialog.showMessageBox(window!, {
      type: 'warning',
      message: `将 ${path.basename(canonical)} 移到回收站？`,
      buttons: ['移到回收站', '取消'],
      defaultId: 1,
      cancelId: 1,
    });
    if (result.response !== 0) return false;
    await shell.trashItem(canonical);
    opened.delete(canonical);
    await watcher.unwatch(canonical);
    return true;
  });
  handle('file:reveal', pathSchema, async (filename) =>
    shell.showItemInFolder(await paths.check(filename)),
  );
  handle(
    'file:write-image',
    z.object({
      path: pathSchema,
      bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.length <= 20 * 1024 * 1024),
    }),
    async (input) => {
      const filename = await paths.check(input.path);
      if (!opened.has(filename)) throw new AppError('ACCESS_DENIED', '请先保存文档');
      const bytes = Buffer.from(input.bytes);
      if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
        throw new AppError('INVALID_IMAGE', '仅支持 PNG 剪贴板图片');
      const directory = path.join(path.dirname(filename), 'assets');
      await paths.check(directory, true);
      await mkdir(directory, { recursive: true });
      await paths.check(directory);
      const name = `image-${randomUUID()}.png`;
      await atomicWrite(path.join(directory, name), bytes);
      return `assets/${name}`;
    },
  );
  handle(
    'export:document',
    z.object({
      html: z.string().max(100 * 1024 * 1024),
      name: z.string().max(1000),
      format: z.enum(['html', 'pdf']),
    }),
    (input) => exports.export(window!, input.html, input.name, input.format, persistence.settings),
  );
  handle('app:external', z.string().url().max(8000), async (url) => {
    if (!['http:', 'https:', 'mailto:'].includes(new URL(url).protocol))
      throw new AppError('INVALID_URL', '不支持此链接协议');
    await shell.openExternal(url);
  });
  handle('settings:set', settingsSchema, (settings) => persistence.setSettings(settings));
  handle('session:save', sessionSchema, async (session) => {
    for (const tab of session.tabs)
      if (tab.path && !opened.has(tab.path)) await paths.check(tab.path, true);
    if (session.root && session.root !== workspace.root) await paths.check(session.root);
    await persistence.save(session);
  });
  handle('session:clear-recovery', empty, () => persistence.clearRecovery());
  handle('app:confirm-close', z.string().max(1000), async (name) => {
    const result = await dialog.showMessageBox(window!, {
      type: 'warning',
      message: `保存对“${name}”的更改？`,
      detail: '未保存的更改将会丢失。',
      buttons: ['保存', '放弃更改', '取消'],
      defaultId: 0,
      cancelId: 2,
    });
    return ['save', 'discard', 'cancel'][result.response];
  });
  handle('app:finish-close', empty, () => {
    allowClose = true;
    if (quitting) app.quit();
    else window?.close();
  });
  handle('update:check', empty, async () => {
    if (!app.isPackaged) return '开发版本不检查更新 / Updates are unavailable in development';
    const config = path.join(process.resourcesPath, 'app-update.yml');
    if (
      !(await access(config).then(
        () => true,
        () => false,
      ))
    )
      return '尚未配置更新发布源 / No update provider configured';
    const { autoUpdater } = (await import('electron-updater')).default;
    autoUpdater.autoDownload = false;
    const result = await autoUpdater.checkForUpdates();
    if (!result || result.updateInfo.version === app.getVersion())
      return '已是最新版本 / Up to date';
    const confirm = await dialog.showMessageBox(window!, {
      message: `下载并安装 MarkScape ${result.updateInfo.version}？`,
      buttons: ['下载', '取消'],
      cancelId: 1,
    });
    if (confirm.response === 0) {
      await autoUpdater.downloadUpdate();
      return '更新已下载，关闭应用后安装 / Update downloaded';
    }
    return '已取消更新 / Update cancelled';
  });
}
function createMenu(): void {
  const command = (name: AppCommand) => () => window?.webContents.send('event:command', name);
  const item = (
    label: string,
    name: AppCommand,
    accelerator?: string,
  ): MenuItemConstructorOptions => ({ label, accelerator, click: command(name) });
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [
          {
            label: 'MarkScape',
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              item('设置 / Settings', 'settings', 'CmdOrCtrl+,'),
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: '文件 / File',
      submenu: [
        item('新建 / New', 'new', 'CmdOrCtrl+N'),
        item('打开 / Open', 'open', 'CmdOrCtrl+O'),
        item('打开文件夹 / Open folder', 'folder', 'CmdOrCtrl+Alt+O'),
        { type: 'separator' },
        item('保存 / Save', 'save', 'CmdOrCtrl+S'),
        item('另存为 / Save as', 'saveAs', 'CmdOrCtrl+Shift+S'),
        item('关闭标签 / Close tab', 'closeTab', 'CmdOrCtrl+W'),
        { type: 'separator' },
        item('导出 HTML', 'exportHtml'),
        item('导出 PDF', 'exportPdf'),
        { role: process.platform === 'darwin' ? 'close' : 'quit' },
      ],
    },
    {
      label: '编辑 / Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('查找 / Find', 'find', 'CmdOrCtrl+F'),
        item('替换 / Replace', 'replace', process.platform === 'darwin' ? 'Alt+Cmd+F' : 'Ctrl+H'),
      ],
    },
    {
      label: '视图 / View',
      submenu: [
        item('切换视图 / Cycle view', 'view', 'CmdOrCtrl+Shift+V'),
        item('大纲 / Outline', 'outline', 'CmdOrCtrl+Shift+O'),
        item('专注模式 / Focus', 'focus'),
        { role: 'togglefullscreen' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        item('设置 / Settings', 'settings'),
        ...(!app.isPackaged ? [{ role: 'toggleDevTools' } as MenuItemConstructorOptions] : []),
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
function createWindow(): void {
  allowClose = false;
  ready = false;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  window = new BrowserWindow({
    width: Math.min(1600, width),
    height: Math.min(1000, height),
    minWidth: Math.min(850, width),
    minHeight: Math.min(600, height),
    show: false,
    title: 'MarkScape',
    backgroundColor: '#f7f8fa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
      webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  window.on('close', (event) => {
    if (!allowClose) {
      event.preventDefault();
      window?.webContents.send('event:close-requested');
    }
  });
  window.on('closed', () => {
    void watcher.unwatch([...opened]);
    opened.clear();
    window = null;
    ready = false;
  });
  window.once('ready-to-show', () => window?.show());
  if (process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void window.loadFile(path.join(__dirname, '../renderer/index.html'));
  createMenu();
}
function handleArgument(argument: string): void {
  if (argument.startsWith('mdview://')) {
    try {
      const url = new URL(argument);
      const filename = url.searchParams.get('path');
      if (url.hostname === 'open' && filename && path.isAbsolute(filename))
        void trustedOpen(filename);
    } catch {
      /* malformed deep link */
    }
  } else if (path.isAbsolute(argument) && /\.(md|markdown|mdown|mkd)$/i.test(argument))
    void trustedOpen(argument);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('open-file', (event, filename) => {
    event.preventDefault();
    void trustedOpen(filename);
  });
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleArgument(url);
  });
  app.on('second-instance', (_event, args) => {
    if (!window) createWindow();
    if (window?.isMinimized()) window.restore();
    window?.focus();
    args.forEach(handleArgument);
  });
  app.on('before-quit', (event) => {
    quitting = true;
    if (window && !allowClose) {
      event.preventDefault();
      window.webContents.send('event:close-requested');
    }
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  void app.whenReady().then(async () => {
    await persistence.initialize();
    const savedPaths = new Set(persistence.recent);
    for (const tab of persistence.session?.tabs ?? []) if (tab.path) savedPaths.add(tab.path);
    await Promise.allSettled(Array.from(savedPaths, (filename) => paths.grantFile(filename)));
    const rgPath = path.join(
      process.resourcesPath,
      'bin',
      process.platform === 'win32' ? 'rg.exe' : 'rg',
    );
    const rgAvailable = await access(rgPath, constants.X_OK).then(
      () => true,
      () => false,
    );
    workspace = new WorkspaceService(paths, rgAvailable ? rgPath : null);
    if (persistence.session?.root)
      workspace.root = await paths.grantDirectory(persistence.session.root).catch(() => null);
    protocol.handle('mdasset', async (request) => {
      try {
        const url = new URL(request.url);
        if (url.hostname !== 'local') return new Response(null, { status: 403 });
        const filename = await paths.check(decodeURIComponent(url.pathname.slice(1)));
        const mime = assetMime[path.extname(filename).toLowerCase()];
        if (!mime || (await stat(filename)).size > 20 * 1024 * 1024)
          return new Response(null, { status: 403 });
        const response = await net.fetch(pathToFileURL(filename).toString());
        return new Response(response.body, {
          headers: {
            'Content-Type': mime,
            'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
          },
        });
      } catch {
        return new Response(null, { status: 403 });
      }
    });
    registerIPC();
    createWindow();
    process.argv.slice(1).forEach(handleArgument);
    app.on('activate', () => {
      quitting = false;
      if (!window) createWindow();
    });
    if (app.isPackaged) app.setAsDefaultProtocolClient('mdview');
  });
}
