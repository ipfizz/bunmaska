// Every OS-service backend contract (D024): api/ and each backend import these, never each other.

import type { Cookie, CookieFilter } from '../../common/cookie-util';
import type { Rect } from './native';

export type ClipboardBackend = {
  readText(): string | Promise<string>;
  writeText(text: string): void;
  readHTML(): string | Promise<string>;
  writeHTML(markup: string): void;
  /** PNG bytes, or an empty array if the clipboard holds no image. */
  readImage(): Uint8Array | Promise<Uint8Array>;
  writeImage(bytes: Uint8Array): void;
  availableFormats(): string[];
  clear(): void;
};

/** Electron message-box severity. Drives the `NSAlert` icon/style on macOS. */
export type MessageBoxType = 'none' | 'info' | 'error' | 'question' | 'warning';

export type MessageBoxSpec = {
  readonly message: string;
  readonly detail: string;
  /** Button titles in order; the first is the default. */
  readonly buttons: ReadonlyArray<string>;
  /** Severity styling; omitted/`none` leaves the default warning style. */
  readonly type?: MessageBoxType;
};

export type OpenDialogSpec = {
  readonly canChooseFiles: boolean;
  readonly canChooseDirectories: boolean;
  readonly allowsMultipleSelection: boolean;
  /** Show the "New Folder" button so the user can create a directory in-panel. */
  readonly canCreateDirectories: boolean;
  /** Directory the panel opens at (`''` = system default / last location). */
  readonly defaultPath: string;
  /** Allowed file extensions (without dots); empty means any file. */
  readonly extensions: ReadonlyArray<string>;
};

export type SaveDialogSpec = {
  /** Electron's `defaultPath`: a file name, an absolute file path, or a directory to open at. */
  readonly defaultName: string;
  /** Allowed file extensions (without dots); empty means any file. */
  readonly extensions: ReadonlyArray<string>;
};

/** macOS and Windows panels are modal and return a value; Linux (GTK) is async and returns a Promise. */
export type DialogBackend = {
  showMessageBox(spec: MessageBoxSpec): number | Promise<number>;
  showOpenDialog(spec: OpenDialogSpec): string[] | Promise<string[]>;
  showSaveDialog(spec: SaveDialogSpec): string | Promise<string>;
};

/** The API owns parsing and the registry; the backend owns the OS grab and firing `callback`. */
export type GlobalShortcutBackend = {
  /** `false` where no grab is possible, e.g. Linux without an X11 display. */
  isSupported(): boolean;
  /** `false` when the OS refused the grab, e.g. the key is already taken. */
  register(accelerator: string, callback: () => void): boolean;
  /** No-op if `accelerator` was not grabbed. */
  unregister(accelerator: string): void;
  unregisterAll(): void;
};

/** Operated on the ACTIVATING window, not a fixed one. */
export type MenuWindowAction = 'minimize' | 'close' | 'zoom' | 'togglefullscreen';

/** A backend-neutral description of one menu item. */
export type NativeMenuItemSpec = {
  readonly label: string;
  readonly type: 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
  readonly enabled: boolean;
  /** Initial check mark of a checkbox/radio item; absent means unchecked. */
  readonly checked?: boolean;
  /** Single-character key equivalent (e.g. `'q'`), or `''` for none. */
  readonly keyEquivalent: string;
  /** `NSEventModifierFlags` mask for the key equivalent; absent means no modifiers. */
  readonly modifierMask?: bigint;
  /** A predefined role name (the item's behavior is native, not a JS click). */
  readonly role?: string;
  /** The macOS first-responder selector for a role item (e.g. `'copy:'`). */
  readonly roleSelector?: string;
  /** Linux: a WebKitGTK editing command a role runs on the focused web view (e.g. `'Copy'`). */
  readonly editingCommand?: string;
  /** Linux: a GTK window op a role performs (e.g. `'minimize'`). */
  readonly windowAction?: MenuWindowAction;
  readonly submenu?: ReadonlyArray<NativeMenuItemSpec>;
  readonly onClick?: () => void;
};

/** `realize` returns an opaque native menu handle. */
export type MenuRealizer = {
  realize(items: ReadonlyArray<NativeMenuItemSpec>): bigint;
  setApplicationMenu(menu: bigint | null): void;
};

/** Opaque: an NSBitmapImageRep (macOS), GdkPixbuf (Linux) or GDI+ image (Windows) address. */
export type NativeImageHandle = bigint;

/** Size comes from scalar getters at decode time: bun:ffi cannot return `NSSize` by value. */
export type DecodedImage = {
  /** `0n` when empty or the decode failed. */
  readonly handle: NativeImageHandle;
  /** Pixels; `0` when empty. */
  readonly width: number;
  /** Pixels; `0` when empty. */
  readonly height: number;
  /** Set for a bad path or undecodable bytes. */
  readonly empty: boolean;
};

