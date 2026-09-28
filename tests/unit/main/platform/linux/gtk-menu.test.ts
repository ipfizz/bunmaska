import { afterEach, describe, expect, test } from 'bun:test';
import type { NativeMenuItemSpec } from '../../../../../src/main/platform/macos/cocoa-menu';
import {
  actionName,
  type Bindings,
  detailedAction,
  getCurrentAppMenu,
  getMenuEntry,
  linuxMenuRealizer,
  realizeForWindow,
  resetCurrentAppMenuForTesting,
  rewireForWindow,
  setBindingsForTesting,
} from '../../../../../src/main/platform/linux/gtk-menu';

/**
 * Pure-logic unit tests for the Linux GMenu realizer. The native GIO/GTK calls
 * are replaced with a fake {@link Bindings} that records the calls and hands out
 * monotonic fake pointers, so the spec→action-name mapping, the model/group
 * wiring order, and the click-routing side-table can all be exercised without a
 * real GTK display. The real activate round-trip is verified by the Linux
 * integration test.
 */

type Call = { fn: string; args: unknown[] };

/** A fake pointer is just a tagged number so identity comparisons work. */
let nextPtr = 1000;
const fakePtr = (): bigint => BigInt(++nextPtr);

const makeFakeBindings = (): { bindings: Bindings; calls: Call[] } => {
  const calls: Call[] = [];
  // Maps an action handle -> the JS thunk registered for its `activate` signal.
  const activateHandlers = new Map<bigint, () => void>();
  // Maps a group handle -> { detailedActionName -> action handle }.
  const groupActions = new Map<bigint, Map<string, bigint>>();
  let lastNewAction: bigint | undefined;
  let lastNewActionName: string | undefined;

  const bindings: Bindings = {
    gMenuNew: () => {
      const p = fakePtr();
      calls.push({ fn: 'gMenuNew', args: [] });
      return p;
    },
    gMenuAppend: (menu, label, detailed) => {
      calls.push({ fn: 'gMenuAppend', args: [menu, label, detailed] });
    },
    gMenuAppendSubmenu: (menu, label, submenu) => {
      calls.push({ fn: 'gMenuAppendSubmenu', args: [menu, label, submenu] });
    },
    gMenuAppendSection: (menu, section) => {
      calls.push({ fn: 'gMenuAppendSection', args: [menu, section] });
    },
    gSimpleActionGroupNew: () => {
      const p = fakePtr();
      groupActions.set(p, new Map());
      calls.push({ fn: 'gSimpleActionGroupNew', args: [] });
      return p;
    },
    gSimpleActionNew: (name) => {
      const p = fakePtr();
      lastNewAction = p;
      lastNewActionName = name;
      calls.push({ fn: 'gSimpleActionNew', args: [name] });
      return p;
    },
    gSimpleActionNewStatefulBool: (name, state) => {
      const p = fakePtr();
      lastNewAction = p;
      lastNewActionName = name;
      calls.push({ fn: 'gSimpleActionNewStatefulBool', args: [name, state] });
      return p;
    },
    gSimpleActionSetEnabled: (action, enabled) => {
      calls.push({ fn: 'gSimpleActionSetEnabled', args: [action, enabled] });
    },
    gActionMapAddAction: (group, action) => {
      // Record the action under its name so activate() can find it.
      if (action === lastNewAction && lastNewActionName !== undefined) {
        groupActions.get(group)?.set(`bunmaska.${lastNewActionName}`, action);
      }
      calls.push({ fn: 'gActionMapAddAction', args: [group, action] });
    },
    connectActivate: (action, thunk) => {
      activateHandlers.set(action, thunk);
      calls.push({ fn: 'connectActivate', args: [action] });
      return { close: () => calls.push({ fn: 'closeThunk', args: [action] }) };
    },
    unref: (handle) => {
      calls.push({ fn: 'unref', args: [handle] });
    },
    activateAction: (group, detailed) => {
      const action = groupActions.get(group)?.get(detailed);
      if (action !== undefined) {
        activateHandlers.get(action)?.();
      }
      calls.push({ fn: 'activateAction', args: [group, detailed] });
    },
  };
  return { bindings, calls };
};

afterEach(() => {
  setBindingsForTesting(undefined);
  resetCurrentAppMenuForTesting();
});

describe('action-name helpers', () => {
  test('actionName produces a unique monotonic menu-<id> per call', () => {
    const a = actionName();
    const b = actionName();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^menu-\d+$/);
    expect(b).toMatch(/^menu-\d+$/);
  });

  test('detailedAction prefixes the action group namespace', () => {
    expect(detailedAction('menu-7')).toBe('bunmaska.menu-7');
  });
});

