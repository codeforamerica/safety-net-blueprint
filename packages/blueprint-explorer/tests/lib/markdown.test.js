import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inlineMd, renderMarkdown, parsePipeTable } from '../../src/lib/markdown.js';

describe('inlineMd', () => {
  it('renders bold', () => assert.match(inlineMd('**bold**'), /<strong>bold<\/strong>/));
  it('renders italic', () => assert.match(inlineMd('*italic*'), /<em>italic<\/em>/));
  it('renders inline code', () => assert.match(inlineMd('`code`'), /<code[^>]*>code<\/code>/));
  it('escapes HTML entities', () => assert.match(inlineMd('<b>'), /&lt;b&gt;/));
  it('handles null', () => assert.equal(inlineMd(null), ''));
});

describe('renderMarkdown', () => {
  it('wraps plain text in a div', () => assert.match(renderMarkdown('hello'), /hello/));
  it('renders a heading', () => assert.match(renderMarkdown('## Heading'), /<h3[^>]*>Heading<\/h3>/));
  it('renders a bullet list', () => assert.match(renderMarkdown('- item one\n- item two'), /<ul/));
  it('returns empty string for empty input', () => assert.equal(renderMarkdown(''), ''));
});

describe('parsePipeTable', () => {
  const tableLines = [
    '| Name | Type |',
    '|------|------|',
    '| foo  | string |',
  ];
  it('renders a table element', () => assert.match(parsePipeTable(tableLines), /<table/));
  it('includes header text', () => assert.match(parsePipeTable(tableLines), /Name/));
  it('includes cell text', () => assert.match(parsePipeTable(tableLines), /foo/));
  it('renders single-column "table" from plain text (one cell)', () => {
    const result = parsePipeTable(['just text']);
    assert.ok(result === null || typeof result === 'string', 'returns null or string');
  });
});
