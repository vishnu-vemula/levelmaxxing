# Firebase identity and Levelmaxing users

Firebase Auth owns sign-in and token issuance. PostgreSQL owns the Levelmaxing user's internal ID, status, operator access and product data. The cloud API verifies Firebase ID tokens before asking the database to resolve that identity. The mobile app uses the backend-issued UUID for sync and encrypted local storage. [Firebase token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens) · [Firebase with Supabase](https://supabase.com/docs/guides/auth/third-party/firebase-auth)

## Identity model

| Field | Authority and invariant |
|---|---|
| `levelmaxing_private.users.id` | Stable PostgreSQL UUID used by existing app contracts, device registrations, change groups, receipts and domain foreign keys. |
| `firebase_uuid` | The exact, opaque Firebase UID from the verified token's `sub` claim. Stored as constrained, unique, case-sensitive **text**. The field name follows the product requirement. Firebase UIDs can contain characters outside a UUID. |
| `access_role` | Postgres controls participant versus operator. A newly resolved Firebase account receives participant access. Firebase's `role: authenticated` claim only selects the restricted PostgREST role. |
| `status` | Active or disabled. A disabled mapping continues to fence that identity while retained. Every hosted request resolves this status, and the sync RPCs enforce their own account check. |

Each environment binds one Firebase project to the same project ID in the backend verifier, Supabase third-party integration and Postgres identity configuration. Issuer and audience are checked before mapping, and the private SQL helper checks them again for Data API calls. The supported project uses the default Firebase tenant. Anonymous and custom-token sign-in are outside the current email/password flow. A Firebase project change is an explicit identity migration.

## Request flow

1. The mobile or admin client signs in using Firebase's modular SDK. Mobile keeps session material in encrypted, backup-excluded device storage. Admin uses memory-only storage and prompts for an enrolled TOTP factor.
2. The client sends a Firebase ID token as a bearer. The API verifies the RS256 signature against Google's published Firebase keys, pins the project issuer and audience, checks ID-token time and identity claims, and rejects an untrusted token before storage access.
3. The API calls `levelmaxing_resolve_firebase_user_v1` with the same bearer and an empty request body. The resolver uses authenticated JWT claims to create or find one user, derives the persisted role, and returns the internal `accountId`. No email-based linking or caller-selected UID is accepted. Application logs omit UIDs and tokens.
4. The API authorizes the resolved role. Operator routes also require the signed Firebase TOTP factor. A participant sends a versioned device registration, push or pull. Each Postgres RPC independently derives the same active participant, even for direct Data API calls.
5. The client stores the internal UUID binding for that Firebase UID. A known session can use its local store during a network outage. First-time binding and online writes require verified backend identity.

The Firebase client SDK manages token refresh. The backend keeps the signing-key set bounded and does not cache an account role beyond its request. Disable the Levelmaxing mapping for immediate app access removal. Firebase bearer signature checks alone do not prove revocation of an already issued token. A release with existing hosted users must explicitly link verified Firebase UIDs to their existing internal UUIDs under reviewed evidence. Stop on mismatches or duplicates and leave queued data intact. [Firebase session management and revocation](https://firebase.google.com/docs/auth/admin/manage-sessions) · [Firebase TOTP](https://firebase.google.com/docs/auth/web/totp-mfa)

## Owner-operated hosted setup

1. Register Firebase client applications and enable email/password in the approved project. Configure Firebase Identity Platform and enroll TOTP for operator accounts. Supply only the public Firebase client configuration to clients. Keep personal, preview and production projects isolated.
2. Add the matching project as Supabase third-party Firebase authentication. Grant the restricted `role: authenticated` Firebase claim from an approved provisioning path and force token refresh after claim changes. Operator grants live in the application user table. [Supabase Firebase setup](https://supabase.com/docs/guides/auth/third-party/firebase-auth) · [Firebase custom claims](https://firebase.google.com/docs/auth/admin/custom-claims)
3. Review the [database drafts](../../backend/database/README.md) with the database owner, choose the target owner role and install the exact Firebase project ID before enabling access. The drafts are outside automatic migration discovery.
4. Set the hosted backend environment and admin same-origin proxy. The Edge entry delegates Firebase signature verification and endpoint authorization to the application. The Data API independently verifies scoped Firebase credentials and receives the Supabase publishable key separately. Use the Supabase CLI bundler that supports imports outside the function folder so the Edge runtime consumes the same contracts and backend source. [Supabase monorepo imports](https://supabase.com/changelog/33613-deploy-edge-functions-from-cli-without-needing-docker-import-files-outside-of-supabase-directory)
5. On approved test accounts, verify same-UID repeated and concurrent resolution, wrong project and UID, active/disabled status, operator with and without TOTP, direct Data API isolation, two devices and immutable replay. Record the results in the [delivery ledger](delivery-status.md).

No live Firebase project, service account, deployment or database operation is required to run the synthetic harness. Hosted Firebase acceptance and PostgreSQL execution remain human-owned and were not performed.
