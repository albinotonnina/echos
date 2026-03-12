---
name: dependency-update
description: Process for safely adding or updating npm dependencies
disable-model-invocation: true
---

## Adding a new dependency

1. Check bundle impact — justify packages >50 KB
2. Verify licence: must be MIT, Apache-2.0, BSD-2-Clause, or BSD-3-Clause
3. Check maintainer activity: last publish within 12 months, >1 maintainer for critical packages
4. Pin to exact version for CLI tools; use `^` for library dependencies
5. Add to `package.json` in the correct section (`dependencies` vs `devDependencies`)
6. Run `npm install` and commit the updated lockfile

## Updating an existing dependency

1. Read the changelog between current and target version — note any breaking changes
2. Run the full test suite after the update: `npm test`
3. Run `npm audit` and resolve any new advisories before committing
4. Update in a separate commit from feature work: `chore(deps): bump express from 4.18 to 4.19`

## Never do

- Do not use `npm install --legacy-peer-deps` without a comment explaining why
- Do not add a dependency to solve a problem that already has a solution in the codebase
- Do not add polyfills for browser APIs if target environments already support them
