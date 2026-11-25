# Levelmaxing API

The same Fetch application serves the local Node adapter and the Supabase Edge composition. `src/app.ts` injects identity verification, the sync and workspace stores, the cursor codec, and request logging. Feature modules own access grants, sync transport and cursor rules, workspace saves, participant exports, the learning catalog, and progress measurement projection. Cloud authentication uses Firebase ID tokens and a PostgreSQL identity directory. Operator access requires the server-owned operator grant and a signed Firebase TOTP sign-in factor. The API and client validate transport payloads through `@levelmaxing/contracts`.

## Local harness

From the workspace root:

```sh
pnpm dev:setup
pnpm dev:api
```

The setup creates ignored development credentials under `.local`. The Node adapter listens on `127.0.0.1:4321` by default. The local store lives in a single Node process and resets when it exits. Use separate participant credentials for tenant isolation or the same participant credential on two devices for sync. Operator credentials can probe the operator route. Devices and measurement IDs are UUIDs. The API reports its window epoch so a client can detect that the local state has changed after a restart.

| Route | Scope | Result |
| --- | --- | --- |
| `GET /healthz` | Local liveness | `{ "status": "ok" }` |
| `GET /v1/session` | Participant | Verified account ID used by the app to select its local store |
| `POST /v1/devices` | Participant | Current device generation and account epoch |
| `POST /v1/sync/push` | Participant | Ordered results and committed weight revisions for the first supported command |
| `GET /v1/sync/pull` | Participant | Account-bound, ordered revision groups and a cursor; optional `limit` from 1 to 100 |
| `GET /v1/workspace?section=…` | Participant | Latest profile, training, nutrition, or journal snapshot for the signed-in account |
| `POST /v1/workspace/batch` | Participant | Up to four conditional section reads in one request |
| `POST /v1/workspace/save-checked` | Participant | Save against both numeric version and the observed representation |
| `POST /v1/workspace/save` | Participant | Atomic version-checked save and idempotent receipt for one section |
| `GET /v1/history` | Participant | Bounded archived meal or workout records, ordered by date and ID |
| `POST /v1/history/move` | Participant | Atomic archive or restore of up to 20 selected records |
| `GET /v1/account/export/history` | Participant, recent sign-in | Export page for the selected archive |
| `GET /v1/account/export?cursor=…` | Participant, recent sign-in | Current committed workspace sections and a pinned page of weight revisions |
| `GET /v1/library` and `GET /v1/library/guide` | Participant | Search, paginate and read the bundled original guides |
| `GET /v1/admin/access` | Operator with MFA | `{ "role": "operator" }` |

The first sync command appends a weight record with immutable measurement ID, integer grams, and a calendar date. Its identity is derived from device ID, generation, and sequence. Repeating an accepted command is safe. Changing an already-used sequence or resending an existing measurement ID yields an explicit conflict. Cursors are HMAC-protected, expire after 30 days, and carry their high-water revision while a read window spans pages. The Node adapter emits request identifiers, route names, duration, and status. The logs omit account IDs, credentials, and health data.

An empty workspace section returns `{ "version": 0, "value": null }`. Send `section`, the last observed version as `expect`, a fresh UUID as `operationId`, and the typed section `value` to save. A successful save increments that section's version. A stale save returns `outcome: "conflict"` and the snapshot current when the command was evaluated. Identical retries return the original result. Reusing the UUID for a different command within the same account returns HTTP 409. Workspace save requests are capped at 256 KiB.

Batch reads accept `{ "sections": [{ "section": "profile", "known": null }] }`. The response preserves the requested order. Each entry includes an account-scoped representation tag and the versioned snapshot. Reuse the returned tag as `known` to receive a null snapshot for that unchanged representation. A restore that changes content at an existing version still returns the changed snapshot. Existing single-section reads and save receipts keep their wire contracts.

Checked saves carry `{ "command": { … }, "known": "…" }`, where the command is the existing save envelope. The server checks the authenticated account, replays a previously committed receipt first, then checks the representation as part of the same write. A stale version or a changed document at the same version returns a conflict. Applied checked receipts also carry the tag of the exact saved version, so consecutive edits can use it without a separate read. Compatible rollback uses the legacy endpoint with a fresh read to catch already-observed divergence. The legacy commit remains version-only, so production restores must fence older clients from writes. The cloud adapter calls the original reads only when PostgREST explicitly reports the batch function absent.

