# Security

## What EchOS Does NOT Do

These are hard guarantees about what EchOS will never do to your system:

| Guarantee | Detail |
|---|---|
| Does not touch your file system | EchOS only reads and writes inside its own `data/` directory. It never traverses your home directory, system files, or anything outside that scope. |
| Does not execute shell commands | No user input, AI output, or plugin code ever reaches a shell. `exec`, `spawn`, and similar calls are absent from the codebase. |
| Does not run code from AI responses | Claude's output is treated as text. EchOS never passes AI-generated strings to `eval()`, `Function()`, `vm.runInNewContext()`, or any other dynamic execution primitive. |
| Does not exfiltrate your data | The only outbound calls are to the APIs you configure (Anthropic, OpenAI). No data is ever sent to any other third party. |
| Does not store secrets in logs | Pino redaction paths cover all common secret field names. API keys and tokens never appear in log output, error messages, or audit trails. |

---

## Authentication

| Interface | Mechanism |
|---|---|
| Telegram | User ID whitelist (`ALLOWED_USER_IDS`) enforced in middleware before every message |
| Web API | Bearer token (`WEB_API_KEY`) on every request + `userId` validated against `ALLOWED_USER_IDS` |
| TUI | Local only — no network, no auth |

The Web API also binds to `127.0.0.1` and enforces localhost-only CORS, so it is not reachable from the network even if the firewall is misconfigured.

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
