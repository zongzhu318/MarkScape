import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bold,
  Check,
  ChevronDown,
  CircleHelp,
  Code2,
  Columns2,
  Download,
  Eye,
  FilePlus2,
  FileText,
  FolderOpen,
  Italic,
  List,
  Loader2,
  Maximize2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { EditorView } from '@codemirror/view';
import { openSearchPanel } from '@codemirror/search';
import type {
  AppCommand,
  Encoding,
  FileDoc,
  SearchMatch,
  SessionSnapshot,
  SnapshotTab,
  ViewMode,
} from '../../shared/types';
import { errorInfo } from '../../shared/errors';
import { useWorkspace, type Tab } from './stores/workspace';
import {
  createDocument,
  deleteDocument,
  getState,
  getView,
  isDirty,
  jumpToLine,
  markSaved,
  replaceDocument,
  wrapSelection,
} from './editor/documents';
import { Editor } from './components/Editor';
import { Preview, type PreviewHandle } from './components/Preview';
import { FileTree } from './components/FileTree';
import { SettingsDialog } from './components/SettingsDialog';
import type { RenderResult } from './markdown/render';
import { sample } from './sample';

const filename = (path: string) => path.split(/[\\/]/).pop() ?? path;
const emptyRender: RenderResult = { html: '', headings: [], frontmatter: null };
export function App() {
  const { tabs, activeId, root, recent, settings } = useWorkspace();
  const tab = tabs.find((item) => item.id === activeId);
  const t = (zh: string, en: string) => (settings.language === 'zh' ? zh : en);
  const [loaded, setLoaded] = useState(false);
  const [sidebar, setSidebar] = useState<'files' | 'outline' | 'search'>('files');
  const [sidebarVisible, setSidebarVisible] = useState(
    () => localStorage.getItem('markscape.sidebarVisible') !== 'false',
  );
  useEffect(() => {
    localStorage.setItem('markscape.sidebarVisible', String(sidebarVisible));
  }, [sidebarVisible]);
  const [focus, setFocus] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rendered, setRendered] = useState<{ id: string | null; result: RenderResult }>({
    id: null,
    result: emptyRender,
  });
  const result = rendered.id === activeId ? rendered.result : emptyRender;
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const previewTab = useRef<string | null>(null);
  const [recovery, setRecovery] = useState<SnapshotTab[]>([]);
  const [refresh, setRefresh] = useState(0);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchInfo, setSearchInfo] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileMenu, setFileMenu] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState('');
  const preview = useRef<PreviewHandle>(null);
  const scrollLock = useRef(0);
  const saves = useRef(new Map<string, Promise<boolean>>());
  const closing = useRef(false);
  const confirming = useRef(new Set<string>());
  const initial = useRef(false);
  const callbacks = useRef<{ command(command: AppCommand): void; close(): Promise<void> } | null>(
    null,
  );
  const report = useCallback((error: unknown) => {
    const info = errorInfo(error);
    if (info.code !== 'CANCELLED') setNotice(info.message);
  }, []);

  const addDoc = useCallback(
    (
      doc: FileDoc,
      options?: { cursor?: number; viewMode?: ViewMode; scrollTop?: number; activate?: boolean },
    ): string => {
      const state = useWorkspace.getState();
      const existing = state.tabs.find((item) => item.path === doc.meta.path);
      if (existing) {
        if (options?.activate !== false) useWorkspace.setState({ activeId: existing.id });
        return existing.id;
      }
      const id = crypto.randomUUID();
      const mode = doc.meta.size > 5 * 1024 * 1024 ? 'source' : (options?.viewMode ?? 'split');
      createDocument(id, doc.text, state.settings, mode, doc.meta.readonly, options?.cursor);
      const next: Tab = {
        id,
        name: filename(doc.meta.path),
        path: doc.meta.path,
        meta: doc.meta,
        dirty: false,
        conflict: false,
        viewMode: mode,
        revision: 0,
        scrollTop: options?.scrollTop ?? 0,
        nextOffset: doc.nextOffset,
      };
      useWorkspace.setState({
        tabs: [...state.tabs, next],
        ...(options?.activate !== false ? { activeId: id } : {}),
        recent: [doc.meta.path, ...state.recent.filter((path) => path !== doc.meta.path)].slice(
          0,
          20,
        ),
      });
      return id;
    },
    [],
  );
  const newDocument = useCallback((text = '', name = 'Untitled.md'): string => {
    const id = crypto.randomUUID();
    const state = useWorkspace.getState();
    createDocument(id, '', state.settings, 'split', false);
    if (text) replaceDocument(id, text);
    useWorkspace.setState({
      tabs: [
        ...state.tabs,
        {
          id,
          name,
          path: null,
          meta: null,
          dirty: !!text,
          conflict: false,
          viewMode: 'split',
          revision: 0,
          scrollTop: 0,
        },
      ],
      activeId: id,
    });
    return id;
  }, []);
  const openPath = useCallback(
    async (path: string, line?: number) => {
      try {
        addDoc(await window.md.open(path));
        if (line) setTimeout(() => jumpToLine(line), 60);
      } catch (error) {
        report(error);
      }
    },
    [addDoc, report],
  );
  const openDialog = async () => {
    try {
      for (const doc of await window.md.openDialog()) addDoc(doc);
    } catch (error) {
      report(error);
    }
  };
  const openFolder = async () => {
    try {
      const directory = await window.md.pickWorkspace();
      if (directory) {
        useWorkspace.setState({ root: directory });
        setSidebar('files');
        setSidebarVisible(true);
      }
    } catch (error) {
      report(error);
    }
  };
  const snapshot = (): SessionSnapshot => {
    const state = useWorkspace.getState();
    return {
      root: state.root,
      activeId: state.activeId,
      savedAt: Date.now(),
      tabs: state.tabs.map((item) => {
        const doc = getState(item.id);
        return {
          id: item.id,
          path: item.path,
          name: item.name,
          meta: item.meta,
          cursor: doc.selection.main.head,
          scrollTop:
            item.id === state.activeId
              ? (getView()?.scrollDOM.scrollTop ?? item.scrollTop)
              : item.scrollTop,
          viewMode: item.viewMode,
          ...(item.dirty ? { text: doc.doc.toString() } : {}),
        };
      }),
    };
  };
  const save = async (id: string, as = false): Promise<boolean> => {
    const pending = saves.current.get(id);
    if (pending) return pending;
    const current = useWorkspace.getState().tabs.find((item) => item.id === id);
    if (!current) return false;
    if (current.meta?.readonly && !as) return false;
    const action = (async () => {
      const doc = getState(id).doc;
      setSaving(true);
      try {
        const meta =
          as || !current.meta
            ? await window.md.saveAs(
                current.meta?.large ? '' : doc.toString(),
                current.name,
                current.meta ?? undefined,
              )
            : await window.md.save(doc.toString(), current.meta);
        if (!meta) return false;
        if (current.meta?.large && meta.path !== current.path) {
          const copy = await window.md.open(meta.path, meta.encoding);
          addDoc(copy);
          return true;
        }
        markSaved(id, doc);
        useWorkspace.getState().updateTab(id, {
          meta,
          path: meta.path,
          name: filename(meta.path),
          dirty: isDirty(id),
          conflict: false,
        });
        if (current.path && current.path !== meta.path) await window.md.closeFile(current.path);
        setRefresh((value) => value + 1);
        return true;
      } catch (error) {
        if (errorInfo(error).code === 'CONFLICT')
          useWorkspace.getState().updateTab(id, { conflict: true });
        report(error);
        return false;
      } finally {
        saves.current.delete(id);
        setSaving(saves.current.size > 0);
      }
    })();
    saves.current.set(id, action);
    return action;
  };
  const autoSave = (item: Tab) => {
    if (
      item.dirty &&
      item.meta &&
      !item.meta.readonly &&
      !item.conflict &&
      !closing.current &&
      !confirming.current.has(item.id) &&
      !saves.current.has(item.id)
    )
      void save(item.id);
  };
  const protect = async (id: string): Promise<boolean> => {
    const pending = saves.current.get(id);
    if (pending) await pending;
    const current = useWorkspace.getState().tabs.find((item) => item.id === id);
    if (!current?.dirty) return true;
    if (confirming.current.has(id)) return false;
    confirming.current.add(id);
    const choice = await window.md
      .confirmClose(current.name)
      .finally(() => confirming.current.delete(id));
    if (choice === 'cancel') return false;
    if (choice === 'save') {
      if (!(await save(id))) return false;
      if (useWorkspace.getState().tabs.find((item) => item.id === id)?.dirty) return protect(id);
    }
    return true;
  };
  const closeTab = async (id: string) => {
    try {
      if (!(await protect(id))) return;
      const state = useWorkspace.getState();
      const index = state.tabs.findIndex((item) => item.id === id);
      const current = state.tabs[index];
      const remaining = state.tabs.filter((item) => item.id !== id);
      useWorkspace.setState({
        tabs: remaining,
        activeId:
          state.activeId === id
            ? (remaining[Math.min(index, remaining.length - 1)]?.id ?? null)
            : state.activeId,
      });
      if (current.path) await window.md.closeFile(current.path);
      setTimeout(() => deleteDocument(id), 100);
      await window.md.saveSession(snapshot());
    } catch (error) {
      report(error);
    }
  };
  const closeWindow = async () => {
    if (closing.current) return;
    closing.current = true;
    try {
      if (recovery.length) {
        await window.md.finishClose();
        return;
      }
      for (const item of useWorkspace.getState().tabs) if (!(await protect(item.id))) return;
      const session = snapshot();
      session.tabs = session.tabs
        .filter((item) => item.path)
        .map(({ text: _text, ...item }) => item);
      await window.md.saveSession(session);
      await window.md.finishClose();
    } catch (error) {
      report(error);
    } finally {
      closing.current = false;
    }
  };
  const exportDocument = async (format: 'html' | 'pdf') => {
    if (!tab || exporting) return;
    if (tab.meta?.large) {
      setNotice(
        t(
          '分页查看的文档不支持整篇导出，可另存为完整文件。',
          'Paged files can be saved as a complete copy. Full-document export is unavailable.',
        ),
      );
      return;
    }
    setExporting(true);
    try {
      const text = getState(tab.id).doc.toString();
      const [{ renderMarkdown }, { enhanceAll }, { default: previewCss }, { default: katexCss }] =
        await Promise.all([
          import('./markdown/render'),
          import('./markdown/enhance'),
          import('./styles/preview.css?inline'),
          import('katex/dist/katex.min.css?inline'),
        ]);
      const rendered = renderMarkdown(text, tab.path, settings.preview);
      const container = document.createElement('div');
      container.className = 'markdown-body';
      container.innerHTML = rendered.html;
      document.body.appendChild(container);
      container.style.position = 'absolute';
      container.style.left = '-100000px';
      try {
        await enhanceAll(container);
        // Inline local fonts so exported HTML/PDF works offline outside the application.
        let css = katexCss;
        const urls = [...css.matchAll(/url\(([^)]+)\)/g)].map((match) =>
          match[1].replace(/["']/g, ''),
        );
        for (const url of new Set(urls))
          if (!url.startsWith('data:')) {
            try {
              const blob = await (await fetch(url)).blob();
              const data = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result));
                reader.onerror = reject;
                reader.readAsDataURL(blob);
              });
              css = css.split(url).join(data);
            } catch {
              /* system font fallback */
            }
          }
        const html = `<style>${previewCss}\n${css}\n.markdown-body{font-size:${settings.fontSize}px;line-height:${settings.lineHeight}}\n${settings.customCss.replace(/<\/style/gi, '')}</style><main class="markdown-body">${container.innerHTML}</main>`;
        const path = await window.md.exportDocument(html, tab.name, format);
        if (path) setNotice(t(`已导出：${path}`, `Exported: ${path}`));
      } finally {
        container.remove();
      }
    } catch (error) {
      report(error);
    } finally {
      setExporting(false);
    }
  };
  const cycleView = () => {
    if (!tab) return;
    const modes: ViewMode[] = ['source', 'split', 'preview', 'inline'];
    setMode(modes[(modes.indexOf(tab.viewMode) + 1) % modes.length]);
  };
  const command = (value: AppCommand) => {
    if (value === 'new') newDocument();
    if (value === 'open') void openDialog();
    if (value === 'folder') void openFolder();
    if (value === 'save' && tab) void save(tab.id);
    if (value === 'saveAs' && tab) void save(tab.id, true);
    if (value === 'closeTab' && tab) void closeTab(tab.id);
    if (value === 'find' || value === 'replace') {
      if (tab?.viewMode === 'preview')
        useWorkspace.getState().updateTab(tab.id, { viewMode: 'split' });
      const view = getView();
      if (view) {
        openSearchPanel(view);
      }
    }
    if (value === 'view') cycleView();
    if (value === 'outline') {
      setSidebar('outline');
      setSidebarVisible(true);
    }
    if (value === 'focus') setFocus((current) => !current);
    if (value === 'settings') setShowSettings(true);
    if (value === 'exportHtml') void exportDocument('html');
    if (value === 'exportPdf') void exportDocument('pdf');
  };
  callbacks.current = { command, close: closeWindow };

  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    const offCommand = window.md.onCommand((command) => callbacks.current?.command(command));
    const restoring = new Map<string, SnapshotTab>();
    const offOpen = window.md.onOpen((doc) => addDoc(doc, restoring.get(doc.meta.path)));
    const offClose = window.md.onCloseRequested(() => {
      void callbacks.current?.close();
    });
    const offChanged = window.md.onFileChanged((path) => {
      const current = useWorkspace.getState().tabs.find((item) => item.path === path);
      if (!current) return;
      void (async () => {
        const saving = saves.current.get(current.id);
        if (saving) await saving;
        const latest = useWorkspace.getState().tabs.find((item) => item.id === current.id);
        if (!latest?.meta) return;
        try {
          const disk = await window.md.inspect(path, latest.meta.encoding);
          if (
            useWorkspace.getState().tabs.find((item) => item.id === current.id)?.meta !==
            latest.meta
          )
            return;
          const unchanged =
            disk.revision === latest.meta.revision &&
            (!disk.large ||
              (disk.size === latest.meta.size && disk.mtimeMs === latest.meta.mtimeMs));
          if (unchanged) {
            useWorkspace.getState().updateTab(latest.id, { meta: disk });
            return;
          }
          useWorkspace.getState().updateTab(latest.id, { conflict: true });
        } catch {
          if (
            useWorkspace.getState().tabs.find((item) => item.id === current.id)?.meta ===
            latest.meta
          )
            useWorkspace.getState().updateTab(latest.id, { conflict: true });
        }
      })();
    });
    void window.md
      .bootstrap()
      .then(async (bootstrap) => {
        useWorkspace.setState({
          settings: bootstrap.settings,
          recent: bootstrap.recent,
          root: bootstrap.session?.root ?? null,
        });
        for (const old of bootstrap.session?.tabs ?? []) if (old.path) restoring.set(old.path, old);
        void window.md.readyForFiles().catch(report);
        const restored = new Map<string, number>();
        let selected: string | null = null;
        for (const old of bootstrap.session?.tabs ?? [])
          if (old.path) {
            try {
              const existing = useWorkspace.getState().tabs.find((item) => item.path === old.path);
              const id =
                existing?.id ?? addDoc(await window.md.open(old.path), { ...old, activate: false });
              restored.set(id, restored.size);
              if (old.id === bootstrap.session?.activeId) selected = id;
            } catch {
              /* missing documents remain in recent list */
            }
          }
        restoring.clear();
        useWorkspace.setState((state) => ({
          tabs: [...state.tabs].sort(
            (a, b) => (restored.get(a.id) ?? restored.size) - (restored.get(b.id) ?? restored.size),
          ),
          activeId: state.activeId ?? selected ?? state.tabs[0]?.id ?? null,
        }));
        setRecovery(bootstrap.recovery);
        setLoaded(true);
      })
      .catch((error) => {
        report(error);
        setLoaded(true);
      });
    return () => {
      offCommand();
      offOpen();
      offClose();
      offChanged();
    };
  }, [addDoc, report]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.dataset.theme =
        settings.theme === 'system' ? (media.matches ? 'dark' : 'light') : settings.theme;
      document.documentElement.lang = settings.language === 'zh' ? 'zh-CN' : 'en';
    };
    apply();
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [settings.theme, settings.language]);
  useEffect(() => {
    document.title = `${tab?.name ? `${tab?.dirty ? '● ' : ''}${tab.name} — ` : ''}MarkScape`;
  }, [tab?.name, tab?.dirty]);
  useEffect(() => {
    const id = tab?.id;
    const path = tab?.path ?? null;
    const sourceOnly = (tab?.meta?.size ?? 0) > 5 * 1024 * 1024;
    const switching = previewTab.current !== id;
    previewTab.current = id ?? null;
    if (!id || sourceOnly || getState(id).doc.length > 5 * 1024 * 1024) {
      setRendered({ id: id ?? null, result: emptyRender });
      return;
    }
    let cancelled = false;
    const render = async () => {
      const { renderMarkdown } = await import('./markdown/render');
      if (cancelled) return;
      setRendered({
        id,
        result: renderMarkdown(getState(id).doc.toString(), path, settings.preview),
      });
    };
    // Let the editor paint on open. Only consecutive edits need debouncing.
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => void render().catch(report), switching ? 0 : 120);
    };
    const frame = switching ? requestAnimationFrame(schedule) : undefined;
    if (!switching) schedule();
    return () => {
      cancelled = true;
      if (frame !== undefined) cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [tab?.id, tab?.revision, tab?.path, tab?.meta?.size, settings.preview, report]);
  useEffect(() => {
    if (!loaded || recovery.length) return;
    const timer = setInterval(() => {
      void window.md.saveSession(snapshot()).catch(report);
    }, 10000);
    return () => clearInterval(timer);
  }, [loaded, recovery.length, report]);
  useEffect(() => {
    if (settings.files.autoSave !== 'afterDelay') return;
    const timer = setTimeout(() => {
      useWorkspace.getState().tabs.forEach(autoSave);
    }, settings.files.delayMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs, settings.files]);
  useEffect(() => {
    const blur = () => {
      if (useWorkspace.getState().settings.files.autoSave === 'onFocusChange')
        useWorkspace.getState().tabs.forEach(autoSave);
    };
    window.addEventListener('blur', blur);
    const unsubscribe = useWorkspace.subscribe((state, previous) => {
      if (state.activeId === previous.activeId || state.settings.files.autoSave !== 'onFocusChange')
        return;
      const leaving = state.tabs.find((item) => item.id === previous.activeId);
      if (leaving) autoSave(leaving);
    });
    return () => {
      unsubscribe();
      window.removeEventListener('blur', blur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!query || !root) {
        setMatches([]);
        setSearching(false);
        return;
      }
      setSearching(true);
      void window.md
        .search(query, caseSensitive)
        .then((result) => {
          if (active) {
            setMatches(result.matches);
            setSearchInfo(
              `${result.matches.length}${result.truncated ? '+' : ''} · ${result.engine === 'node' ? 'Node fallback' : 'ripgrep'}`,
            );
          }
        })
        .catch(report)
        .finally(() => {
          if (active) setSearching(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      void window.md.cancelSearch().catch(report);
    };
  }, [query, root, caseSensitive, report]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 10000);
    return () => clearTimeout(timer);
  }, [notice]);

  const activate = (id: string) => {
    useWorkspace.setState({ activeId: id });
  };
  const navigate = (line: number) => {
    scrollLock.current = Date.now() + 250;
    jumpToLine(line);
    preview.current?.scrollToLine(line);
  };
  const reload = async (encoding = tab?.meta?.encoding) => {
    if (!tab?.path) return;
    try {
      if (tab.dirty && !(await protect(tab.id))) return;
      const disk = await window.md.open(tab.path, encoding);
      replaceDocument(tab.id, disk.text);
      markSaved(tab.id, getState(tab.id).doc);
      useWorkspace.getState().updateTab(tab.id, {
        meta: disk.meta,
        nextOffset: disk.nextOffset,
        pageOffset: 0,
        previousOffsets: [],
        ...(disk.meta.size > 5 * 1024 * 1024 ? { viewMode: 'source' as const } : {}),
        dirty: false,
        conflict: false,
        revision: Date.now(),
      });
    } catch (error) {
      report(error);
    }
  };
  const recover = async () => {
    for (const item of recovery) {
      if (item.text === undefined) continue;
      const current = item.path
        ? useWorkspace.getState().tabs.find((tab) => tab.path === item.path)
        : null;
      if (
        current?.meta &&
        item.meta &&
        current.meta.revision === item.meta.revision &&
        current.meta.mtimeMs === item.meta.mtimeMs
      ) {
        replaceDocument(current.id, item.text);
        useWorkspace.getState().updateTab(current.id, { dirty: true, revision: Date.now() });
        useWorkspace.setState({ activeId: current.id });
      } else newDocument(item.text, current ? `${item.name} (恢复副本)` : item.name);
    }
    setRecovery([]);
    await window.md.saveSession(snapshot());
  };
  const readPage = async (back = false) => {
    if (!tab?.path || !tab.meta) return;
    const previous = [...(tab.previousOffsets ?? [])];
    const offset = back ? previous.pop() : tab.nextOffset;
    if (offset === undefined) return;
    if (!back) previous.push(tab.pageOffset ?? 0);
    const page = await window.md.readPage(tab.path, offset, tab.meta.encoding);
    replaceDocument(tab.id, page.text);
    markSaved(tab.id, getState(tab.id).doc);
    useWorkspace.getState().updateTab(tab.id, {
      nextOffset: page.nextOffset,
      pageOffset: offset,
      previousOffsets: previous,
      dirty: false,
      revision: Date.now(),
    });
    getView()?.scrollDOM.scrollTo(0, 0);
  };
  const setMode = (mode: ViewMode) => {
    if (tab) {
      if (tab.meta && tab.meta.size > 5 * 1024 * 1024 && mode !== 'source') {
        setNotice(t('大文件使用源码模式以保持流畅', 'Large files use source mode'));
        return;
      }
      useWorkspace.getState().updateTab(tab.id, { viewMode: mode });
    }
  };
  const sidebarLabel = sidebarVisible
    ? t('收起侧栏', 'Hide sidebar')
    : t('展开侧栏', 'Show sidebar');
  const iconButton = (
    label: string,
    icon: React.ReactNode,
    action: () => void,
    disabled = false,
  ) => (
    <button
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={action}
      disabled={disabled}
    >
      {icon}
    </button>
  );

  return (
    <div
      className={`app ${focus ? 'focus-mode' : ''}`}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        void (async () => {
          for (const file of event.dataTransfer.files) {
            try {
              addDoc(await window.md.openDropped(file));
            } catch (error) {
              report(error);
            }
          }
        })();
      }}
    >
      <style>{`.preview-scroll{font-size:${settings.fontSize}px;line-height:${settings.lineHeight}}.inline-link{color:var(--accent);text-decoration:underline}${settings.customCss}`}</style>
      <header className="titlebar">
        <div className="brand">
          <button
            className="icon-button"
            aria-label={sidebarLabel}
            title={sidebarLabel}
            aria-expanded={sidebarVisible}
            aria-controls="workspace-sidebar"
            onClick={() => setSidebarVisible((visible) => !visible)}
          >
            {sidebarVisible ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <span className="brand-mark">
            M<span>↗</span>
          </span>
          <strong>MarkScape</strong>
          <span className="brand-divider" />
          <span className="workspace-name">
            {root ? filename(root) : t('个人写作空间', 'Your writing space')}
          </span>
        </div>
        <div className="titlebar-right">
          <span className="local-badge">
            <span />
            {t('本地优先', 'Local first')}
          </span>
          {iconButton(t('偏好设置', 'Preferences'), <Settings2 size={17} />, () =>
            setShowSettings(true),
          )}
        </div>
      </header>
      <div className="app-body">
        {!focus && sidebarVisible && (
          <nav className="activity-bar" aria-label={t('主导航', 'Main navigation')}>
            <div>
              {(['files', 'search', 'outline'] as const).map((item, index) => (
                <button
                  key={item}
                  className={`activity-button ${sidebar === item && sidebarVisible ? 'active' : ''}`}
                  title={t(
                    ['文件', '全库搜索', '文档大纲'][index],
                    ['Files', 'Workspace search', 'Outline'][index],
                  )}
                  aria-label={t(
                    ['文件', '全库搜索', '文档大纲'][index],
                    ['Files', 'Workspace search', 'Outline'][index],
                  )}
                  onClick={() => {
                    setSidebar(item);
                    setSidebarVisible(true);
                  }}
                >
                  {
                    [
                      <FolderOpen key="files" size={21} />,
                      <Search key="search" size={21} />,
                      <List key="outline" size={21} />,
                    ][index]
                  }
                </button>
              ))}
            </div>
            <div>
              {iconButton(t('使用示例', 'Example document'), <CircleHelp size={20} />, () =>
                newDocument(sample, 'Welcome.md'),
              )}
              {iconButton(t('设置', 'Settings'), <Settings2 size={20} />, () =>
                setShowSettings(true),
              )}
            </div>
          </nav>
        )}
        <aside id="workspace-sidebar" className="sidebar" hidden={focus || !sidebarVisible}>
          <div className="sidebar-heading">
            <span>
              {t(
                sidebar === 'files'
                  ? '资源管理器'
                  : sidebar === 'outline'
                    ? '文档大纲'
                    : '工作区搜索',
                sidebar === 'files' ? 'EXPLORER' : sidebar === 'outline' ? 'OUTLINE' : 'SEARCH',
              )}
            </span>
          </div>
          {sidebar === 'files' && (
            <>
              <div className="sidebar-actions">
                <button onClick={() => void openFolder()}>
                  <FolderOpen size={15} />
                  {t('打开文件夹', 'Open folder')}
                </button>
                {iconButton(t('刷新', 'Refresh'), <RefreshCw size={14} />, () =>
                  setRefresh((value) => value + 1),
                )}
                {iconButton(t('新建文档', 'New document'), <Plus size={16} />, () => newDocument())}
              </div>
              {root ? (
                <div className="tree-container">
                  <div className="folder-caption">
                    <ChevronDown size={13} />
                    {filename(root)}
                  </div>
                  <FileTree
                    root={root}
                    activePath={tab?.path ?? null}
                    onOpen={(path) => void openPath(path)}
                    onError={report}
                    refresh={refresh}
                  />
                </div>
              ) : (
                <div className="sidebar-empty">
                  <FolderOpen size={28} />
                  <p>{t('让文档井井有条', 'A home for your documents')}</p>
                  <span>
                    {t(
                      '打开一个文件夹，开始你的写作项目。',
                      'Open a folder to start your writing project.',
                    )}
                  </span>
                </div>
              )}
              <div className="recent-heading">{t('最近打开', 'RECENT FILES')}</div>
              <div className="recent-list">
                {recent.slice(0, 10).map((path) => (
                  <button key={path} title={path} onClick={() => void openPath(path)}>
                    <FileText size={14} />
                    <span>{filename(path)}</span>
                  </button>
                ))}
                {!recent.length && (
                  <p className="empty-small">{t('还没有最近文档', 'No recent documents')}</p>
                )}
              </div>
              <div className="sidebar-footer">
                <span className="small-logo">M</span>
                <div>
                  MarkScape<span>{t('留白，是灵感的开始。', 'Room for your next idea.')}</span>
                </div>
              </div>
            </>
          )}
          {sidebar === 'outline' && (
            <div className="outline-list">
              {result.headings.map((heading) => (
                <button
                  key={heading.id}
                  style={{ paddingLeft: 16 + (heading.level - 1) * 12 }}
                  onClick={() => navigate(heading.line)}
                >
                  <span className="heading-level">H{heading.level}</span>
                  {heading.text}
                </button>
              ))}
              {!result.headings.length && (
                <p className="empty-small">
                  {t('使用 # 标题来组织文档', 'Use # headings to structure your document')}
                </p>
              )}
              {result.frontmatter && (
                <details className="metadata" open>
                  <summary>Front Matter</summary>
                  <dl>
                    {Object.entries(result.frontmatter).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key}</dt>
                        <dd>{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </div>
          )}
          {sidebar === 'search' && (
            <div className="workspace-search">
              <div className="search-input">
                <Search size={15} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('搜索 Markdown 文档…', 'Search Markdown files…')}
                  aria-label={t('全库搜索', 'Workspace search')}
                />
              </div>
              <label className="case-toggle">
                <input
                  type="checkbox"
                  checked={caseSensitive}
                  onChange={(event) => setCaseSensitive(event.target.checked)}
                />
                {t('区分大小写', 'Match case')}
              </label>
              {!root && (
                <button className="secondary" onClick={() => void openFolder()}>
                  {t('先打开文件夹', 'Open a folder first')}
                </button>
              )}
              <p className="empty-small">{searching ? t('搜索中…', 'Searching…') : searchInfo}</p>
              {matches.map((match, index) => (
                <button
                  className="search-result"
                  key={`${match.path}-${index}`}
                  onClick={() => void openPath(match.path, match.line)}
                >
                  <strong>
                    {filename(match.path)}
                    <span>:{match.line}</span>
                  </strong>
                  <span>{match.text}</span>
                </button>
              ))}
            </div>
          )}
        </aside>
        <main className="main-panel">
          <div className="tabs-bar">
            <div className="tabs" role="tablist" aria-label={t('打开的文档', 'Open documents')}>
              {tabs.map((item) => (
                <div className={`tab ${item.id === activeId ? 'active' : ''}`} key={item.id}>
                  <button
                    role="tab"
                    aria-selected={item.id === activeId}
                    onClick={() => activate(item.id)}
                    title={item.path ?? item.name}
                  >
                    <FileText size={14} />
                    <span>{item.name}</span>
                    {item.dirty && (
                      <span className="dirty-dot" aria-label={t('未保存', 'Unsaved')} />
                    )}
                  </button>
                  <button
                    className="tab-close"
                    aria-label={`${t('关闭', 'Close')} ${item.name}`}
                    onClick={() => void closeTab(item.id)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
            {iconButton(t('新建文档', 'New document'), <Plus size={17} />, () => newDocument())}
          </div>
          {tab ? (
            <>
              <div className="document-toolbar">
                <div className="toolbar-group">
                  <div className="file-menu-container">
                    <button className="document-name" onClick={() => setFileMenu(!fileMenu)}>
                      <FileText size={16} />
                      {tab.name}
                      <ChevronDown size={13} />
                    </button>
                    {fileMenu && (
                      <div className="file-menu">
                        <button
                          onClick={() => {
                            void save(tab.id, true);
                            setFileMenu(false);
                          }}
                        >
                          {t('另存为…', 'Save as…')}
                        </button>
                        <button
                          disabled={!tab.path}
                          onClick={() => {
                            if (tab.path) void window.md.reveal(tab.path).catch(report);
                            setFileMenu(false);
                          }}
                        >
                          {t('在文件管理器中显示', 'Reveal in file manager')}
                        </button>
                        <button
                          disabled={!tab.path}
                          onClick={() => {
                            setNewName(tab.name);
                            setRenaming(true);
                            setFileMenu(false);
                          }}
                        >
                          {t('重命名…', 'Rename…')}
                        </button>
                        <button
                          disabled={!tab.path}
                          onClick={() => {
                            void (async () => {
                              if (
                                tab.path &&
                                (await protect(tab.id)) &&
                                (await window.md.trash(tab.path))
                              ) {
                                useWorkspace
                                  .getState()
                                  .updateTab(tab.id, { dirty: false, path: null, meta: null });
                                await closeTab(tab.id);
                                setRefresh((value) => value + 1);
                              }
                            })().catch(report);
                            setFileMenu(false);
                          }}
                        >
                          <Trash2 size={14} />
                          {t('移到回收站', 'Move to trash')}
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="toolbar-divider" />
                  {iconButton(
                    t('加粗', 'Bold'),
                    <Bold size={16} />,
                    () => {
                      const view = getView();
                      if (view) wrapSelection(view, '**');
                    },
                    !!tab.meta?.readonly,
                  )}
                  {iconButton(
                    t('斜体', 'Italic'),
                    <Italic size={16} />,
                    () => {
                      const view = getView();
                      if (view) wrapSelection(view, '*');
                    },
                    !!tab.meta?.readonly,
                  )}
                  {iconButton(
                    t('行内代码', 'Inline code'),
                    <Code2 size={17} />,
                    () => {
                      const view = getView();
                      if (view) wrapSelection(view, '`');
                    },
                    !!tab.meta?.readonly,
                  )}
                </div>
                <div className="toolbar-group">
                  <div className="view-switch" aria-label={t('视图模式', 'View mode')}>
                    {(['source', 'split', 'preview', 'inline'] as const).map((mode, index) => (
                      <button
                        key={mode}
                        className={tab.viewMode === mode ? 'selected' : ''}
                        title={t(
                          ['源码', '分栏', '预览', '即时预览'][index],
                          ['Source', 'Split', 'Preview', 'Live preview'][index],
                        )}
                        aria-label={t(
                          ['源码', '分栏', '预览', '即时预览'][index],
                          ['Source', 'Split', 'Preview', 'Live preview'][index],
                        )}
                        aria-pressed={tab.viewMode === mode}
                        onClick={() => setMode(mode)}
                      >
                        {
                          [
                            <Code2 key="s" size={16} />,
                            <Columns2 key="c" size={16} />,
                            <Eye key="p" size={16} />,
                            <Sparkles key="i" size={15} />,
                          ][index]
                        }
                      </button>
                    ))}
                  </div>
                  {iconButton(t('查找与替换', 'Find and replace'), <Search size={17} />, () =>
                    command('find'),
                  )}
                  {iconButton(t('专注模式', 'Focus mode'), <Maximize2 size={16} />, () =>
                    setFocus(!focus),
                  )}
                  <button
                    className="save-button"
                    disabled={saving || !!tab.meta?.readonly}
                    onClick={() => void save(tab.id)}
                  >
                    {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
                    <span>{t('保存', 'Save')}</span>
                  </button>
                  <details className="export-menu">
                    <summary title={t('导出', 'Export')} aria-label={t('导出', 'Export')}>
                      {exporting ? <Loader2 size={17} className="spin" /> : <Download size={17} />}
                    </summary>
                    <div>
                      <button disabled={exporting} onClick={() => void exportDocument('html')}>
                        {t('导出 HTML', 'Export HTML')}
                      </button>
                      <button disabled={exporting} onClick={() => void exportDocument('pdf')}>
                        {t('导出 PDF', 'Export PDF')}
                      </button>
                    </div>
                  </details>
                </div>
              </div>
              {tab.conflict && (
                <div className="conflict-banner" role="alert">
                  <span>
                    {t(
                      '磁盘上的文件已改变。请检查后选择如何处理。',
                      'The file changed on disk. Choose how to continue.',
                    )}
                  </span>
                  <button onClick={() => void reload()}>{t('重新加载', 'Reload')}</button>
                  <button
                    onClick={() => {
                      useWorkspace.getState().updateTab(tab.id, { conflict: false });
                      setNotice(
                        t(
                          '已保留编辑内容；保存仍会校验磁盘版本，请另存为以保留双方修改。',
                          'Your edits are retained. Save as a copy to preserve both versions.',
                        ),
                      );
                    }}
                  >
                    {t('保留我的', 'Keep mine')}
                  </button>
                  <button onClick={() => void save(tab.id, true)}>
                    {t('另存为副本', 'Save a copy')}
                  </button>
                </div>
              )}
              {tab.meta?.readonly && (
                <div className="info-banner">
                  {t('只读模式', 'Read-only mode')}
                  {tab.meta.large && ` · ${t('超大文件按页查看', 'Large file paged viewer')}`}
                  {!!tab.previousOffsets?.length && (
                    <button onClick={() => void readPage(true).catch(report)}>
                      {t('上一页', 'Previous page')}
                    </button>
                  )}
                  {tab.nextOffset !== undefined && (
                    <button onClick={() => void readPage().catch(report)}>
                      {t('下一页', 'Next page')}
                    </button>
                  )}
                </div>
              )}
              <div className={`editing-area mode-${tab.viewMode}`}>
                <section className="source-pane">
                  <div className="pane-label">
                    <span>
                      {tab.viewMode === 'inline' ? t('即时预览', 'LIVE PREVIEW') : 'MARKDOWN'}
                    </span>
                    <span>{t('专注于内容', 'FOCUS ON YOUR WORDS')}</span>
                  </div>
                  <Editor
                    key={tab.id}
                    tab={tab}
                    settings={settings}
                    onChange={() => undefined}
                    onCursor={(line, column) => setCursor({ line, column })}
                    onScroll={(line) => {
                      if (Date.now() < scrollLock.current || tab.viewMode !== 'split') return;
                      scrollLock.current = Date.now() + 200;
                      preview.current?.scrollToLine(line);
                    }}
                    onError={report}
                  />
                </section>
                <section className="preview-pane">
                  <div className="pane-label">
                    <span>{t('实时预览', 'LIVE PREVIEW')}</span>
                    <span className="preview-dot">{t('已同步', 'IN SYNC')}</span>
                  </div>
                  <Preview
                    ref={preview}
                    result={result}
                    tabId={tab.id}
                    readonly={tab.meta?.readonly ?? false}
                    onNavigate={navigate}
                    onScroll={(line) => {
                      if (Date.now() < scrollLock.current || tab.viewMode !== 'split') return;
                      scrollLock.current = Date.now() + 200;
                      const view = getView();
                      if (view)
                        view.dispatch({
                          effects: EditorView.scrollIntoView(
                            view.state.doc.line(
                              Math.max(
                                1,
                                Math.min(
                                  Number.isFinite(line) ? Math.floor(line) : 1,
                                  view.state.doc.lines,
                                ),
                              ),
                            ).from,
                            { y: 'start' },
                          ),
                        });
                    }}
                    onError={report}
                  />
                </section>
              </div>
            </>
          ) : (
            <div className="welcome">
              <div className="welcome-grid" />
              <div className="welcome-content">
                <span className="welcome-icon">
                  M<span>↗</span>
                </span>
                <span className="eyebrow">A LITTLE SPACE. A LOT OF POSSIBILITIES.</span>
                <h1>{t('给想法，一片自由的空间。', 'A little space for big ideas.')}</h1>
                <p>
                  {t(
                    '从一个字开始，让思绪自然流淌。',
                    'Start with a word. Let your thoughts find their way.',
                  )}
                  <br />
                  {t(
                    '简洁的 Markdown 编辑，安静而专注的写作体验。',
                    'Simple Markdown editing. A calm place to write.',
                  )}
                </p>
                <div className="welcome-actions">
                  <button className="primary" onClick={() => newDocument()}>
                    <FilePlus2 size={17} />
                    {t('新建文档', 'New document')}
                    <kbd>⌘ N</kbd>
                  </button>
                  <button className="secondary" onClick={() => void openDialog()}>
                    <FolderOpen size={17} />
                    {t('打开文档', 'Open document')}
                    <kbd>⌘ O</kbd>
                  </button>
                </div>
                <button className="sample-link" onClick={() => newDocument(sample, 'Welcome.md')}>
                  {t('打开示例，探索 MarkScape', 'Explore MarkScape with an example')}{' '}
                  <span>↗</span>
                </button>
                <div className="welcome-features">
                  <div>
                    <Columns2 size={20} />
                    <strong>{t('所写即所见', 'Write & preview')}</strong>
                    <span>{t('分栏预览，灵感实时呈现', 'Your words, beautifully rendered')}</span>
                  </div>
                  <div>
                    <FileText size={20} />
                    <strong>{t('文档由你掌握', 'Your files, always')}</strong>
                    <span>
                      {t('本地存储，离线也能安心写作', 'Local files. Works entirely offline.')}
                    </span>
                  </div>
                  <div>
                    <Sparkles size={20} />
                    <strong>{t('表达，不设限', 'More ways to express')}</strong>
                    <span>{t('代码、公式、图表，一应俱全', 'Code, equations, and diagrams')}</span>
                  </div>
                </div>
              </div>
              <div className="welcome-bottom">
                {loaded
                  ? t('你的下一段故事，从这里开始。', 'Your next story starts here.')
                  : t('正在恢复工作空间…', 'Restoring your workspace…')}
              </div>
            </div>
          )}
        </main>
      </div>
      <footer className="statusbar">
        <div>
          <span className="status-indicator" />
          {saving
            ? t('正在保存…', 'Saving…')
            : tab?.dirty
              ? t('有未保存的更改', 'Unsaved changes')
              : t('准备就绪', 'All set')}
          {tab && (
            <>
              <span className="status-separator" />
              <span>
                {getState(tab.id).doc.length.toLocaleString()} {t('字符', 'characters')}
              </span>
              <span>
                {getState(tab.id).doc.lines} {t('行', 'lines')}
              </span>
            </>
          )}
        </div>
        <div>
          {tab && (
            <>
              <span>
                {t(
                  `行 ${cursor.line}，列 ${cursor.column}`,
                  `Ln ${cursor.line}, Col ${cursor.column}`,
                )}
              </span>
              <span className="status-separator" />
              <select
                className="encoding-select"
                aria-label={t('以指定编码重新打开', 'Reopen with encoding')}
                title={t('以指定编码重新打开', 'Reopen with encoding')}
                value={tab.meta?.encoding ?? 'utf8'}
                disabled={!tab.path}
                onChange={(event) => void reload(event.target.value as Encoding)}
              >
                {(['utf8', 'utf8-bom', 'gbk', 'utf16le', 'utf16be', 'shift_jis'] as const).map(
                  (encoding) => (
                    <option key={encoding} value={encoding}>
                      {encoding.toUpperCase()}
                    </option>
                  ),
                )}
              </select>
              <span>{tab.meta?.eol.toUpperCase() ?? 'LF'}</span>
              <span>Markdown</span>
            </>
          )}
          <span className="version">v0.1.0</span>
        </div>
      </footer>
      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            className="icon-button"
            onClick={() => setNotice('')}
            aria-label={t('关闭提示', 'Dismiss notification')}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {dragging && (
        <div className="drop-overlay">
          <FileText size={42} />
          <h2>{t('松开以打开文档', 'Drop to open your document')}</h2>
        </div>
      )}
      {showSettings && (
        <SettingsDialog
          settings={settings}
          onSave={async (settings) => {
            useWorkspace.setState({ settings: await window.md.setSettings(settings) });
          }}
          onClose={() => setShowSettings(false)}
          onError={report}
        />
      )}
      {recovery.length > 0 && (
        <div className="modal-backdrop">
          <section
            className="recovery-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('恢复文档', 'Recover documents')}
          >
            <div className="recovery-icon">
              <RefreshCw size={28} />
            </div>
            <h2>{t('继续上次的创作', 'Pick up where you left off')}</h2>
            <p>
              {t(
                `发现 ${recovery.length} 份未保存的文档快照。`,
                `Found ${recovery.length} unsaved document snapshots.`,
              )}
            </p>
            <ul>
              {recovery.map((item) => (
                <li key={item.id}>
                  <FileText size={15} />
                  {item.name}
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button
                className="secondary"
                onClick={() => {
                  void window.md
                    .clearRecovery()
                    .then(() => setRecovery([]))
                    .catch(report);
                }}
              >
                {t('放弃快照', 'Discard snapshots')}
              </button>
              <button className="primary" autoFocus onClick={() => void recover().catch(report)}>
                <Check size={16} />
                {t('恢复文档', 'Recover documents')}
              </button>
            </div>
          </section>
        </div>
      )}
      {renaming && (
        <div className="modal-backdrop">
          <form
            className="recovery-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              if (!tab?.path) return;
              void (async () => {
                if (!(await protect(tab.id))) return;
                const doc = await window.md.rename(tab.path!, newName);
                if (doc) {
                  replaceDocument(tab.id, doc.text);
                  markSaved(tab.id, getState(tab.id).doc);
                  useWorkspace.getState().updateTab(tab.id, {
                    path: doc.meta.path,
                    name: filename(doc.meta.path),
                    meta: doc.meta,
                    conflict: false,
                    dirty: false,
                    revision: Date.now(),
                  });
                  setRefresh((value) => value + 1);
                }
                setRenaming(false);
              })().catch(report);
            }}
          >
            <h2>{t('重命名文档', 'Rename document')}</h2>
            <input
              autoFocus
              required
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              aria-label={t('文件名', 'File name')}
            />
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={() => setRenaming(false)}>
                {t('取消', 'Cancel')}
              </button>
              <button className="primary" type="submit">
                {t('重命名', 'Rename')}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
