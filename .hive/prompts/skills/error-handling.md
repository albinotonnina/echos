---
name: error-handling
description: Error handling patterns for this project
---

## Throwing errors

- Use typed error classes — never throw raw strings
- Include enough context in the message to diagnose without a debugger:
  `throw new NotFoundError(\`User ${userId} not found in org ${orgId}\`)`
- Do not catch an error just to re-throw it unchanged

## HTTP layer

- Route handlers must not throw — wrap in a top-level error-handling middleware
- Return standardised error shape: `{ error: { code, message, details? } }`
- 4xx errors: include `details` with field-level validation failures where applicable
- 5xx errors: log the full stack, return a generic message to the client (no stack traces in responses)

## Async code

- Always `await` promises inside try/catch — do not mix `.catch()` chains and try/catch in the same function
- Unhandled promise rejections crash the process — this is intentional, do not suppress them

## Logging

- Never use `console.log` in application code outside of scripts
- Log at `warn` for recoverable issues, `error` for failures that require attention
- Include structured metadata: `logger.error({ userId, requestId }, 'Payment failed')`
