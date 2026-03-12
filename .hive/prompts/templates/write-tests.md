---
name: write-tests
description: Write missing tests for a source file
type: prompt-template
---

Write comprehensive tests for $1.

Steps:

1. Read the source file and understand every exported function and class
2. Check the `tests/` directory for any existing tests for this file — extend rather than replace
3. Write unit tests for all pure logic; write integration tests for any DB/HTTP interactions
4. Use factory functions from `tests/factories/` for test data
5. Each test description should read: `it('does X when Y')`
6. Run `npm test` to confirm all new tests pass and no existing tests regress

Do not modify the source file itself. If you find a bug while writing tests, note it with
a `hive_checkpoint` call and continue — do not fix it in this task.
