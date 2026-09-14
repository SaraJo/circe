import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/renderer/tile/markdown';

describe('renderMarkdown', () => {
  it('renders the Markdown structures agents commonly return', () => {
    const html = renderMarkdown('# Plan\n\n- **Ship** `code`\n- Test');

    expect(html).toContain('<h1>Plan</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>Ship</strong>');
    expect(html).toContain('<code>code</code>');
  });

  it('can be re-run as a streamed Markdown construct becomes complete', () => {
    expect(renderMarkdown('This is **bold')).toContain('**bold');
    expect(renderMarkdown('This is **bold**')).toContain('<strong>bold</strong>');
  });
});
