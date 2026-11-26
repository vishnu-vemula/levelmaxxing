# Levelmaxing mobile

The Android app uses bare React Native 0.86 and the Android project in `mobile/android`. The debug APK embeds the app's JavaScript and assets. The screens, Firebase identity, API contract and account-scoped offline model share the existing feature implementation. The iOS application target and its native storage adapter are pending.

## Run on a USB-connected Android phone

Use Node 24, the pinned pnpm version, and Android SDK platform-tools. The React Native Gradle plugin uses a Java 17 toolchain, which Gradle can provision. Set up Android SDK Platform 36, Build Tools 36.0.0 and NDK 27.1.12297006. Unlock the phone, enable USB debugging, and accept the authorization prompt. In regular Windows PowerShell from the repository root, run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\android-usb.ps1
```

The script installs the locked Node dependencies if needed, builds an APK for the phone's CPU, and verifies the installation through Android's package manager. It starts the synthetic API on Windows port 4321, forwards device port 4321 over USB, and verifies that the app's activity starts and its process stays up. Use the participant token in `.local/access.env` and enter synthetic data. Keep PowerShell open while testing.

The debug APK is written to `android/app/build/outputs/apk/debug/app-debug.apk` under the mobile directory. Use Android Studio or run `gradlew.bat :app:assembleDebug` from `mobile/android` to build without installing. The wrapper pins Gradle 9.3.1, which matches the installed React Native plugin's wrapper. [React Native Android setup](https://reactnative.dev/docs/set-up-your-environment) · [Gradle checksums](https://gradle.org/release-checksums/)

To reuse an APK already built in this checkout, add `-SkipBuild` to the USB command. The new APK can open without Metro. Local sign-in and sync use the synthetic API over USB. The script starts Metro and forwards device port 8081 when installing an older APK that needs it or one built with `-PlevelmaxingUseMetro=true` for live JavaScript development.

For manual runs, set `APP_PUBLIC_API_URL` to `http://127.0.0.1:4321` on a USB device or `http://10.0.2.2:4321` on an Android emulator, and set `APP_PUBLIC_ENABLE_LOCAL_AUTH=1`. Run `pnpm dev:setup` and `pnpm dev:api` from the root. In a separate terminal, run `pnpm dev:mobile`. Hosted builds use a full HTTPS API base and the public Firebase and Supabase values described in `.env.example`.

To exercise the native journey with synthetic data, sign in and finish onboarding. Activate a program, start a workout, log a set and finish the session. Add a food entry, record a weigh-in and complete today's check-in. Use **Sync now** in Settings on both installations to compare the same account. Force-stop the app during setup and reopen it to verify progress persisted. Make an offline edit and verify it syncs once the connection returns. Sign out and verify the second account cannot see the first account's data. **More** opens workspace recovery when edits compete.

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

The progress database keeps the existing Levelmaxing UUID in its scope. Preserving that UUID and API base lets a user who signs in through Firebase regain access to existing queued entries. Supabase hosts PostgreSQL and its public API key is used for hosted ingress. Firebase supplies the user identity token. [Firebase ID tokens](https://firebase.google.com/docs/auth/admin/verify-id-tokens)

## Ownership

- `src/app` keeps the route map and account-scoped navigation. The account layout uses `src/composition.ts` to inject the auth gateway, account-keyed store, token-scoped progress and workspace transports, and ID generator.
- `features/session` owns Firebase Authentication, explicit loopback authentication, account binding, isolation and sign-out.
- `features/progress` owns measurements, durable pending writes, synchronization and the progress screen.
- `features/workspace` owns the encrypted section replicas, retry and explicit version recovery. Profile, training, nutrition and journal own the user-facing flows.
- Session, Progress and Workspace own their API paths and response handling. `platform` supplies the generic request adapter and SQLCipher. The Android storage module uses the nonpurgeable native directory.
- `shared` contains reusable presentation primitives. Only public feature entry points cross feature boundaries.

The SQLCipher database is scoped to the environment and account, with a separate encrypted session vault. Android uses the no-backup directory and Android Keystore. The storage bridge keeps the existing encrypted filenames and key format. An unavailable key or missing encryption fails closed. Sign-out hides account-scoped storage and preserves queued entries for the same account.

## Verification

Run the following from the repository root. They inspect or bundle code without launching the app or executing the SQLite schema.

```sh
pnpm --filter @levelmaxing/mobile typecheck
pnpm --filter @levelmaxing/mobile test
pnpm bundle:mobile
```

Native SQLCipher startup, device backup behavior, large text rendering, physical two-device sync and live Firebase sign-in require a development build and approved test environment. The unit tests use injected storage and transport for the local sync and Firebase account binding paths. The [delivery ledger](../docs/engineering/delivery-status.md) tracks the provider and release flows.
