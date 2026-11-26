import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

function decorations(view: EditorView): DecorationSet {
  if (view.composing || view.state.doc.length > 5 * 1024 * 1024) return Decoration.none;
  const cursorLines = new Set(
    view.state.selection.ranges.map((range) => view.state.doc.lineAt(range.head).number),
  );
  const ranges: ReturnType<Decoration['range']>[] = [];
  for (const visible of view.visibleRanges)
    syntaxTree(view.state).iterate({
      from: visible.from,
      to: visible.to,
      enter(node) {
        const line = view.state.doc.lineAt(node.from);
        if (cursorLines.has(line.number)) return;
        if (
          ['HeaderMark', 'EmphasisMark', 'CodeMark'].includes(node.name) ||
          (['LinkMark', 'URL'].includes(node.name) && node.node.parent?.name === 'Link')
        )
          ranges.push(Decoration.replace({}).range(node.from, node.to));
        if (/^ATXHeading/.test(node.name))
          ranges.push(
            Decoration.mark({ class: `inline-heading inline-h${node.name.slice(-1)}` }).range(
              node.from,
              node.to,
            ),
          );
        if (node.name === 'StrongEmphasis')
          ranges.push(Decoration.mark({ class: 'inline-strong' }).range(node.from, node.to));
        if (node.name === 'Emphasis')
          ranges.push(Decoration.mark({ class: 'inline-em' }).range(node.from, node.to));
        if (node.name === 'Link')
          ranges.push(Decoration.mark({ class: 'inline-link' }).range(node.from, node.to));
      },
    });
  return Decoration.set(ranges, true);
}
export const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = decorations(view);
    }
    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.transactions.length
      )
        this.decorations = decorations(update.view);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
