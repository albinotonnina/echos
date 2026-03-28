#!/usr/bin/env bash
set -euo pipefail

# ─────────────────────────────────────────────────────────────
# EchOS local dev launcher
#
# Detects git worktrees, lets you pick one (or stay on main),
# then starts the daemon or CLI sharing the main repo's data/
# and .env so every worktree uses the same knowledge base.
#
# Usage:
#   ./scripts/dev.sh          # picker → daemon
#   ./scripts/dev.sh cli      # picker → interactive CLI
#   pnpm dev:local            # same, via npm script
#   pnpm cli:local            # same for CLI
# ─────────────────────────────────────────────────────────────

MODE="${1:-daemon}"
shift 2>/dev/null || true

# Resolve the main repo root (where .git is a directory, not a file).
# Works whether invoked from main or from inside a worktree.
find_main_repo() {
  local dir
  dir="$(git rev-parse --show-toplevel 2>/dev/null)" || {
    echo "Error: not inside a git repository." >&2
    exit 1
  }

  # In a worktree, .git is a file pointing to the main repo's .git/worktrees/<name>.
  # Follow it back to the main repo root.
  if [ -f "$dir/.git" ]; then
    local gitdir
    gitdir="$(sed 's/^gitdir: //' "$dir/.git")"
    # gitdir is like /path/to/main/.git/worktrees/<name>
    # Go up 3 levels: <name> → worktrees → .git → repo root
    dir="$(cd "$dir" && cd "$gitdir/../../.." && pwd)"
  fi

  echo "$dir"
}

MAIN_REPO="$(find_main_repo)"
DATA_DIR="$MAIN_REPO/data"
ENV_FILE="$MAIN_REPO/.env"

# ── Sanity checks ────────────────────────────────────────────

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env not found at $ENV_FILE"
  echo "Run 'pnpm wizard' from the main repo to create it."
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "Warning: data directory not found at $DATA_DIR"
  echo "It will be created on first run."
fi

# ── Collect worktrees ────────────────────────────────────────

declare -a paths=()
declare -a branches=()

while IFS= read -r line; do
  wt_path="$(echo "$line" | awk '{print $1}')"
  wt_branch="$(echo "$line" | sed 's/.*\[\(.*\)\].*/\1/')"
  paths+=("$wt_path")
  branches+=("$wt_branch")
done < <(git -C "$MAIN_REPO" worktree list)

count="${#paths[@]}"

# ── If only main exists, skip the picker ─────────────────────

if [ "$count" -eq 1 ]; then
  echo "No worktrees found — running from main."
  echo ""
  target="$MAIN_REPO"
  branch="${branches[0]}"
else
  # ── Interactive picker ───────────────────────────────────────

  echo "EchOS worktrees:"
  echo ""
  for i in $(seq 0 $((count - 1))); do
    num=$((i + 1))
    label="${branches[$i]}"
    if [ "${paths[$i]}" = "$MAIN_REPO" ]; then
      label="$label (main)"
    fi
    echo "  $num) $label"
    echo "     ${paths[$i]}"
  done
  echo ""

  read -rp "Pick a worktree [1-$count]: " choice

  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "$count" ]; then
    echo "Invalid choice."
    exit 1
  fi

  idx=$((choice - 1))
  target="${paths[$idx]}"
  branch="${branches[$idx]}"
fi

# ── Setup environment ────────────────────────────────────────

echo ""
echo "  Branch: $branch"
echo "  Path:   $target"
echo "  Data:   $DATA_DIR"
echo "  Env:    $ENV_FILE"
echo "  Mode:   $MODE"
echo ""

cd "$target"

# Ensure deps are installed (fast no-op if already current).
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
  echo ""
fi

# Load .env into the environment so all child processes see the vars.
set -a
# shellcheck source=/dev/null
source "$ENV_FILE"
set +a

# Point storage paths at the main repo's data directory.
# The .env may contain relative paths (e.g. ./data/db) which would resolve
# against the worktree cwd. Override them with absolute paths.
export ECHOS_HOME="$DATA_DIR"
export KNOWLEDGE_DIR="$DATA_DIR/knowledge"
export DB_PATH="$DATA_DIR/db"
export SESSION_DIR="$DATA_DIR/sessions"

# ── Launch ───────────────────────────────────────────────────

case "$MODE" in
  cli)
    echo "Starting EchOS CLI..."
    echo ""
    exec tsx packages/cli/src/index.ts "$@"
    ;;
  *)
    echo "Starting EchOS daemon..."
    echo ""
    exec tsx src/index.ts
    ;;
esac
