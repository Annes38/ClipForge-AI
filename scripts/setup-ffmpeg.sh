#!/usr/bin/env bash
# ClipForge-AI :: FFmpeg provisioning
#
# The audit established that this environment has NO system ffmpeg/ffprobe and
# that `apt` cannot be used. The verified replacement is the `imageio-ffmpeg`
# Python package, which ships a self-contained static FFmpeg binary.
#
# This script creates a local virtualenv and installs imageio-ffmpeg into it.
# It never touches system packages and never requires root.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv"

if [ ! -x "$VENV/bin/python" ]; then
  echo "==> Creating virtualenv at $VENV"
  python3 -m venv "$VENV"
fi

echo "==> Installing imageio-ffmpeg"
"$VENV/bin/pip" install --quiet --upgrade pip >/dev/null 2>&1 || true
"$VENV/bin/pip" install --quiet imageio-ffmpeg

echo "==> Resolving FFmpeg binary"
"$VENV/bin/python" - <<'PY'
import os
import imageio_ffmpeg

exe = imageio_ffmpeg.get_ffmpeg_exe()
if not os.path.exists(exe):
    raise SystemExit(f"imageio-ffmpeg reported a binary that does not exist: {exe}")
print(f"    binary : {exe}")
print(f"    size   : {os.path.getsize(exe)} bytes")
print(f"    version: {imageio_ffmpeg.get_ffmpeg_version()}")
PY

echo "==> FFmpeg is ready."
