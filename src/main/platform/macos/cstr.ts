/**
 * Encode a JS string as a null-terminated UTF-8 byte sequence suitable for
 * passing to a C function expecting `const char *`.
 *
 * Bun's `FFIType.cstring` does not add the trailing null itself — the caller
 * must include it. This helper handles that consistently across the codebase.
 */
export const cstr = (input: string): Uint8Array => new TextEncoder().encode(`${input}\0`);
