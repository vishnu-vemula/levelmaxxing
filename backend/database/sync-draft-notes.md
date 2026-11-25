# Progress sync database draft

The [Firebase user draft](drafts/001-firebase-users.sql) defines the Firebase UID mapping and project check. The [progress sync draft](drafts/002-progress-sync.sql) defines the three Data API RPCs consumed by the existing v1 transport. Both files sit outside the managed migration directory.

| RPC | Outcome |
| --- | --- |
| `levelmaxing_register_device_v1(uuid)` | Repeat registration returns the same device generation and current account epoch. First registration starts the device fence at zero. |
| `levelmaxing_push_v1(jsonb)` | Validates at most 50 ordered operations and a 256 KiB canonical request limit. Returns one result per operation. |
| `levelmaxing_pull_v1(text, text, text, integer)` | Returns at most 100 append-only changes after the supplied revision and at or below the pinned high-water mark. Revisions travel as decimal strings. |

## Invariants

- The authenticated caller reaches private storage only through scoped functions. Every RPC resolves the Firebase subject to an active participant UUID. The request cannot choose an account. Private tables have no client grants or RLS policies. Public functions pin `search_path` and grant execution to `authenticated` during the same transaction that creates them. Use the same trusted owner for both drafts so private helpers and tables remain accessible to the security definer functions. [PostgreSQL function security](https://www.postgresql.org/docs/current/sql-createfunction.html)
- A writer takes the account revision lock, pins the active user status under a shared row lock, and then locks the device when pushing. Measurement, revision, receipt and device fence commit together. An infrastructure error aborts the batch. A recognized conflict or sequence gap returns a result. Future account state and retention procedures must respect this lock order. [PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html#LOCKING-ROWS)
- A bounded batch is canonicalized before acquiring locks. A receipt stores the SHA-256 operation hash and exact response. Matching retries reuse the response. Changed input under the same sequence returns `operation_body_changed`. A terminal sequence with an absent receipt returns `receipt_expired` without replaying the write. [PostgreSQL hash functions](https://www.postgresql.org/docs/16/functions-binarystring.html)
- Append-only weight rows are both the source of truth and the immutable change projection. The unique account and revision index supports ordered pulls. A reader uses the last committed revision as its initial high-water mark. Later writes may commit while it reads, but their revisions stay outside the pinned range. The public HTTP layer still signs and scopes cursors. Direct RPC use can request windows only for the verified participant account.
- Each measurement ID is unique within its account. A valid duplicate ID from another sequence issues a stable `entity_already_exists` receipt, then advances that device's sequence. The account revision advances only for a new observation. Future migrations must preserve this create-only stream while any v1 client remains supported.

## Capacity and release evidence

Push work is bounded by batch size, with indexed device, receipt and observation lookups and transaction contention limited to one account. The read path uses the account and revision index and allocates one bounded JSON page. Stored records and receipts grow linearly with accepted data and terminal outcomes. Retention, projection expansion for edits and deletes, and a restore-safe epoch rotation remain release work. Weight rows and sequence fences must remain available across cursor and receipt retention changes.

Database-backed checks are human-owned. Provision the actual Firebase issuer and roles, verify first-account registration, two concurrent devices, replay with equivalent and changed canonical values, duplicate entity outcomes, stale epoch handling, fixed-window paging, cross-tenant isolation, role and status changes, leap-date validation, and service-role table restrictions. Inspect query plans at representative scale and confirm receipt growth and account deletion policies before exposing this workload to production. No draft or database check was executed in this workspace.
