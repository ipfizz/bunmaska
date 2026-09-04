// The roadmap's single source of truth. Every milestone on /roadmap renders
// from this file - no prose hidden in component frontmatter, no drift.
// Rule of the page: if it isn't built, it says so here.

export type MilestoneStatus = 'shipped' | 'now' | 'next' | 'planned' | 'beta' | 'later';

export interface Milestone {
  readonly version: string;
  readonly status: MilestoneStatus;
  readonly title: string;
  readonly note: string;
  readonly items: readonly string[];
  readonly exit?: string;
}

export const STATUS_LABEL: Record<MilestoneStatus, string> = {
  shipped: 'Shipped',
  now: 'In progress',
  next: 'Next',
  planned: 'Planned',
  beta: 'The bar',
  later: 'After beta',
};

export const milestones: readonly Milestone[] = [
  {
    version: 'alpha.5',
    status: 'shipped',
    title: 'The first npm release',
    note: 'three platforms, honest gaps, on npm.',
    items: [
      'The Electron-shaped API on Bun and WebKit: 21 main-process modules, roughly 70-80% of what a typical app touches, pure `bun:ffi`, zero compiled native code, zero runtime dependencies.',
      'macOS and Linux in full. Windows (x64) in beta on a from-source WinCairo WebKit backend, green on CI next to the other two.',
      'The CLI loop, `init` / `dev` / `build`, producing real .app, .deb and .exe distributables, and the pinned-WebKit engine store: side-by-side, content-addressed, signature-verified.',
      'Frameless windows, bundled preloads, and an event-driven macOS run loop that idles at about a tenth of the CPU.',
    ],
  },
  {
    version: 'alpha.6',
    status: 'shipped',
    title: 'Foundation. Unglamorous on purpose.',
    note: 'the fixes and plumbing everything after it stands on.',
    items: [
      'Crash-class fixes from our own code review: a Linux multi-window SIGSEGV and a macOS window use-after-free. Plus a security fix: a signed engine can no longer install under a different pinned id.',
      'The engine feed went live at engines.bunmaska.org, Windows first, because Windows is the one platform that needs a hosted engine. `bunmaska engine install <id>` verifies the Ed25519 signature and the content hash before it extracts anything.',
      'Trusted input on Windows (`webContents.sendInputEvent`), `loadFile` with `{ hash, query, search }`, one shared WebKit context on Windows so a login carries across windows, and smaller Windows binaries.',
      'A test-budget gate in CI: a suite that silently stops registering now fails the build instead of shrinking quietly.',
    ],
  },
  {
    version: 'alpha.7',
    status: 'shipped',
    title: 'The dev loop, rebuilt. Updates you can ship.',
    note: 'the current release. `npm i bunmaska` gets you this.',
    items: [
      'Bunmaska owns the renderer build. A `renderer` block in the config makes `dev` rebuild and live-reload a React edit instead of restarting the app, and `build` ships the bundle beside the executable on all three OSes.',
      'A dev loop that respects your saves: changes are content-hashed, atomic editor saves are never lost, a restart waits for the old process to exit, preload edits restart, the engine pin is honored, and the window comes back where you left it.',
      'Signed auto-updates end to end: `bunmaska keygen`, a detached Ed25519 `.sig` from `build --update`, https-only feeds, unsigned updates refused, a real swap-and-relaunch `quitAndInstall`, and a `--notarize` that submits and staples.',
      'API depth: `session.cookies` on macOS and Linux, `capturePage` on Linux, real macOS window geometry with a `move` event, `setApplicationMenu(null)`, Super as Cmd in accelerators, and named `bunmaska/electron` exports.',
      'What did not ship: the stable-train hosted engine. The feed has been live since alpha.6 with one engine on it; the catalogue is alpha.8 work.',
    ],
  },
  {
    version: 'alpha.8',
    status: 'now',
    title: 'Hosted engines, a React starter, the last API stretch',
    note: 'what we are building now. Nothing here is done yet; the first bullet says why.',
    items: [
      'The engine catalogue, honestly: three attempts to build the stable-train WinCairo engine in CI were cancelled at the six-hour runner cap. The pipeline works end to end; it needs a bigger build box or a compile cache. Until then the feed serves the one engine it has.',
      'A `bunmaska init --react` starter on top of the alpha.7 renderer build: an IIFE bundle (`file://` blocks ES modules), live reload, and the renderer shipped beside the executable. The recipe is proven in a real app; the template is the work.',
      'The hosted Linux engine: the relocatable build loads from the store today. Next it has to draw, then get a cross-distro base and a publish step of its own.',
      'Engine delivery you never type: embedded in the bundle, or fetched on first run.',
      'The parity cells still marked easy: `powerMonitor` idle and battery, `page-title-updated`, per-instance `webContents.ipc`, `session.clearStorageData` on Linux.',
      'A self-pipe wakeup primitive that structurally removes the one hang class we have ever shipped, and a worked serial-port native module published as a real package: the buildless-FFI demo, not a slide.',
    ],
    exit: 'a fresh machine goes install > init > build > running app on a pinned engine, on all three OSes, and no "easy" cells are left on the parity page',
  },
  {
    version: 'v0.2.0-beta.1',
    status: 'beta',
    title: 'What beta means here: checkable, not vibes',
    note: 'every box below can be verified by you. No box, no beta.',
    items: [
      'The API surface is frozen for the beta line and semver discipline begins.',
      'install > init > dev > build > launch runs end to end in CI on macOS, Linux and Windows, not just unit-green.',
      'Hosted engines are live and the auto-updater has shipped a real update to a real app.',
      'At least five real open-source Electron apps run via dependency swap, and one app we use daily has run for two weeks without a crash.',
      'Docs are complete: every implemented method documented, the parity matrix exact, the migration guide tested against a real app.',
      'Coverage at threshold, zero silent skips, and published size and memory numbers with the methodology attached.',
    ],
  },
  {
    version: 'v1 line',
    status: 'later',
    title: 'After beta',
    note: 'real, but not next. Listed so you know we know.',
    items: [
      'Windows ARM64 (waiting on upstream WinCairo) and a Windows isolated content world.',
      'The macOS pinned-engine spike. System WKWebView stays the default either way.',
      'Delta updates, crash reporting, and a SECURITY.md with a disclosure process.',
      'The event-driven run loop on Linux and Windows, then upstreaming a Bun event-loop API so the pump disappears entirely.',
    ],
  },
];

// The compact "where we are" numbers strip. Update when reality changes;
// the page renders exactly these.
export const snapshot = [
  { value: '21', label: 'Electron-shaped modules' },
  { value: '~70-80%', label: 'weighted API parity' },
  { value: '~1,600', label: 'tests passing · 3-OS CI matrix' },
  { value: '0', label: 'compiled native code' },
] as const;
