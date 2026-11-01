# Taxi-LIB

**A playable multiplayer open-world life and transport simulation inspired by Liberia.**

This repository contains a working Phase 1 vertical slice: a live Three.js coastal district, persistent citizen accounts, walking and driving with solid actor/prop collision, signal-responsive traffic with 12 civilian cars and siren-equipped community patrols, non-graphic impact injury/recovery, NPC taxi dispatch, server-validated LRD fares, nearby multiplayer replication/chat, GPS navigation, day/night, gameplay-affecting tropical rain, and procedural spatial audio. A compact citizen smartphone provides a live account dashboard, wallet ledger, passenger dispatch, playable citizen tasks, scripted NPC service messages, a professional vehicle showroom, persistent property titles, garage selection and real handling upgrades. Owned homes have exterior entrances, furnished walkable rooms, room navigation and working interior lights; drivers can also operate rendered headlights. Fictional municipal departments, sanitation/public-works/market personnel, community police and traffic wardens add scheduled street presence, usable Civic phone services, shared incident work orders and nonviolent server-derived road-safety enforcement. It is not a static landing page or a claim that the complete commercial-scale game is finished.

## Play locally

Requires **Node.js 22.5+** (Node 22 LTS recommended). No external database, API key, asset download, or game engine installation is needed for the local slice.

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. In Arena or another remote preview, open the forwarded port instead; browser code uses relative same-origin URLs and never calls a backend at the player's localhost.

1. Create a citizen account (handle, display name, and an 8+ character password).
2. Optionally customize and save your character.
3. Select **Enter the district**. New citizens receive a non-modal **guided first trip**; choose **Start guided first trip** or skip it. It advances through real movement, taxi entry, phone/dispatch, pickup and drop-off actions, and can be replayed later under **Settings → Learning → First-trip guide**.
4. Walk to your selected vehicle and press **E**.
5. Press **J** (or open **Phone → Dispatch**), accept an NPC passenger request, and follow the gold GPS route.
6. Stop inside the pickup marker and press **F**. Drive to the destination, stop, and press **F** again.
7. The server credits the LRD wallet once. Sign out/reconnect to verify persistence.
8. Press **P** for scripted NPC service calls, the vehicle showroom, property portfolio and your garage/workshop. Open **Motors** to search inventory, orbit a selected vehicle, preview supported paint/finish options and purchase through the authoritative LRD flow. Press **L** or the dashboard button while driving to toggle real headlights.
9. After buying a home, choose **Enter home / set directions** in the Homes app. Follow GPS to its front door and press **E**. Inside, walk with **WASD**, use the room navigator to visit furnished spaces, press **L** for home lights, and use **Leave home**, **E** at the front door, or walk through the doorway to exit.
10. Open **Phone → Tasks** and accept **Market Restock**. On foot, follow GPS to the exact glowing **CURRENT OBJECTIVE** sign at **Cooperative Garage** and press **E** to collect the packed provisions. Then follow the updated route to **Sinkor Market** and press **E** at the marked stall to stock it. The server pays the **L$650** reward once after both steps.
11. Open **Phone → Civic** for fictional department information, worker shifts, notices, municipal contracts, shared incidents and your safety record. Accept an open incident, follow its exact GPS target and press **E** on foot to resolve it. After resolution, nearby report sites can be reported again through the same Civic app. Municipal and District Safety counters, civic workers and marked incidents also provide contextual **E** interactions.

For a second player, open a separate browser profile or private window, register another account, and enter the same server. Nearby characters, vehicles, movement, waving, and text chat replicate through the authenticated WebSocket gateway. Focusing the chat field clears held movement controls and keeps the typing pedestrian still; receiving a message does not stop the recipient.

## Controls

