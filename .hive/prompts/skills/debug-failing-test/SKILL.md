---
name: debug-failing-test
description: Systematic process for diagnosing and fixing a failing test
disable-model-invocation: true
---

Follow this order before changing any application code:

1. **Reproduce in isolation**
   Run only the failing test and confirm it fails reliably (not intermittently).

2. **Read the full error output**
   Do not skim — read the assertion failure, the stack trace, and any stderr output.
   Note the exact line number in the test and in the source.

3. **Check for environment issues**
   - Is the test DB seeded?
   - Are required env vars set in `.env.test`?
   - Is there leftover state from a previous test run?

4. **Trace the failure**
   Add a single `console.log` at the point of failure to inspect the actual value.
   Do not add multiple logs at once — add one, run, interpret, then add the next.

5. **Identify the root cause**
   Is the test wrong (wrong expectation), the fixture wrong (bad test data), or the code wrong?
   Fix the right thing — do not change a test expectation just to make it pass.

6. **Verify the fix**
   Run the full test suite after fixing.
   If the fix touches shared utilities, check for regressions in related tests.
