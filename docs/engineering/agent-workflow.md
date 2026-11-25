# Codex and Claude engineering workflow

Start either agent from the workspace root when changing a cross-app flow. For focused work, use `mobile/` or `backend/`. Codex reads the applicable `AGENTS.md` files. Each `CLAUDE.md` imports the corresponding `AGENTS.md` so there is one shared policy for both tools. The repository contains no assistant permission overrides. [Claude Code project memory and imports](https://code.claude.com/docs/en/memory#import-other-files)

| Task | Fast evidence | Broader evidence |
|---|---|---|
| Backend feature or auth | `pnpm check:backend` | `pnpm check` and a real local HTTP check. Auth tests must prove that invalid tokens cannot reach storage. |
| Mobile feature | `pnpm check:mobile` | `pnpm bundle:mobile`, then authorized device scenarios and applicable accessibility checks. |
| Admin feature | `pnpm --filter @levelmaxing/admin test` | `pnpm build:admin` and `pnpm test:operator` using Chrome and loopback services. |
| Shared contract or sync | `pnpm check:boundaries` | `pnpm check` to verify all consumers and the two-client journey. Preserve offline operation IDs and versions. |
| Watch feature | `pnpm test:watch` | The shared unsigned Xcode scheme, then physical pairing proof when available. |
| Persistence or SQL draft | `pnpm check:sql` plus static trust-boundary review | Record owner-operated testing and application as open in the ledger. Agent checks must avoid launching a database or applying schemas. |

Before editing, read the route, feature, contract and its consumers. Identify the failing or missing user outcome and write the expected result for one success and one negative case. Keep work in one scope and put provider SDK interactions behind injected adapters. Prefer existing commands and test fixtures. Report the commands and their observed results in the [delivery ledger](delivery-status.md). A green mock alone cannot establish a live-provider or database behavior.

For a handoff, record the requirement ID, changed files, reproducible evidence, assumptions, and next unresolved gate. Never copy secrets or user data into prompts, fixtures, logs, screenshots, or commit messages.
