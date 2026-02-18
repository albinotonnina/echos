#!/usr/bin/env bash
# EchOS installer — works on macOS and Linux (Ubuntu/Debian)
#
# Usage (VPS one-liner):
#   curl -sSL https://raw.githubusercontent.com/albinotonnina/echos/main/install.sh | bash
#
# Environment overrides:
#   ECHOS_INSTALL_DIR   — where to clone (default: ~/echos)
#   ECHOS_BRANCH        — git branch to checkout (default: main)
#   ECHOS_NON_INTERACTIVE=1 — skip wizard, print instructions instead

set -euo pipefail

# ─── Config ──────────────────────────────────────────────────────────────────

ECHOS_INSTALL_DIR="${ECHOS_INSTALL_DIR:-$HOME/echos}"
ECHOS_BRANCH="${ECHOS_BRANCH:-main}"
ECHOS_REPO="${ECHOS_REPO:-https://github.com/USER/echos.git}"
NON_INTERACTIVE="${ECHOS_NON_INTERACTIVE:-0}"

# ─── Helpers ─────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

info()    { echo -e "  ${CYAN}→${RESET} $*"; }
success() { echo -e "  ${GREEN}✓${RESET} $*"; }
warn()    { echo -e "  ${YELLOW}⚠${RESET} $*"; }
error()   { echo -e "  ${RED}✗${RESET} $*" >&2; }
fatal()   { error "$*"; exit 1; }

# ─── Platform detection ──────────────────────────────────────────────────────

detect_platform() {
  OS="$(uname -s)"
  ARCH="$(uname -m)"
  case "$OS" in
    Darwin) PLATFORM="macos" ;;
    Linux)  PLATFORM="linux" ;;
    *)      fatal "Unsupported OS: $OS" ;;
  esac
}

# ─── Prerequisite checks ─────────────────────────────────────────────────────

check_node() {
  if ! command -v node >/dev/null 2>&1; then
    fatal "Node.js not found. Install Node.js 20+ from https://nodejs.org/"
  fi
  NODE_VER="$(node --version | sed 's/v//')"
  NODE_MAJOR="${NODE_VER%%.*}"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    fatal "Node.js $NODE_VER is too old. Requires Node.js 20+."
  fi
  success "Node.js $NODE_VER"
}

check_git() {
  if ! command -v git >/dev/null 2>&1; then
    fatal "git not found. Install git and re-run."
  fi
  success "git $(git --version | awk '{print $3}')"
}

check_pnpm() {
  if ! command -v pnpm >/dev/null 2>&1; then
    info "pnpm not found — installing via npm..."
    npm install -g pnpm || fatal "Failed to install pnpm"
  fi
  PNPM_VER="$(pnpm --version)"
  PNPM_MAJOR="${PNPM_VER%%.*}"
  if [ "$PNPM_MAJOR" -lt 9 ]; then
    info "Updating pnpm to latest..."
    npm install -g pnpm || fatal "Failed to update pnpm"
  fi
  success "pnpm $(pnpm --version)"
}

check_python_soft() {
  if ! python3 -c "from youtube_transcript_api import YouTubeTranscriptApi" >/dev/null 2>&1; then
    warn "youtube-transcript-api not found — YouTube plugin will fail"
    warn "Fix later: pip3 install youtube-transcript-api"
  else
    success "youtube-transcript-api available"
  fi
}

# ─── Clone / update ──────────────────────────────────────────────────────────

clone_or_update() {
  if [ -d "$ECHOS_INSTALL_DIR/.git" ]; then
    info "EchOS already cloned at $ECHOS_INSTALL_DIR — pulling latest..."
    git -C "$ECHOS_INSTALL_DIR" fetch origin
    git -C "$ECHOS_INSTALL_DIR" checkout "$ECHOS_BRANCH"
    git -C "$ECHOS_INSTALL_DIR" pull --ff-only origin "$ECHOS_BRANCH"
    success "Updated to latest $ECHOS_BRANCH"
  else
    info "Cloning EchOS to $ECHOS_INSTALL_DIR..."
    git clone --branch "$ECHOS_BRANCH" "$ECHOS_REPO" "$ECHOS_INSTALL_DIR"
    success "Cloned"
  fi
}

# ─── Install dependencies ────────────────────────────────────────────────────

install_deps() {
  info "Installing dependencies (this may take a few minutes)..."
  pnpm --dir "$ECHOS_INSTALL_DIR" install --frozen-lockfile
  success "Dependencies installed"
}

# ─── TTY detection and wizard launch ─────────────────────────────────────────

launch_wizard() {
  if [ "$NON_INTERACTIVE" = "1" ]; then
    echo ""
    echo -e "  ${BOLD}Non-interactive mode:${RESET} Set env vars then run:"
    echo -e "    ${CYAN}cd $ECHOS_INSTALL_DIR && pnpm setup --non-interactive${RESET}"
    return
  fi

  # Check if we have a real TTY (i.e., not piped without terminal)
  if [ -t 0 ]; then
    info "Launching setup wizard..."
    echo ""
    # cd is intentional here to ensure wizard runs from project root
    cd "$ECHOS_INSTALL_DIR" && exec pnpm setup
  else
    # Piped without TTY (e.g. curl | bash without a terminal)
    echo ""
    echo -e "  ${YELLOW}No TTY detected${RESET} (running in a pipe)"
    echo ""
    echo -e "  To complete setup, run:"
    echo -e "    ${CYAN}cd $ECHOS_INSTALL_DIR && pnpm setup${RESET}"
    echo ""
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo -e "  ${BOLD}${CYAN}EchOS Installer${RESET}"
  echo ""

  detect_platform

  echo -e "  ${BOLD}Checking prerequisites…${RESET}"
  check_git
  check_node
  check_pnpm
  check_python_soft
  echo ""

  echo -e "  ${BOLD}Setting up EchOS…${RESET}"
  clone_or_update
  install_deps
  echo ""

  echo -e "  ${GREEN}${BOLD}Installation complete!${RESET}"
  launch_wizard
}

main "$@"