| Input | On foot | In vehicle |
| --- | --- | --- |
| WASD / arrows | Walk | Accelerate, reverse and steer |
| Shift | Run | — |
| Space | — | Brake |
| E | Interact with the marked citizen objective, civic incident/report site, service counter or worker; enter a nearby selected vehicle or owned home; exit at its front door | Exit when nearly stopped |
| F | — | Valid passenger pickup/drop-off interaction |
| L | Toggle lights inside an owned home | Toggle headlights (dashboard button also works) |
| C | First/third-person camera | First/third-person vehicle camera |
| Mouse drag / wheel | Orbit / zoom camera | Orbit / zoom camera |
| M | Interactive road map | Interactive road map |
| J | Passenger dispatch | Passenger dispatch |
| P | Citizen phone | Citizen phone |
| Enter | Nearby text chat; remain stationary while typing | Nearby text chat; driving input is cleared while typing |
| G | Wave | Wave emote to nearby players |
| Escape | Close panel / release input | Close panel / release input |

Basic browser-standard gamepad input and touch controls are included. Desktop keyboard/mouse is the primary experience; comprehensive device/accessibility testing remains a release gate.

## Verify and build

```bash
npm run typecheck   # strict client + server TypeScript
npm test            # domain, API, navigation, visual assets and two-client realtime tests
npm run build       # optimized browser bundle + compiled server
npm start           # production server (after build; use HTTPS in deployment)
```

`npm run check` runs the main verification sequence. `GET /health` checks process and database liveness. With the development server running, `npm run smoke` additionally drives the live HTTP/WebSocket server through pickup, drop-off and duplicate-payment rejection, then verifies replay-safe vehicle purchase/upgrade/selection and, with a second citizen, home purchase/upgrade, garage-capacity changes and indoor/exterior vehicle-service validation.

### Docker

```bash
docker compose up --build
```

The container stores the local SQLite database in a named volume. The compose configuration is for local evaluation over HTTP. A public deployment must terminate TLS, use a production backup strategy, and migrate to PostgreSQL before running multiple world processes.

## What is genuinely implemented

