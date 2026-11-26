# Levelmaxing delivery status

This ledger tracks the native app against the [full release register](../product/01-release-plan.md). The release app uses the supplied Level Maxing HTML as its visual reference. The standalone browser prototype is still available under [prototype](../prototype/README.md).

| Requirement | Native app and API | Release work still open |
|---|---|---|
| F01 · Identity, onboarding and preferences | Firebase email sign-in, account creation and reset screens, encrypted session vault, verified UID-to-account mapping, four-step onboarding, optional calorie target and kg/lb. Today has week and month browsing with diary navigation. | Live Firebase Email/Password and claim provisioning, hosted account binding, revocation, locale and week-start settings, and native calendar acceptance. |
| F02 · Training programs | Starter and manual programs, exercise edits, weekday schedule, duplication, activation and substitution. | Immutable program versions, future-dated activation, reviewed content and equipment-based recommendations. |
| F03 · Workout execution | Start and resume, edit sets and load, deadline-based rest timer, substitutions, history, date corrections, field-by-field recap sharing and reversible archive. | Native history and share sheet acceptance, progression proposals, retention approval and verified Watch phone handoff. |
| F04 · Nutrition diary | Dated entries, editable quantities and meal groups, macro totals, target view, copy individual foods or meals to a chosen date and meal, and a record-level archive. | Native offline copy acceptance, licensed catalog packs, unbounded active logging and hosted archive verification. |
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

## Incremental delivery checkpoint · 25 November 2026

The goal is to complete the [release board](../product/01-release-plan.md) through user-facing increments and record physical-device and service evidence for each. These increments use the existing account workspace and API. Calendar weeks start on Monday, consistent with the diary. Its overview covers active records and the recent weigh-ins already loaded by Progress. Date corrections move a completed workout to the selected local date, preserving the logged sets and elapsed duration. A copy keeps the exact food snapshot and creates new IDs. Shared recap fields start unselected.

| Card and increment | State | Evidence | Blocked by and resume condition | Blocks |
| --- | --- | --- | --- | --- |
| S01 / F01 · Browse dates from Today | Verifying | Week/year boundaries, leap-month navigation and date aggregation passed at the model layer. | Install the native build and verify date selection, return to today, large text and diary navigation on Android. Hosted identity and device acceptance still apply to S01. | S02, S10, S17, S20 |
| S04 / F03 · Correct the date of a completed workout | Verifying | Date validation, stale changes, same-day no-op, elapsed duration, history order, v1 parsing and second-client sync through the API handler passed. | Verify editing, cancellation, History and Progress updates on a native build. S03 and hosted/device requirements still apply to S04. | S05, S13, S16, S19, S21 |
| S04 / F03 · Share selected recap fields | Verifying | Payload allowlist tests passed. An independent check exercised all 32 field combinations. Set editing keeps its draft until the user exits editing. | Verify the preview and native share sheet with a synthetic workout and dismiss without sharing externally. | S04 acceptance |
| S06 / F04 · Copy a diary entry or meal | Verifying | Source snapshots, invalid dates, stale entries, independent IDs, offline restart, second-client sync and account isolation passed using the real API handler in-process. | Verify one item and a whole meal from the phone, including an offline restart and target-day totals after reconnect. S02 and approved catalog coverage still apply to S06. | S07, S08, S09, S13, S19 |
| Physical Android and loopback API | Blocked | The Windows SDK is present. ADB failed to create its server socket. A separate TCP client probe to localhost returned `EACCES`. | Run in a session with a working ADB server, a USB-authorized device, package registry access and loopback TCP. Use the local synthetic API for the first device checks. | Native acceptance above, S02 and subsequent hardware checks |
| Publish increments to `main` | Blocked | The authorized GitHub integration can read the repository. Creating a Git tree returned HTTP 403. The managed checkout denies write access to its Git index. | Use write access to the authorized checkout and remote, or a GitHub integration with repository Contents write permission. | Publication of these increments |

Nine focused cases passed using Node with cached tooling because the pinned pnpm install could not reach the package registry. The boundary check and TypeScript/TSX transpilation passed. The two client journeys exercised the actual Fetch API handler and injected memory storage. A separate run of all 118 test cases with cached tooling passed 95. Of the 23 failures, 21 reported `EACCES` on loopback connections and two failed assertions in the affected TCP journeys. Live localhost verification, full TypeScript workspace checking, mobile bundling, device installation and hosted acceptance remain open. The immediate release frontier is S01 on the physical phone, then S02 with a second test client and a reachable isolated API. Production work follows the original dependencies and its owner-approved provider, content, privacy and rollout gates.

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

## First release slices · 25 November 2026

