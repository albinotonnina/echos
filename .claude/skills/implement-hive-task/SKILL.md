---
name: implement-hive-task
description: >
  Implements a project task from docs/IMPLEMENTATION.md when the user says
  "implement task X.XX" (e.g. "implement task 1.11", "implement task 2.02").
  Reads the task spec, sets up a git worktree on the correct branch, then
  implements the task end-to-end following project conventions.
  Use this skill whenever the user says "implement task", "do task", "work on task",
  or references a task ID like "1.07", "2.03", etc. in this project.
---

# Implement Task

When the user asks to implement a task (e.g. "implement task 1.11"), execute
the following steps in order. Do not skip steps.

## Step 1: Parse the task ID

Extract the task ID from the user's message (e.g. `1.11`, `2.02`, `3.01`).

## Step 2: Rename the Claude Code instance

Set the terminal title so the user can identify which instance is working on which
task — especially useful when running multiple Claude Code sessions in parallel:

```bash
printf '\e]2;Task <task-id> — <short-slug>\a'
```

For example, for task 1.11 about the persona module: `Task 1.11 — persona-module`

Derive the slug from the task title (same slug used later for the branch name).

## Step 3: Read the task spec

Read `docs/IMPLEMENTATION.md` and find the section for that task. Task sections
are headed like `### 1.11 —` or `### 2.02 —`. Extract:

- **Description** — what to build
- **Files to create** — new files with their responsibilities
- **Files to modify** — existing files and what to change
- **Acceptance criteria** — the definition of done
- **Dependencies** — prerequisite tasks (check they exist; don't re-implement them)
- **Docs to read** — reference docs to consult before coding

## Step 4: Read referenced docs (if listed)

The task will name docs like `ARCHITECTURE.md (Data Model section)` or
`ACP-INTEGRATION.md`. Read the relevant sections from `docs/` before writing
any code. This gives you the full design context, not just the task summary.

## Step 5: Check existing code

Before creating files, check what already exists:
- Scan the files listed under "Files to create" — if any already exist, read them first
- Scan the files listed under "Files to modify" — always read them before editing
- Check that dependency tasks' output exists (e.g., if task depends on 1.01, confirm the expected files are in place)

## Step 6: Read project conventions

Read `CLAUDE.md` if it exists. Look for:
- Worktree conventions (where worktrees should live, branch naming)
- Build commands and test commands
- Code style rules, import conventions, type restrictions
- Any project-specific constraints

These conventions override the defaults below.

## Step 7: Create the git worktree

**Never work on `main` directly.** Create a worktree for this task.

Derive the slug from the task title (kebab-case, 2–4 words).

**Default convention** (use unless CLAUDE.md specifies otherwise):

```bash
# Get the repo directory name
REPO_NAME=$(basename "$(git rev-parse --show-toplevel)")

# Branch: task/<task-id>-<slug>
# Worktree: sibling directory named <repo>-<task-id>-<slug>
git worktree add ../${REPO_NAME}-${TASK_ID}-${SLUG} -b task/${TASK_ID}-${SLUG}
cd ../${REPO_NAME}-${TASK_ID}-${SLUG}
```

All subsequent file edits happen inside the worktree.

## Step 8: Implement

Work through the "Files to create" and "Files to modify" lists. For each file:

1. If modifying: read the current file first, then edit
2. Follow project conventions from CLAUDE.md (code style, imports, types, etc.)
3. If no CLAUDE.md exists, follow standard TypeScript/JavaScript conventions

After creating/modifying files, run the project's build command from the worktree:

```bash
# Use whatever the project uses — check CLAUDE.md or package.json scripts
npm run build   # or pnpm -r build, etc.
```

Fix any build errors before continuing. If tests exist for the area being
modified, run the test suite as well.

## Step 9: Verify acceptance criteria

Go through each acceptance criterion from the task spec and confirm it is met.
If any criterion requires a test, check that a test covers it or write one.

## Step 10: Update documentation

Documentation is as much a deliverable as the code. Before committing, update any docs affected by the changes you made. Check `CLAUDE.md` for the project's specific doc mapping — in the EchOS project it looks like this:

| What changed | Doc to update |
|---|---|
| Architecture / data model / new packages | `docs/ARCHITECTURE.mdx` |
| New or changed interfaces / APIs | `docs/INTERFACES.mdx` |
| New or changed plugins | `docs/PLUGINS.mdx` |
| Deployment / Docker / scripts | `docs/DEPLOYMENT.mdx` |
| Security / auth / validation | `docs/SECURITY.mdx` |
| Setup / configuration / env vars | `docs/SETUP_FIXES.mdx` |
| Categorization / tagging logic | `docs/CATEGORIZATION.mdx` |
| Import / export changes | `docs/KNOWLEDGE_IMPORT.mdx` |

Also skim `docs/TROUBLESHOOTING.mdx` and add an entry if the task introduced or resolved anything that could trip up future developers.

If the task's spec already specifies "Docs to update", treat that as the minimum — still check whether adjacent docs need a mention.

## Step 11: Push and open a PR

```bash
git add <specific files — never git add .>
git commit -m "feat: <summary of what was built> (task <task-id>)"
git push -u origin task/<task-id>-<slug>
gh pr create --title "feat: <task title> (task <task-id>)" --body "..."
```

PR body should include:
- One-line summary of what was built
- Checklist of acceptance criteria (each as a checkbox)
- Any deviations from the spec and why
