# Engineering harness

Start with a frozen install. Run checks using the repository scripts, in this order when working on a release slice:

| Command | Evidence |
|---|---|
| `pnpm check:boundaries` | Parses static and dynamic literal imports. Enforces feature public entrypoints, package exports, app isolation and the Edge composition root. |
| `pnpm check:sql` | Optional `uv`-based parser check for SQL and PL/pgSQL drafts. It opens no database connection. |
| `pnpm typecheck` | Compiles each TypeScript workspace independently, including app integration call sites. |
| `pnpm test` | Runs deterministic contract, feature, auth and sync checks. The API suite listens on isolated local loopback and uses injected memory storage. Cross-workspace tests exercise the weight and workspace coordinators through their actual Fetch clients and the real API listener. Workspace coverage includes the hosted path prefix, lost receipts, competing edits, stale screens and account isolation. |
| `pnpm build:admin` | Produces the deployable admin bundle for the same-origin proxy contract. |
| `pnpm test:operator` | Starts a local API, Vite and temporary headless Chrome profile using ports 4321/5173. Verifies backend liveness, role denial and approval through the actual UI, reload and scoped session behavior, and a dark narrow layout at enlarged text size. Use `CHROME_BIN` if Chrome is installed somewhere else. |
| `pnpm bundle:mobile` | Bundles the JavaScript and assets for both native platforms. This does not sign nor launch a binary. |
| `pnpm test:watch` | Exercises the Swift model for account binding, rest timing and rejected snapshots. See the Watch README for unsigned build evidence. |

`pnpm check` combines architecture boundaries, typechecking and TypeScript tests. The standalone browser prototype suite is intentionally separate. Use it as a design reference or repeat legacy usability expectations, while recording release-app evidence under its own slice IDs.

## Add a slice

1. Name the F and S IDs in the delivery ledger, write the exact user-visible behavior and list affected contracts, persisted formats, test environments and privacy boundaries.
2. Pick a discriminating negative case before coding. For sync, preserve same request bytes after equivocal transport failure. Test sequence gaps, another account, bounded pulling and recovery from stale context. For adapters, test cancellation, unavailable provider, duplicate delivery and changed payload.
3. Keep SDK operations at the edge. Unit-test a feature with injected clock, storage and IO as relevant. Use real loopback HTTP for routes and a browser or device interaction when the UI is the user's entry point.
4. Run narrow checks first. State the expected response, resulting state and known unverified cases. If the feature touches an earlier wire or persisted format, exercise both versions and an outstanding queue with actual fixtures.
5. Update the delivery ledger with the command, scope and result. Native permissions, auth authority, privacy and backup behavior get review with real device evidence. Cloud constraints get evidence from an owner-provisioned environment.

Use synthetic fixtures and a bounded local test identity. Firebase tests sign real fixture JWTs with an ephemeral test key and inject the public keys and Data API responses. The loopback runtime accepts only its explicitly configured local credentials. Hosted signing, claim provisioning and database behavior require separate evidence. Test scripts create per-run data or memory state and clean only their generated artifacts. Backend services must fail closed on missing credentials or unsupported runtime configuration. Reviewers must be able to distinguish the development adapter, injected test transports and production authority from test descriptions and logs.
