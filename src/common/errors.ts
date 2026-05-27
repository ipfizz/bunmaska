/**
 * Base class for all errors thrown by Sambar.
 *
 * Consumers can use `instanceof SambarError` to distinguish errors originating
 * in Sambar from errors thrown by user code or third-party libraries.
 *
 * Subclasses should set a more specific `name` in their constructor.
 */
export class SambarError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'SambarError';
  }
}
