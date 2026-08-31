#!/bin/sh
# Run the exact CI Linux leg locally in a container, so blind-platform FFI code
# (GTK/WebKitGTK) is proven BEFORE a push instead of by a red CI run. Mirrors
# validate.yml's ubuntu job: same deps, same xvfb-run, same validate script.
#
# The repo mounts READ-ONLY and is copied inside the container: a shared
# writable mount let the container's `bun install` write Linux binaries into
# the host's node_modules and race the host validate (it happened).
set -e
exec docker run --rm -t \
  -v "$(pwd)":/repo:ro \
  -e HOME=/tmp \
  ubuntu:24.04 bash -c '
    set -e
    apt-get update -q
    apt-get install -y -q curl unzip libgtk-4-1 libwebkitgtk-6.0-4 libnotify4 libsecret-1-0 xvfb ca-certificates > /dev/null
    curl -fsSL https://bun.sh/install | bash > /dev/null
    export PATH="/tmp/.bun/bin:$PATH"
    mkdir /work
    tar -C /repo --exclude node_modules --exclude .git --exclude website/node_modules --exclude website/dist -cf - . | tar -C /work -xf -
    cd /work
    bun install --frozen-lockfile
    xvfb-run -a bun run validate
  '
