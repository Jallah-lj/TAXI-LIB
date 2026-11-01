# Vehicle, taxi and networking design

## Driving model

Each vehicle model defines acceleration, braking, maximum forward/reverse speed, steering rate, grip and fuel use. The starter sedan, modern Mesurado Aero sport sedan, Farmington Cross urban SUV, private hatchback and passenger minibus use a responsive arcade-simulation model: speed-sensitive steering, rolling resistance, off-road drag, collision response and rain-dependent grip. Engine levels increase acceleration/maximum speed, brake levels increase braking force, and tire levels increase grip/steering response; the server returns effective specs and the local controller consumes them directly. It is intentionally approachable rather than a full rigid-body simulator. The two modern showroom listings use original procedural loft bodywork, sloped glazing, LED materials and four animated alloy-wheel assemblies directly in gameplay; they are not illustration-only catalog entries.

**Controls:** WASD/arrows move or drive; Shift runs; Space brakes; E enters/exits; F performs a valid trip interaction; L or the dashboard control toggles real headlights, and L toggles lights while inside an owned home; C changes camera; M opens the map; J opens dispatch; P opens the citizen phone; Enter opens chat; G waves; Escape closes panels/pauses. Standard gamepad left stick/triggers and south/east buttons are supported where browser mappings permit.

## Street collision, signals, patrols and conversation

### Solid street play

Buildings, world boundaries, market counters/posts, shelter benches/posts, civic desks, signs, signal/street poles, palms, the garage tire stack and coastline rocks share the static collision world. Walking uses a circular footprint with axis-separated sliding. Vehicles use their actual heading and model-specific length/width in an oriented bounding box; SAT checks cover rotated vehicle/building and vehicle/vehicle contact, and circle/oriented-box checks cover people against vehicles.

A dynamic actor snapshot is rebuilt during each exterior frame. It contains the local person/vehicle, replicated players and their vehicles, ambient and civic NPCs, ambient traffic, the visible passenger and active task/incident objects. Local movement, NPC routes, traffic and vehicle exit checks consume that same layer. Interior movement instead uses the owned home's dedicated collision world, and exterior actors are suppressed. An actor already overlapping another—most importantly two citizens joining at the same spawn—may make only a move that increases separation; approaching from outside or moving deeper remains blocked.

Static vehicle impacts stop the car and can apply the existing condition damage cooldown. Person contact stops movement and now has an explicit non-graphic health outcome; it still does not simulate pushing, suspension or rigid-body momentum. This is discrete, client-predicted 2D collision rather than continuous server physics. The server's existing pose plausibility/ownership checks still apply, but it does not arbitrate general contacts, and a malicious or heavily desynchronized client is outside what this layer can fully resolve.

### Impact severity, recovery and person labels

The shared severity rule uses metres per second: below **4.5 m/s (16.2 km/h)** there is no injury; at or above that threshold a healthy person is injured; at **12.5 m/s (45 km/h)** the outcome is fatal. An already injured person suffers a fatal outcome from a repeat impact at 6 m/s or above. Dead characters do not take further damage. Injured pedestrians have reduced walking mobility and a non-graphic leaned/fallen pose; dead pedestrians cannot move or use interactions until respawn. No blood, gore, weapons or casualty-economy reward is involved.

Ambient and civic NPC outcomes are local deterministic game state. Injuries recover after **18 seconds** and fatal outcomes respawn after **7 seconds**, using the server-synchronized simulation clock. Dead/unhealthy civic workers cannot be used as interaction targets during that interval.

Player-to-player vehicle impacts are different: the gateway accepts no injury or impact message. Its session-scoped health service measures displacement between consecutive accepted, owned-vehicle poses, checks a closing pedestrian against a tolerant oriented vehicle footprint, and retains only a short measured approach sample for the stop-on-contact case. Client speed fields alone cannot injure anyone. The server broadcasts condition, impact speed and recovery time, then issues healthy recovery or a taxi-rank respawn state. The latest accepted pose used for this history is deliberately separate from the fresh-pose checks used for financial checkpoints. Remote characters render the same condition pose and compact status nameplate.

Player health and ambient NPC conditions are **session/runtime state**, not persistent medical or casualty records. Restarting the world process clears player-health history; ambient NPC state is per client. This health fanout is not a claim of server rigid-body physics, and ambient traffic remains client-simulated rather than a server-authoritative traffic/physics service.

