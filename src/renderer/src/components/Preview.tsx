import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { RenderResult } from '../markdown/render';
import { getState, getView } from '../editor/documents';

interface Props {
  result: RenderResult;
  tabId: string;
  readonly: boolean;
  onNavigate(line: number): void;
  onScroll(line: number): void;
  onError(error: unknown): void;
}
export interface PreviewHandle {
  element(): HTMLElement | null;
  scrollToLine(line: number): void;
}
export const Preview = forwardRef<PreviewHandle, Props>(function Preview(
  { result, tabId, readonly, onNavigate, onScroll, onError },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const originalHtml = useRef(new WeakMap<Element, string>());
  useImperativeHandle(ref, () => ({
    element: () => host.current,
    scrollToLine(line) {
      const blocks = [...(host.current?.querySelectorAll<HTMLElement>('[data-line-start]') ?? [])];
      let target = blocks[0];
      for (const block of blocks) {
        if (Number(block.dataset.lineStart) <= line) target = block;
      }
      if (target && host.current)
        host.current.scrollTop +=
          target.getBoundingClientRect().top - host.current.getBoundingClientRect().top - 26;
    },
  }));
  useEffect(() => {
    const element = host.current!;
    const template = document.createElement('template');
    template.innerHTML = result.html;
    const incoming = Array.from(template.content.children);
    if (!element.childElementCount) {
      const fragment = document.createDocumentFragment();
      for (const child of incoming) {
        originalHtml.current.set(child, child.outerHTML);
        fragment.appendChild(child);
      }
      element.replaceChildren(fragment);
    } else {
      const existing = new Map<string, Element[]>();
      for (const child of Array.from(element.children)) {
        const key = originalHtml.current.get(child) ?? child.outerHTML;
        const group = existing.get(key);
        if (group) group.push(child);
        else existing.set(key, [child]);
      }
      // Preserve unchanged blocks, including rendered diagrams and image state.
      let cursor = element.firstElementChild;
      const keep = new Set<Element>();
      for (const child of incoming) {
        const key = child.outerHTML;
        const node = existing.get(key)?.shift() ?? child;
        originalHtml.current.set(node, key);
        keep.add(node);
        if (node === cursor) cursor = cursor.nextElementSibling;
        else element.insertBefore(node, cursor);
      }
      for (const child of Array.from(element.children)) if (!keep.has(child)) child.remove();
    }
    for (const input of element.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))
      input.disabled = readonly;
    const enhancedBlocks = element.querySelectorAll<HTMLElement>(
      '[data-diagram], pre[data-language]',
    );
    if (!enhancedBlocks.length) return;
    const pending = new Set<HTMLElement>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries)
          if (entry.isIntersecting) {
            pending.add(entry.target as HTMLElement);
            observer.unobserve(entry.target);
          }
      },
      { root: element, rootMargin: '300px' },
    );
    for (const block of enhancedBlocks) observer.observe(block);
    const timer = setInterval(() => {
      if (!pending.size) return;
      const blocks = [...pending];
      pending.clear();
      void (async () => {
        const { enhanceElement } = await import('../markdown/enhance');
        for (const block of blocks) if (block.isConnected) await enhanceElement(block);
      })().catch(onError);
    }, 400);
    return () => {
      observer.disconnect();
      clearInterval(timer);
    };
  }, [result, readonly, onError]);
  return (
    <article
      ref={host}
      className="markdown-body preview-scroll"
      aria-label="Markdown preview"
      onScroll={() => {
        const element = host.current!;
        const top = element.getBoundingClientRect().top;
        const blocks = [...element.querySelectorAll<HTMLElement>('[data-line-start]')];
        const block = blocks.find((block) => block.getBoundingClientRect().bottom >= top + 28);
        if (block) onScroll(Number(block.dataset.lineStart));
      }}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        const link = target.closest('a');
        if (link) {
          event.preventDefault();
          const href = link.getAttribute('href') ?? '';
          if (href.startsWith('#')) {
            const id = decodeURIComponent(href.slice(1));
            const element = [...host.current!.querySelectorAll<HTMLElement>('[id]')].find(
              (node) => node.id === id,
            );
            element?.scrollIntoView({ block: 'start' });
            const heading = result.headings.find((item) => item.id === id);
            if (heading) onNavigate(heading.line);
          } else void window.md.openExternal(href).catch(onError);
        }
        if (target instanceof HTMLInputElement && target.dataset.taskLine && !readonly) {
          const document = getState(tabId).doc;
          const number = Number(target.dataset.taskLine);
          if (!Number.isSafeInteger(number) || number < 1 || number > document.lines) return;
          const line = document.line(number);
          const updated = line.text.replace(
            /^(\s*(?:[-+*]|\d+[.)])\s+)\[([ xX])\]/,
            (_all, prefix: string, checked: string) => `${prefix}[${checked === ' ' ? 'x' : ' '}]`,
          );
          const view = getView();
          if (view) view.dispatch({ changes: { from: line.from, to: line.to, insert: updated } });
        }
      }}
    />
  );
});