The [release execution board](../product/01-release-plan.md#release-execution) links these increments to their native, hosted and provider dependencies. The workspace contract and PostgreSQL schema require no change for either increment.

| Slice | Observed evidence | Still open |
| --- | --- | --- |
| S01-A · Recover setup choices | `onboarding.test.ts` and `onboarding-journey.test.ts` verified validated checkpoints, resume after reopening persisted state, use on a second same-account client, an empty profile for a different account, and conflict rejection before a stale save. Finished-profile edits still require a final save. | Physical app startup and account switching must verify SQLCipher storage and route behavior. With no muscle priorities saved, reopening can return to the optional page. Live Firebase binding and roles remain S01-C. |
| S02-A · Recover workout and meal after receipt loss | `workspace-journey.test.ts` verified real workout actions, manual meal values, two restarts, byte-identical checked-save replay, one result on the second client, third-account isolation, and transport replacement during the durable write. | The tests use captured synthetic inputs, a serialized memory disk and the real request handler in-process. Live TCP, the native disk and hosted PostgreSQL still need S02-B. |
| E01 · Android test environment | `adb devices -l` failed because the daemon could not start. A separate HTTP client could not connect to a bound loopback server (`EACCES`). The pinned dependency installation cannot resolve registry packages in this session. | Run the [USB device steps](../../mobile/README.md#physical-android-over-usb) from a runner with authorized USB, localhost networking and package access. Keep the test API on loopback. |

Before a non-empty checked write is sent, the controller persists its representation tag beside the existing pending command. This adds one local snapshot write the first time the tag is used for that operation. A replacement connection or restored process reuses it. Acknowledging the operation clears that tag before the next queued command begins. Earlier replicas without a tag remain readable.

The focused suite passed nine tests. The import boundary check and scoped TypeScript check passed. A broader run using cached tooling passed 100 of 123 tests. Twenty-one failures reported the denied localhost connection and two additional assertions failed in affected TCP journeys. Native bundling and installation, hosted verification and the full release remain open.

## Android verification checkpoint · 25 November 2026

GitHub `main` was verified at `aa25c3361adc259632d8146d4b142384c6731699`. It includes the earlier S01-A and S02-A work. The current checkout adds one Android build-input repair and this checkpoint.

| Check | Observed result | Required to close |
| --- | --- | --- |
| Android Kotlin source discovery | Kotlin 2.2.21 failed when its fixture source directory contained the tracked binary AppleDouble file under the Android private-storage module. Removing that verified metadata file let the same fixture compile and emit its class. `.gitignore` ignores future AppleDouble files. The Kotlin module source was preserved. | Build the app with Expo/Gradle to verify the native module and install the APK before claiming device acceptance. |
| App and sync logic | All 61 mobile tests and nine focused S01/S02 and regression checks passed with cached tooling. The import-boundary and scoped TypeScript checks passed. The broader run passed 100 of 123 tests. Twenty-one reported `EACCES` on loopback and two follow-on assertions failed in those TCP scenarios. | Run the frozen install, full `pnpm check`, native bundling, and the operator browser check from an environment with real localhost access. |
| Attached phone | Android SDK and Java are present, but `adb devices -l` could not start its daemon. Local TCP returned `EACCES`. The pinned pnpm bootstrap could not reach its registry and the available offline cache was incomplete. No device connection, APK build or install was observed. | Use an execution session that can access USB and localhost and can reach the npm and Android build repositories. Once ADB lists the authorized phone as `device`, use the [USB setup](../../mobile/README.md#physical-android-over-usb), then run S01-B and the local part of S02-B with a second installation. |
| Hosted staging | The repo declares Supabase PostgreSQL for hosted records and Firebase Auth for identity. The local test backend uses process memory and the phone uses SQLCipher. No Levelmaxing hosted environment was available to this session. | Owner-prepared Supabase project and schema, Firebase project with test users and the required claim, deployed test HTTPS API, participant and TOTP operator accounts. Supply the values through the staging environment. |
| Publication | The local Git index is read-only and the GitHub integration returned `403 Resource not accessible by integration` for the Android fix. No new commit or push was created in this session. | Enable repository Contents write for the integration or use a writable checkout with an authenticated `origin` and authorized fast-forward access to `main`. |

The first Android pass uses locally generated development credentials and synthetic records. Hosted settings are documented in `backend/.env.example`, `mobile/.env.example` and `backend/admin/.env.example`. The mobile build takes the public Firebase client config, API URL and Supabase publishable key. The deployed API keeps `LEVELMAXING_CURSOR_SECRET` server-side. AI provider credentials are outside S01–S02. Use a project-scoped staging secret when S08 or S11 is implemented and ready for provider testing.

### Follow-up after the phone and environment update

- The Firebase project IDs and public Supabase keys in the mobile and backend environment files agree. The mobile API URL was blank. After the owner selected the synthetic API, the ignored mobile development file was set to `http://127.0.0.1:4321` with local authentication enabled. The hosted values were preserved. The backend file has no `LEVELMAXING_CURSOR_SECRET`, and its Supabase origin matches the project labeled Production. An isolated hosted test endpoint is still needed for S01-C and hosted S02-B.
- The cloud app could be composed in-process using the configured public values and an ephemeral cursor secret. Its health handler returned 200, and unauthenticated session access returned 401. The injected upstream adapter received zero requests. This leaves the deployed Edge endpoint, Firebase sign-in, and PostgreSQL persistence unverified.
- The synthetic API started on port 4321 using cached dependencies. A TCP request to its health endpoint returned `EACCES` from the Codex Windows session, and the temporary process was stopped. ADB could not start in that session, and npm DNS resolution failed. The Android SDK and Java are present. No native build or installation was observed.
- The 62 mobile and contract tests and nine targeted workspace checks passed using cached tooling. The import boundary check passed. Resume E01 in a session that can see an authorized USB device and reach localhost and build dependencies. Keep the first device test on the synthetic API, or supply an isolated hosted API and test identities for hosted verification.

### Windows USB build recheck

- Removed 28 additional files with verified AppleDouble headers from the app route tree and the Android private-storage module. The source files remained intact. The root ignore rules now cover generated Expo native projects. The USB instructions start Metro on localhost and use ADB reverse for Metro and the synthetic API.
- ADB 37.0.0 failed before device enumeration. Running its server in the foreground reported `failed to create fdevent interrupt socketpair: Invalid argument`. A separate Node probe bound `127.0.0.1` successfully and got `EACCES` when connecting to it.
- The copied dependency links are macOS `XSym` files. Node could not resolve Expo, React Native, or the development client. The pinned pnpm 10.28.1 bootstrap failed at npm DNS resolution, and the local cache lacked the pinned tool. The frozen install, native build, APK installation and launch remain open.
- The import-boundary check and all 62 mobile and contract tests passed with cached tooling. Seven of eight onboarding and workspace journeys passed. The remaining loopback HTTP journey could not reach its simulated lost-receipt step in this session.
- The owner confirmed that regular Windows PowerShell lists the USB phone as `device`. The managed session still received `EACCES` connecting to the host ADB port and was denied npm DNS resolution. Three ignored dependency directories containing the macOS links were moved into an ignored backup so a Windows frozen install can recreate them. Native build and launch remain open.

### Android prebuild and bundle recheck

- Windows workspace dependencies now resolve locally. `expo config --type public`, `expo prebuild --platform android --no-install`, Android module resolution and `expo export --platform android` passed. Autolinking includes `expo-dev-client`, `expo-sqlite` and `levelmaxing-private-storage`. The generated Android project has the SQLCipher flag and permits the local HTTP connection in debug builds. Metro compiled 1,430 modules into a 3.8 MB Android Hermes bundle.
- Gradle's wrapper requires 9.3.1. It failed to resolve `services.gradle.org` before starting. A separate offline attempt with the already cached Gradle 9.4.1 failed to connect to its local daemon, including with `--no-daemon`. ADB also failed before enumeration in the managed session. No native compilation, APK installation or on-device test was observed.
- Fixed the Windows backend test glob, which previously selected zero cases, and aligned the onboarding harness import with the public contracts entry used by the other journeys. All workspace TypeScript checks and the import-boundary check passed. With installed dependencies, 100 of 123 cases passed across the package and journey runs. Twenty-one failures reported localhost `EACCES` directly and two assertions failed in the affected TCP journeys.

### Gradle wrapper update

- Android prebuild now pins Gradle 9.4.1 and its published distribution checksum. Two native generations produced identical wrapper properties, and the generated wrapper reported Gradle 9.4.1 from the local distribution cache with Java 21.
- The updated wrapper reached Gradle startup without downloading Gradle 9.3.1. `:app:assembleDebug --offline --no-daemon` still failed to connect to the single-use daemon after it bound to localhost. The native compile, APK and physical tests remain open.

### Direct offline Android build recheck

- Matching the launcher JVM settings allowed Gradle to configure the project without a daemon. Java reported the existing React Native plugin directories as unwritable in the managed checkout. A temporary copy could be written to, but creating the workspace's dependency junctions there returned `EPERM`.
- A separate offline Gradle resolver ran in a writable directory and confirmed that `com.facebook.react:react-android:0.86.3` is absent from the dependency cache. The managed shell denies Google Maven DNS and access to the ADB port. The physical APK build and device verification remain open.

- The owner's native PowerShell run reached USB port forwarding and then failed when Expo tried to resolve the ADB serial as a device name. The USB runner now calls Gradle to assemble the debug APK and uses the authorized serial for ADB install and activity launch. PowerShell 5.1 verified the command sequence with stubbed native tools. The debug variant still loads its JavaScript from Metro. A completed native build and device test remain open.

### Bare React Native Android migration

- Removed Expo and its transitive packages from the mobile dependency graph. Android now has a source-controlled React Native host, a typed screen table, plain Metro tooling, and an ADB build and install script. The script starts Metro and the synthetic API for device testing.
- The Android storage bridge uses SQLCipher 4.20.0, Android Keystore, and the existing encrypted filenames and preference format. Independent review checked the compatibility and backup rules and prompted fixes for key visibility, library load errors, keyed-connection checks, and overlapping opens. An upgrade test with an existing encrypted database remains open.
- The pinned frozen lockfile validation, workspace typechecks, import boundary check, 61 mobile tests, and Android and iOS JavaScript bundles passed. The managed native build resolved the React Native settings plugin and then stopped because Java rejected the existing plugin subproject directory as unwritable. The USB runner also could not reach ADB in this session. No APK or physical launch was verified. The iOS native application target and storage adapter remain open.

### Windows native build follow-up

- The owner's Windows PowerShell reached `:gradle-plugin:settings-plugin:compileKotlin`. Its daemon log showed Kotlin metadata 2.3.0 from Gradle 9.4.1, while the installed React Native 0.86.3 plugin compiler reads through 2.2.0. The app wrapper now matches the plugin's Gradle 9.3.1 distribution and uses its published checksum. The wrapper JAR passed checksum verification. The host already has the required Java 17 compiler toolchain.
- The USB runner now validates the APK application ID and verifies the install through Android's package manager before starting the local services. It allocates available Windows ports while preserving the app's device-side ports. A PowerShell 5.1 fixture verified the command sequence. The real rerun on the updated wrapper and device acceptance remain open.

- The next Windows build passed the Kotlin stage on Gradle 9.3.1 and failed in `:app:buildCMakeDebug[arm64-v8a]`. Ninja 1.10.2 rejected the 271-character path of the safe-area library's generated `ComponentDescriptors.cpp`. The workspace now caps pnpm virtual-store directory names at 36 characters, and native autolinking tracks the installed pnpm layout. The USB runner performs one frozen relink on an old layout. Ninja reproduced the original failure and accepted an equivalent 247-character fixture. The updated host build and APK installation remain open.

### Bare React Native Android APK build

- Removed an unused launcher background that referenced a missing Expo splash asset. A staged Windows build with cached dependencies, Gradle 9.3.1, Java 17, and shortened native paths completed `:app:assembleDebug`. Android build tools verified the debug signature, `org.levelmaxing.app` package, launch activity and `arm64-v8a` native libraries. The debug app loads JavaScript from Metro. The USB script supports `-SkipBuild` to install the existing APK.
- The mobile TypeScript check, all 61 mobile tests, the Android Metro bundle, and the dependency-boundary check passed. Nine cross-workspace journey tests passed, including the onboarding restart and sync test. Six HTTP journeys failed where this session could not connect to the loopback test API. ADB could not start its daemon, so installation, launch and physical device acceptance remain open.

### Android launch without Metro

- The default debug build packages the Hermes bytecode and loads it locally. The USB script supplies the synthetic API settings at build time and uses Metro only for APKs without an embedded bundle. The script checks that the app process survives activity launch. PowerShell 5.1 fixtures exercised the embedded build, reuse of an embedded APK, and reuse of a Metro-dependent APK with stubbed device and service commands.
- The staged ARM64 `:app:assembleDebug` build succeeded. Android build tools verified the signature, alignment, package, and launcher activity. The packaged Hermes bytecode and loopback API URL were verified. TypeScript, the dependency-boundary check, all 61 mobile tests, and the onboarding restart journey passed. The real USB run stopped before device enumeration when ADB failed to create its interrupt socket pair. The session returned `EACCES` for a separate TCP connection to a bound localhost server. Device installation, launch, and on-device sign-in remain open.

### Physical Realme launch and local sign-in

- The first installation opened the Connect Levelmaxing screen because React Native's embedded bundle set `__DEV__` to false, disabling synthetic sign-in. Updated the embedded debug bundle configuration and verified the replacement APK's signature and alignment after packaging the corrected Hermes bytecode.
- Android Studio installed the replacement APK on the USB-connected Realme RMX3771 (Android 15). The physical phone opened the Welcome back screen with the Development account sign-in form. The managed shell still could not connect to ADB or Windows loopback, and a physical sign-in attempt returned a generic error. Run the USB script with `-SkipBuild` in regular Windows PowerShell to start the synthetic API and forward port 4321 before verifying authenticated screens.