Worker labels use smaller two-line name/role textures, depth testing and distance-based scale. Civic incident cards use a compact sprite and are hidden within **4.35 m**, covering the complete **4.2 m** contextual E-interaction radius; at close range the worker nameplate and ordinary E prompt remain available instead of two large banners competing for the same pixels.

### Signals and community patrols

Twelve road intersections use a shared deterministic 30-second cycle. Horizontal and vertical approaches have separate green/yellow phases with all-red clearance, and the rendered far-right signal heads consume exactly the same phase function as traffic AI. Twelve civilian ambient cars follow four-metre right-hand lane offsets on connected road loops. They reduce speed on rain-affected roads, switch on headlights at night, brake before a red/yellow stop line, remain stopped until green, and allow vehicles already committed beyond the line to clear the junction. Nearby players and the shared actor layer provide additional stopping behavior.

Two white community-police sedans use the same signal/collision-aware routes, door markings and alternating red/blue emissive roof bars with local light spill. Their original Web Audio sirens use two swept oscillator voices, nearest-source selection, stereo direction and quadratic distance attenuation up to 135 metres. The existing master-volume setting controls them, and interior play mutes them. These are nonviolent ambient patrols: there is no pursuit, arrest, weapon or real emergency-service claim.

### Nearby chat without unwanted movement

Chat remains the authenticated, rate-limited, persisted, proximity-delivered player text system. Focusing the chat field now clears held keyboard/touch controls and immediately stops local walking speed. While the field remains active, the production input helper returns zero movement/brake input, including for a held gamepad; editable fields do not capture new WASD keypresses. Escape or another focus change releases conversation state, after which a new deliberate movement input is required. Sending or receiving a chat message does not itself toggle movement for other players.

## Lifestyle commerce and phone

The phone's contacts are deterministic, timed NPC text simulations—not telecom calls, generative agents or voice chat. Their action buttons open real dispatch, showroom and property panels. Home and vehicle purchases use canonical shared catalog prices and server-side transactions. Each home level adds one garage slot; base capacity is two. A purchased vehicle joins the persistent garage and can be selected while the citizen is on foot and outside an active trip. Selection replaces the local vehicle at the current parking position and is restored on later entry. Upgrade and selection requests are rejected for unauthorized, occupied or active-trip vehicles. Request UUIDs make retries safe, and every debit has a signed ledger entry. There is no real-money or real-property transaction.

The compact smartphone provides a Home dashboard and app grid, Services, Motors, Homes and Garage tabs, plus Wallet, Dispatch and Citizen Tasks apps. Home summarizes real balance, selected vehicle, active work and simulated weather. Wallet loads the authoritative ledger; Dispatch uses the same NPC jobs/trip mutations as the desktop panel; Tasks exposes the existing server-backed catalog, acceptance/cancellation, current objectives, completion statistics and rewards. Task and passenger work are mutually exclusive, and task objectives require a recent live on-foot position. GPS routes and the minimap distance target the current step's exact object coordinates; the object also carries a visible **CURRENT OBJECTIVE** sign with its location and **E** action. These are connected transaction interfaces, not separate mock catalogs.

## Fictional civic government, incidents and safety

The Civic phone app connects four fictional departments to actual district locations and services. Municipal Services Hall and the District Safety Office have marked service counters; contextual **E** interactions also open nearby incidents, report sites and worker information. Departments publish their service hours, deterministic worker shifts and notices. Sanitation crews, public-works technicians, market inspectors, community police and traffic wardens follow repeatable patrol/inspection routines, pause near players who drive toward them, respond visibly to nearby open incidents, shelter during heavy rain and go off duty according to the district clock. These ambient routines are client-side game AI, not claims of generative agents or real emergency services.

Incident records and every sensitive transition remain authoritative on the server:

1. A citizen must be outside, on foot, nearly stationary and within six metres of a canonical report site using recent server-accepted presence. Request UUIDs and one active incident per site prevent duplicate reports.
2. An open incident can be claimed only with its matching incident-response task definition and while no other citizen task or passenger trip is active. Assignment is conditional and atomic, so two citizens cannot claim the same response.
3. The current on-foot objective is validated through the existing task service. Completion resolves the incident, completes the task, credits its fixed reward and writes the ledger in one transaction. Cancellation releases the incident to `open` without payment; replay cannot produce a second reward.
4. Connected clients receive shared incident snapshots. Open/assigned sites render their physical condition and label; resolved sites remove that condition. Civic GPS uses exact incident/report coordinates rather than only the surrounding location marker.

