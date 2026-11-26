---
"@codeforamerica/blueprint-explorer": minor
---

**Breaking:** the Blueprint's pages for state leadership (`authored/`) are in a site only when its `config.yaml` sets `blueprint_pages: true`; a site linking them from `featured_links` adds it, and `featured_heading: "For state leadership"` to keep the label over those links. Before, a site said what it was only through `name`; now `config.yaml` also takes a `title` and a `tagline` for the home page, a `logo`, an `organization` for the footer, and a `pages` folder whose Markdown pages are rendered in the explorer's layout. (#543)
