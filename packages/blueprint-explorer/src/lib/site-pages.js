/**
 * A site's own pages, such as a developer portal's getting-started guide.
 *
 * `pages` in config.yaml names a folder, relative to config.yaml, that the
 * build copies into the site. Each Markdown page in it is rendered in the
 * explorer's layout as an HTML page of the same name beside it, titled by its
 * first heading, so a page is written as Markdown rather than built by hand;
 * anything else, an HTML page or an image, is used as it is. A site links its
 * pages from `featured_links` on the home page.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, relative, sep } from 'path';
import { loadConfig } from './config.js';
import { marked } from 'marked';
import { singleColumnPage } from './layout.js';
import { COLORS } from './theme.js';

// A whole page, not a field's description, so the full CommonMark and GitHub
// Markdown that marked reads: links, code blocks, tables, headings.
const PAGE_STYLE = `
  .site-page { max-width: 760px; margin: 0 auto; padding: 2rem 1.5rem 4rem; font-size: 15px; line-height: 1.65; }
  .site-page h1 { font-size: 1.75rem; font-weight: 800; color: ${COLORS.darkBlue}; margin: 0 0 1rem; letter-spacing: -0.01em; }
  .site-page h2 { font-size: 1.25rem; font-weight: 800; color: ${COLORS.darkBlue}; margin: 2rem 0 0.75rem; }
  .site-page h3 { font-size: 1rem; font-weight: 700; color: ${COLORS.darkBlue}; margin: 1.5rem 0 0.5rem; }
  .site-page p, .site-page ul, .site-page ol, .site-page table, .site-page pre, .site-page blockquote { margin: 0 0 1rem; }
  .site-page ul, .site-page ol { padding-left: 1.5rem; }
  .site-page li { margin: 0.25rem 0; }
  .site-page pre { background: #1e1b3a; color: #e6e4f5; padding: 12px 14px; border-radius: 6px; overflow: auto; }
  .site-page pre code { background: none; border: 0; color: inherit; padding: 0; font-size: 12.5px; }
  .site-page blockquote { border-left: 3px solid ${COLORS.sandDark}; padding: 0.25rem 1rem; color: #555; }
  .site-page img { max-width: 100%; }
  .site-page a code { color: ${COLORS.midBlue}; }
  .site-page a:hover code { text-decoration: underline; }
`;

/** Every file under a folder. */
const filesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? filesUnder(path) : [path];
});

/** A page's title: its first heading, else its file name. */
function titleOf(markdown, file) {
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading) return heading[1].trim();
  return file.split(sep).pop().replace(/\.md$/, '').replace(/[-_]/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/**
 * Render the Markdown pages in the folder config.yaml names. Nothing to do
 * when it names none.
 *
 * @param {string} contentDir - The built site, where config.yaml and the folder are
 * @throws {Error} When config.yaml names a folder that isn't there
 */
export function buildSitePages(contentDir) {
  const { pages, name: projectName } = loadConfig(contentDir);
  if (!pages) return;
  const folder = join(contentDir, pages);
  if (!existsSync(folder)) {
    throw new Error(`config.yaml names pages: ${pages}, but ${folder} doesn't exist.`);
  }
  for (const file of filesUnder(folder).filter((path) => path.endsWith('.md'))) {
    const markdown = readFileSync(file, 'utf8');
    const title = titleOf(markdown, file);
    const home = `${'../'.repeat(relative(contentDir, file).split(sep).length - 1)}index.html`;
    writeFileSync(file.replace(/\.md$/, '.html'), singleColumnPage({
      title: `${projectName} — ${title}`,
      breadcrumbs: [{ label: 'Explorer', href: home }, { label: title }],
      bodyHtml: `<main class="site-page">${marked.parse(markdown)}</main>`,
      extraStyle: PAGE_STYLE,
    }));
  }
}
