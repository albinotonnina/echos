---
name: plan-to-tasks
description: >
  Transform a plan (from session memory, a markdown file, or inline description)
  into agent-executable tasks in docs/IMPLEMENTATION.md following the project's
  established format. Use when the user says "add to implementation", "convert
  plan to tasks", "create tasks from this plan", "add a phase", or similar.
---

# Plan to Tasks

Convert a plan into the `docs/IMPLEMENTATION.md` task format so each task can
be executed by an AI agent via the `implement-task` skill, one task per session.

## When to Use This Skill

- User says "add this plan to IMPLEMENTATION.md"
- User says "convert plan to tasks" or "create tasks from this plan"
- User says "add a new phase" to the implementation doc
- User has a plan (in session memory, a file, or inline) and wants it broken into
  agent-executable tasks

## Step 1: Gather the Plan

Find the plan content. Check in order:

1. Session memory (`/memories/session/`) — look for plan files
2. User's message — inline plan description
3. Ask the user where the plan is

Extract the high-level goals, steps, files involved, and verification criteria.

## Step 2: Read the Existing `docs/IMPLEMENTATION.md`

```bash
# Get the current phase numbering
grep -n "^## Phase\|^### [0-9]" docs/IMPLEMENTATION.md
```

Determine:
- The last phase number (e.g. Phase 8 → new phase is 9)
- The last task number (e.g. 8.03 → new tasks start at 9.01)
- The format conventions (read at least 2 full task examples to match style)

## Step 3: Design the Task Breakdown

Transform the plan into tasks following these rules:

### Task Sizing

- **One task = one agent session** (1-4 hours of focused work)
- Each task should produce a single PR
- If a plan step is too large, split it into multiple tasks
- If a plan step is too small, combine it with related steps
- A task should touch at most ~10 files (ideally fewer)

### Task Independence

- Tasks within a phase should be **as independent as possible**
- Minimize cross-task dependencies (an agent can't know what another session did)
- If tasks must be sequential, declare it in **Dependencies**
- Prefer "no dependencies" — design tasks so they work against the current codebase

### Task Scope

Each task must be self-contained:
- An agent must be able to implement it without context from other tasks
- All files to create and modify must be explicitly listed
- Acceptance criteria must be verifiable by the agent (build passes, tests pass, specific behaviors)

## Step 4: Write Tasks in the Exact Format

Every task MUST follow this template exactly:

```markdown
### X.YY — Task Title

**Description:** 2-5 sentences explaining what to build/change, why it matters,
and any key design decisions. Be specific enough that an agent can implement
without asking questions. Include the current state (what exists now) and the
target state (what should exist after).

**Files to create:**

- `path/to/new-file.ts` — What this file contains. What it exports. Key functions
  or types with their signatures. Approximate size. Enough detail that the agent
  knows what to write without inventing the API.

**Files to modify:**

- `path/to/existing-file.ts` — What specific changes to make. Which sections to
  add/remove/update. Be explicit: "Remove lines X-Y", "Add import for Z",
  "Replace the foo() call with bar()".

**Acceptance criteria:**

- Bullet list of verifiable conditions
- Always include: `pnpm -r build` passes
- Include test requirements if applicable
- Include behavioral checks (e.g. "daemon starts and logs show X")
- Include size targets if splitting files (e.g. "file is under 100 lines")

**Dependencies:** None (or list specific task IDs like 9.01)
```

### Format Rules

1. **Task ID**: `X.YY` where X = phase number, YY = zero-padded sequence (01, 02, ...)
2. **Title**: Short, descriptive, starts with a verb or noun
3. **Description**: Present tense. Explain the problem AND the solution.
4. **Files to create**: Only for NEW files. Include enough implementation detail
   (types, function signatures, behavior) that the agent doesn't need to guess.
5. **Files to modify**: Only for EXISTING files. Be specific about what changes.
6. **Background job** / **Docs to update** / **Docs to read**: Optional sections,
   include only when relevant.
7. **Acceptance criteria**: Always include `pnpm -r build` passes (or equivalent
   build command). Include `pnpm vitest run` if tests exist for the area.
8. **Dependencies**: Always present. Use "None" or list task IDs.

### What NOT to Include

- Don't include implementation code (the agent writes the code)
- Don't include line numbers that will change (use descriptions instead)
- Don't include vague criteria ("works correctly") — be specific
- Don't add tasks for documentation updates unless they're substantial (each task
  already updates docs per the `implement-task` skill Step 10)

## Step 5: Insert into `docs/IMPLEMENTATION.md`

1. Add the new phase section after the last existing phase (before the Dependency Graph)
2. Add entries to the Dependency Graph section
3. Add entries to the Recommended Execution Order section
4. Update the Parallelization note if relevant

### Insertion Points

- **Phase section**: Before `## Dependency Graph`
- **Dependency graph**: Inside the ASCII art graph
- **Execution order**: In the numbered list at the bottom

## Step 6: Verify the Format

After writing, verify:

1. Task IDs are sequential and correctly numbered
2. All file paths are valid (check they exist or are clearly new files)
3. Dependencies are consistent (no circular deps, referenced tasks exist)
4. Each task has all required sections (Description, Files to create/modify,
   Acceptance criteria, Dependencies)
5. Phase heading uses `## Phase N:` format
6. Task headings use `### N.YY —` format with em dash (—), not hyphen (-)
7. The document still renders correctly as Markdown

## Step 7: Summarize

Tell the user:
- How many tasks were created
- The phase number and task ID range
- Any dependencies between tasks
- Suggested execution order
- Which tasks can be parallelized
