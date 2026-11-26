# Levelmaxing mobile instructions

Read the [workspace instructions](../AGENTS.md) and [mobile setup](README.md).

- Keep app routes thin. Session owns Firebase Auth and the verified Firebase-to-Levelmaxing account binding. Progress owns the encrypted confirmed view and immutable outbox.
- Use the backend-issued account UUID for local storage and sync. A Firebase UID is an opaque provider identity. Preserve saved data on sign-out and account switches, and discard stale results from the prior session.
- Store Firebase session material in the encrypted, backup-excluded vault. A previously verified UID binding may unlock local data offline. Backend authorization still requires a valid online credential.
- Use `pnpm check:mobile` from the root. Run `pnpm bundle:mobile` for changes to navigation, native modules or assets. Record iOS and Android evidence independently. Obtain device runs only in an authorized safe environment that meets the workspace's database rules.
