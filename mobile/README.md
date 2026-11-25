# Levelmaxing mobile

Expo SDK 57 and Expo Router provide one native iOS and Android app. The supplied Level Maxing HTML informs the navigation, shared components, mascot and cobalt training, yellow nutrition and green progress surfaces. The app uses native typography and follows system appearance.

## Run locally

Install the root workspace dependencies and start the loopback API using the root setup instructions. Copy .env.example to .env.local and set the mobile values for the chosen environment.

| Environment | API base | Authentication |
| --- | --- | --- |
| iOS Simulator | http://127.0.0.1:4321 | Set EXPO_PUBLIC_ENABLE_LOCAL_AUTH=1. Sign in with the participant token in the root developer access file. |
| Android Emulator | http://10.0.2.2:4321 | Same explicit development mode and participant token. |
| Hosted | HTTPS API base. For Edge Functions include the full functions/v1/api prefix. | Set `EXPO_PUBLIC_FIREBASE_API_KEY`, `EXPO_PUBLIC_FIREBASE_PROJECT_ID`, `EXPO_PUBLIC_FIREBASE_APP_ID`, and the Supabase Edge ingress publishable key. Sign in with your Firebase email and password. |

Start Metro with `pnpm --filter @levelmaxing/mobile dev` from the repository root. A native Expo **development build** with SQLCipher and the backup-excluded storage module is required. The Expo Go binary cannot use these paths. Local mode is checked in development only and expects a loopback API. Use synthetic records with the local API. Native provisioning, development signing and any environment setup that could apply schemas remain owner tasks.

To exercise the native journey with synthetic data, sign in and finish onboarding. Activate a program, start a workout, log a set and finish the session. Add a food entry or log one portion of a recipe. Record a weigh-in and today’s check-in. Use **Sync now** in Settings on both installations to compare the same account. Make a change while offline and sync after reconnecting. **More** opens workspace recovery when edits compete. Independent food and journal changes can be combined. Edits to the same record still need a choice. Starting a fresh local API process clears its server memory and can also trigger version review. Weight uses its existing cursor and epoch recovery.

## Native screen map

| HTML screen | Native route or state |
| --- | --- |
| Splash and Account Access | Account boundary, Firebase email sign-in and registration, reset and offline states |
| Onboarding | `/onboarding` with goals, schedule, equipment and preferences |
| Today | `/` with training, food and progress based on the signed-in account |
| Training Program and Workout Session | `/program` and `/workout` |
| Nutrition Diary and Add/Edit Food | `/nutrition` and `/food` |
| Recipes and Saved Meals | `/recipes` |
| Progress/History and Check-Ins | `/progress` and `/check-in` |
| AI Coach | `/coach` with a daily review from saved logs |
| Learning Library | `/library` |
| Groceries and Account/Settings | `/groceries` and `/settings` |
| Error | Shared notices, route retry screen and `/more` sync recovery |

## Archive older logs

Open **Food archive** from Nutrition or **Workout archive** from workout history. Select currently synced entries to archive them with their original IDs, dates and values. Archive browsing is paginated. Restore entries to include them in the active diary or active workout history again. Archived records stay outside the active totals and set suggestions. Restoring a workout puts it back in chronological order. Moves require an online, synced account and a server with the archive feature. If the response is interrupted, the app keeps the original move in account-scoped secure storage so it can check the same receipt when you return.

## Export synced records

From **Settings**, choose **Export active records and weight**, **Export archived meals**, or **Export archived workouts**. Hosted accounts confirm their Firebase password before preparing the first page. The active export includes the four current synced workspace sections and confirmed weight history. Archive exports page through the records currently in the selected archive. Sync pending edits first. Each JSON page can be shared with a destination you choose. Large pages are split into numbered JSON text envelopes. To reconstruct a split page, decode each envelope and concatenate the `payload` strings in `index` order for the same `exportId` and `page`.

## Firebase account binding

Use the public app configuration from the same Firebase project configured in the backend, with Email/Password authentication enabled. The backend resolves each verified Firebase UID to a Levelmaxing account UUID. The first binding on each device needs the backend online. After binding, the same authenticated Firebase user can access their encrypted offline entries if the network is temporarily unavailable. The Firebase credential, binding and offline eligibility are encrypted in a vault scoped to the Firebase project, app registration and API base. Explicit access denial or a different UUID reported by the backend locks offline access and preserves the original binding.

The progress database keeps the existing Levelmaxing UUID in its scope. Preserving that UUID and API base lets a user who signs in through Firebase regain access to existing queued entries. Supabase still hosts PostgreSQL and its public API key is used for hosted ingress. Firebase supplies the user identity token. [Expo Firebase setup](https://docs.expo.dev/guides/using-firebase/) · [Firebase ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

## Ownership

- `src/app` keeps the route map and account-scoped navigation. The account layout uses `src/composition.ts` to inject the auth gateway, account-keyed store, token-scoped progress and workspace transports, and ID generator.
- `features/session` owns Firebase Authentication, explicit loopback authentication, account binding, isolation and sign-out.
- `features/progress` owns measurements, durable pending writes, synchronization and the progress screen.
- `features/workspace` owns the encrypted section replicas, retry and explicit version recovery. Profile, training, nutrition and journal own the user-facing flows.
- Session, Progress and Workspace own their API paths and response handling. `platform` supplies the generic request adapter and SQLCipher. The local Expo module supplies the nonpurgeable native directory.
- `shared` contains reusable presentation primitives. Only public feature entry points cross feature boundaries.

SecureStore holds a native-generated random key. The SQLCipher database is scoped to the environment and account, with a separate encrypted session vault. Android uses the app's no-backup directory. iOS explicitly verifies backup exclusion on Application Support before opening a database. A missing module or encryption support prevents opening a plaintext database. Sign-out hides account-scoped storage and preserves queued entries for the same account.

## Verification

Run the following from the repository root. They inspect or bundle code without launching the app or executing the SQLite schema.

```sh
pnpm --filter @levelmaxing/mobile typecheck
pnpm --filter @levelmaxing/mobile test
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 pnpm --filter @levelmaxing/mobile validate:config
EXPO_OFFLINE=1 EXPO_NO_TELEMETRY=1 pnpm --filter @levelmaxing/mobile bundle
```

Native SQLCipher startup, device backup behavior, large text rendering, physical two-device sync and live Firebase sign-in require a development build and approved test environment. The unit tests use injected storage and transport for the local sync and Firebase account binding paths. The [delivery ledger](../docs/engineering/delivery-status.md) tracks the provider and release flows.
