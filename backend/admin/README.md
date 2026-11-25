# Levelmaxing admin

The operations console checks API reachability and confirms the operator role through the restricted backend endpoint.

- `features/access` owns Firebase sign-in, TOTP assertion, server-side operator verification, and sign-out states.
- `features/service-health` owns the public liveness check and its timestamp.
- `src/main.tsx` composes the Firebase adapter and the app, using the shared Levelmaxing colors.

## Local development

Start the local backend from the workspace, then run `VITE_LEVELMAXING_AUTH_MODE=local pnpm --filter @levelmaxing/admin dev`. Open the Vite URL and enter the loopback harness operator credential. The Vite proxy maps `/api` to `127.0.0.1:4321`. The Node backend denies a normal participant credential. Local sign-in is available only in explicitly configured Vite development.

## Hosted authentication

Set the Firebase web app's public values using the names in [.env.example](.env.example). Use the same Firebase project that the Levelmaxing backend trusts. Enable Email/Password and Firebase Authentication with Identity Platform for TOTP multifactor authentication. An operator needs a verified email, an already enrolled TOTP authenticator, and an operator role assigned through the backend's account directory. Account provisioning and authenticator enrollment are owner-operated. The Firebase `role: authenticated` claim permits access to applicable Supabase Data API functions. The backend directory independently owns the operator role. [Firebase TOTP multi-factor authentication](https://firebase.google.com/docs/auth/web/totp-mfa)

Firebase sessions are kept in memory. Reloading the console requires sign-in again. The browser submits a Firebase ID token after a successful TOTP authentication. The backend verifies its signature and second-factor claim and reads the operator grant from the account directory before granting access. The console can then use a refreshed token to recheck its access.

Serve the console on HTTPS and route same-origin API requests before the SPA fallback, at `/api` by default. If using the Supabase Edge ingress, the proxy supplies the project's public `apikey` where required and forwards the caller's Firebase Bearer token on protected requests. Firebase account setup, hosted ingress, and live TOTP verification are release checks. [Supabase authorization headers](https://supabase.com/docs/guides/functions/auth-headers)

## Verification

Run `pnpm --filter @levelmaxing/admin typecheck`, `pnpm --filter @levelmaxing/admin test`, and `pnpm --filter @levelmaxing/admin build` from the workspace. The tests cover Firebase-facing identity state with injected results, console configuration, and the restricted backend request. The workspace browser check exercises the same-origin local proxy and operator access. This foundation covers API reachability and access verification. Content, budgets, support, and job workflows each require their own scoped backend feature.
