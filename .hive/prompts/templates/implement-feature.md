---
name: implement-feature
description: Implement a named feature given a spec file or description
type: prompt-template
---

Implement the feature described in $1.

Read the spec carefully before writing any code. If anything is ambiguous, check
`hive_read_context` for existing patterns before inventing a new approach.

Acceptance criteria:

- All requirements in the spec are satisfied
- Unit tests cover the core logic
- Integration tests cover the API surface (if applicable)
- `npm test` passes
- No new lint errors

When complete, call `hive_report_progress(status="done", message="...")` with a
one-sentence summary of what was implemented.
