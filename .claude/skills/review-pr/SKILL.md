---
name: review-pr
description: >
  Perform a thorough, project-aware code review on the current PR and post it
  to GitHub as a real review with inline comments via the GitHub API. Use this
  skill whenever the user says "review", "review this PR", "review my changes",
  "do a code review", "give me feedback on this branch", or "check my PR" —
  especially when working in a git worktree. Trigger even if the user just says
  "review" with no other context.
---

# PR Code Review

You are acting as a senior engineer doing a thorough, honest code review. Your
goal is to find every real problem in a single pass — not rubber-stamp it. Be
direct and constructive. Flag genuine issues clearly; don't nitpick style when
nothing is actually wrong.

A thorough review is not just reading the diff. It means understanding the
change, then systematically checking it from multiple angles: logic correctness,
security, type safety, cross-file impact, test coverage, and completeness. Most
review misses come from skipping one of these angles, not from reading too fast.

---

## Step 0: Load required tools

Before doing anything else, load all tools you will need:

```
ToolSearch: select:Bash,Read,Edit,Glob,Grep
```

---

## Step 1: Identify the PR and gather context

If the user gives a PR number, use that. Otherwise detect from the current branch:

```bash
gh pr view --json number,url,headRefName,title,baseRefName 2>/dev/null
```

If the user gives a PR number that isn't on the current branch:

```bash
gh pr view PR_NUMBER --json number,url,headRefName,title,baseRefName
```

Extract `OWNER`, `REPO`, `PR_NUMBER`, `HEAD_BRANCH`, `BASE_BRANCH`. Handle both
HTTPS (`https://github.com/OWNER/REPO.git`) and SSH
(`git@github.com:OWNER/REPO.git`) remote formats.

Fetch all metadata you'll need — run these in parallel:

```bash
# Per-file change stats (skip lockfiles)
gh api repos/OWNER/REPO/pulls/PR_NUMBER/files \
  --jq '.[] | select(.filename | test("lock\\.json|lock\\.yaml") | not) | "\(.filename) +\(.additions)/-\(.deletions)"'

# Commit history
gh pr view PR_NUMBER --json commits --jq '.commits[] | "\(.oid[:7]) \(.messageHeadline)"'

# Existing reviews (to avoid duplicating feedback)
gh api repos/OWNER/REPO/pulls/PR_NUMBER/reviews \
  --jq '.[] | "\(.state) by \(.user.login) at \(.submitted_at)"'

# Current gh user (needed for self-review check later)
gh api user --jq '.login'
```

If there are prior reviews with fix commits after them, note which issues were
already addressed. Don't re-raise points the commit history shows were fixed.

---

## Step 2: Read project context and check coherence

Before looking at code, build a mental model of what the project expects and
what this PR is supposed to accomplish. This is the "heresy detector" — it
catches PRs that are internally correct but wrong for the project.

### 2a: Project conventions (mandatory)

- Read `CLAUDE.md` in the project root
- Check for `README.md`, `CONTRIBUTING.md`, or `ARCHITECTURE.md` if CLAUDE.md
  doesn't exist

### 2b: Specification lookup (when applicable)

If the PR title, branch name, or description references a task ID, feature
name, or spec — find and read the relevant section of the project's docs.
Don't read entire doc files (they can be huge); grep for the specific reference:

```bash
# PR title says "task 3.26" — find that section in implementation docs
grep -n "3\.26\|3.26" docs/*.md

# PR touches the harness — find harness rules
grep -n -i "harness" docs/*.md CLAUDE.md | head -20

# PR adds a new CLI command — check if there's a spec for it
grep -n -i "cli\|command" docs/*.md | head -20
```

Then read just the matching section (e.g. 50 lines around the match). This
costs ~2KB of context instead of 150KB for the full doc.

What you're looking for:
- **Does the implementation match the spec?** If task 3.26 says "replace X with
  Y using approach Z" and the PR does something different, that's a finding.
