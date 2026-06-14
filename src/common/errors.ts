/**
 * Error taxonomy for Bunmaska.
 *
 * Consumers use `instanceof BunmaskaError` to distinguish Bunmaska-originated
 * failures from user or third-party errors, and the stable `code` field to
 * branch on a specific failure without matching on message text.
 */

/** Options accepted by every Bunmaska error, extending the standard `ErrorOptions`. */
export type BunmaskaErrorOptions = ErrorOptions & {
  /** Stable machine-readable code, e.g. `ERR_FFI`. */
  readonly code?: string;
};

/** Base class for all errors thrown by Bunmaska. */
export class BunmaskaError extends Error {
  /** Stable machine-readable code; `undefined` on the bare base class. */
  readonly code: string | undefined;

  constructor(message: string, options?: BunmaskaErrorOptions) {
    super(message, options);
    this.name = 'BunmaskaError';
    this.code = options?.code;
  }
}

/** Thrown when an operation is attempted on a platform Bunmaska does not support. */
export class UnsupportedPlatformError extends BunmaskaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, { ...options, code: 'ERR_UNSUPPORTED_PLATFORM' });
    this.name = 'UnsupportedPlatformError';
  }
}

/** Thrown when a native library or symbol cannot be loaded or resolved via FFI. */
export class FFIError extends BunmaskaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, { ...options, code: 'ERR_FFI' });
    this.name = 'FFIError';
  }
}

/** Thrown when a caller passes an argument that violates a documented contract. */
export class InvalidArgumentError extends BunmaskaError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, { ...options, code: 'ERR_INVALID_ARGUMENT' });
    this.name = 'InvalidArgumentError';
  }
}
