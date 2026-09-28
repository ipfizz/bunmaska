/** UTF-8 for a C `const char *`, NUL-terminated here because `FFIType.cstring` does not. */
export const cstr = (input: string): Uint8Array => new TextEncoder().encode(`${input}\0`);
