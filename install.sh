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

ECHOS_INSTALL_DIR="${ECHOS_INSTALL_DIR:-$PWD/echos}"
ECHOS_BRANCH="${ECHOS_BRANCH:-main}"
ECHOS_REPO="${ECHOS_REPO:-https://github.com/albinotonnina/echos.git}"
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
    install_node
    return
  fi
  NODE_VER="$(node --version | sed 's/v//')"
  NODE_MAJOR="${NODE_VER%%.*}"
  if [ "$NODE_MAJOR" -lt 20 ]; then
    warn "Node.js $NODE_VER is too old (requires 20+) — installing newer version..."
    install_node
    return
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

install_node() {
  info "Node.js not found — installing via fnm..."
  if ! command -v curl >/dev/null 2>&1; then
    fatal "curl is required to install Node.js. Install curl and re-run."
  fi
  curl -fsSL https://fnm.vercel.app/install | bash
  # Source fnm into current shell
  export PATH="$HOME/.local/share/fnm:$HOME/.fnm:$PATH"
  eval "$(fnm env)" 2>/dev/null || true
  fnm install 20 || fatal "Failed to install Node.js 20 via fnm"
  fnm use 20
  success "Node.js $(node --version) installed via fnm"
}

ensure_redis() {
  if command -v redis-server >/dev/null 2>&1; then
    REDIS_VER="$(redis-server --version | grep -oE 'v=[0-9.]+' | sed 's/v=//' || echo '?')"
    success "Redis $REDIS_VER"
    start_redis
    return
  fi

  info "Redis not found — installing (needed for background scheduler)..."

  if [ "$PLATFORM" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew install redis 2>/dev/null && success "Redis installed via Homebrew" || {
        warn "Failed to install Redis via Homebrew — scheduler won't work without it"
        warn "Install manually: brew install redis"
        return
      }
    else
      warn "Homebrew not found — cannot auto-install Redis"
      warn "Install manually: https://redis.io/docs/getting-started/"
      return
    fi
  elif [ "$PLATFORM" = "linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      info "Installing redis-server via apt (may ask for sudo password)..."
      sudo apt-get update -qq && sudo apt-get install -y -qq redis-server 2>/dev/null && {
        success "Redis installed via apt"
      } || {
        warn "Failed to install Redis via apt — scheduler won't work without it"
        warn "Install manually: sudo apt install redis-server"
        return
      }
    elif command -v dnf >/dev/null 2>&1; then
      info "Installing redis via dnf (may ask for sudo password)..."
      sudo dnf install -y redis 2>/dev/null && {
        success "Redis installed via dnf"
      } || {
        warn "Failed to install Redis via dnf"
        return
      }
    else
      warn "Could not detect package manager (apt/dnf) — cannot auto-install Redis"
      warn "Install manually: https://redis.io/docs/getting-started/"
      return
    fi
  fi

  start_redis
}

start_redis() {
  # Check if Redis is already running
  if redis-cli ping >/dev/null 2>&1; then
    success "Redis is running"
    return
  fi

  info "Starting Redis..."

  if [ "$PLATFORM" = "macos" ]; then
    if command -v brew >/dev/null 2>&1; then
      brew services start redis >/dev/null 2>&1 && success "Redis started via Homebrew services" || {
        warn "Could not start Redis — start manually: brew services start redis"
      }
    fi
  elif [ "$PLATFORM" = "linux" ]; then
    if command -v systemctl >/dev/null 2>&1; then
      sudo systemctl enable --now redis-server >/dev/null 2>&1 \
        || sudo systemctl enable --now redis >/dev/null 2>&1 \
        || warn "Could not start Redis — start manually: sudo systemctl start redis-server"
      if redis-cli ping >/dev/null 2>&1; then
        success "Redis started via systemd"
      fi
    fi
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

build_project() {
  info "Building EchOS..."
  pnpm --dir "$ECHOS_INSTALL_DIR" build
  success "Build complete"
}

# ─── TTY detection and wizard launch ─────────────────────────────────────────

launch_wizard() {
  if [ "$NON_INTERACTIVE" = "1" ]; then
    echo ""
    echo -e "  ${BOLD}Non-interactive mode:${RESET} Set env vars then run:"
    echo -e "    ${CYAN}cd $ECHOS_INSTALL_DIR && pnpm wizard --non-interactive${RESET}"
    return
  fi

  # Check if we have a real TTY (i.e., not piped without terminal)
  if [ -t 0 ]; then
    info "Launching setup wizard..."
    echo ""
    # cd is intentional here to ensure wizard runs from project root
    cd "$ECHOS_INSTALL_DIR" && exec pnpm wizard
  else
    # Piped without TTY (e.g. curl | bash without a terminal)
    echo ""
    echo -e "  ${YELLOW}No TTY detected${RESET} (running in a pipe)"
    echo ""
    echo -e "  To complete setup, run:"
    echo -e "    ${CYAN}cd $ECHOS_INSTALL_DIR${RESET}"
    echo -e "    ${CYAN}pnpm wizard${RESET}        # configure API keys + interfaces"
    echo -e "    ${CYAN}pnpm build${RESET}         # compile workspace packages"
    echo -e "    ${CYAN}pnpm start${RESET}         # launch EchOS"
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
  ensure_redis
  echo ""

  echo -e "  ${BOLD}Setting up EchOS…${RESET}"
  clone_or_update
  install_deps
  build_project
  echo ""

  echo -e "  ${GREEN}${BOLD}Installation complete!${RESET}"
  launch_wizard
}

main "$@"