- **Identity:** bcrypt password hashes, random HttpOnly session cookies, hashed session tokens, expiration/revocation, persistent profile and appearance.
- **World:** original procedural Sinkor-inspired coastal blocks, market, hotel, clinic, garage, taxi stand, ocean/beach, road markings, sidewalks and palms, populated by textured/rigged CC0 citizens and detailed CC0 vehicles with procedural load-failure fallbacks.
- **Driving and ownership:** a persistent starter sedan plus purchasable modern sport-sedan/SUV, hatchback and minibus models, selected-vehicle spawning, realistic paint, plates and animated wheels; modern cars use original aerodynamic 3D geometry, LED materials and alloy-wheel rigs; model-defined acceleration, braking, steering and grip; persistent engine/brake/tire upgrades with real handling effects; off-road drag, oriented vehicle/static collision response, fuel/condition HUD and camera views.
- **Physical street play and impact health:** oriented vehicle footprints against buildings and world bounds, circular pedestrian/objective contact, and a shared dynamic layer for local/remote players, NPCs, civic workers, traffic and parked vehicles. Market counters, shelter furniture, signal/street poles, palms, tires and coastline rocks are solid. Existing overlaps can separate without permitting deeper contact. Below 4.5 m/s (16.2 km/h), contact remains a collision stop; higher measured impacts injure, while 12.5 m/s (45 km/h) or a repeat serious hit can be fatal. Ambient/civic NPCs show non-graphic injured/dead poses and recover or respawn on local timers. Player-to-player health is issued by the server from accepted movement history with timed recovery/respawn and replicated conditions; it is session-scoped, not a persistent casualty record. This remains responsive client-side 2D collision, not server-authoritative rigid-body physics.
- **Signals and community patrols:** 12 intersections have visible far-right signal heads with deterministic 30-second red/yellow/green cycles and all-red clearance. Twelve civilian ambient vehicles follow right-hand lane loops, brake at stop lines, wait for green and avoid nearby actors. Two marked police sedans patrol with alternating red/blue lightbars and distance-attenuated stereo siren synthesis; sirens respect master volume and are muted indoors.
- **Vehicle showroom:** searchable/filterable/sortable real inventory, a lazy-loaded single-vehicle 3D studio, reflective platform, orbit/zoom and cinematic camera presets, live headlight and physical paint/finish previews, actual handling specifications, authoritative LRD totals and persistent configured purchases. Unsupported interior/door controls are intentionally omitted.
- **Headlights:** driver-operated dashboard and **L** control, two forward spotlights, emissive headlamp materials, and optional light-state replication to nearby drivers.
- **Taxi economy:** contestable NPC jobs, atomic assignment, recent-server-pose and assigned-vehicle checks at pickup/drop-off, fare quotes, elapsed lifecycle, exactly-once wallet/ledger payment, cancellation and active-trip restoration.
- **Lifestyle commerce:** transactional home/vehicle purchases, home and vehicle upgrades, ownership/capacity/authorization checks, persistent selected-vehicle preferences and request-ID replay protection with signed ledger entries.
- **Owned homes:** exterior entrances and GPS directions for server-owned titles, local furnished interior instances with collision, entry hall/living/kitchen/bedroom/bathroom, safe room navigation, working lights, level-two/three furnishings and clean exit/disposal. Indoor presence is ownership-validated and indoor avatars are hidden from exterior players.
- **Citizen phone:** a compact device-shaped Home dashboard and app grid with live balance/vehicle/work/weather summaries, keyboard-accessible navigation, an authoritative LRD ledger, passenger dispatch, playable citizen tasks and Civic services. Scripted local service messages, real vehicle specifications, property/showroom actions and garage management remain integrated. It does not place real calls or provide voice chat.
- **Fictional civic government:** Municipal Services Hall and District Safety Office counters; sanitation, public-works and market personnel; uniformed community police and traffic wardens. Workers follow deterministic shifts, patrol/inspection/incident-response routines and heavy-rain shelter behavior. Civic departments, notices, schedules, contracts and exact GPS actions use the existing connected phone and task systems.
- **Shared incidents and safety:** persistent litter, streetlight, drain and obstruction reports with nearby on-foot validation, exclusive work-order claims, cancellation/release and transactional resolution/reward. Incident props/status replicate to connected citizens. Marked taxi-stand and market speed zones use server-accepted displacement history for warnings, cooldowns and affordable fixed LRD fines with ledger entries—never client-triggered penalties, negative balances, arrests or weapons.
- **Readable people and civic labels:** workers use compact two-line name/role sprites with depth testing and distance scaling. Civic incident cards are smaller and hidden throughout the close 4.2 m E-interaction range, leaving the normal contextual prompt and worker nameplate unobstructed.
- **Multiplayer:** authenticated same-origin WebSockets, 10 Hz validated movement, nearby interest filtering, interpolation, remote vehicles/characters, proximity chat, wave emotes, shared civic incident updates, safety records and reconnection. Player health conditions and respawn poses replicate through the same gateway; health is not a client impact claim or a persistent cross-session medical record.
- **Navigation:** the rendered roads, minimap, full map and GPS share one road graph. Destination selection uses actual route traversal, not decorative lines.
- **Environment:** compressed day/night, street lighting, changing NPC activity, tropical rain, reduced visibility/grip, wet materials and weather-influenced server quotes. Night-only ambient/moon/camera-side fill and subtle texture-preserving character material fill keep faces, eyes and clothing readable without changing the clear-day lighting profile.
- **Graphics and accessibility settings:** persistent browser-local Low/Medium/High presets, 60/75/100% 3D resolution, optional dynamic shadows, bounded brightness/night visibility, reduced decorative motion and sound volume. Medium at 100% brightness preserves the established rendering profile. Preferences affect presentation only; interface text stays sharp and gameplay/authoritative state is unchanged.
- **First-trip onboarding:** a professional, non-modal six-milestone coachmark sequence driven by actual walking, vehicle entry, phone/dispatch events and matching server trip IDs. It provides live taxi/destination distances, highlighted existing controls, accessible progress, minimize/exit confirmation, cancellation recovery, a completion fare summary and Settings replay. Only completion/dismissal preference is account-persistent; current step progress is session-only and the guide never cancels work or changes fares.
- **Interface:** live-world menu, account/lobby, character customization, HUD, dispatch, interactive map, wallet ledger, settings, chat, responsive compact-phone/showroom/property/garage apps, an in-world room navigator and contextual vehicle/home controls.
- **Audio:** original Web Audio engine/rain/coastal sound and two-voice police siren synthesis with proximity attenuation, stereo direction and master-volume control. No voice chat is claimed.

