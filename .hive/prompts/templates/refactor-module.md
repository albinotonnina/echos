---
name: refactor-module
description: Refactor a module for a stated goal without changing behaviour
type: prompt-template
---

Refactor $1 to achieve: $2

Rules:

- Behaviour must not change — every existing test must still pass after the refactor
- Add tests for any code paths that are currently untested before starting
- Make incremental commits — one logical change per commit (e.g. "extract helper", "rename method")
- If the refactor requires a behaviour change, stop and call
  `hive_checkpoint(summary="Refactor blocked: behaviour change needed — ...")` before proceeding
- Do not change public API signatures unless the task explicitly says so
- Run `npm test` after each commit

When done, the module should be simpler, not just differently organised.
