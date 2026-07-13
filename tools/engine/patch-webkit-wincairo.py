#!/usr/bin/env python3
"""Apply Bunmaska's WinCairo build patches to a WebKit checkout (idempotent).

The only patch we currently carry is a Windows command-line-length fix: WebKit's
`generate-serializers` custom command passes ~300 absolute `.serialization.in`
paths inline, which (run via a cmd `.bat` wrapper) overflows Windows' ~8191-char
command-line limit and aborts the build. We route those inputs through a response
file instead. The exact upstream shape varies by release train (2.52.x parses raw
sys.argv and passes the list bare; 2.53+ uses argparse and --split-by-directory),
so the Python patch is two-mode and the CMake patch is line-based: it rewrites
whatever `COMMAND ... generate-serializers.py ...` line carries the inline list.

This is the kind of build-only patch the engine-id's `bunmaska<rev>` field exists
for; it does not change the produced binary's behaviour. Usage:

    python patch-webkit-wincairo.py <path-to-webkit-checkout>

Re-running is safe: each edit is skipped if already present.
"""
import sys
from pathlib import Path

DEPS = "${WebKit_SERIALIZATION_DEPENDENCIES}"
RSP = "@${WebKit_DERIVED_SOURCES_DIR}/serializers-inputs.rsp"

EXPAND_SHIM = (
    "def _expand_response_files(argv):\n"
    "    out = []\n"
    "    for arg in argv:\n"
    "        if arg.startswith('@'):\n"
    "            with open(arg[1:]) as f:\n"
    "                out.extend(line.strip() for line in f if line.strip())\n"
    "        else:\n"
    "            out.append(arg)\n"
    "    return out\n"
    "\n\n"
    "if __name__ == '__main__':\n"
    "    sys.exit(main(_expand_response_files(sys.argv)))"
)


def patch_generator(gen: Path) -> None:
    """Teach generate-serializers.py to expand @response-files. 2.53+ has
    argparse (fromfile_prefix_chars does it); 2.52.x is raw sys.argv (wrap it)."""
    text = gen.read_text(encoding="utf-8")
    if "fromfile_prefix_chars" in text or "_expand_response_files" in text:
        print(f"  already patched: {gen.name}")
        return
    argparse_anchor = "ArgumentParser(description='Generate serializers from input files')"
    argv_anchor = "if __name__ == '__main__':\n    sys.exit(main(sys.argv))"
    if argparse_anchor in text:
        text = text.replace(
            argparse_anchor,
            "ArgumentParser(description='Generate serializers from input files',\n"
            "                                     fromfile_prefix_chars='@')",
            1,
        )
    elif argv_anchor in text:
        text = text.replace(argv_anchor, EXPAND_SHIM, 1)
    else:
        raise SystemExit(f"FATAL: anchor not found in {gen} (WebKit layout changed?)")
    gen.write_text(text, encoding="utf-8")
    print(f"  patched: {gen.name}")


def patch_cmake(cml: Path) -> None:
    """Swap the inline input list for @rsp on the generate-serializers COMMAND
    line (whatever its per-train flags are) and emit the response file at
    configure time, injected before the enclosing add_custom_command."""
    text = cml.read_text(encoding="utf-8")
    if "serializers-inputs.rsp" in text:
        print("  already patched: CMakeLists.txt")
        return
    lines = text.splitlines(keepends=True)
    cmd_i = next(
        (
            i
            for i, line in enumerate(lines)
            if "COMMAND" in line and "generate-serializers.py" in line and DEPS in line
        ),
        None,
    )
    if cmd_i is None:
        raise SystemExit(
            f"FATAL: generate-serializers COMMAND not found in {cml} (WebKit layout changed?)"
        )
    lines[cmd_i] = lines[cmd_i].replace(DEPS, RSP)
    block_i = next(
        (i for i in range(cmd_i, -1, -1) if lines[i].lstrip().startswith("add_custom_command(")),
        None,
    )
    if block_i is None:
        raise SystemExit(f"FATAL: enclosing add_custom_command not found in {cml}")
    inject = (
        'string(REPLACE ";" "\\n" _serializers_inputs_nl "' + DEPS + '")\n'
        "file(GENERATE OUTPUT ${WebKit_DERIVED_SOURCES_DIR}/serializers-inputs.rsp"
        ' CONTENT "${_serializers_inputs_nl}\\n")\n'
    )
    lines.insert(block_i, inject)
    cml.write_text("".join(lines), encoding="utf-8")
    print("  patched: CMakeLists.txt (@rsp command + response-file generation)")


def main(webkit: Path) -> None:
    gen = webkit / "Source/WebKit/Scripts/generate-serializers.py"
    cml = webkit / "Source/WebKit/CMakeLists.txt"
    for p in (gen, cml):
        if not p.exists():
            raise SystemExit(f"FATAL: {p} not found — is this a WebKit checkout?")
    patch_generator(gen)
    patch_cmake(cml)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-webkit-wincairo.py <path-to-webkit-checkout>")
    main(Path(sys.argv[1]))
