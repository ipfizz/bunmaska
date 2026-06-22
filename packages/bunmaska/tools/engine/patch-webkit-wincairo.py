#!/usr/bin/env python3
"""Apply Bunmaska's WinCairo build patches to a WebKit checkout (idempotent).

The only patch we currently carry is a Windows command-line-length fix: WebKit's
`generate-serializers` custom command passes ~300 absolute `.serialization.in`
paths inline, which (run via a cmd `.bat` wrapper) overflows Windows' ~8191-char
command-line limit and aborts the build. We route those inputs through a response
file instead — `generate-serializers.py` reads `@file` natively once argparse is
told to, and CMake writes the file list at configure time.

This is the kind of build-only patch the engine-id's `bunmaska<rev>` field exists
for; it does not change the produced binary's behaviour. Usage:

    python patch-webkit-wincairo.py <path-to-webkit-checkout>

Re-running is safe: each edit is skipped if already present.
"""
import sys
from pathlib import Path


def patch_file(path: Path, old: str, new: str, marker: str) -> bool:
    text = path.read_text(encoding="utf-8")
    if marker in text:
        print(f"  already patched: {path.name}")
        return False
    if old not in text:
        raise SystemExit(f"FATAL: anchor not found in {path} (WebKit layout changed?)")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")
    print(f"  patched: {path.name}")
    return True


def main(webkit: Path) -> None:
    gen = webkit / "Source/WebKit/Scripts/generate-serializers.py"
    cml = webkit / "Source/WebKit/CMakeLists.txt"
    for p in (gen, cml):
        if not p.exists():
            raise SystemExit(f"FATAL: {p} not found — is this a WebKit checkout?")

    # 1) Let generate-serializers.py expand @response-files.
    patch_file(
        gen,
        "ArgumentParser(description='Generate serializers from input files')",
        "ArgumentParser(description='Generate serializers from input files',\n"
        "                                     fromfile_prefix_chars='@')",
        marker="fromfile_prefix_chars='@'",
    )

    # 2) Write the inputs to a response file and pass @rsp instead of the inline list.
    patch_file(
        cml,
        "    COMMAND ${PYTHON_EXECUTABLE} ${WEBKIT_DIR}/Scripts/generate-serializers.py "
        "${WebKit_GENERATED_SERIALIZERS_SUFFIX} --split-by-directory "
        "${WebKit_SERIALIZATION_DEPENDENCIES} --output-dir ${_serializers_stage_dir}",
        "    COMMAND ${PYTHON_EXECUTABLE} ${WEBKIT_DIR}/Scripts/generate-serializers.py "
        "${WebKit_GENERATED_SERIALIZERS_SUFFIX} --split-by-directory "
        "@${WebKit_DERIVED_SOURCES_DIR}/serializers-inputs.rsp --output-dir ${_serializers_stage_dir}",
        marker="serializers-inputs.rsp",
    )
    # Generate the response file at configure time (inserted just before the command).
    text = cml.read_text(encoding="utf-8")
    gen_line = (
        'file(GENERATE OUTPUT ${WebKit_DERIVED_SOURCES_DIR}/serializers-inputs.rsp'
        ' CONTENT "${_serializers_inputs_nl}\\n")'
    )
    if gen_line not in text:
        anchor = "add_custom_command(\n    OUTPUT\n        ${_serializers_absolute_outputs}"
        inject = (
            'string(REPLACE ";" "\\n" _serializers_inputs_nl "${WebKit_SERIALIZATION_DEPENDENCIES}")\n'
            + gen_line
            + "\n"
            + anchor
        )
        cml.write_text(text.replace(anchor, inject, 1), encoding="utf-8")
        print("  patched: CMakeLists.txt (response-file generation)")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("usage: patch-webkit-wincairo.py <path-to-webkit-checkout>")
    main(Path(sys.argv[1]))