The Civic app also contains the Market Standards Inspection contract and links to existing municipal work. Incident-only templates do not appear as unclaimable items in the regular Tasks catalog.

Marked 12th Street Taxi Stand and Sinkor Market safety zones publish **30 km/h** and **25 km/h** limits. While a player is driving, the server measures displacement across multiple recently accepted movement samples over at least 1.2 seconds; client-supplied speed is not used for enforcement. A violation must remain within the same zone and clear a small distance/tolerance threshold. The first recorded violation in a zone is a warning. Another after the 45-second cooldown may create a fixed **L$250** debit with a unique ledger reference, but only when the balance can afford it; otherwise the server records another warning rather than creating a negative balance. Walking, indoor and disconnected movement clears enforcement history. Officers' visible routines never authorize client-triggered fines.

All departments, personnel, service rules and penalties are fictional game systems. Punitive arrests, pursuits, weapons, courts and real Liberian legal procedures are deliberately outside this slice.

## Owned-home access and interiors

Each owned listing has an exterior residence and front-door map destination. **Enter home / set directions** either enters when the citizen is nearby and on foot without a trip, or sets real road GPS guidance. The same ownership check is repeated when indoor presence is replicated. At the door, **E** creates a local interior instance and preserves the exterior/network pose.

Both listings use a canonical 14 × 12 m layout with an entry hall, living room, kitchen, bedroom and bathroom. Major furniture and walls participate in local collision; the room navigator moves the citizen to tested safe spawns rather than displaying static room cards. **L** operates actual interior point lights/emissive bulbs. Persistent levels two and three add visible workspace/fan furnishings. Exterior actors are suppressed indoors and restored on exit; interior geometry, materials and colliders are disposed. Vehicle selection/workshop changes require stepping outside, while home upgrades can furnish the active interior immediately.

## Passenger lifecycle

1. The server offers globally contestable NPC jobs with fixed pickup/drop-off location IDs.
2. A driver selects a job and an owned vehicle. A conditional update prevents two drivers claiming it.
3. Server state becomes `accepted`; route and quoted LRD fare are stored.
4. The server must have a recent, plausible driving state near the pickup, almost stationary, with the assigned vehicle.
5. `accepted → active` occurs atomically. The passenger boards and the destination becomes active.
6. Completion again requires a recent validated driving state near the destination with the assigned vehicle and plausible elapsed time.
7. One database transaction marks the trip/job complete, credits the wallet and inserts a uniquely referenced ledger entry.
8. Repeating completion returns the original result without a second payment. Disconnect/reconnect restores the active lifecycle state.

Cancellation never emits a fare. Ratings and disputes are reserved for the next economy iteration; the UI does not pretend they are operational.

## Fare rules

All prices are simulation settings, not current real-world exchange rates. The local quote is a base flag-fall plus road-route distance and expected time, with a bounded heavy-rain modifier. There is no real-money purchase or cash-out mechanism.

## Replication and interest

- Same-origin secure WebSocket in production.
- 10 Hz client input/state messages; small payload schema validation.
- Server rejects invalid numbers, out-of-world poses, impossible bursts and vehicles not owned by the sender. Optional `interiorPropertyId` is accepted only for a current server-owned property and walking state; ownership caches refresh after purchases.
- Other players receive nearby states, profile appearance, driving light state and emotes; remote transforms interpolate and remote vehicles toggle the same spotlight/emissive rig. Indoor citizens retain their exterior network pose and their avatars are hidden from exterior viewers.
- `player-health` frames carry the server-issued condition, measured impact speed and recovery timestamp; fatal recovery also includes the accepted respawn pose. Initial snapshots include current health for nearby players. There is no client health/impact message type.
- Chat is text-only, proximity-scoped, length/rate limited and persisted for moderation. Voice is not advertised or emulated.

## Nighttime character readability

