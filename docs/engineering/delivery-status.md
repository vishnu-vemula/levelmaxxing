# Levelmaxing delivery status

This ledger tracks the native app against the [full release register](../product/01-release-plan.md). The release app uses the supplied Level Maxing HTML as its visual reference. The standalone browser prototype is still available under [prototype](../prototype/README.md).

| Requirement | Native app and API | Release work still open |
|---|---|---|
| F01 · Identity, onboarding and preferences | Firebase email sign-in, account creation and reset screens, encrypted session vault, verified UID-to-account mapping, four-step onboarding, optional calorie target and kg/lb. | Live Firebase Email/Password and claim provisioning, hosted account binding, revocation and lifecycle acceptance. |
| F02 · Training programs | Starter and manual programs, exercise edits, weekday schedule, duplication, activation and substitution. | Immutable program versions, future-dated activation, reviewed content and equipment-based recommendations. |
| F03 · Workout execution | Start and resume, edit sets and load, deadline-based rest timer, substitutions, history, sharing and reversible archive. | Progression proposals, retention approval and verified Watch phone handoff. |
| F04 · Nutrition diary | Dated entries, editable quantities and meal groups, macro totals, target view, repeat meals and a record-level archive. | Licensed catalog packs, unbounded active logging and hosted archive verification. |
| F05 · Food input | Manual entry, package label transcription and validated typed barcode matching against personal logs. | Camera scanning, catalog lookup, OCR, photo and plain-text estimation. |
| F06 · Recipes | Ingredient nutrition, serving calculations, recipe editing, duplicates, sharing and logging portions. | Versioning, secure import and shared recipe access. |
| F07 · Check-ins | Dated sleep, appetite, energy and notes, history and corrections. | Reviewed coaching rules, proposal acceptance and effective dates. |
| F08 · Coaching | Daily review derived from training, food and check-ins. | AI provider, jobs, quotas, review and proposal acceptance. |
| F09 · Progress and activity | Synced weight, trend and history views, workout history, manual activity and check-ins. | Physical device verification, weight corrections, advanced analytics and progress media. |
| F10 · Cycle | Release interaction and architecture design. | Consent, encrypted storage, privacy validation and export/deletion. |
| F11 · Grocery prices | Editable grocery lists and user-entered store price observations. | Retailer feeds, locale/currency policy, freshness and attribution. |
| F12 · Exercise content and lessons | Versioned participant API for the original guides with search, detail, offline fallback and existing bookmarks. | Full catalog, media, rights, content reviews and publishing. |
| F13 · Reminders, localization, accessibility and support | Shared light/dark tokens, accessible component labels, focus styles, native navigation, empty/error states and sync recovery. | Native assistive-technology verification at large text, Hindi coverage, reminders and support lifecycle. |
| F14 · Platform integrations | Existing SwiftUI Watch companion and tested account-bound rest model. | iPhone responder, physical pairing, Apple Health, Health Connect, Samsung, Strava and Live Activities. |
| F15 · Paid access and data control | Server-checked roles, encrypted local storage, and fresh-auth export of current workspace records, confirmed weights and paginated archive records. | Billing, restoration, webhooks, processor/export scope, erasure, backup and recovery rehearsals. |
| F16 · Operations | Existing React operator console with service health, staff verification and Firebase TOTP flow. | Production MFA, web proxy, operator data access, publishing and audit. |

## Current integration boundary

The app keeps profile, training, nutrition and journal data in four versioned sections. The encrypted local store keeps the current view and immutable in-flight save across restarts. The Node listener isolates test accounts through the same route layer used by Edge. The Postgres draft derives account identity from the verified Firebase JWT and compares the expected version and records a retry receipt in the same transaction. Weight retains its separately versioned, append-only sync contract. Workspace polling batches up to four reads and downloads only changed representations. Checked saves fence same-version restores under the write lock and carry the exact acknowledged representation for subsequent writes. Independent food and journal edits can be combined after a conflict.

Loopback tests cover offline persistence through an injected store, a lost response after server commit, matching data on a second installation, account isolation and a competing edit. They also exercise the documented Edge-style URL prefix. The dependency-boundary and TypeScript checks and all 110 tests passed. The iOS and Android Hermes exports passed. All six SQL drafts parsed without a database connection. A running synthetic API verified the four-to-one poll request reduction, no intervening read between healthy checked writes, exact replay, scoped export pagination, reversible archive, restore content checks and the library rollback path. Actual hosted query plans, restore isolation and two-device behavior require the approved environment. Native SQLCipher and backup behavior, on-device layout and accessibility, and live Firebase/Supabase behavior require owner-operated verification.

Snapshot writes and validation grow linearly with section size. Active save requests remain limited to 256 KiB. Users can move older foods and completed workouts to a paginated record-level archive and restore them. Per-record writes for active sync and hosted query-plan and retention verification remain open. The draft retains historical versions and receipts. Approve a retention and erasure policy and a rate limit before storing real health or journal data. The app's visible removal controls remove records from the latest view. Full account erasure is open.

No database migration, schema synchronization, cloud publication, signing operation, branch operation, commit or push was performed.

## Backend release evidence and dependencies

| Release cards | Observable check | Environment and evidence needed |
|---|---|---|
| S01–S02 | Preserve legacy weight and workspace contracts. An unchanged poll returns only metadata. A restored document at the same version is detected on reads and checked writes. | Synthetic loopback journeys, signed fixture adapters, SQL grammar and owner-prepared PostgreSQL with Firebase claims, then two real devices. |
| S03–S06, S09, S12 | Keep workout and diary history correct through corrections, versioning and restore. | Archived meals and workouts now keep stable IDs through a version-checked move and indexed browse. Active per-record sync must preserve existing IDs and older snapshot clients. Reviewed exercise/recipe policies, media retention and native acceptance remain open. |
| S05, S07–S08, S11, S13–S14, S18 | Offer qualified proposals, camera and catalog lookup, meal estimates, cycle privacy and regional prices with honest unavailable states. | Reviewed fitness and privacy rules, approved catalog/OCR/AI/retailer providers, contractual terms, budgets and independent evaluation. |
| S10 | Read stable, versioned original guides from the same API on local and hosted runtimes. | Backend route and mobile fallback can be exercised with bundled content. Rights-reviewed media and editor publication/revocation remain open. |
| S15–S16, S19 | Reconnect and deduplicate approved health/native flows and verify accessibility/localization. | Real accounts and supported native hardware are required for Health Connect, HealthKit, Strava, Watch, Live Activities and assistive technology. |
| S17 | Export committed account records after fresh Firebase authentication. | Loopback and signed-token fixture coverage for export. Store sandbox, end-to-end erasure, retention policy and recovery drills remain open. |
| S20–S21 | Verify scoped operations and controlled recovery and release. | Owner-provisioned roles, accepted retention/restore drill, supported device matrix and release approval. |
