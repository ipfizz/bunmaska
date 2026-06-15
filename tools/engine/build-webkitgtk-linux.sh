#!/usr/bin/env bash
#
# Build a RELOCATABLE WebKitGTK 6.0 engine directory for the Bunmaska engine
# store. It relocates the system WebKitGTK + GTK + their shared-object closure
# into a self-contained tree whose libraries find each other via `$ORIGIN`, so
# the engine can be `dlopen`ed from `~/.bunmaska/webkit/<id>/` independent of the
# distro's own WebKitGTK.
#
# This is the apt-relocate path (proves the mechanism + produces a usable engine
# on a matching/newer glibc). A truly cross-distro build compiles on an old-glibc
# base; that is a later refinement — the structure here is the same.
#
# Usage: build-webkitgtk-linux.sh <out-dir> <engine-id>
# Produces: <out-dir>/<engine-id>/{lib/,libexec/,engine.json}
#
set -euo pipefail

OUT_DIR="${1:?usage: build-webkitgtk-linux.sh <out-dir> <engine-id>}"
ENGINE_ID="${2:?usage: build-webkitgtk-linux.sh <out-dir> <engine-id>}"
SONAME="libwebkitgtk-6.0.so.4"
GTK_SONAME="libgtk-4.so.1"

ENGINE_DIR="${OUT_DIR}/${ENGINE_ID}"
LIB_DIR="${ENGINE_DIR}/lib"
LIBEXEC_DIR="${ENGINE_DIR}/libexec"

# Core glibc/loader libraries that must stay the system's — bundling them causes
# loader/symbol conflicts. Everything else in the closure gets bundled.
KEEP_SYSTEM="ld-linux-x86-64.so.2 ld-linux-aarch64.so.1 libc.so.6 libm.so.6 libpthread.so.0 libdl.so.2 librt.so.1 libresolv.so.2 libgcc_s.so.1"

log() { printf '  • %s\n' "$*"; }

command -v patchelf >/dev/null || { echo "patchelf is required (apt install patchelf)"; exit 1; }

# Resolve a soname to its absolute path via ldconfig.
resolve_soname() {
  ldconfig -p | grep -F "$1" | head -1 | sed -E 's/.*=>\s*//'
}

WEBKIT_PATH="$(resolve_soname "$SONAME")"
GTK_PATH="$(resolve_soname "$GTK_SONAME")"
[ -n "$WEBKIT_PATH" ] || { echo "system $SONAME not found"; exit 1; }
[ -n "$GTK_PATH" ] || { echo "system $GTK_SONAME not found"; exit 1; }
log "WebKitGTK: $WEBKIT_PATH"
log "GTK:       $GTK_PATH"

mkdir -p "$LIB_DIR" "$LIBEXEC_DIR"

is_kept() { case " $KEEP_SYSTEM " in *" $1 "*) return 0;; *) return 1;; esac; }

# Collect the full transitive .so closure of both roots (ldd is transitive).
collect_closure() {
  ldd "$1" 2>/dev/null | awk '{ for (i=1;i<=NF;i++) if ($i ~ /^\//) print $i }'
}

copy_lib() {
  local src="$1" name
  name="$(basename "$src")"
  is_kept "$name" && return 0
  [ -f "$LIB_DIR/$name" ] && return 0
  cp -L "$src" "$LIB_DIR/$name"
  chmod u+w "$LIB_DIR/$name"
}

log "Bundling the shared-object closure…"
# Copy the two roots first (preserve their sonames), then the closure.
cp -L "$WEBKIT_PATH" "$LIB_DIR/$SONAME"; chmod u+w "$LIB_DIR/$SONAME"
cp -L "$GTK_PATH" "$LIB_DIR/$GTK_SONAME"; chmod u+w "$LIB_DIR/$GTK_SONAME"
{ collect_closure "$WEBKIT_PATH"; collect_closure "$GTK_PATH"; } | sort -u | while IFS= read -r so; do
  [ -f "$so" ] && copy_lib "$so"
done

COUNT="$(find "$LIB_DIR" -name '*.so*' | wc -l | tr -d ' ')"
log "Bundled ${COUNT} libraries"

log "Rewriting RPATHs to \$ORIGIN…"
find "$LIB_DIR" -name '*.so*' -type f | while IFS= read -r so; do
  patchelf --set-rpath '$ORIGIN' "$so" 2>/dev/null || true
done

# WebKit spawns helper processes; copy them best-effort so render works later.
log "Copying WebKit helper processes (best-effort)…"
HELPER_SRC="$(dirname "$WEBKIT_PATH")/webkitgtk-6.0"
for helper in WebKitNetworkProcess WebKitWebProcess WebKitGPUProcess; do
  if [ -f "$HELPER_SRC/$helper" ]; then
    cp -L "$HELPER_SRC/$helper" "$LIBEXEC_DIR/$helper"
    chmod u+w "$LIBEXEC_DIR/$helper"
    patchelf --set-rpath '$ORIGIN/../lib' "$LIBEXEC_DIR/$helper" 2>/dev/null || true
    log "  + $helper"
  else
    log "  ! $helper not found at $HELPER_SRC (render may need it)"
  fi
done

cat > "${ENGINE_DIR}/engine.json" <<JSON
{
  "id": "${ENGINE_ID}",
  "soname": "${SONAME}",
  "note": "relocatable WebKitGTK 6.0, apt-relocated; libs find each other via \$ORIGIN"
}
JSON

log "Engine built at ${ENGINE_DIR} (${COUNT} libs)"
