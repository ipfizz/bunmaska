/**
 * Encode a JS string as a null-terminated UTF-8 buffer for a C `const char *`.
 * Bun's `FFIType.cstring` does not add the trailing null itself — the caller must.
 */
export const cstr = (input: string): Uint8Array => new TextEncoder().encode(`${input}\0`);
