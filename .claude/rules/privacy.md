---
paths:
  - "6am-agent/src/core/claude/**"
  - "6am-agent/src/core/detect/**"
  - "6am-agent/src/core/sync/**"
  - "agent-dashboard/app/Actions/Ingestion/**"
  - "agent-dashboard/app/Models/SessionMessage.php"
  - "agent-dashboard/app/Http/Controllers/Dashboard/SessionController.php"
  - "agent-dashboard/resources/js/pages/Sessions/**"
---
# Privacy & tracking-category rules
- Apply central tracking settings before building any payload. A disabled category's fields stay null/empty and are never read into payload objects.
- Prompt text (user message content, `last-prompt`, `ai-title`, tool results) is read only when `prompt` is ON. Tool inputs/outputs are never collected.
- Backend strips any data for disabled categories even if an agent sends it (defense in depth) and records a rejection reason `category_disabled`.
- `session_messages.content` uses the encrypted cast. Viewing requires the `viewPrompts` gate and writes an `audit_logs` row (`prompt.viewed`).
- Never log or audit-store prompt content, tokens, credentials, or pairing codes.
- Test fixtures must be sanitized: no real prompts, emails, hostnames, or paths from real machines.
