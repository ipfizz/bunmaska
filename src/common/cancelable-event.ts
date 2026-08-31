/**
 * The `Event` Electron passes to preventable listeners (`before-quit`,
 * `will-quit`, a window's `close`, …): a listener vetoes the default action, the
 * emitter checks `defaultPrevented` (D023).
 */
export type CancelableEvent = {
  preventDefault(): void;
  readonly defaultPrevented: boolean;
};

/** Create a fresh {@link CancelableEvent} in the not-prevented state. */
export const makeCancelableEvent = (): CancelableEvent => {
  let prevented = false;
  return {
    preventDefault(): void {
      prevented = true;
    },
    get defaultPrevented(): boolean {
      return prevented;
    },
  };
};
