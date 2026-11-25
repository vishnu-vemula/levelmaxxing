# PostgreSQL drafts

The SQL in [drafts](drafts/) is a review input for the database owner. It is kept outside the Supabase migrations directory and is outside the scope of agent execution. The design is for a new isolated schema with a single Firebase project and a fresh append-only Progress stream.

| Draft | Responsibility |
|---|---|
| [001 Firebase users](drafts/001-firebase-users.sql) | Private user table with unique exact `firebase_uuid` text, stable internal UUID, role, disabled status and idempotent caller-bound identity resolution |
| [002 Progress sync](drafts/002-progress-sync.sql) | Scoped device registration, transactional receipt and revision handling, and ordered progress pulls |
| [003 Participant workspace](drafts/003-participant-workspace.sql) | Scoped reads, section version checks, and transactional replay receipts for profile, training, nutrition, and journal data |
| [004 Conditional workspace reads](drafts/004-workspace-batch.sql) | Additive participant batch read with representation tags from the committed version receipts |
| [005 Checked workspace save](drafts/005-workspace-checked-save.sql) | Atomic representation and version guard reusing the existing save receipt namespace |
| [006 Reversible workout and meal archive](drafts/006-workspace-history.sql) | Indexed archived records, exact move receipts, per-record restore preconditions, and a compatible active projection |

Review RLS and execute privileges under your real deployment roles. These drafts rely on the verified PostgREST JWT context from a matching third-party Firebase integration, and on the SQL definer role owning the private schema and tables. Keep direct client privileges on private tables absent. Every authenticated RPC can be called outside the Edge API, so it validates caller role, project, identity and any data mutations independently.

Workspace reads use a single indexed latest-version lookup. Writes serialize per account to compare the expected section version and record the receipt in one transaction. A successful save adds one section version and one small receipt. A stale save adds only a receipt pointing to an existing version. Storage grows with retained section versions and operation receipts. Review full-document storage, rate limits, retention, and account erasure before hosted use with real health data. Verify that workspace's SQL rules stay aligned with the shared transport parser when evolving the contract.

## Human-owned follow-up, not performed by Codex

- Review dependency collisions, reviewable ownership, restrictions and schema compatibility. For an existing hosted environment, map Firebase UIDs to existing internal account UUIDs using verified identity evidence before exposing the new resolver. Preserve account status and product record links.
- Apply the drafts in order in an approved environment and configure the one private Firebase project ID. Verify behavior with actual role grants, Firebase JWTs, concurrent resolution, replay and multi-account reads. Use staged expand-and-contract rollout if earlier clients or identity records coexist.
- Exercise workspace at the default `READ COMMITTED` isolation, including concurrent first writes, account disablement, direct malformed RPC submissions, and account erasure. Review query plans and storage growth with representative documents before enabling the new client routes. A rollback can disable workspace routing while preserving stored versions and receipts for recovery.
- Configure restore drills and plan the epoch and user-disable state across restore and rollback. Completing these steps is required before claiming hosted sync, migration verification or operating readiness.

### Batch read rollout

The database owner runs the concurrent partial index build as a standalone statement and verifies the index is valid before applying the transaction containing the batch function. Exercise a restored same-version section with changed content and measure indexed metadata-only reads on representative data. Verify ordinary participant, revoked user and operator calls. Keep the original read and mutation functions available while clients roll forward. If needed, roll back the API first so mobile uses the compatible reads. Index and function cleanup belong to an approved database operation. Section size and historical receipt retention keep their existing bounds and release gates.

Release 005 after 004 and before enabling hosted checked writes. Test a restored equal-version document, both directions of replay across checked and legacy routes, and an old-client write under the restore policy. The function uses the same account lock and request hash as the original save. Rolling back to legacy preserves the receipt shape, but legacy commits remain version-only. Freeze legacy workspace writes during production restores until older clients can no longer reach that dataset.

Apply 006 only in an owner-prepared environment after 003–005. Test accepted, replayed, interrupted, wrong-account and stale operations, restoration of a newer workout, and the same active representation with changed archived contents. Validate the archive index on realistic payloads. Confirm old builds cannot resurrect archived IDs and can still accept the synced active version. Provision a retention and erasure policy covering old active versions, archive rows, receipts and backup recovery before using real data.

For rollback, disable moves and keep authorized archive reads and exports available for records already moved. The active snapshot shapes and original receipts remain compatible. Removing the archive guard or storage while rows are outside the active view creates a data recovery risk.
