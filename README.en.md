# Worldara

> A single workbench for world settings, history, relationships and prose.

[中文 README](./README.md) · Current version `1.0.0`

Worldara is a local worldbuilding workspace for long-running creative projects. Characters, places, factions, facts, events and chapters stay in one place, with enough structure to check how they fit together.

## Screenshots

These screenshots come from the running `The Amber Coast` demo world included only in the local capture session. The demo data is not committed to the repository.

| Overview | Entity files |
| --- | --- |
| ![Overview](docs/screenshots/01-overview.png) | ![Entity files](docs/screenshots/02-entities.png) |

| Relationship graph | Chronicle |
| --- | --- |
| ![Relationship graph](docs/screenshots/03-graph.png) | ![Chronicle](docs/screenshots/04-timeline.png) |

| World map | Canon checks |
| --- | --- |
| ![World map](docs/screenshots/05-map.png) | ![Canon checks](docs/screenshots/06-canon.png) |

| Claims and branches | Works and scenes |
| --- | --- |
| ![Claims and branches](docs/screenshots/07-knowledge.png) | ![Works and scenes](docs/screenshots/08-manuscript.png) |

| Proposal review | Types and rules |
| --- | --- |
| ![Proposal review](docs/screenshots/09-proposals.png) | ![Types and rules](docs/screenshots/10-schema.png) |

| Preferences |
| --- |
| ![Preferences](docs/screenshots/11-settings.png) |

## Why it exists

People who build detailed settings rarely run out of ideas. The harder part is checking those ideas while writing. Worldara keeps that check close at hand: define entities and rules, record history and relationships, then write scenes against the same world state.

It is suited to individual authors, small creative teams and self-hosted projects with a sizeable setting. It is a local monorepo, not a hosted account service, and it does not upload your world to an external service by itself.

## What is included

- Entity files for characters, places, cities, factions and other structured records.
- Relationship graphs with explicit relation types and descriptions.
- A chronicle based on `world tick`, with participants, locations, causal links and snapshots.
- Layered maps with entity-bound Marker, Polygon and other GeoJSON features.
- Deterministic Canon checks for references, types, timeline rules and structural constraints.
- Works, chapters and scenes linked to POV characters, locations, participants and world time.
- JSON, ZIP, Markdown, GeoJSON and Obsidian export boundaries for backup and migration.
- Proposal review: an external model may draft a change set, but it cannot write Canon directly. With no provider configured, no model request is made.

## Quick start

You need Node.js 20+, pnpm 11 and PowerShell.

```powershell
pnpm install
```

Start the local development environment. It uses a SQLite file in `data/` by default:

```powershell
pnpm dev
```

Open `http://localhost:3000`. The API health endpoint is `http://127.0.0.1:4000/health`.

To start one service at a time, use two terminals:

```powershell
pnpm --filter @world-codex/api dev
pnpm --filter @worldara/web dev
```

For PostgreSQL, start Docker Desktop and set the connection in PowerShell:

```powershell
docker compose -f infra/compose/docker-compose.yml up -d
$env:DATABASE_URL = 'postgres://worldcodex:worldcodex@localhost:54329/worldcodex'
$env:MIGRATE_ON_START = '1'
pnpm db:migrate
pnpm dev
```

`.env.example` lists PostgreSQL, API, MCP and optional content-provider settings. Keep secrets in local environment variables and never commit `.env`.

## Repository layout

```text
apps/web       Next.js frontend
apps/api       Fastify HTTP API
apps/worker    PostgreSQL outbox / async task entry point
apps/mcp       MCP stdio entry point
packages/*     Domain, application, contracts, database, validation, snapshots and import/export
docs/screenshots  Product screenshots used by the READMEs
infra          Docker Compose configuration
```

The browser talks to the API rather than the database. Canon rules, revision gates and cross-world reference checks live in the server and shared core. AI and MCP do not have a back door into those rules.

## Checks and builds

```powershell
pnpm -r --workspace-concurrency=1 --if-present check
pnpm -r --workspace-concurrency=1 --if-present test
pnpm -r --workspace-concurrency=1 --if-present build
```

For the `1.0.0` release, TypeScript checks, the full test suite and the full build passed locally. The run produced 160 passing assertions; the PostgreSQL contract was skipped because the Docker engine was unavailable. Real PostgreSQL migrations, target-scale performance, browser E2E and external model calls still need validation in their respective environments.

## Configuration and license

- [.env.example](./.env.example)
- Database migrations live in `packages/database/migrations/`

There is currently no license file in the repository. Unless a license is added, the code is provided with all rights reserved.