describe('linuxMenuRealizer.realize (fake bindings)', () => {
  test('appends one model entry per normal item and wires its action', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const items: NativeMenuItemSpec[] = [
      {
        label: 'Alpha',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => undefined,
      },
      { label: 'Beta', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
    ];
    linuxMenuRealizer.realize(items);
    expect(calls.filter((c) => c.fn === 'gSimpleActionNew')).toHaveLength(2);
    expect(calls.filter((c) => c.fn === 'gMenuAppend')).toHaveLength(2);
    expect(calls.filter((c) => c.fn === 'gActionMapAddAction')).toHaveLength(2);
    expect(calls.filter((c) => c.fn === 'connectActivate')).toHaveLength(2);
  });

  test('creates a stateful boolean action for a checkbox item carrying its checked state', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    linuxMenuRealizer.realize([
      {
        label: 'Word Wrap',
        type: 'checkbox',
        enabled: true,
        checked: true,
        keyEquivalent: '',
        onClick: () => undefined,
      },
    ]);
    const stateful = calls.filter((c) => c.fn === 'gSimpleActionNewStatefulBool');
    expect(stateful).toHaveLength(1);
    expect(stateful[0]?.args[1]).toBe(true);
    expect(calls.filter((c) => c.fn === 'gSimpleActionNew')).toHaveLength(0);
    expect(calls.filter((c) => c.fn === 'connectActivate')).toHaveLength(1);
  });

  test('routes activate to the matching onClick via the action group', () => {
    const { bindings } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const fired: string[] = [];
    const handle = linuxMenuRealizer.realize([
      {
        label: 'Alpha',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => fired.push('alpha'),
      },
      {
        label: 'Beta',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => fired.push('beta'),
      },
    ]);
    const entry = getMenuEntry(handle);
    expect(entry).toBeDefined();
    // The first clickable item is action menu-0-relative; use the recorded names.
    const names = entry?.actionNames ?? [];
    expect(names).toHaveLength(2);
    bindings.activateAction(entry?.group as bigint, detailedAction(names[1] as string), null);
    bindings.activateAction(entry?.group as bigint, detailedAction(names[0] as string), null);
    expect(fired).toEqual(['beta', 'alpha']);
  });

  test('re-throws a failing click on a microtask instead of into the GLib dispatch', () => {
    const { bindings } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const boom = new Error('app bug');
    const handle = linuxMenuRealizer.realize([
      {
        label: 'Bad',
        type: 'normal',
        enabled: true,
        keyEquivalent: '',
        onClick: () => {
          throw boom;
        },
      },
    ]);
    const entry = getMenuEntry(handle);
    const queued: Array<() => void> = [];
    const original = globalThis.queueMicrotask;
    globalThis.queueMicrotask = (cb) => {
      queued.push(cb);
    };
    try {
      const fire = (): void =>
        bindings.activateAction(
          entry?.group as bigint,
          detailedAction(entry?.actionNames[0] as string),
          null,
        );
      expect(fire).not.toThrow();
    } finally {
      globalThis.queueMicrotask = original;
    }
    expect(queued).toHaveLength(1);
    expect(() => queued[0]?.()).toThrow(boom);
  });

  test('maps Electron & mnemonics to GTK underlines and escapes literal underscores', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    linuxMenuRealizer.realize([
      {
        label: '&File',
        type: 'submenu',
        enabled: true,
        keyEquivalent: '',
        submenu: [
          {
            label: 'my_notes.txt',
            type: 'normal',
            enabled: true,
            keyEquivalent: '',
            onClick: () => undefined,
          },
          { label: 'Save && Quit', type: 'normal', enabled: true, keyEquivalent: '' },
        ],
      },
    ]);
    const labels = calls
      .filter((c) => c.fn === 'gMenuAppend' || c.fn === 'gMenuAppendSubmenu')
      .map((c) => c.args[1]);
    expect(labels).toEqual(['my__notes.txt', 'Save & Quit', '_File']);
  });

  test('honours enabled:false via g_simple_action_set_enabled(0)', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    linuxMenuRealizer.realize([
      { label: 'Off', type: 'normal', enabled: false, keyEquivalent: '', onClick: () => undefined },
    ]);
    const enabledCalls = calls.filter((c) => c.fn === 'gSimpleActionSetEnabled');
    expect(enabledCalls).toHaveLength(1);
    expect(enabledCalls[0]?.args[1]).toBe(0);
  });

  test('does not create an action for an item without onClick', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    linuxMenuRealizer.realize([
      { label: 'Inert', type: 'normal', enabled: true, keyEquivalent: '' },
    ]);
    expect(calls.filter((c) => c.fn === 'gSimpleActionNew')).toHaveLength(0);
    // The label still appears as a (disabled-looking) model entry with no action.
    expect(calls.filter((c) => c.fn === 'gMenuAppend')).toHaveLength(1);
  });

  test('puts the items after a separator into a new section (GTK draws no empty section)', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const handle = linuxMenuRealizer.realize([
      { label: 'A', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
      { label: '', type: 'separator', enabled: true, keyEquivalent: '' },
      { label: 'B', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
    ]);
    const sections = calls.filter((c) => c.fn === 'gMenuAppendSection');
    expect(sections).toHaveLength(1);
    expect(sections[0]?.args[0]).toBe(handle);
    const appendedTo = (label: string): unknown =>
      calls.find((c) => c.fn === 'gMenuAppend' && c.args[1] === label)?.args[0];
    expect(appendedTo('A')).toBe(handle);
    expect(appendedTo('B')).toBe(sections[0]?.args[1]);
  });

  test('realizes a submenu into a child model sharing the same action group', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const fired: string[] = [];
    const handle = linuxMenuRealizer.realize([
      {
        label: 'File',
        type: 'submenu',
        enabled: true,
        keyEquivalent: '',
        submenu: [
          {
            label: 'New',
            type: 'normal',
            enabled: true,
            keyEquivalent: 'n',
            onClick: () => fired.push('new'),
          },
        ],
      },
    ]);
    // One top-level GMenu + one child GMenu for the submenu.
    expect(calls.filter((c) => c.fn === 'gMenuNew')).toHaveLength(2);
    expect(calls.filter((c) => c.fn === 'gMenuAppendSubmenu')).toHaveLength(1);
    // Exactly one action group across the whole tree.
    expect(calls.filter((c) => c.fn === 'gSimpleActionGroupNew')).toHaveLength(1);
    // The nested action routes back to its onClick through the shared group.
    const entry = getMenuEntry(handle);
    const name = entry?.actionNames[0] as string;
    bindings.activateAction(entry?.group as bigint, detailedAction(name), null);
    expect(fired).toEqual(['new']);
  });

  test('retains one JSCallback-equivalent thunk per clickable item', () => {
    const { bindings } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const handle = linuxMenuRealizer.realize([
      { label: 'A', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
      { label: 'B', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
    ]);
    expect(getMenuEntry(handle)?.retained).toHaveLength(2);
  });
});

