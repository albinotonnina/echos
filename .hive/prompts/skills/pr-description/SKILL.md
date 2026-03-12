---
name: pr-description
description: Template and rules for writing PR descriptions
disable-model-invocation: true
---

Every PR description must contain these sections:

```markdown
## What

[One paragraph: what changed and why. Link the Hive task ID.]

## How

[Technical approach: key decisions made, alternatives considered, trade-offs.]

## Testing

[How was this verified? Which test commands were run? Include output for non-obvious cases.]

## Screenshots / recordings

[For UI changes: before/after screenshots or a screen recording. Delete section if not applicable.]

## Checklist

- [ ] Tests added or updated
- [ ] `npm test` passes locally
- [ ] No new lint errors (`npm run lint`)
- [ ] Breaking changes documented in the PR body
- [ ] Dependent PRs linked in description
```

Keep the "What" section readable by non-engineers — it will end up in the changelog.
