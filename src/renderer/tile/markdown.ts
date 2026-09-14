import { marked } from 'marked';

/** Parse synchronously so a streaming paint can assign the result directly. */
export function renderMarkdown(source: string): string {
  return marked.parse(source, { async: false });
}
