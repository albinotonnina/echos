---
name: create-branch
description: 'Prepare a new branch for a change. Ensures main is up to date, then creates a properly prefixed branch (feature/, chore/, fix/). The user handles commit message and push.'
---

# Create Branch for Change

Switches to `main`, pulls latest, then creates a new branch with the correct conventional prefix. The user then commits their changes and pushes.

## When to Use This Skill

- User says "create a branch" or "set up a branch for this change"
- User says "prepare a PR" or "I want to open a PR"
- User asks to "branch off main" before committing work

## Branch Prefix Reference

| Prefix | Use for |
|--------|---------|
| `feature/` | New functionality |
| `fix/` | Bug fixes |
| `chore/` | Maintenance, deps, config, tooling |
| `docs/` | Documentation only |
| `refactor/` | Code restructuring, no behaviour change |

## Steps

### Step 1: Check for uncommitted changes

```bash
git status --short
```

If there are uncommitted changes, note them — the user may want to stash or they may be the changes for this branch. Ask if unsure.

### Step 2: Switch to main and pull

```bash
git checkout main
git pull origin main
```

If this fails (merge conflicts, etc.), stop and report the error.

### Step 3: Determine the branch name

Based on the work described, choose the correct prefix and derive a short kebab-case name.

- Ask the user to confirm if the nature of the change is ambiguous.
- Keep the slug short (3–5 words max), e.g. `feature/telegram-voice-replies`, `fix/corepack-brew-install`, `chore/bump-pnpm`.

### Step 4: Create and switch to the branch

```bash
git checkout -b <prefix>/<slug>
```

### Step 5: Restore any stashed changes (if applicable)

If changes were stashed in Step 1, restore them now:

```bash
git stash pop
```

### Step 6: Confirm and hand off

Report:
- The branch name created
- That the user should now commit their changes and run `git push origin <branch>` when ready
- Remind them you can create the PR once they've pushed