- **Does the PR violate stated architecture rules?** If the architecture doc
  says "all agent communication goes through the hub" and the PR adds direct
  agent-to-agent calls, that's blocking.
- **Are there constraints the PR ignores?** Security policies, naming
  conventions, required patterns that the PR doesn't follow.

If no task/spec is referenced, or the project has no docs beyond CLAUDE.md,
skip 2b — don't waste context reading docs that won't help.

### 2c: What to do with coherence findings

Coherence issues are often **blocking** because they mean the PR is solving the
wrong problem or solving it the wrong way. Flag them prominently in your review
summary, not buried in inline comments. Example:

> "PR title says 'implement task 3.26 — remove Pi SDK via ACP-based inference'
> but `docs/IMPLEMENTATION.md` specifies that task 3.26 should also migrate the
> orchestrator tools, which this PR doesn't touch."

---

## Step 3: Understand the change (first pass)

The purpose of this pass is comprehension, not critique. You need to understand
what the PR does before you can find what's wrong with it.

### 3a: Get the diff

```bash
gh pr diff PR_NUMBER
```

For large diffs (>50KB), filter out noise first:

```bash
# Exclude lockfiles
gh pr diff PR_NUMBER | awk '/^diff --git/{skip=0} /^diff --git a\/.*lock\\.json/{skip=1} !skip'
```

### 3b: Classify every changed file

Go through the file list and categorize each file:

| Category | What it means | Review depth |
|----------|---------------|-------------|
| **Spine** | New files, core logic, the main abstraction the PR introduces | Read every line of the full file |
| **Consumer** | Files that were updated to use the new code | Read full file, verify correct usage |
| **Cleanup** | Import swaps, one-line deletions, renames | Scan from diff only |
| **Config/types** | Type definitions, config changes | Read in full — check for dead fields |
| **Tests** | Test files | Read in full — check coverage of new paths |
| **Generated** | Lockfiles, auto-generated code | Skip entirely |

Write down this classification before proceeding. It determines where you spend
your time — spine and consumer files get the most scrutiny.

### 3c: Identify the "contract surface"

Before reading any file in detail, answer these questions from the diff alone:

- What public interfaces / types / exports did this PR add, change, or remove?
- What dependency did it add or remove?
- What configuration options changed?

These are the things most likely to have cross-file impact, and you'll check
their consumers in the next step.

---

## Step 4: Deep file analysis (second pass)

Now read files systematically. For each file, read the **full file** (not just
the diff) — a change that looks fine in isolation may duplicate existing logic,
break an invariant, or contradict a pattern used elsewhere in the file.

**When the PR is on a different branch** than your checkout, files on disk won't
match. Either check out the branch, or read from the PR's head ref:

```bash
gh api repos/OWNER/REPO/contents/PATH?ref=HEAD_BRANCH --jq '.content' | base64 -d
```

### Per-file checklist

For every spine and consumer file, run through this checklist. Not every item
applies to every file — skip what's irrelevant, but don't skip the checklist.

**Logic correctness:**
- Trace each code path. What happens on success? On error? On empty/null input?
- Are there race conditions? (concurrent calls, shared mutable state, async gaps)
- If there's a cleanup/finally block, does every code path reach it?
- If there's a Promise constructor, can it leak? (never resolve, never reject)
- If there's retry or fallback logic, what happens when the fallback also fails?

**Security:**
- Is user input used in file paths, URLs, shell commands, or SQL without validation?
- Are secrets, tokens, or API keys exposed in logs or error messages?
- Does the change weaken any existing validation or auth checks?

**Type safety:**
- Any `as` casts that could be wrong at runtime?
- Any implicit `any` (untyped function parameters, untyped catch blocks)?
- If an interface changed, does all usage conform to the new shape?

**Error handling:**
- Are errors caught and handled, or silently swallowed?
- When errors are caught, is the error information preserved or lost?
- Does a catch block that returns a "success" value mask a real failure?

