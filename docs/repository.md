# Repository and engineering conventions

## Directory structure

```text
.github/workflows/       reproducible CI verification
docs/
  adr/                   significant, dated technical decisions
  architecture.md        process and scaling diagrams
  gameplay-and-networking.md
  world-design.md
  database.md
  api.md
  showroom.md            dealership controls, authority and rendering lifecycle
  assets-and-dependencies.md
  roadmap.md
  known-limitations.md
src/
  client/
    assets/              cached local GLTF template loaders
    entities/            reusable character/vehicle visual entities
    systems/             input, movement, environment, networking support
    world/               district construction and material library
    showroom/            isolated 3D studio and dealership controller
    api.ts               typed same-origin HTTP boundary
    realtime.ts          typed WebSocket boundary
    game.ts              client simulation composition
    ui.ts                DOM interface and accessibility hooks
    main.ts              application flow
  server/
    db/migrations/       ordered, executable schema migrations
    realtime/            socket lifecycle, validation, interest and chat
    services/            modular domain rules and persistence invariants
    app.ts               HTTP composition and security middleware
    config.ts            environment-based process configuration
  shared/                pure contracts and rules imported by both runtimes
public/assets/           bundled CC0 GLBs, hashes and license notices
scripts/                 live smoke test and reproducible asset preparation
tests/                   unit/integration/multi-client behavior
Dockerfile               reproducible multi-stage production image
compose.yaml             local persistent container evaluation
```

## Change rules

- Keep shared protocol changes backward-compatible or update both ends and tests in the same change.
- Do not import client/Three.js code into server modules or server persistence code into the client bundle.
- Use integer LRD and explicit lifecycle states. Add a unique idempotency constraint for every future financial/ownership operation.
- Use a database transaction whenever multiple dependent records change. Test concurrent/duplicate requests before marking a transaction feature complete.
- Add foreign keys, lifecycle checks and useful query indexes only for implemented domains; avoid decorative unused tables.
- Keep files focused. Extract a system when rendering, UI and domain rules begin to mix, rather than adding to a monolith.
- Store environment configuration outside Git. Never put privileged credentials or signing keys in client source.
- New external assets need provenance and license entries before commit.
- Run `npm run typecheck`, `npm test`, and `npm run build`. A rendered interface alone is not feature acceptance.

## Error handling and logs

Public API errors use stable messages/codes without stack traces. Unexpected errors are logged server-side. Audit events cover account and economic transitions. Production log retention, metrics export and alert thresholds are intentionally left to the deployment environment rather than hardcoded to a vendor.

## Backup, recovery and deployment

For local evaluation, stop the process and copy `data/taxi-lib.sqlite`, then test opening the copy with a separate `DATABASE_PATH`. For a public PostgreSQL deployment, automate encrypted base backups/WAL, define retention and perform timed restore drills. Run one process per SQLite database. Build with `npm ci && npm run build`, run database migrations at startup, health-check `/health`, and terminate TLS before browser access.
