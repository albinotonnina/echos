---
name: code-style
description: TypeScript code style and quality rules for this project
---

## TypeScript

- Strict mode is enabled — never use `any`, use `unknown` and narrow with guards
- Prefer `const` over `let`; never use `var`
- All exported functions and classes must have explicit return types
- Avoid type assertions (`as`) except when interacting with untyped external data
- Use Zod for runtime validation at system boundaries (HTTP request bodies, env vars, external API responses)

## Naming

- Files: `kebab-case.ts`
- Classes and interfaces: `PascalCase`
- Functions, variables, methods: `camelCase`
- Constants (module-level, truly immutable): `SCREAMING_SNAKE_CASE`
- Boolean variables/props: prefix with `is`, `has`, `can`, `should`

## Imports

- Use named imports; avoid default imports except for third-party modules that require them
- Group imports: (1) Node built-ins, (2) third-party, (3) internal — separated by blank lines
- Never use relative imports that traverse more than two levels — use path aliases instead

## Comments

- Write comments for *why*, not *what*
- JSDoc only on public API surface; not on internal helpers
- TODO comments must include an issue number: `// TODO(#123): ...`