The clear-day lighting profile is unchanged. As night falls, a bounded increase in hemispherical and moon fill keeps clothing readable away from streetlamps; a camera-side, shadow-free directional fill reduces backlit silhouettes when a character turns toward the viewer. Character skin, eyes, brows, eyelashes and fabric use low-intensity texture-backed material fill so facial and clothing detail is preserved rather than replaced by a flat glow. Procedural fallback citizens use the equivalent color-matched minimum fill. Dark sky, fog, warm practical streetlights and rain exposure remain intact.

Night front/rear, close-face and high-resolution views were checked in headless Chromium with software WebGL. This is a readability improvement, not a hardware-GPU performance or photorealism claim.

## Graphics, accessibility and local preferences

The existing Settings panel controls real renderer and interface behavior. Preferences are validated and stored under `taxi-lib.client-settings.v1` in local browser storage when available; blocked, full or corrupt storage falls back safely and never prevents entry. They are device presentation preferences, not account data, server-authoritative gameplay, or anti-cheat inputs.

- **Quality:** Low, Medium and High select actual pixel-ratio caps, sun-shadow map sizes, rain-particle counts and showroom reflection/shadow resolutions. Selecting a preset restores 100% render scale; Low also starts with shadows disabled. Shadow and resolution controls can then be adjusted independently. Medium's 1.65 device-pixel cap, 2048 sun-shadow map, full rain and enabled shadows preserve the established default.
- **Render resolution:** 60%, 75% or 100% scales the 3D drawing buffer after the quality/device cap. HUD, settings, phone and showroom interface text remain at browser resolution.
- **Brightness:** 80–130% scales tone-mapping exposure only. The 100% default preserves the canonical day/night profiles; the control cannot change district time, weather, visibility rules, physics or rewards.
- **Reduced decorative motion:** follows the operating-system preference on first use and can be overridden locally. It stops cinematic menu orbit, route-marker rotation, task/incident pulsing, showroom camera transitions/damping and CSS animation/transition motion. Player/NPC movement, precipitation and other essential gameplay feedback continue.
- **Sound:** the persisted 0–100% slider is converted to bounded 0–1 Web Audio gain. Its default 65% preserves the previous effective 0.65 gain.

The same brightness, quality and motion preferences are applied when the lazy showroom renderer is created. Browser checks exercised live changes, drawing-buffer sizes, storage restoration and the Low/reduced-motion showroom in software WebGL. These controls provide performance options, not a measured frame-rate guarantee; hardware-GPU profiling remains a release gate.

## Realism verification boundary

A two-client Chromium/software-WebGL gameplay pass used authenticated realtime state rather than a teleport/debug interface. It verified separation from a shared spawn, continued walking after an incoming message, zero measured drift while typing a delivered reply, solid walking contact with a parked taxi, solid driving contact with the other pedestrian, and a stationary approach view whose signal changed from red to green. The running AudioContext, both siren carrier/sweep pairs and nonzero distance-attenuated voice gains were inspected. This is visual and audio-graph verification, not a human listening test, hardware-GPU performance result, server-physics certification or high-concurrency soak.

A later authenticated browser/network pass put a browser pedestrian in the path of an owned vehicle driven through normal 10 Hz accepted WebSocket poses. The browser displayed the server-issued injured condition, a non-graphic pose and countdown, then returned to healthy after the authoritative recovery window; the run reported no page/console errors. Separate pure and two-socket regressions cover low-speed immunity, fatal/repeat impacts, anti-spoofing, contact deceleration, interpolated footprint tolerance, recovery and respawn. A day-shift market route also reached the safety-route obstruction at 1.88 m: the compact worker nameplate remained visible, the large civic card was hidden, and the ordinary `View Market safety-route obstruction in Civic app` E prompt was present with no browser errors. These checks do not establish persistent casualty records, server traffic simulation, target-GPU frame rates or human-audible siren output.

## Performance targets for this slice

Targets, not measured claims: 60 FPS on a typical recent desktop at medium quality, 30 FPS on lower-power integrated graphics, under 150 ms interaction latency on a regional connection, and 20 connected clients in one district soak test. Automated tests cover domain correctness; rendering and multi-client load still require manual/profiling passes before release claims.

## Anti-cheat boundaries

Movement remains client-predicted and is therefore not fully cheat-proof. The server constrains accepted poses and uses only its last accepted state for financial checkpoints. Production should add server vehicle simulation or stronger replay/anomaly detection, velocity history, route progress and administrative review. No client request can directly set a balance, fare, owner or completion result.
