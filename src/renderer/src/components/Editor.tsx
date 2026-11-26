import { useEffect, useRef } from 'react';
import { EditorView } from '@codemirror/view';
import {
  attachView,
  configureDocument,
  getState,
  isDirty,
  listenerEffect,
  setState,
} from '../editor/documents';
import { useWorkspace, type Tab } from '../stores/workspace';
import type { Settings } from '../../../shared/types';

interface Props {
  tab: Tab;
  settings: Settings;
  onChange(): void;
  onCursor(line: number, column: number): void;
  onScroll(line: number): void;
  onError(error: unknown): void;
}
export function Editor({ tab, settings, onChange, onCursor, onScroll, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onChange, onCursor, onScroll, onError });
  callbacks.current = { onChange, onCursor, onScroll, onError };
  useEffect(() => {
    const state = getState(tab.id);
    const extension = [
      EditorView.updateListener.of((update) => {
        setState(tab.id, update.state);
        if (update.docChanged) {
          useWorkspace
            .getState()
            .updateTab(tab.id, { dirty: isDirty(tab.id), revision: Date.now() });
          callbacks.current.onChange();
        }
        if (update.selectionSet || update.docChanged) {
          const head = update.state.selection.main.head;
          const line = update.state.doc.lineAt(head);
          callbacks.current.onCursor(line.number, head - line.from + 1);
        }
      }),
      EditorView.domEventHandlers({
        scroll: (_event, view) => {
          const block = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
          const line = view.state.doc.lineAt(block.from).number;
          callbacks.current.onScroll(line);
        },
        paste: (event, view) => {
          if (view.state.readOnly) return false;
          const image = [...(event.clipboardData?.items ?? [])].find(
            (item) => item.type === 'image/png',
          );
          if (!image) return false;
          event.preventDefault();
          const file = image.getAsFile();
          if (!file) return true;
          const path = useWorkspace.getState().tabs.find((item) => item.id === tab.id)?.path;
          if (!path) {
            callbacks.current.onError(
              new Error('请先保存文档再粘贴图片 / Save the document before pasting an image'),
            );
            return true;
          }
          void file
            .arrayBuffer()
            .then((bytes) => window.md.writeImage(path, new Uint8Array(bytes)))
            .then((relative) => {
              if (!view.dom.isConnected) return;
              view.dispatch(view.state.replaceSelection(`![image](${relative})`));
            })
            .catch(callbacks.current.onError);
          return true;
        },
      }),
    ];
    const view = new EditorView({
      state: state.update({ effects: listenerEffect(tab.id, extension) }).state,
      parent: host.current!,
    });
    attachView(view, tab.id);
    view.scrollDOM.scrollTop = tab.scrollTop;
    const cursor = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursor);
    callbacks.current.onCursor(line.number, cursor - line.from + 1);
    return () => {
      // Remove component-bound listeners, retaining undo history and selection.
      setState(tab.id, view.state.update({ effects: listenerEffect(tab.id, []) }).state);
      useWorkspace.getState().updateTab(tab.id, { scrollTop: view.scrollDOM.scrollTop });
      attachView(null, null);
      view.destroy();
    };
    // Configuration changes are handled by a compartment below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);
  useEffect(() => {
    configureDocument(tab.id, settings, tab.viewMode, tab.meta?.readonly ?? false);
  }, [tab.id, settings, tab.viewMode, tab.meta?.readonly]);
  return (
    <div
      className="editor-host"
      ref={host}
      aria-label={settings.language === 'zh' ? 'Markdown 编辑器' : 'Markdown editor'}
    />
  );
}