**Config and constant honoring:**
- Is the code hardcoding values that should come from config? (paths, URLs,
  thresholds, feature names). Check the relevant config interface — if a field
  exists for this purpose, the code must use it.
- Does the code ignore config fields that apply to it? Read the config type for
  the feature being modified and verify each relevant field is either read or
  has an explicit reason to be skipped.
- Are hardcoded paths consistent with how other code derives the same path?
  (e.g., does it construct a path from components when there's already a field
  on the object carrying the resolved path?)

**Completeness of status/enum handling:**
- If the code switches on or filters a status/enum, does it handle all values?
  Check the type definition for the full set. A skip-list that covers 5 of 9
  terminal states is a bug — the other 4 will fall through incorrectly.
- If the PR adds a new enum value, search for every switch/if-chain on that
  enum and verify the new value is handled (or explicitly falls through).

**Dead code:**
- Did the change leave behind unused imports, types, config fields, or functions?
- If a dependency was removed, are there remaining references to it anywhere?

---

## Step 5: Cross-cutting analysis (third pass)

This is where most review misses happen. Individual files can look correct but
the change as a whole can be incomplete or break things at the seams.

### 5a: Consumer verification

For every public interface, type, or export that changed in this PR, check who
calls it:

```bash
# Find all callers of a changed function/type
grep -r "functionName\|TypeName" src/ --include="*.ts" -l
```

If a caller exists outside the PR's changed files, the PR may have a breaking
change it didn't account for. This is a blocking finding.

### 5b: Removal completeness

If the PR removes a dependency, module, or feature, verify the removal is
complete:

```bash
# Check for leftover references to a removed package
grep -r "removed-package" src/ tests/ --include="*.ts" -l
grep "removed-package" package.json
```

Partial removals leave the codebase in a broken or confusing state — if they
removed 90% of a dependency but left stale references, flag it.

### 5c: Test adequacy

Read the test files in the PR with these questions:

