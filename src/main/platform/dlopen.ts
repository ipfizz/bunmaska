import { dlopen as bunDlopen, type FFIFunction, type Library, type Pointer } from 'bun:ffi';

/**
 * bun-types 1.4 widens a `FFIType.ptr` return to `Pointer | bigint | null`, but the runtime
 * returns a number (probed on Bun 1.4.2), so pointer returns narrow to `Pointer | null` here
 * instead of at every call site. `u64` returns stay `bigint`.
 */
type NarrowReturn<R> = [R] extends [bigint]
  ? R
  : [Pointer] extends [Extract<R, Pointer>]
    ? Exclude<R, bigint>
    : R;

type NarrowSymbols<S> = {
  [K in keyof S]: S[K] extends (...args: infer A) => infer R
    ? (...args: A) => NarrowReturn<R>
    : S[K];
};

export type NarrowLibrary<Fns extends Record<string, FFIFunction>> = Omit<
  Library<Fns>,
  'symbols'
> & {
  readonly symbols: NarrowSymbols<Library<Fns>['symbols']>;
};

export const dlopen = <Fns extends Record<string, FFIFunction>>(
  path: string,
  fns: Fns,
): NarrowLibrary<Fns> => bunDlopen(path, fns) as unknown as NarrowLibrary<Fns>;
