---
name: testing-strategy
description: Testing approach, tooling, and rules
---

## Test layers

| Layer | Tool | Location | When to write |
|---|---|---|---|
| Unit | Vitest | `tests/unit/**/*.test.ts` | Every exported function with logic |
| Integration | Vitest + real DB | `tests/integration/**/*.test.ts` | Every API endpoint (happy + error paths) |
| E2E | Playwright | `tests/e2e/**/*.spec.ts` | Critical user journeys only (CI-gated) |

## Rules

- Run `npm test` before calling `hive_report_progress(status="done", ...)`
- Do NOT mock the database layer in integration tests
- Unit tests must not touch the filesystem or network — mock those boundaries
- Test file names mirror source file names: `src/lib/billing.ts` → `tests/unit/lib/billing.test.ts`
- Each test file must be independently runnable
- Use `describe` blocks to group related cases; use `it` (not `test`) for individual cases
- Test description format: `it('returns 401 when token is expired')`

## Fixtures and factories

- Use factory functions from `tests/factories/` for test data — never hard-code IDs
- Seed data for integration tests lives in `tests/seeds/` — run `npm run db:seed:test` before the suite
