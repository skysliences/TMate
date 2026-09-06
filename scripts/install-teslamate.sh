#!/usr/bin/env bash
set -euo pipefail
TMATE_SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null 2>&1 || { printf '%s\n' '请先安装 Python 3.9+，此脚本不自动修改系统软件。' >&2; exit 1; }
exec python3 "$TMATE_SCRIPT_DIR/install-teslamate.py" "$@"
