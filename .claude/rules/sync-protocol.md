---
paths:
  - "6am-agent/src/core/sync/**"
  - "6am-agent/src/core/contract/**"
  - "6am-agent/src/core/state/**"
  - "agent-dashboard/app/Actions/Ingestion/**"
  - "agent-dashboard/app/Actions/Agent/**"
  - "agent-dashboard/app/Http/Controllers/Api/Agent/**"
  - "agent-dashboard/routes/agent/**"
---
# Sync protocol rules (full contract: docs/contracts/sync-api-v1.md)
- Agent commits file checkpoints for a batch only after HTTP 200 with `success: true`, in one SQLite transaction. Any other outcome leaves checkpoints untouched and retries the same `batch_id`.
- Backend processes a batch in exactly one DB transaction. Failure ⇒ 5xx `persistence_failed`, nothing committed.
- Replayed `(device_id, batch_uuid)` that already succeeded ⇒ return the stored response, write nothing.
- Every ingested entity is upserted on its unique key (see docs/architecture/data-model.md). Token columns merge with GREATEST, never add.
- Per-record semantic problems go to `rejected_records` in a 200 and to `sync_batches.rejections`. Never drop records silently.
- Usage is deduplicated by `message.id` (Claude splits one API message across several JSONL lines with identical usage).
- Changing a payload field means changing docs/contracts/sync-api-v1.md, the JSON Schema, the zod schema, and the backend FormRequest together.
