// FAQ copy for /alternatives (`faq`) and the home page (`homeFaq`); anything that churns links to docs.
export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

export const faq: readonly FaqItem[] = [
  {
    q: 'Is bunmaska production-ready?',
    a: "No. It's alpha, and it says so. Use it for the app you were going to rewrite anyway; if you're a large company evaluating it, please read the word 'alpha' three more times before proceeding.",
  },
  {
    q: 'Why use bunmaska instead of Electron?',
    a: "No bundled Chromium. Your app is a fraction of the size, the OS patches the browser engine for you, and native modules need no node-gyp build step. If you need the last slice of Electron's API or battle-tested stability today, use Electron and check back.",
  },
  {
    q: 'Does bunmaska really have no Chromium?',
    a: "Correct. macOS and Linux render on the system's own WebKit (WKWebView and WebKitGTK); Windows ships a from-source WinCairo WebKit - the real WebKit port, never WebView2 or Chromium.",
  },
  {
    q: 'How is bunmaska a drop-in Electron replacement?',
    a: "It keeps Electron's module names and shapes - app, BrowserWindow, ipcMain, ipcRenderer, Menu, dialog, clipboard, webContents - so migrating is mostly changing an import. It covers most of the surface a real app uses; the exact per-method parity, per platform, lives in the parity matrix.",
  },
  {
    q: 'How do native modules work without node-gyp?',
    a: 'A native module is a .ts file that dlopens the OS directly through bun:ffi. No node-gyp, no N-API, no electron-rebuild, no per-arch prebuild matrix, no compile step. Nothing to rebuild, because there was never anything to build.',
  },
  {
    q: 'What breaks?',
    a: "It's alpha: some of the Electron surface isn't implemented yet (it throws a clear error naming the missing module, not a mystery failure), and a few APIs differ per platform. We publish exactly which on the parity matrix. It's also single-process, so there's no per-window crash isolation - that's the price of the lightness.",
  },
];

// The home cards (TradeOffs.astro) and the home FAQPage JSON-LD both render this list:
// Google drops the rich result when the markup differs from the visible text.
export const homeFaq: readonly FaqItem[] = [
  {
    q: 'Windows?',
    a: 'In beta (x64) - on a from-source WinCairo WebKit build (never Chromium), green on CI alongside macOS and Linux. A few APIs are engine-blocked there (custom protocols, printToPDF, capturePage); a hosted WinCairo engine is on the feed, and the stable-train build and ARM64 are still on the roadmap. The parity matrix is honest about every cell.',
  },
  {
    q: 'Production-ready?',
    a: 'It says alpha for a reason. Use it for the thing you were going to rewrite anyway.',
  },
  {
    q: 'Why no Chromium?',
    a: "Because it's already on your computer, and shipping a second one is how we got here.",
  },
  {
    q: "What's the catch?",
    a: "~70-80% of Electron's surface, and we publish the parity matrix so you can check before you commit.",
  },
];

export function faqPageJsonLd(faqItems: readonly FaqItem[] = faq): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqItems.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  };
}
