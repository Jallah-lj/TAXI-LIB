# Local API and realtime contract

All endpoints are same-origin under `/api`. API responses carry `Cache-Control: no-store` so authenticated world, wallet and civic refreshes cannot reuse stale cached state. JSON mutations require a valid session cookie or `Authorization: Bearer` preview session; the server checks request origin when an Origin header is present. Errors use `{ "error": "message" }` and an appropriate 4xx/5xx status.

## HTTP

- `POST /api/auth/register` — `{handle, password, displayName}`; creates profile, wallet and cooperative starter taxi. The embedded preview response also includes a tab-scoped `sessionToken` fallback.
- `POST /api/auth/login` — `{handle, password}`; rotates the session cookie and, in the embedded preview, returns the bearer fallback.
- `POST /api/auth/logout` — revokes the current session.
- `GET /api/session` — current account/profile summary.
- `POST /api/realtime/ticket` — issues a 30-second, single-use WebSocket ticket using the authenticated cookie or bearer session.
- `PATCH /api/profile/appearance` — validated appearance indices.
- `GET /api/world` — shared locations/roads, player, wallet, effective upgraded vehicles, properties, selected vehicle, garage capacity, jobs, active trip/task, civic incidents/safety history and simulation state.
- `GET /api/tasks` — active citizen task and authoritative completion/earnings statistics.
- `POST /api/tasks/accept` — `{templateId, requestId, incidentId?}`; accepts one catalog task when no other task or passenger trip is active. Incident-response templates require the matching open `incidentId` and claim it atomically.
- `POST /api/tasks/:id/advance` — `{stepId, position, requestId}`; validates the current step against a recent live on-foot presence, then advances or completes the task and pays its final reward once.
- `POST /api/tasks/:id/cancel` — `{requestId}`; cancels an active owned task without a reward and reopens its linked civic incident when applicable.
- `GET /api/civic` — current shared incident snapshot plus the authenticated citizen's warning/fine history.
- `POST /api/civic/reports` — `{siteId, requestId}`; validates a nearby, stationary, outdoor on-foot presence and creates one open incident/work order for a canonical site.
- `GET /api/taxi/jobs` — currently available NPC requests.
- `POST /api/taxi/jobs/:id/accept` — `{vehicleId}`; atomically claims a job when no trip or citizen task is active.
- `POST /api/taxi/trips/:id/pickup` — validates recent server-accepted driving state.
- `POST /api/taxi/trips/:id/complete` — validates conditions and pays exactly once.
- `POST /api/taxi/trips/:id/cancel` — cancels without payment.
- `GET /api/wallet` — balance and recent transparent ledger history.
- `POST /api/lifestyle/properties/purchase` — `{listingId, requestId}`; debits LRD and creates one owned home.
- `POST /api/lifestyle/properties/upgrade` — `{propertyId, requestId}`; upgrades an owned home by one level and adds one garage slot.
- `POST /api/lifestyle/vehicles/purchase` — `{modelId, requestId, configuration?}`; optional `{paintId, finish}` selects a supported visual appearance. The server checks garage capacity and funds, calculates the canonical paint/finish total, debits integer LRD and creates an owned vehicle with that persistent appearance.
- `POST /api/lifestyle/vehicles/upgrade` — `{vehicleId, kind, requestId}`; applies one `engine`, `brakes` or `tires` level to an owned, unoccupied vehicle outside an active trip.
- `POST /api/lifestyle/vehicles/select` — `{vehicleId, requestId}`; persists the selected owned vehicle under the same service restrictions.
- `GET /health` — process/database liveness.

Lifestyle mutations return the current wallet, properties, effective vehicles, selected vehicle and garage capacity plus a `duplicate` flag. A replay with the same UUID, operation and target performs no second write or debit. Vehicle-purchase targets include the canonical paint/finish configuration, with a migration preserving legacy default-configuration requests. Reusing that UUID for a different operation/target/configuration is rejected. Ownership, maximum levels, funds and garage capacity are checked again inside the server transaction; client prices are never trusted. Citizen-task acceptance, advancement and cancellation also use scoped request UUIDs for replay protection; rewards use a unique task ledger reference. Civic reports use scoped request UUIDs plus a per-site active-incident constraint. Incident assignment, cancellation/release and completion/resolution/payment share the task transaction. Safety penalties are derived only from accepted driving movement; each warning/fine and affordable fixed-LRD ledger debit is written by the server.

## WebSocket `/ws`

Client messages: `state`, `chat`, `emote`, `ping`. Server messages: `welcome`, `snapshot`, `player-state`, `player-joined`, `player-left`, `player-health`, `chat`, `emote`, `world`, `civic-incidents`, `safety`, `pong`, `error`. Civic incident snapshots are published after reports, claims, releases and resolutions; `safety` delivers the affected citizen's authoritative history, wallet and notice after a server-derived warning or fine. `player-health` is emitted for nearby initial state, server-derived vehicle/pedestrian impacts and timed recovery; fatal recovery can include the server respawn pose. Clients cannot send a health or impact-claim message.

State is compact and validated. Driving states may include `lightsOn`; the server normalizes it to a boolean and nearby clients use it to replicate the actual vehicle headlight rig. Walking states omit vehicle/light state. Walking states may include `interiorPropertyId`; the gateway checks it against current server-owned titles (refreshing its cache after a purchase), and clients hide indoor remote avatars while retaining the exterior pose. No socket message accepts wallet amounts, ownership IDs for transfer, fare results or trip completion. See `src/shared/protocol.ts` for the canonical typed payloads.

## Local development

`npm install && npm run dev`, then open the shown port. Production: `npm run build && npm start`. Set `NODE_ENV=production` behind HTTPS so cookies use `Secure`. The hosted browser client uses relative API/WS URLs only.
