# Levelmaxing

[Start here](START-HERE.md) for the initialized mobile and backend directories, Firebase Auth setup, and engineering checks.

Levelmaxing is an original training, nutrition and progress app designed for iOS and Android, with a paired Apple Watch experience and an admin console. The production plan covers the complete release across 16 capability groups. The interactive browser prototype runs on a local HTTP server and demonstrates two-client sync with fictional data.

| Open | Contents |
|---|---|
| [Full release plan](docs/product/01-release-plan.md) | Scope, product decisions, 21 implementation slices, staffing assumptions and launch gates |
| [Production architecture](docs/product/02-production-architecture.md) | Native and cloud stack, data model, API contracts, offline protocol, capacity, cost and recovery |
| [Product design](docs/product/03-product-design.md) | Mobile and admin screen map, connected journeys, component states, accessibility and visual direction |
| [Build prompt](docs/product/04-build-prompt.md) | One copyable instruction for a coding agent implementing the full product |
| [Run the prototype](docs/prototype/README.md) | Launch, functional walkthroughs, two-client recovery demo and validation commands |
| [Desktop preview](docs/prototype/desktop-preview.png) · [Phone preview](docs/prototype/mobile-preview.png) | Screens from the running browser prototype |

You can open the demo with Node.js 22 or newer. From the extracted package, run `node docs/prototype/server.mjs`, then open [localhost:4316](http://127.0.0.1:4316). The demo requires no package install or external account.

The architecture proposes an India-first release for adults, English and Hindi, and one production region at launch. The technical baseline is React Native, encrypted local SQLite, and a Supabase/PostgreSQL backend. Native build, provider, paid service, device and store verification are release gates.
