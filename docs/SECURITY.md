# Security

## Authentication

- Single-user system authenticated via Telegram user ID whitelist
- Web interface uses Telegram Login Widget (same user identity)
- TUI is local-only (no auth needed)

## SSRF Prevention

All URL fetching goes through `validateUrl()` which:
- Only allows `http:` and `https:` protocols
- Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x)
- Blocks localhost and metadata endpoints
- Applied before any fetch operation

## Content Sanitization

- HTML content sanitized with DOMPurify before processing
- `sanitizeHtml()` strips all tags and re-escapes entities
- `escapeXml()` for XML context escaping
- AI output treated as untrusted data

## Rate Limiting

- Token bucket algorithm (20 tokens, 1 token/second refill)
- Per-user tracking
- Applied at middleware level in all interfaces

## Secret Management

- Pino configured with redaction paths for common secret field names
- Secrets never included in error messages
- `.env` files gitignored

## Audit Logging

- Separate audit logger instance
- Structured events with timestamps and user IDs
- Security-relevant events logged: auth failures, content access, mutations

## Input Validation

- All configuration validated with Zod schemas
- Tool parameters validated with TypeBox + AJV (via pi-agent-core)
- User input sanitized before storage
