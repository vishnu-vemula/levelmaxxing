# Levelmaxing repository instructions

Read [Start here](START-HERE.md), [current architecture](docs/engineering/foundation.md) and the [release ledger](docs/engineering/delivery-status.md) before changing a feature. The [full-release plan](docs/product/01-release-plan.md) defines the whole product. Keep these instructions subordinate to the user's current and global requirements.

## Placement and compatibility

- Work in the feature that owns the user-visible outcome. Backend features in `backend/` expose a public `index.ts`. App composition injects infrastructure, identity, persistence and clock/transport as needed. Feature domain code does not import HTTP servers, environment variables, vendor SDKs or another feature's internals.
- Treat `packages/contracts` as the versioned public wire boundary. App implementations stay in their own deployable. Parse untrusted data at entry boundaries. Keep transmitted operation bytes immutable, and preserve idempotency and older client compatibility.
- Keep native route files in `mobile/` and web entrypoints thin. UI state has one owner. Offline intent belongs in the account-scoped store. Device state or an account in a request body never grants authorization.
- Use the documented light/dark roles from `packages/design-tokens`. Preserve native accessibility, Dynamic Type or text scaling, reduced motion, platform navigation and keyboard focus.
- Keep logs free of bearer tokens, credentials, Firebase UIDs, health values, personal data and request bodies. Keep environment values and local access material out of source control. Auth, security, data storage and privacy changes get an independent review.

## Safe harness

- Inspect all hooks before executing commands. Use `pnpm check`, `pnpm build:admin`, `pnpm test:operator`, `pnpm bundle:mobile` and `pnpm test:watch` as relevant. See the [harness](docs/engineering/harness.md) for what they prove. Verify a real authorized test endpoint when behavior crosses the API boundary.
- SQL under `backend/database/drafts/` is static, owner-operated input. Never execute database migrations, schema synchronization, resets, destructive data operations or migration-backed tests. A human operator owns application, database-backed migration testing, backfills, rollback and deployment.
- Never create, switch, merge, rebase, delete or rename Git branches. Preserve all user changes and protected branches. Commit or push only when the user authorizes that exact operation. Never change production credentials, signing, capabilities, entitlements or release targets unless explicitly requested and required.
- Use isolated fixtures, bounded external or local work, and deterministic tests where they distinguish regressions. Read the [agent workflow](docs/engineering/agent-workflow.md) for Codex and Claude commands and evidence expectations. Keep the prototype separate from the release implementation and use fictional data for local development.
- Record what ran, what was observed, and which evidence is still open. Update the delivery ledger only when new evidence changes a slice's state.