Meals and completed workouts can move between the legacy active view and a record-level archive. A move is explicit and checks the active section's version and tag. A restore also checks each archived record's tag, so an active projection that looks identical after recovery cannot conceal different archived content. Respond with an existing receipt for an exact retry, or conflict if the selected representation changed. Restores that would exceed active capacity preserve the archive. Older workspace writers see a normal conflict if they include an ID that is still archived.

Archive pages accept `kind=meals|workouts`, an optional `limit` from 1 to 20, and both `beforeDate` and `beforeId` for continuation. Meals use their logged date. Workouts use the UTC completion date. The indexed keyset follows date and then ID descending and caps response data at 1 MiB. Archive export uses the same ordered pages behind recent-auth verification. Its pages reflect the live archive, so keep it unchanged while exporting. The existing export remains the active workspace and pinned confirmed weights.

Export requires a participant JWT with Firebase authentication from the last five minutes. The first page includes four current workspace versions and at most 20 confirmed weight revision groups. Later pages contain only weight groups pinned to the first page's high-water mark. The cursor is signed and scoped to the account and export purpose. Workspace and weight use separate consistency boundaries. The export excludes tokens, internal receipts, archived workspace versions and unsynced native records. Responses use `Cache-Control: no-store`. [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

The library lists bundled guides by optional search and category with a stable continuation ID. Detail is keyed by the existing bookmark ID. The same content bundle ships in mobile for offline access. Additional media and a publishing workflow require editorial approval.

## Verify

```sh
pnpm --filter @levelmaxing/api typecheck
pnpm --filter @levelmaxing/api test
```

Loopback tests exercise the real HTTP listener, authorization, two-device sync, replay, ordered paging, malformed bodies, cross-account isolation, and CORS. Workspace tests cover concurrent first writes, stale versions, exact replay, changed operations, and account isolation. Cloud fixture tests verify signed tokens against an injected key service and exercise the scoped RPC contract, UID mapping, provider failures, and operator denial. The tests use process memory and synthetic fixtures.

Local append and per-command replay checks take expected `O(1)` time per operation, with `O(n)` total memory for devices, receipts, and changes retained over the life of the process. A pull reads `O(p)` groups for page size `p`, capped at 100, and a push handles at most 50 commands and 256 KiB. The hosted adapter expects bounded indexed reads and transactional sequence, receipt, and change writes from its RPC implementation.

## Hosted contract

The Edge adapter is composed in `backend/supabase/functions/api`. It requires `FIREBASE_PROJECT_ID`, `SUPABASE_URL`, a publishable Supabase key, and `LEVELMAXING_CURSOR_SECRET`. Configure Firebase third-party authentication on Supabase and issue the Firebase `role: "authenticated"` claim through trusted administration. [Supabase Firebase integration](https://supabase.com/docs/guides/auth/third-party/firebase-auth)

Node and Edge use the same configuration reader. Node prefers `SUPABASE_PUBLISHABLE_KEY`, Edge prefers `LEVELMAXING_PUBLISHABLE_KEY`, and both fall back to `SUPABASE_ANON_KEY` if their preferred variable is absent.

The Access feature verifies the RS256 signature against Google's fixed Secure Token key set, pins issuer and audience to the configured project, and verifies the token's validity dates and provider. The resolver passes the same Firebase ID token to `levelmaxing_resolve_firebase_user_v1` with an empty request body. PostgreSQL uses the verified subject to find the account's unique `firebase_uuid`. The draft provisions an unlinked, verified UID as a participant on first sign-in. The API preserves the internal account UUID in session, cursor, and sync contracts. An existing account association requires an approved exact Firebase UID match. The resolver looks up the active role on each authenticated request. Firebase-only revocation takes effect as ID tokens expire unless the application directory disables the account sooner. [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

The weight-sync and identity RPCs are documented in the engineering foundation. Workspace persistence pairs `levelmaxing_workspace_read_v1` and `levelmaxing_workspace_save_v1` with the additive batch and checked-save RPCs. Each RPC resolves the active account from the Firebase token. PostgreSQL also validates write payloads. An explicit missing additive RPC allows compatible rollout. Other provider failures and invalid responses fail closed. Live credentials, production schema, deployment, and hosted integration checks remain owner-operated steps. [Engineering foundation](../docs/engineering/foundation.md) · [Database drafts](database/README.md)
