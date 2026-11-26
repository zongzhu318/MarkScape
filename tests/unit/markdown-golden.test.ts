// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { markdownCases } from '../fixtures/markdown-cases';
import { renderMarkdown } from '../../src/renderer/src/markdown/render';
import { defaultSettings } from '../../src/shared/defaults';
it.each(Object.entries(markdownCases))('renders golden sample: %s', (_name, source) => {
  const result = renderMarkdown(source, '/workspace/readme.md', defaultSettings.preview);
  expect(result).toMatchSnapshot();
});
