// Single source of truth for the docs sidebar order + prev/next.
export interface NavItem {
  slug: string;
  label: string;
}
export interface NavGroup {
  title: string;
  items: NavItem[];
}

export interface BreadcrumbItem {
  label: string;
  href: string;
}

export const sidebar: NavGroup[] = [
  {
    title: 'Get Started',
    items: [
      { slug: 'introduction', label: 'Introduction' },
      { slug: 'why-bunmaska', label: 'Why Bunmaska' },
      { slug: 'installation', label: 'Installation' },
      { slug: 'quickstart', label: 'Quickstart' },
    ],
  },
  {
    title: 'Platforms & Building',
    items: [
      { slug: 'platforms', label: 'Platform Support' },
      { slug: 'building', label: 'Building & Distribution' },
      { slug: 'shipping', label: 'Shipping Your App' },
    ],
  },
  {
    title: 'Core Concepts',
    items: [
      { slug: 'concepts/ipc', label: 'IPC & Context Bridge' },
      { slug: 'concepts/engine', label: 'Pinned WebKit Engine' },
      { slug: 'concepts/engine-repository', label: 'The Engine Repository' },
      { slug: 'concepts/frameless-windows', label: 'Frameless Windows' },
      { slug: 'cli', label: 'The CLI' },
    ],
  },
  {
    title: 'Buildless Native Modules',
    items: [{ slug: 'native-modules/overview', label: 'Overview' }],
  },
  {
    title: 'Migrating from Electron',
    items: [
      { slug: 'migrating-from-electron', label: 'Migration Guide' },
      { slug: 'migrating/parity', label: 'API Parity & Gaps' },
    ],
  },
  {
    title: 'API - Main Process',
    items: [
      { slug: 'api/app', label: 'app' },
      { slug: 'api/browser-window', label: 'BrowserWindow' },
      { slug: 'api/web-contents', label: 'webContents' },
      { slug: 'api/ipc-main', label: 'ipcMain' },
      { slug: 'api/menu', label: 'Menu' },
      { slug: 'api/menu-item', label: 'MenuItem' },
      { slug: 'api/dialog', label: 'dialog' },
      { slug: 'api/tray', label: 'Tray' },
      { slug: 'api/notification', label: 'Notification' },
      { slug: 'api/global-shortcut', label: 'globalShortcut' },
      { slug: 'api/protocol', label: 'protocol' },
      { slug: 'api/screen', label: 'screen' },
      { slug: 'api/power-monitor', label: 'powerMonitor' },
      { slug: 'api/power-save-blocker', label: 'powerSaveBlocker' },
      { slug: 'api/safe-storage', label: 'safeStorage' },
      { slug: 'api/session', label: 'session' },
      { slug: 'api/auto-updater', label: 'autoUpdater' },
      { slug: 'api/native-theme', label: 'nativeTheme' },
    ],
  },
  {
    title: 'API - Renderer Process',
    items: [
      { slug: 'api/ipc-renderer', label: 'ipcRenderer' },
      { slug: 'api/context-bridge', label: 'contextBridge' },
      { slug: 'api/web-frame', label: 'webFrame' },
    ],
  },
  {
    title: 'API - Both Processes',
    items: [
      { slug: 'api/clipboard', label: 'clipboard' },
      { slug: 'api/native-image', label: 'nativeImage' },
      { slug: 'api/shell', label: 'shell' },
    ],
  },
  {
    title: 'Compare',
    items: [{ slug: 'compare/bunmaska-vs-electron', label: 'Bunmaska vs Electron' }],
  },
  {
    title: 'Project',
    items: [{ slug: 'changelog', label: 'Changelog' }],
  },
];

export const flat: NavItem[] = sidebar.flatMap((g) => g.items);

export function findNavGroup(slug: string): NavGroup | null {
  return sidebar.find((group) => group.items.some((item) => item.slug === slug)) ?? null;
}

export function findNavItem(slug: string): NavItem | null {
  return flat.find((item) => item.slug === slug) ?? null;
}

export function breadcrumbItems(slug: string): BreadcrumbItem[] {
  const group = findNavGroup(slug);
  const current = findNavItem(slug);

  const first = group?.items[0];
  if (!group || !current || !first) return [];

  return [
    { label: group.title, href: `/docs/${first.slug}` },
    { label: current.label, href: `/docs/${current.slug}` },
  ];
}

export function prevNext(slug: string): { prev: NavItem | null; next: NavItem | null } {
  const i = flat.findIndex((x) => x.slug === slug);
  if (i === -1) return { prev: null, next: null };
  return {
    prev: flat[i - 1] ?? null,
    next: flat[i + 1] ?? null,
  };
}