## Repository map

```text
src/
  shared/                 wire contracts, validation, road graph, simulation rules
  server/
    db/migrations/        executable relational schema
    services/             auth, profiles, presence, taxi and wallet invariants
    realtime/             authenticated WebSocket gateway
    app.ts                API/security middleware
    index.ts              HTTP + Vite/production composition
  client/
    assets/               cached, local GLTF model loaders
    entities/             realistic/procedural citizens, vehicles and animation
    world/                district, procedural materials, art direction
    showroom/             lazy 3D studio and dealership interface
    systems/              controls, physics, NPCs, traffic, weather, audio, maps
    onboarding.ts         event-driven first-trip guide state machine
    ui/onboarding-view.*  accessible coachmarks, progress and responsive styling
    game.ts               render/simulation orchestration
    ui.ts                 connected menus, HUD and panels
    main.ts               account/gameplay application flow
public/assets/           local CC0 models, hashes and license notices
scripts/                 smoke test and reproducible asset preparation
tests/                   executable behavioral and multiplayer tests
docs/                    ADR, architecture, world, schema, API, roadmap, limitations
```

See [docs/repository.md](docs/repository.md) for boundary and contribution conventions.

## Documentation

- [Engine/architecture decision record](docs/adr/0001-browser-vertical-slice.md)
- [System and scaling architecture](docs/architecture.md)
- [World and district design](docs/world-design.md)
- [Vehicle, taxi and networking design](docs/gameplay-and-networking.md)
- [Vehicle showroom](docs/showroom.md)
- [Database schema and persistence](docs/database.md)
- [HTTP/WebSocket API](docs/api.md)
- [Dependencies and asset licensing](docs/assets-and-dependencies.md)
- [Milestones and acceptance criteria](docs/roadmap.md)
- [Known limitations](docs/known-limitations.md)

## Security and production boundaries

The client is untrusted. It cannot set a balance, fare, owner, successful trip result, incident resolution or safety penalty. API input is schema-validated; API responses are marked `Cache-Control: no-store`; mutations have origin checks; auth and realtime traffic are rate-limited; important economic events are audited; financial changes use database transactions and unique ledger references. Normal sessions use HttpOnly cookies; the embedded preview also supports a tab-scoped bearer fallback and single-use realtime tickets for browsers that suppress embedded cookies. Movement has plausibility checks but is not a complete server-physics anti-cheat solution. Actor collision, ambient signal obedience and patrol lighting/audio are client simulation; the server does not arbitrate rigid-body contacts or red-light violations. The server does derive player-to-player injury/fatality state from accepted vehicle/pedestrian poses and owns its recovery timers, but this is not a general server physics or persistent casualty system.

The local SQLite adapter is deliberately single-process. PostgreSQL, Redis, managed voice, regional shards and high-concurrency claims are not represented as deployed. Player-to-player markets, rentals, businesses, airport/port operations and regional Liberia remain roadmap systems rather than inactive decorative buttons; the implemented phone and owned-home experiences contain only the documented simulated services and local interiors.

District art, UI and audio are generated from original source. Citizens and vehicles use locally bundled **CC0** MakeHuman/Quaternius and Innerscene assets; see [asset provenance and licensing](docs/assets-and-dependencies.md) and [bundled notices](public/assets/CREDITS.md). No third-party asset service is contacted at runtime. The district is fictionalized and compressed; it is not a verified street map or an official representation of Liberian infrastructure.
