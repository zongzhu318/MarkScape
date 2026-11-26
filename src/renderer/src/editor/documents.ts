import { Compartment, EditorState, type Extension, type Text } from '@codemirror/state';
import {
  EditorView,
  keymap,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { Settings, ViewMode } from '../../../shared/types';
import { inlinePreview } from './inline';
import { tags } from '@lezer/highlight';

const markdownHighlight = HighlightStyle.define([
  { tag: tags.heading, color: 'var(--heading)', fontWeight: '650' },
  { tag: [tags.processingInstruction, tags.meta, tags.comment], color: 'var(--muted)' },
  { tag: [tags.keyword, tags.atom, tags.bool], color: 'var(--syntax-keyword)' },
  { tag: [tags.string, tags.url, tags.link], color: 'var(--accent)' },
  { tag: [tags.number, tags.literal], color: 'var(--syntax-number)' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.monospace, color: 'var(--code-fg)' },
]);

interface DocumentEntry {
  state: EditorState;
  saved: Text;
  configuration: Compartment;
  listeners: Compartment;
}
const documents = new Map<string, DocumentEntry>();
let activeView: EditorView | null = null;
let activeId: string | null = null;
export function attachView(view: EditorView | null, id: string | null): void {
  activeView = view;
  activeId = id;
}
export function getView(): EditorView | null {
  return activeView;
}
export function getState(id: string): EditorState {
  if (id === activeId && activeView) return activeView.state;
  const entry = documents.get(id);
  if (!entry) throw new Error('Document not found');
  return entry.state;
}
export function setState(id: string, state: EditorState): void {
  const entry = documents.get(id);
  if (entry) entry.state = state;
}
export function listenerEffect(id: string, extension: Extension) {
  return documents.get(id)!.listeners.reconfigure(extension);
}
export function isDirty(id: string): boolean {
  const entry = documents.get(id)!;
  return !getState(id).doc.eq(entry.saved);
}
export function markSaved(id: string, doc: Text): void {
  const entry = documents.get(id);
  if (entry) entry.saved = doc;
}
export function deleteDocument(id: string): void {
  documents.delete(id);
}
export function wrapSelection(view: EditorView, marker: string): boolean {
  if (view.state.readOnly) return false;
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: `${marker}${selected}${marker}` },
    selection: { anchor: range.from + marker.length, head: range.to + marker.length },
  });
  view.focus();
  return true;
}
function configuration(settings: Settings, mode: ViewMode, readonly: boolean): Extension[] {
  return [
    EditorState.readOnly.of(readonly),
    EditorView.editable.of(!readonly),
    EditorState.tabSize.of(settings.editor.tabSize),
    ...(settings.editor.wordWrap ? [EditorView.lineWrapping] : []),
    ...(settings.editor.lineNumbers ? [lineNumbers(), highlightActiveLineGutter()] : []),
    ...(settings.editor.autoPairs ? [closeBrackets()] : []),
    ...(mode === 'inline' ? [inlinePreview] : []),
    EditorView.theme({
      '&': {
        fontSize: `${settings.fontSize}px`,
        height: '100%',
        color: 'var(--fg)',
        backgroundColor: 'var(--surface)',
      },
      '.cm-content': {
        fontFamily: '"JetBrains Mono", monospace',
        lineHeight: String(settings.lineHeight),
        padding: '24px 0',
      },
      '.cm-line': { padding: '0 24px' },
      '.cm-scroller': { overflow: 'auto' },
      '.cm-gutters': {
        background: 'var(--surface)',
        color: 'var(--muted)',
        border: 'none',
        paddingLeft: '12px',
      },
      '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--active-line)' },
      '.cm-cursor': { borderLeftColor: 'var(--accent)' },
      '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--selection)',
      },
      '.cm-panels': {
        background: 'var(--panel)',
        color: 'var(--fg)',
        borderColor: 'var(--border)',
      },
      '.cm-searchMatch': { backgroundColor: '#eab30844' },
    }),
  ];
}
export function createDocument(
  id: string,
  text: string,
  settings: Settings,
  mode: ViewMode,
  readonly: boolean,
  cursor = 0,
): EditorState {
  const compartment = new Compartment();
  const listeners = new Compartment();
  const state = EditorState.create({
    doc: text,
    selection: { anchor: Math.min(cursor, text.length) },
    extensions: [
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      highlightActiveLine(),
      syntaxHighlighting(markdownHighlight),
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search({ top: true }),
      highlightSelectionMatches(),
      keymap.of([
        { key: 'Mod-b', run: (view) => wrapSelection(view, '**') },
        { key: 'Mod-i', run: (view) => wrapSelection(view, '*') },
        { key: 'Mod-e', run: (view) => wrapSelection(view, '`') },
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      compartment.of(configuration(settings, mode, readonly)),
      listeners.of([]),
    ],
  });
  documents.set(id, { state, saved: state.doc, configuration: compartment, listeners });
  return state;
}
export function configureDocument(
  id: string,
  settings: Settings,
  mode: ViewMode,
  readonly: boolean,
): void {
  const entry = documents.get(id);
  if (!entry) return;
  const effects = entry.configuration.reconfigure(configuration(settings, mode, readonly));
  if (activeId === id && activeView) {
    activeView.dispatch({ effects });
    entry.state = activeView.state;
  } else entry.state = entry.state.update({ effects }).state;
}
export function replaceDocument(id: string, text: string): void {
  const transaction = { changes: { from: 0, to: getState(id).doc.length, insert: text } };
  if (activeId === id && activeView) activeView.dispatch(transaction);
  else setState(id, getState(id).update(transaction).state);
}
export function jumpToLine(line: number): void {
  if (!activeView) return;
  const target = activeView.state.doc.line(Math.max(1, Math.min(line, activeView.state.doc.lines)));
  activeView.dispatch({
    selection: { anchor: target.from },
    effects: EditorView.scrollIntoView(target.from, { y: 'start' }),
  });
  activeView.focus();
}
