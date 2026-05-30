import { nsString, nsStringToString } from './cocoa-foundation';
import { msgSendI64, msgSendPtr, msgSendReturnsI64, msgSendU8 } from './cocoa-msgsend-variants';
import { cocoa } from './cocoa-runtime';
import type { Handle } from './objc';

/**
 * Native modal dialogs via `NSAlert`, `NSOpenPanel`, and `NSSavePanel`.
 *
 * Each dialog is split into a non-blocking *build* step (alloc + configure the
 * panel — fully testable) and a *run* step that calls the blocking `runModal`.
 * `runModal` spins a nested AppKit modal loop and cannot run on a headless CI
 * display, so only the build steps are covered by automated tests; the run
 * steps are exercised in real apps (mirroring the D019/D022 testing approach).
 */

/** `NSModalResponseOK` for save/open panels. */
const NS_MODAL_RESPONSE_OK = 1n;
/** `NSAlertFirstButtonReturn`; subsequent buttons are this + index. */
const NS_ALERT_FIRST_BUTTON_RETURN = 1000n;

export type MessageBoxSpec = {
  readonly message: string;
  readonly detail: string;
  /** Button titles in order; the first is the default. */
  readonly buttons: ReadonlyArray<string>;
};

export type OpenDialogSpec = {
  readonly canChooseFiles: boolean;
  readonly canChooseDirectories: boolean;
  readonly allowsMultipleSelection: boolean;
};

export type SaveDialogSpec = {
  readonly defaultName: string;
};

/** Build (but do not run) an `NSAlert` for a message box. Returns its handle. */
export const buildAlert = (spec: MessageBoxSpec): Handle => {
  const rt = cocoa();
  const alert = rt.msgSend(
    rt.msgSend(rt.classes.get('NSAlert'), rt.selectors.get('alloc')),
    rt.selectors.get('init'),
  );
  msgSendPtr(alert, rt.selectors.get('setMessageText:'), nsString(spec.message));
  msgSendPtr(alert, rt.selectors.get('setInformativeText:'), nsString(spec.detail));
  const buttons = spec.buttons.length > 0 ? spec.buttons : ['OK'];
  for (const title of buttons) {
    msgSendPtr(alert, rt.selectors.get('addButtonWithTitle:'), nsString(title));
  }
  return alert;
};

/** Show a message box modally. Returns the index of the clicked button. */
export const showMessageBox = (spec: MessageBoxSpec): number => {
  const alert = buildAlert(spec);
  const response = msgSendReturnsI64(alert, cocoa().selectors.get('runModal'));
  return Number(response - NS_ALERT_FIRST_BUTTON_RETURN);
};

/** Build (but do not run) a configured `NSOpenPanel`. Returns its handle. */
export const buildOpenPanel = (spec: OpenDialogSpec): Handle => {
  const rt = cocoa();
  const panel = rt.msgSend(rt.classes.get('NSOpenPanel'), rt.selectors.get('openPanel'));
  msgSendU8(panel, rt.selectors.get('setCanChooseFiles:'), spec.canChooseFiles ? 1 : 0);
  msgSendU8(panel, rt.selectors.get('setCanChooseDirectories:'), spec.canChooseDirectories ? 1 : 0);
  msgSendU8(
    panel,
    rt.selectors.get('setAllowsMultipleSelection:'),
    spec.allowsMultipleSelection ? 1 : 0,
  );
  return panel;
};

const readPanelURLs = (panel: Handle): string[] => {
  const rt = cocoa();
  const urls = rt.msgSend(panel, rt.selectors.get('URLs'));
  const count = Number(msgSendReturnsI64(urls, rt.selectors.get('count')));
  const paths: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const url = msgSendI64(urls, rt.selectors.get('objectAtIndex:'), BigInt(i));
    paths.push(nsStringToString(rt.msgSend(url, rt.selectors.get('path'))));
  }
  return paths;
};

/** Show an open dialog modally. Returns the selected paths (empty if cancelled). */
export const showOpenDialog = (spec: OpenDialogSpec): string[] => {
  const panel = buildOpenPanel(spec);
  const response = msgSendReturnsI64(panel, cocoa().selectors.get('runModal'));
  return response === NS_MODAL_RESPONSE_OK ? readPanelURLs(panel) : [];
};

/** Build (but do not run) a configured `NSSavePanel`. Returns its handle. */
export const buildSavePanel = (spec: SaveDialogSpec): Handle => {
  const rt = cocoa();
  const panel = rt.msgSend(rt.classes.get('NSSavePanel'), rt.selectors.get('savePanel'));
  if (spec.defaultName.length > 0) {
    msgSendPtr(panel, rt.selectors.get('setNameFieldStringValue:'), nsString(spec.defaultName));
  }
  return panel;
};

/** Show a save dialog modally. Returns the chosen path, or `''` if cancelled. */
export const showSaveDialog = (spec: SaveDialogSpec): string => {
  const rt = cocoa();
  const panel = buildSavePanel(spec);
  const response = msgSendReturnsI64(panel, rt.selectors.get('runModal'));
  if (response !== NS_MODAL_RESPONSE_OK) {
    return '';
  }
  const url = rt.msgSend(panel, rt.selectors.get('URL'));
  return nsStringToString(rt.msgSend(url, rt.selectors.get('path')));
};
