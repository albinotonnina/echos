---
name: commit-convention
description: Git commit message conventions
---

Use Conventional Commits format: `<type>(<scope>): <subject>`

Types: `feat` | `fix` | `chore` | `docs` | `test` | `refactor` | `perf` | `ci`

Rules:

- Subject line: imperative mood, lowercase, no trailing period, ≤72 chars
- Scope is optional but encouraged: `feat(auth): add MFA flow`
- Breaking changes: add `!` after type/scope and a `BREAKING CHANGE:` footer
- Reference issues in the footer: `Closes #42`
- Never commit commented-out code or debug logging (`console.log`, `debugger`)
- Each commit should compile and pass linting independently

Examples:

```
feat(api): add rate limiting to /auth endpoints
fix(billing): prevent duplicate charge on retry
refactor(db): extract connection pool into singleton
test(user): add integration tests for deactivation flow
```
