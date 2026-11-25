# Levelmaxing backend instructions

Read the [workspace instructions](../AGENTS.md), [backend setup](README.md), and [Firebase identity design](../docs/engineering/firebase-identity.md).

- Put business behavior in a feature under `src/features`. Expose only its public entry point. Inject ports through `src/app.ts` and configure adapters in the Node, local and cloud composition roots.
- Bind the Firebase project at token verification and storage. Resolve the verified opaque UID to the internal account UUID before authorization or data access. A request body, custom role hint or email cannot grant access.
- Keep the Supabase RPCs independently scoped, with authenticated execute-only grants and explicit account/generation checks. All drafts are human-owned. Keep them outside automatic migration discovery.
- Run `pnpm check:backend` from the root and `pnpm check` for cross-client changes. Verify invalid, expired, wrong-project, isolated-tenant and actual protected endpoint cases when changing auth.
