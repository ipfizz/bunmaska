# bunmaska-site

The landing page **and** docs for [Bunmaska](https://github.com/ipfizz/bunmaska) - one
app, statically rendered. Apple-clean, warm "Maska Gold" accent, hairline borders,
zero drop shadows. Tone: funny, dry, allergic to lying (matches the Bunmaska README).

## Stack

- **Astro 6** (`output: 'static'` - every page is rendered to HTML at build time)
- **React 19** islands on the home page only (install picker, bundle-size counter, and a
  three.js pixel hero that loads only when motion is allowed); every other page ships no React
- **Tailwind v4** (`@tailwindcss/vite`, CSS-first `@theme` tokens - no `tailwind.config.js`)
- **Markdown** content collection for docs
- **Self-hosted fonts**: Inter Variable (UI), Instrument Serif (display), Geist Mono (code)
- Runs on **Bun**.

## Develop

```sh
bun install
bun run dev       # http://localhost:4321
bun run build     # static render → ./dist
bun run preview   # serve ./dist
```

## Where things live

- `src/styles/global.css` - the entire design system (tokens, light/dark, no-shadow rules).
- `src/pages/index.astro` - the landing page (all sections + copy).
- `src/content/docs/**` - the docs corpus (markdown). Add a file, add it to `src/nav.ts`.
- `src/nav.ts` - single source of truth for the docs sidebar order + prev/next.
- `src/layouts/` - `Base.astro` (shell + theme) and `Doc.astro` (3-column docs).
- `src/components/` - Nav, Footer, Sidebar, Toc, PrevNext, CodeBlock, and the React
  islands in `ui/`.

## Adding a docs page

1. Drop a `.md` file in `src/content/docs/` (frontmatter: `title`, `description`).
   Don't write an `# H1` - the title comes from frontmatter.
2. Add its slug + label to the right group in `src/nav.ts`. The build fails if a doc
   and the nav disagree.
