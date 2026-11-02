# Prioritized roadmap and acceptance criteria

## Phase 1 — Playable foundation (this vertical slice)

- [x] Typed browser/server architecture and reproducible local commands.
- [x] Account registration/login, secure session cookie and persistent profile.
- [x] Character appearance selection and reconnect persistence.
- [x] Original Sinkor-inspired coastal district with shared road graph.
- [x] Walking, camera, vehicle entry and differentiated modern-sedan/SUV/hatchback/minibus handling.
- [x] Driver headlights with dashboard/keyboard controls and multiplayer light-state replication.
- [x] Scripted NPC phone calls, fixed-catalog home/vehicle purchases, persistent garage selection and functional upgrades.
- [x] Compact smartphone showroom/portfolio, owned-home directions/entrances, furnished room navigation and working interior lights.
- [x] HUD, full map/minimap, waypoints and route guidance.
- [x] Server-validated NPC taxi job, LRD wallet and ledger.
- [x] Nearby multiplayer movement/vehicle replication, text chat and emote.
- [x] Weather with driving/economic effects, day/night and procedural audio.
- [ ] Manual multi-client soak and device accessibility audit (release gate).

**Acceptance:** two new accounts can log in, enter the same district, see one another, exchange nearby chat, drive their own taxis, complete different jobs, and retain their balances and appearance after reconnecting. Duplicate trip completion cannot pay twice.

## Phase 2 — Multiplayer hardening

Server reconciliation improvements, reconnect interruption tests, friends/parties, moderation workflows, structured metrics, PostgreSQL adapter and automated multi-process integration tests. Acceptance requires measured 20-client baseline and no lost active trip across process restart.

## Phase 3 — Transport economy depth

Scheduled/shared rides, passenger/driver ratings, disputes, more vehicle classes, fuel/maintenance persistence, airport-style transfer contracts and bus routes. Acceptance requires route-condition tests, cancellation policy tests and economy soak simulation.

## Phase 4 — Commerce and ownership depth

The fixed-catalog, server-authoritative home/dealership baseline is implemented with ownership, replay-safe LRD debits, garage capacity and functional upgrades. The baseline also includes exterior access and furnished local interiors for owned homes. Remaining work: player-to-player markets, user listings, rentals, permissions, businesses, multi-unit/custom floorplans and broader inventories. Every future listing sale needs concurrent-buyer tests and exactly-once ownership/ledger transfer. No decorative purchase buttons.

## Phase 5 — Expand Liberia

Additional reviewed geographic districts, airport and port hubs, regional roads, delivery/freight, richer NPC schedules, rural surfaces and streaming. Each region has an art/gameplay acceptance review and attribution record.

## Phase 6 — Controlled test preparation

Production art passes, optimization, audio licensing review, backup/restore drill, security review, load tests, deployment runbook and explicit known-limitations publication.

## Economy and content policy

No pay-to-win or real-money progression bypass is included. Future monetization needs a separate fairness policy. NPCs remain deterministic and useful during low population; generative AI is not required for ordinary behavior.
