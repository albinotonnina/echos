#!/usr/bin/env bash
# EchOS self-updater
#
# Usage:
#   pnpm update-echos
#
# What it does:
#   1. Checks for uncommitted changes (warns, doesn't block)
#   2. git pull --ff-only
#   3. pnpm install (picks up any new/changed deps)
#   4. pnpm build
#   5. Reports what changed

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "  ${CYAN}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $*"; }
fatal()   { echo -e "  ${RED}✗${RESET} $*" >&2; exit 1; }

echo ""
echo -e "  ${BOLD}${CYAN}EchOS Updater${RESET}"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────

if [ ! -f "package.json" ] || ! grep -q '"name": "echos"' package.json 2>/dev/null; then
  fatal "Run this from the echos project root."
fi

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  fatal "Not a git repository."
fi

# ── Warn about local changes ──────────────────────────────────────────────────

if ! git diff --quiet || ! git diff --cached --quiet; then
  warn "You have uncommitted local changes."
  warn "They will be preserved (update uses --ff-only, not reset)."
  echo ""
fi

# ── Record current version ────────────────────────────────────────────────────

BEFORE=$(git rev-parse --short HEAD)
BRANCH=$(git rev-parse --abbrev-ref HEAD)

info "Current: ${BEFORE} on ${BRANCH}"
info "Fetching latest from origin…"

# ── Pull ──────────────────────────────────────────────────────────────────────

if ! git pull --ff-only origin "$BRANCH" 2>&1; then
  echo ""
  warn "Fast-forward pull failed — your branch has diverged from origin."
  warn "To reset to origin: git reset --hard origin/${BRANCH}"
  fatal "Update aborted. No changes made."
fi

AFTER=$(git rev-parse --short HEAD)

if [ "$BEFORE" = "$AFTER" ]; then
  success "Already up to date (${AFTER})"
  echo ""
  exit 0
fi

echo ""
info "Updated ${BEFORE} → ${AFTER}"

# ── Show what changed ─────────────────────────────────────────────────────────

CHANGED_FILES=$(git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null | wc -l | tr -d ' ')
echo ""
echo -e "  ${BOLD}Changed files (${CHANGED_FILES}):${RESET}"
git diff --name-only "$BEFORE" "$AFTER" 2>/dev/null | sed 's/^/    /'
echo ""

# ── Install deps if lockfile changed ──────────────────────────────────────────

if git diff --name-only "$BEFORE" "$AFTER" | grep -q "pnpm-lock.yaml"; then
  info "Lockfile changed — installing dependencies…"
  pnpm install --frozen-lockfile
  success "Dependencies updated"
else
  info "No lockfile changes — skipping install"
fi

# ── Build ─────────────────────────────────────────────────────────────────────

echo ""
info "Building…"
pnpm build
echo ""
success "Build complete"

# ── Config schema changes warning ─────────────────────────────────────────────

if git diff --name-only "$BEFORE" "$AFTER" | grep -q "packages/shared/src/config"; then
  echo ""
  warn "Config schema changed — run ${CYAN}pnpm wizard${RESET} to check your .env is up to date."
fi

# ── Done ──────────────────────────────────────────────────────────────────────

echo ""
echo -e "  ${GREEN}${BOLD}Update complete!${RESET} Restart EchOS to apply: ${CYAN}pnpm start${RESET}"
echo ""
