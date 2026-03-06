#!/usr/bin/env bash
# E2E assertions for install.sh
#
# Expects install.sh to have already run with:
#   ECHOS_INSTALL_DIR=/tmp/echos-test
#   ECHOS_NON_INTERACTIVE=1
#
# Usage in CI (from repo root):
#   ECHOS_INSTALL_DIR=/tmp/echos-test ECHOS_NON_INTERACTIVE=1 bash install.sh
#   bash tests/e2e/setup/test-install.sh

set -euo pipefail

INSTALL_DIR="${ECHOS_INSTALL_DIR:-/tmp/echos-test}"
PASS=0
FAIL=0

check() {
  local desc="$1"
  local result="$2"
  if [ "$result" = "true" ]; then
    echo "  ✓ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ✗ FAIL: $desc"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "  E2E: install.sh assertions"
echo "  Install dir: $INSTALL_DIR"
echo ""

# Repo was cloned / exists
[ -d "$INSTALL_DIR/.git" ] && check "repo directory exists with .git" "true" || check "repo directory exists with .git" "false"

# Dependencies installed
[ -d "$INSTALL_DIR/node_modules" ] && check "node_modules installed" "true" || check "node_modules installed" "false"

# Build output
[ -d "$INSTALL_DIR/packages/core/dist" ] && check "packages/core/dist built" "true" || check "packages/core/dist built" "false"
[ -d "$INSTALL_DIR/packages/shared/dist" ] && check "packages/shared/dist built" "true" || check "packages/shared/dist built" "false"

# pnpm workspace bins available (echos CLI)
if [ -f "$INSTALL_DIR/node_modules/.bin/tsx" ] || \
   [ -f "$INSTALL_DIR/node_modules/.pnpm/.bin/tsx" ] || \
   command -v tsx >/dev/null 2>&1; then
  check "tsx executable available" "true"
else
  check "tsx executable available" "false"
fi

echo ""
if [ "$FAIL" -gt 0 ]; then
  echo "  RESULT: $PASS passed, $FAIL failed"
  exit 1
else
  echo "  RESULT: $PASS passed — all checks OK"
fi
