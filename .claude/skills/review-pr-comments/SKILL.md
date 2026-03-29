---
name: review-pr-comments
description: >
  Check a PR for unresolved review comments, assess each one, apply fixes
  where needed, and resolve addressed threads via the GitHub API. Use this
  skill whenever the user mentions PR comments, review threads, unresolved
  feedback, or addressing reviewer suggestions — even if they just say "fix
  the comments", "close out the review threads", or "address the feedback".
---

# Review & Resolve PR Comments

Fetch every unresolved review thread on a PR, decide for each whether a code
fix is needed, apply the fix (or confirm it's already done), then resolve the
thread via `gh` GraphQL. Ask the user whenever a decision is genuinely
ambiguous.

## When to Use This Skill

- User says "address the PR comments" or "fix the review comments"
- User says "resolve comments on PR #N" or pastes a PR URL
- User says "check the open comments on my PR"

---

## Steps

Execute in order. Stop and report if any step fails.

### Step 1: Identify the PR

If the user provided a PR number or URL, extract the number.

Otherwise, try to detect the PR automatically from the current branch/worktree:

```bash
gh pr view --json number,url,headRefName 2>/dev/null
```

If that returns a PR, use it and inform the user which PR was detected (number
+ title) before continuing.

If no PR is found automatically, ask:

> Which PR number (or URL) should I review?

Derive `OWNER`, `REPO`, `PR_NUMBER` from the URL or from the current repo's
`git remote get-url origin`. Handle both HTTPS (`https://github.com/OWNER/REPO.git`)
and SSH (`git@github.com:OWNER/REPO.git`) remote formats.

### Step 2: Switch gh to the repo owner account (if needed)

Extract the currently active GitHub username:

```bash
gh api user --jq '.login'
```

If that username does not match `OWNER` (derived in Step 1), switch:

```bash
gh auth switch --user <OWNER>
```

Note the original username so you can restore it at the end. Do NOT rely on
`gh auth status` to determine the active user — its output format is harder to
parse reliably. Use `gh api user --jq '.login'` instead.

### Step 3: Fetch ALL unresolved review threads

Use the GitHub GraphQL API to get every thread — paginate if needed.
The REST endpoint can truncate output; always use GraphQL:

```bash
gh api graphql -f query='
{
  repository(owner:"OWNER", name:"REPO") {
    pullRequest(number:PR_NUMBER) {
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:20) {
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
             outdated: .isOutdated,
             commentId: .comments.nodes[0].databaseId,
             path: .comments.nodes[0].path,
             line: .comments.nodes[0].line,
             body: .comments.nodes[0].body
           }'
```

Record the full list. If there are zero unresolved threads, report that and
stop.

### Step 4: Read the current file for each thread

For every unresolved thread, read the relevant file at the commented line to
understand the current state of the code:

- If the thread is **outdated** (`isOutdated: true`), the code has already
  changed. Read the file to confirm the concern is addressed.
- If the thread is **not outdated** (`isOutdated: false`), the commented line
  still exists. Read it and decide:
  - Is the issue **already fixed** (e.g. a test was added in a new file, or
    the change was applied elsewhere)?
  - Does it **still need a fix**?
  - Is the suggestion **wrong / inapplicable** (stale logic, wrong assumption)?

### Step 5: Triage each thread

Categorise every thread into one of three buckets:

| Bucket             | Meaning                                                       | Action                                  |
| ------------------ | ------------------------------------------------------------- | --------------------------------------- |
| **already-fixed**  | The code concern is addressed; comment is just not resolved   | Resolve the thread, no code change      |
| **needs-fix**      | The issue is real and present in the current code             | Apply the fix, then resolve             |
| **not-applicable** | The suggestion is wrong, stale, or intentionally not followed | Post a reply explaining why, then resolve |

**When in doubt**, pause and ask the user before placing a thread in any bucket.
Never silently skip a thread.

### Step 6: Apply fixes

For threads in the **needs-fix** bucket:

1. Make the minimal correct change to the file.
2. Build and run tests using the project's standard commands (e.g. `pnpm build`
   and `pnpm vitest run` for pnpm projects; `npm test` or `yarn test` for
   others — check `package.json` scripts if unsure) to confirm nothing breaks.
3. If tests fail, fix them or pause and ask the user.
4. Commit the fix:

```bash
git add <files>
git commit -m "fix: <short description of what was fixed>

Addresses PR review comment: <comment body summary>"
git push
```

Collect the thread IDs of all fixed threads.

### Step 7: Resolve threads

For threads in **not-applicable**, first post a reply comment explaining why
the suggestion wasn't followed, so the reviewer isn't left wondering:

```bash
gh api repos/OWNER/REPO/pulls/PR_NUMBER/comments \
  --method POST \
  -f in_reply_to=COMMENT_DATABASE_ID \
  -f body="<brief explanation: e.g. 'This is intentional — X because Y'>"
```

Then, for every thread in **already-fixed**, **needs-fix** (now fixed), and
**not-applicable**, resolve via GraphQL:

```bash
gh api graphql -f query="
  mutation {
    resolveReviewThread(input: {threadId: \"THREAD_ID\"}) {
      thread { isResolved }
    }
  }
" --jq '.data.resolveReviewThread.thread.isResolved'
```

Verify the result is `true` before moving to the next thread.

### Step 8: Restore original gh account

If the active account was switched in Step 2, restore it:

```bash
gh auth switch --user <ORIGINAL_ACCOUNT>
```

### Step 9: Report

Summarise what was done:

- How many threads were found
- How many were already-fixed (just resolved)
- How many needed and received a fix
- How many were not-applicable (resolved with explanation)
- Any that were skipped pending user input (list them explicitly)

---

## Important Notes

- **Never resolve a thread without first confirming the underlying concern is
  addressed** — either in the current code or with a new commit.
- **Outdated ≠ resolved.** An outdated thread may still represent a real issue
  in refactored code.
- **Ask the user** for anything that involves a design choice, trade-off, or
  intentional deviation from the reviewer's suggestion.
- This skill resolves threads under the repo owner's account. Always restore
  the original `gh` account at the end.