export type NativeImageBackend = {
  /** A filesystem path or in-memory PNG/JPEG bytes. */
  decode(source: string | Uint8Array): DecodedImage;
  encodePng(handle: NativeImageHandle): Uint8Array;
  /** `quality` is 0-100. */
  encodeJpeg(handle: NativeImageHandle, quality: number): Uint8Array;
  /** Redraws at exactly `width`×`height` px into a NEW native image. */
  resize(handle: NativeImageHandle, width: number, height: number): DecodedImage;
  /** Copies the sub-rectangle into a NEW native image. */
  crop(
    handle: NativeImageHandle,
    x: number,
    y: number,
    width: number,
    height: number,
  ): DecodedImage;
  /** Drops the reference `decode`, `resize` or `crop` returned, once its image is collected. */
  release?(handle: NativeImageHandle): void;
};

export type ThemeSource = 'system' | 'light' | 'dark';

export type NativeThemeBackend = {
  shouldUseDarkColors(): boolean;
  prefersReducedTransparency(): boolean;
  /** Re-themes the app's windows; a no-op where the OS has no app-wide override. */
  setThemeSource(source: ThemeSource): void;
  /** Calls `onChange` on every OS appearance change, for the process lifetime. */
  observe(onChange: () => void): void;
};

export type NotificationSpec = {
  readonly title: string;
  readonly body: string;
  readonly subtitle: string;
  readonly silent: boolean;
  /** `app.getName()`, for backends that register the sender by name. */
  readonly appName?: string;
};

export type NotificationHandle = {
  /** Safe to call more than once. */
  close(): void;
  /** Fired when the OS closes or the user dismisses it. */
  onClosed(callback: () => void): void;
};

export type NotificationBackend = {
  isSupported(): boolean;
  present(spec: NotificationSpec): NotificationHandle;
};

export type PowerEventHandlers = {
  readonly onSuspend: () => void;
  readonly onResume: () => void;
  readonly onLockScreen: () => void;
  readonly onUnlockScreen: () => void;
};

export type PowerSaveBlockerType = 'prevent-app-suspension' | 'prevent-display-sleep';

/** Opaque and platform-owned, e.g. an IOPMAssertion id or a D-Bus cookie. */
export type NativeBlocker = unknown;

/** `acquire` returns null without a mechanism (the block is then a no-op); `release` is best-effort. */
export type PowerSaveBlockerBackend = {
  /** `appName` is `app.getName()`, for backends that name the inhibitor. */
  acquire: (type: PowerSaveBlockerType, appName?: string) => NativeBlocker | null;
  release: (handle: NativeBlocker) => void;
};

export type KeyringBackend = {
  /** MUST be cheap, non-blocking, and never throw. */
  isAvailable(): boolean;
  /** Exactly 32 bytes. May throw; the throw is surfaced by encrypt/decrypt. */
  getOrCreateKey(): Buffer;
};

/** Top-left screen coordinates; backends already report top-left rects, so none is flipped. */
export type Point = {
  readonly x: number;
  readonly y: number;
};

/** A backend's display, before the derived sizes. */
export type RawDisplay = {
  readonly id: number;
  readonly bounds: Rect;
  readonly workArea: Rect;
  readonly scaleFactor: number;
  readonly rotation: number;
  readonly internal: boolean;
  readonly primary: boolean;
};

export type ScreenBackend = {
  /** Must return at least one display on a real host. */
  getDisplays(): readonly RawDisplay[];
  getCursorScreenPoint(): Point;
};

export type SessionBackend = {
  clearStorageData(): Promise<void>;
  /** Already filtered by the backend. */
  getCookies(filter: CookieFilter): Promise<Cookie[]>;
  /** A fully normalized cookie; the api layer derives domain and path. */
  setCookie(cookie: Cookie): Promise<void>;
  /** Delete every cookie named `name` that matches `url`'s host and path. */
  removeCookie(url: string, name: string): Promise<void>;
};

export type ShellBackend = {
  openExternal(url: string): boolean;
  openPath(path: string): boolean;
  showItemInFolder(path: string): void;
  beep(): void;
};

/** Only macOS honours `template`. */
export type TrayImageOptions = { readonly template?: boolean };

export type TrayInstance = {
  setToolTip(toolTip: string): void;
  setTitle(title: string): void;
  setImage(image: string, options?: TrayImageOptions): void;
  /** `null` clears the installed menu; a backend that shows none never calls `realize`. */
  setContextMenu(menu: { realize(): bigint } | null): void;
  onClick(callback: () => void): void;
  /** Must be idempotent. */
  destroy(): void;
  isDestroyed(): boolean;
};

export type TrayBackend = {
  /** `image` is a filesystem path, never a NativeImage; `appName` is `app.getName()`. */
  create(image: string, options?: TrayImageOptions, appName?: string): TrayInstance;
};

/** One OS's services; `service(key)` in platform/index.ts picks the current OS's row. */
export type PlatformServices = {
  readonly clipboard: ClipboardBackend;
  readonly dialog: DialogBackend;
  readonly globalShortcut: GlobalShortcutBackend;
  readonly menu: MenuRealizer;
  readonly nativeImage: NativeImageBackend;
  readonly nativeTheme: NativeThemeBackend;
  readonly notification: NotificationBackend;
  readonly powerMonitor: (handlers: PowerEventHandlers) => void;
  readonly powerSaveBlocker: PowerSaveBlockerBackend;
  readonly safeStorage: KeyringBackend;
  readonly screen: ScreenBackend;
  readonly session: SessionBackend;
  readonly shell: ShellBackend;
  readonly tray: TrayBackend;
};
