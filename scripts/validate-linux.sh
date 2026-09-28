#!/bin/sh
# Run validate.yml's Linux leg in a container (same deps, Bun version, WebKit env
# and xvfb-run), so GTK/WebKitGTK FFI code is proven before a push, not by red CI.
#
# The repo mounts READ-ONLY and is copied inside the container: a shared
# writable mount let the container's `bun install` write Linux binaries into
# the host's node_modules and race the host validate (it happened).
set -e
exec docker run --rm -t \
  -v "$(pwd)":/repo:ro \
  -e HOME=/tmp \
  -e WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS=1 \
  -e WEBKIT_DISABLE_COMPOSITING_MODE=1 \
  -e LIBGL_ALWAYS_SOFTWARE=1 \
  -e GDK_BACKEND=x11 \
  ubuntu:24.04 bash -c '
    set -e
    apt-get update -q
    apt-get install -y -q curl unzip libgtk-4-1 libwebkitgtk-6.0-4 libnotify4 libsecret-1-0 xvfb ca-certificates > /dev/null
    curl -fsSL https://bun.sh/install | bash -s "bun-v$(cat /repo/.bun-version)" > /dev/null
    export PATH="/tmp/.bun/bin:$PATH"
    mkdir /work
    tar -C /repo --exclude node_modules --exclude .git --exclude website/node_modules --exclude website/dist -cf - . | tar -C /work -xf -
    cd /work
    bun install --frozen-lockfile
    xvfb-run -a bun run validate
  '
