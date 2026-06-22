/**
 * A minimal cancelable event object, mirroring the `Event` Electron passes to
 * preventable listeners (`before-quit`, `will-quit`, a window's `close`, …): a
 * listener calls {@link CancelableEvent.preventDefault} to veto the default
 * action, and the emitter checks {@link CancelableEvent.defaultPrevented} (D023).
 */
export type CancelableEvent = {
  /** Veto the default action associated with this event. */
  preventDefault(): void;
  /** Whether {@link preventDefault} has been called. */
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