- Do tests cover the **new** behavior, not just the old behavior with mocks swapped?
- Are mocks realistic? (A mock that always returns success doesn't test error paths)
- If the PR adds error handling, is there a test that triggers each error path?
- If the PR changes a public interface, do tests verify the new contract?
- Are there test files that should have been updated but weren't?

### 5d: Config and type consistency

**For new config fields:**
- Is the field documented (JSDoc or inline comment)?
- Is there a default when the field is omitted?
- Is the field actually read anywhere? (config fields without consumers are dead code)

**For existing config fields the PR should honor:**
This is the most commonly missed category. When code touches a feature that has
config options, check whether it respects them:

```bash
# Read the config type for the feature area the PR modifies
# e.g., if the PR modifies the heresy detector, read HeresyConfig
grep -A 20 "interface HeresyConfig" src/types/
```

For each field in the relevant config interface, ask: does the new code honor
this, or is it hardcoding something the config was designed to control?

Common patterns to catch:
- Hardcoded file path when config has a `dir` or `path` field
- Hardcoded status list when the type has more values than the list covers
- Feature ignoring its own `model`, `provider`, `source`, or `timeout` config
- Object carrying a resolved value (like `task.sandboxRef`) being ignored in
  favor of re-deriving the same value from components

If the PR removes functionality but keeps its config type, that's dead code.

---

## Step 6: Collect findings

For each issue you find, record:

| Field | Value |
|---|---|
| `file` | Relative path from repo root |
| `line` | Line number in the **new** file (the `+` side of the diff) |
| `severity` | `blocking`, `suggestion`, or `nit` |
| `body` | Markdown comment: explain the problem, then suggest the fix |

**Severity guide:**
- `blocking` — bug, security issue, breaking change, violation of a hard project
  rule, or something that will cause a failure in production. The review outcome
  will be REQUEST_CHANGES if any blocking issues exist.
- `suggestion` — a real improvement worth making, but not a blocker. The code
  works but could be meaningfully better (robustness, performance, clarity).
- `nit` — minor style, naming, or cosmetic point. Prefix the body with "nit:".

**Line number accuracy matters** — the GitHub API will reject comments whose
`line` does not appear in the diff. Only attach inline comments to lines that
were added or modified (the `+` side) or to unchanged context lines visible
within a diff hunk. If the issue is about a deleted line or a file not in the
diff, put it in the summary body instead.

Write an **overall summary** covering:
- What the PR does (1-2 sentences)
- Architecture/design assessment
- Key concerns (or "no blocking issues found")
- Your verdict

Present findings in a table in the terminal before posting, so the user can see
the review at a glance.

---

## Step 7: Decide the review outcome

- `APPROVE` — no blocking issues
- `COMMENT` — suggestions only, no blockers
- `REQUEST_CHANGES` — one or more blocking issues

**Self-review caveat:** GitHub blocks `APPROVE` and `REQUEST_CHANGES` on your
own PRs. Check whether the current `gh` user matches the PR author:

```bash
PR_AUTHOR=$(gh pr view PR_NUMBER --json author --jq '.author.login')
```

If `GH_USER == PR_AUTHOR`, always use `COMMENT` as the event. State the intended
verdict in the summary body instead (e.g. "**Verdict: APPROVE**").

---

## Step 8: Post the review

Submit everything in a single API call:

```bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER/reviews \
  --method POST \
  -H "Content-Type: application/json" \
  --input - <<'EOF'
{
  "body": "<overall summary — markdown OK>",
  "event": "APPROVE|COMMENT|REQUEST_CHANGES",
  "comments": [
    {
      "path": "src/core/foo.ts",
      "line": 42,
      "body": "**Blocking:** Explain the problem.\n\nFix:\n```ts\ncode here\n```"
    }
  ]
}
EOF
```

If there are no inline comments, omit the `comments` array entirely.

Inline comment bodies support full markdown — use code blocks, bold, and bullet
lists liberally.

---

## Step 9: Offer to fix blocking issues

After posting, list the blocking issues in the terminal and ask:

> "I've posted the review. Found N blocking issue(s) — want me to fix them?"

If the user says yes:

### 9a: Apply and push the fixes

1. Make the minimal correct change for each blocking issue
2. Run the project's build and test commands (check `package.json` scripts)
3. If anything fails, fix it or pause and ask the user
4. Commit and push:

```bash
git add <files>
git commit -m "fix: <description>

Addresses code review findings on PR #PR_NUMBER"
git push
```

### 9b: Resolve the review threads for fixed issues

Fetch review threads to get their GraphQL node IDs:

```bash
gh api graphql -f query='
{
  repository(owner:"OWNER", name:"REPO") {
    pullRequest(number:PR_NUMBER) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          comments(first:5) {
            nodes {
              databaseId
              path
              line
              body
            }
          }
        }
      }
    }
  }
}' --jq '.data.repository.pullRequest.reviewThreads.nodes[]
         | select(.isResolved == false)
         | {
             threadId: .id,
             path: .comments.nodes[0].path,
             line: .comments.nodes[0].line,
             body: .comments.nodes[0].body
           }'
```

For each fixed thread, resolve it:

```bash
gh api graphql -f query="
  mutation {
    resolveReviewThread(input: {threadId: \"THREAD_ID\"}) {
      thread { isResolved }
    }
  }
" --jq '.data.resolveReviewThread.thread.isResolved'
```

---

## Quality principles

- **Inline comments beat summary walls of text.** Put the specific finding and
  fix suggestion inline; keep the summary high-level.
- **Be specific about fixes.** "Consider validating this" is less useful than a
  concrete code snippet showing the fix.
- **Don't over-review.** If the code is fine, say so. APPROVE with a couple of
  nits is a perfectly valid outcome. The goal is to find every real problem —
  not to invent problems that aren't there.
- **Don't duplicate prior feedback.** If the PR has fix commits addressing
  earlier reviews, verify those fixes and focus on what's new.
