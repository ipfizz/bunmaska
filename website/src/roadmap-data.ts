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
    title: 'The framework, the CLI, and the engine store',
    note: 'the release that put bunmaska on npm - three platforms, honest gaps.',
    items: [
      'An Electron-shaped API on Bun + system WebKit - 29 modules, ~70-80% weighted parity, pure `bun:ffi`, zero compiled native code, zero runtime deps.',
      'macOS and Linux in full; Windows (x64) in beta on a from-source WinCairo backend, green on CI next to the other two.',
      'The CLI loop - `init` / `dev` / `build` - producing real .app, .deb and .exe distributables, plus a pure-Bun auto-updater.',
      'The pinned-WebKit engine store: side-by-side, content-addressed, signature-verified installs. Relocatable engines proven on Linux and Windows CI.',
      'Frameless windows, bundled preloads, dev live-reload, and an event-driven macOS run loop (~10× less idle CPU).',
    ],
  },
  {
    version: 'alpha.6',
    status: 'shipped',
    title: 'Foundation - the unglamorous release. Deliberately.',
    note: 'where we are today - on npm as `latest`.',
    items: [
      'Landed from the internal code review: the crash-class FFI lifetime fixes, and a security fix that closes an engine-downgrade path - a genuinely-signed older or other engine can no longer install under a different pinned id, because the store now binds the dir to the id inside the signed `engine.json`.',
      'The engine repository is live at engines.bunmaska.org: pack a built engine dir to `.tar.zst`, content-hash it, Ed25519-sign the bytes, publish to R2; `bunmaska engine install <id>` resolves the id against the feed, verifies the signature against the baked release key and re-checks the hash before extracting. The first hosted engine is the WinCairo WebKit Windows apps require - installed from the real CDN, end-to-end.',
      'The start of the Electron contract-fidelity pass: `app.isReady()` is a method, `toPNG`/`toJPEG` return Buffer, Tray takes a NativeImage, `loadFile` handles hash/query and encodes paths properly. The rest of the list rides in alpha.7.',
      'A first test-budget gate in CI: a minimum pass count and a skip ceiling per OS, so a silently-degraded suite fails the build instead of shrinking quietly.',
      'The website is held to the framework’s own strict TypeScript + lint bar, gated in CI.',
    ],
  },
  {
    version: 'alpha.7',
    status: 'now',
    title: 'Hosted engines - the distribution unlock',
    note: 'any app, any platform, a tested WebKit one fetch away.',
    items: [
      'The feed shipped early, in alpha.6: engines.bunmaska.org serves the signed WinCairo engine from Cloudflare R2, and the release public key is baked in as the trust anchor. What remains is the rest of the catalogue - the stable-train WinCairo build (hosted engines track WPE stable releases, where security advisories land), the hosted Linux engine, and publishing wired into CI instead of run by hand.',
      'The render pass for the relocatable Linux engine: it loads from the store today; next it draws.',
      'Cross-distro Linux engines (an old-glibc base, one build across distros).',
      'Engine delivery for end users: embedded in the bundle or fetched on first run. Never something a user types.',
      'The foundation leftovers carry here, not dropped: the coverage ratchet, the remaining contract-fidelity fixes, shared e2e harness helpers, and the Windows WebKit stack tested on every push.',
    ],
    exit: 'a fresh machine goes install > init > build > running app on a pinned engine, on all three OSes',
  },
  {
    version: 'alpha.8',
    status: 'planned',
    title: 'API depth - the last stretch real apps hit',
    note: 'closing the gap list the parity page already admits to.',
    items: [
      '`session.cookies` on all three platforms - the auth-app blocker.',
      'A real `autoUpdater.quitAndInstall` (atomic swap + relaunch) and cryptographically signed updates, not just integrity hashes.',
      'Linux `capturePage`, `powerMonitor` idle/battery, `page-title-updated`, per-instance `webContents.ipc`.',
      'The self-pipe wakeup primitive that structurally prevents the one hang class we’ve ever shipped.',
      'A worked serial-port native module - the buildless-FFI flagship demo, as a real package.',
    ],
    exit: 'no "easy" cells left on the parity page; every N/A documented with its reason',
  },
  {
    version: 'v0.2.0-beta.1',
    status: 'beta',
    title: 'What beta means here - checkable, not vibes',
    note: 'every box below is verifiable. No box, no beta.',
    items: [
      'The API surface is frozen for the beta line; semver discipline begins.',
      'install > init > dev > build > launch runs end-to-end in CI on macOS, Linux and Windows - not just unit-green.',
      'Hosted engines are live and the auto-updater has shipped a real update to a real app.',
      'At least five real open-source Electron apps run via dependency swap, and one app we use daily has run for two weeks without a crash.',
      'Docs are complete: every implemented method documented, the parity matrix exact, the migration guide tested against a real app.',
      'Coverage at threshold, zero silent skips, and published (measured, methodology-included) size and memory numbers.',
    ],
  },
  {
    version: 'v1 line',
    status: 'later',
    title: 'After beta',
    note: 'real, but not next. Listed so you know we know.',
    items: [
      'Windows ARM64 (waiting on upstream WinCairo) and a Windows isolated content world.',
      'The macOS pinned-engine spike - system WKWebView stays the default either way.',
      'Delta updates, crash reporting, a SECURITY.md + disclosure process.',
      'The event-driven run loop on Linux and Windows, then upstreaming a Bun event-loop API so the pump disappears entirely.',
    ],
  },
];

// The compact "where we are" numbers strip. Update when reality changes;
// the page renders exactly these.
export const snapshot = [
  { value: '29', label: 'Electron-shaped modules' },
  { value: '~70-80%', label: 'weighted API parity' },
  { value: '~1,600', label: 'tests passing · 3-OS CI matrix' },
  { value: '0', label: 'compiled native code' },
] as const;
