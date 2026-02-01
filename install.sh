#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME="nl-terminal-cli"

if command -v npm >/dev/null 2>&1; then
  npm install -g "${PACKAGE_NAME}"
  exit 0
fi

if command -v bun >/dev/null 2>&1; then
  bun add -g "${PACKAGE_NAME}"
  exit 0
fi

cat <<'EOF'
No supported package manager found.

Install Node.js (npm) or Bun, then rerun this script:
  https://nodejs.org/
  https://bun.sh/
EOF
exit 1
