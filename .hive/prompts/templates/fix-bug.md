---
name: fix-bug
description: Fix a described bug, optionally providing the relevant file(s)
type: prompt-template
---

Bug: $1

Relevant file(s): ${@:2}

Process:

1. Reproduce the bug by reading the code and tracing the failing path — do not assume
2. Add a failing test that demonstrates the bug before touching any source code
3. Fix the minimum amount of code necessary to make the test pass
4. Run the full test suite: `npm test`
5. If the fix touches a public API, check for callers in the rest of the codebase

Do not refactor unrelated code in the same commit. If you discover a related issue,
call `hive_checkpoint(summary="Found related issue: ...")` and continue with the original bug.
