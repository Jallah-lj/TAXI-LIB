# ADR 0001 — Browser 3D vertical slice with an authoritative Node server

**Status:** Accepted for Phase 1–3
**Date:** 2026-10-23

## Context

Taxi-LIB is a long-term 3D multiplayer simulation, but its first deliverable must be runnable and testable in this repository. The repository was empty. Unreal Engine 5 would provide stronger high-end rendering and built-in replication, but it cannot produce an immediately accessible browser preview in this environment and would require substantial licensed art, engine tooling, and platform-specific build infrastructure.

## Decision

Use **Three.js with TypeScript** for the game client and **Node.js/Express with WebSockets** for the authoritative vertical-slice server. Vite provides development middleware and production bundling. The same HTTP port serves the client, JSON API, and realtime upgrade, avoiding browser-to-localhost calls in hosted previews.

Use Node's transactional SQLite adapter for the self-contained local slice behind a small persistence boundary. The relational model and money/ownership invariants are designed to transfer to PostgreSQL. PostgreSQL, Redis, dedicated world shards, object storage, and a voice provider are **not** falsely claimed as deployed; they enter only when their operational need is real.

## Why not a conventional website

The client owns a persistent WebGL scene, animated characters and vehicles, collision-aware controllers, a road graph, interpolated network entities, weather, audio, and a game HUD. Express serves APIs; it does not substitute web pages for gameplay.

## Consequences and trade-offs

- **Positive:** one typed language across protocol, road graph, client, and server; fast reproducible builds; instant browser access; no engine installation; straightforward multiplayer testing.
- **Visual:** procedural low/mid-detail art cannot match a staffed UE5 production. Art direction emphasizes believable proportions, neighborhood variation, coastal light, materials, and environmental storytelling rather than photorealism claims.
- **Performance:** browser draw calls and memory require instancing, culling, quality settings, and later asset streaming. The initial district is intentionally bounded.
- **Networking:** WebSockets are reliable ordered TCP, appropriate for this low-speed slice but not a proven thousands-player solution. Interest filtering, snapshots, validation, and shard boundaries are explicit. UDP/WebTransport can be evaluated after profiling.
- **Persistence:** SQLite is a local development/single-process adapter, not the production multi-shard database. Migration to PostgreSQL is a release gate for multi-process deployment.

## Security and economic authority

The server alone validates authentication, session credentials, job assignment, pickup/drop-off conditions, vehicle ownership, wallet updates, and ledger writes. Client positions are untrusted movement input subject to bounds, ownership, recency, and plausibility checks. Financial results are never calculated or declared successful by the client. Standard deployments use HttpOnly cookies; the embedded preview has an explicitly scoped bearer fallback in `sessionStorage` and short-lived single-use WebSocket tickets to handle browser cookie partitioning.

## Reassessment triggers

Move rendering to Unreal or another engine if a funded art pipeline and target consoles justify it; add PostgreSQL before horizontal server scaling; add Redis only for measured cross-process presence/coordination needs; add a voice service only after a real provider integration.
