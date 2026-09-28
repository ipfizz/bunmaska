// @ts-check
import { defineConfig } from 'astro/config';

import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import icon from 'astro-icon';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';

import rehypeCopyButton from './src/rehype-copy-button.mjs';

// https://astro.build/config
export default defineConfig({
  site: 'https://bunmaska.org',
  output: 'static',
  trailingSlash: 'never',
  // Pages serves about.html at /about; a directory build 308s every URL to /about/.
  build: { format: 'file' },
  integrations: [react(), mdx(), icon(), sitemap()],
  redirects: {
    '/docs': '/docs/introduction',
    '/docs/roadmap': '/roadmap',
  },
  markdown: {
    shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' }, wrap: false },
    rehypePlugins: [rehypeCopyButton],
  },
  vite: {
    plugins: [tailwindcss()],
  },
});
