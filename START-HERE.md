# Start here · Levelmaxing

This workspace contains the initialized release codebase, the complete app design, and the earlier standalone prototype. The mobile implementation includes onboarding, training, food, progress, check-ins, a learning library, groceries and settings. Profile, training, nutrition and journal updates use the account workspace. Weight uses its existing append-only sync path. The operator console separately verifies API reachability and staff access.

| Path | Role |
|---|---|
| [Mobile](mobile/README.md) | Bare React Native Android app with Firebase Auth and account-scoped secure storage |
| [API](backend/README.md) | Top-level TypeScript modular monolith with injected Firebase verification, Postgres sync and transport adapters |
| [Admin](backend/admin/README.md) | React and Vite operator access, MFA flow and API service status |
| [Watch](mobile/watch/README.md) | SwiftUI watchOS target, Swift Package model and receive-side WatchConnectivity boundary |
| [Engineering foundation](docs/engineering/foundation.md) | Current data flow, dependency rules, trust boundaries and first slice |
| [Firebase setup](docs/engineering/firebase-identity.md) · [Database drafts](backend/database/README.md) | Firebase project binding, unique Firebase UID mapping, and owner-operated PostgreSQL setup |
| [Harness](docs/engineering/harness.md) | Checks, test data and device/cloud verification gates |
| [Delivery status](docs/engineering/delivery-status.md) | Evidence and open work across the full release |
| [Release plan](docs/product/01-release-plan.md) · [Production design](docs/product/02-production-architecture.md) · [Product design](docs/product/03-product-design.md) · [Build prompt](docs/product/04-build-prompt.md) | Complete-release scope, UI, architecture and implementation instructions |
| [Standalone prototype](docs/prototype/README.md) | Original clickable concept with a separate local server and its own test suite |

## Run the app locally

Use Node 24 and the pnpm version pinned in `package.json`. From this directory:

```sh
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev:api
```

The API listens on loopback port 4321 in development and uses an in-memory server store for that process. Enter synthetic data for testing. Device records persist through the encrypted client store. `dev:setup` generates local credentials in a private ignored file. Open it on your machine to copy the needed value, and keep credentials local. Two installations use the same participant credential for same-account sync. Use the second participant credential for isolation tests.

In another terminal, start the console:

```sh
VITE_LEVELMAXING_AUTH_MODE=local pnpm dev:admin
```

Open [the operator console](http://127.0.0.1:5173) and use the local operator credential. The Android development build includes SQLCipher. Follow the [mobile setup](mobile/README.md) for USB, Metro and build steps. Use synthetic data until the production storage and privacy review is complete.

## Production boundary

The API can run on a Supabase Edge Function through the entrypoint under `backend/supabase/`. Firebase issues the user token and PostgreSQL resolves its verified UID to the existing app account contract. Hosted Firebase, database application, provider approvals, store signing and physical verification are tracked in the full plan. Current code and validation status are recorded in the [delivery ledger](docs/engineering/delivery-status.md).
