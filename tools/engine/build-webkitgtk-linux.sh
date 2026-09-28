#!/usr/bin/env bash
# Relocates the system WebKitGTK + GTK closure into <out-dir>/<engine-id>/{lib,libexec,engine.json},
# libs finding each other via $ORIGIN. Usage: build-webkitgtk-linux.sh <out-dir> <engine-id>
# ponytail: apt-relocated, so matching/newer glibc only; cross-distro needs an old-glibc build
set -euo pipefail

OUT_DIR="${1:?usage: build-webkitgtk-linux.sh <out-dir> <engine-id>}"
ENGINE_ID="${2:?usage: build-webkitgtk-linux.sh <out-dir> <engine-id>}"
SONAME="libwebkitgtk-6.0.so.4"
GTK_SONAME="libgtk-4.so.1"

ENGINE_DIR="${OUT_DIR}/${ENGINE_ID}"
LIB_DIR="${ENGINE_DIR}/lib"
LIBEXEC_DIR="${ENGINE_DIR}/libexec"

log() { printf '  • %s\n' "$*"; }

command -v patchelf >/dev/null || { echo "patchelf is required (apt install patchelf)"; exit 1; }

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

# Libraries that must stay the host's. Everything else in the closure is bundled.
is_kept() {
  case "$1" in
    # glibc/loader: bundling them causes loader/symbol conflicts.
    ld-linux*|libc.so.*|libm.so.*|libpthread.so.*|libdl.so.*|librt.so.*|libresolv.so.*|libgcc_s.so.*) return 0 ;;
    # Driver- and display-coupled (the AppImage excludelist): the host's GPU driver
    # loads against these by soname, so an older bundled copy breaks EGL/GL init
    # ("GLIBCXX_x not found" from a newer Mesa against a bundled libstdc++).
    libGL.so.*|libGLX*.so.*|libEGL*.so.*|libGLdispatch.so.*|libOpenGL.so.*|libglapi.so.*) return 0 ;;
    libgbm.so.*|libdrm*.so.*|libX11*.so.*|libxcb*.so.*|libasound.so.*) return 0 ;;
    libfontconfig.so.*|libfreetype.so.*|libstdc++.so.*) return 0 ;;
    *) return 1 ;;
  esac
}

# ldd is transitive: this is the full closure.
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
# The two roots first, under their sonames.
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

# WebKit spawns these helpers; nothing renders without them.
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