describe('realizeForWindow (per-window role wiring)', () => {
  const role = (label: string, extra: Partial<NativeMenuItemSpec>): NativeMenuItemSpec => ({
    label,
    type: 'normal',
    enabled: true,
    keyEquivalent: '',
    ...extra,
  });

  test('wires a role item with a Linux action to dispatchRole, fired on activate', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const dispatched: NativeMenuItemSpec[] = [];
    const copy = role('Copy', { role: 'copy', editingCommand: 'Copy' });
    const entry = realizeForWindow([copy], (s) => dispatched.push(s));
    expect(calls.filter((c) => c.fn === 'connectActivate')).toHaveLength(1);
    expect(entry.actionNames).toHaveLength(1);
    bindings.activateAction(entry.group, detailedAction(entry.actionNames[0] as string), null);
    expect(dispatched).toEqual([copy]);
  });

  test('leaves a role with no Linux action (quit) inert — no action wired', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    realizeForWindow([role('Quit', { role: 'quit' })], () => undefined);
    expect(calls.filter((c) => c.fn === 'connectActivate')).toHaveLength(0);
  });

  test('the shared realize() (no dispatcher) leaves role items inert', () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    linuxMenuRealizer.realize([role('Copy', { role: 'copy', editingCommand: 'Copy' })]);
    expect(calls.filter((c) => c.fn === 'connectActivate')).toHaveLength(0);
  });
  test('rewireForWindow re-realizes a handle with role wiring and releases the original', async () => {
    const { bindings, calls } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const copy = role('Copy', { role: 'copy', editingCommand: 'Copy' });
    const handle = linuxMenuRealizer.realize([copy, role('Open', { onClick: () => undefined })]);
    const original = getMenuEntry(handle);
    const dispatched: NativeMenuItemSpec[] = [];
    const entry = rewireForWindow(handle, (s) => dispatched.push(s));
    bindings.activateAction(
      entry?.group as bigint,
      detailedAction(entry?.actionNames[0] as string),
      null,
    );
    expect(dispatched).toEqual([copy]);
    expect(getMenuEntry(handle)).toBeUndefined();
    const unrefs = calls.filter((c) => c.fn === 'unref').map((c) => c.args[0]);
    expect(unrefs).toEqual([original?.model, original?.group]);
    expect(calls.filter((c) => c.fn === 'closeThunk')).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls.filter((c) => c.fn === 'closeThunk')).toHaveLength(1);
  });

  test('rewireForWindow returns undefined for an unknown handle', () => {
    setBindingsForTesting(makeFakeBindings().bindings);
    expect(rewireForWindow(424242n, () => undefined)).toBeUndefined();
  });
});

describe('shared app-menu state', () => {
  test('is undefined before any setApplicationMenu', () => {
    expect(getCurrentAppMenu()).toBeUndefined();
  });

  test('setApplicationMenu stores the realized model + group as the current menu', () => {
    const { bindings } = makeFakeBindings();
    setBindingsForTesting(bindings);
    const handle = linuxMenuRealizer.realize([
      { label: 'App', type: 'normal', enabled: true, keyEquivalent: '', onClick: () => undefined },
    ]);
    linuxMenuRealizer.setApplicationMenu(handle);
    const current = getCurrentAppMenu();
    const entry = getMenuEntry(handle);
    expect(current?.model).toBe(entry?.model as bigint);
    expect(current?.group).toBe(entry?.group as bigint);
  });

  test('throws if setApplicationMenu is given an unknown handle', () => {
    const { bindings } = makeFakeBindings();
    setBindingsForTesting(bindings);
    expect(() => linuxMenuRealizer.setApplicationMenu(999999n)).toThrow();
  });
});
