---
name: security-checklist
description: Security checklist to run before marking any task done
disable-model-invocation: true
---

Before reporting `status="done"`, verify each item:

**Input validation**

- [ ] All request parameters validated with Zod or a validation library
- [ ] File uploads: type, size, and filename are validated; files stored outside webroot
- [ ] Query parameters that drive DB queries use allowlists, not blocklists

**Authentication & authorisation**

- [ ] Every new endpoint has an auth middleware applied
- [ ] Authorisation checks are centralised — not ad-hoc comparisons scattered in handlers
- [ ] Password fields: never returned in API responses, never logged

**Data handling**

- [ ] No credentials, tokens, session IDs, or PII in log messages
- [ ] No sensitive values in error messages returned to clients
- [ ] All DB queries are parameterised — no string concatenation

**Transport & headers**

- [ ] New endpoints inherit the global CORS policy
- [ ] `Content-Security-Policy` header still passes for any new inline scripts/styles

**Rate limiting**

- [ ] Unauthenticated endpoints have rate limiting applied
- [ ] Auth endpoints (`/login`, `/register`, `/reset-password`) have strict rate limits (≤5 req/min)

If any item is not applicable, note why in the PR description.
