# World design — Greater Monrovia vertical slice

## Geographic stance

The playable area is **Sinkor Coastal District**, a fictionalized and heavily compressed game environment inspired by Greater Monrovia. It is not a map of verified addresses, road connections, airport facilities or port infrastructure. Coordinates are game meters. Real district names provide cultural grounding; individual businesses such as Oceanview Hotel and the cooperative garage are fictional.

A future geographic pipeline should use appropriately licensed map data and verified satellite/topographic sources, record attribution, and separate source geometry from gameplay compression. No random road generator is used for navigation: the rendered roads, collision, minimap and GPS all share `src/shared/world.ts`.

## First district

- **Coastal edge:** Atlantic-inspired water, a sandy strip, palms, coastal haze and a beach access point west of the main road.
- **Tubman Boulevard-inspired spine:** a broad urban road with markings, sidewalks, taxis and local traffic. The game road is not presented as an exact reconstruction.
- **Sinkor market block:** concrete shops, colorful stalls, produce displays, merchants and pedestrians.
- **Residential/commercial blocks:** varied weathered plaster, corrugated roofs, balconies, walls, storefronts and tropical planting. Neither uniform poverty nor uniform luxury.
- **Community clinic and cooperative garage:** legible gameplay landmarks with roadside interactions.
- **Oceanview Hotel:** a fictional taller coastal business and transfer destination.
- **12th Street Taxi Stand:** a fictional transport meeting point and new-player spawn.

## First navigation destinations

| ID | Destination | Gameplay purpose |
| --- | --- | --- |
| `taxi-stand` | 12th Street Taxi Stand | Spawn, onboarding, NPC work |
| `sinkor-market` | Sinkor Market | Passenger demand, future commerce |
| `oceanview-hotel` | Oceanview Hotel | Hotel transfer jobs |
| `community-clinic` | Community Clinic | Essential local journey |
| `cooperative-garage` | Cooperative Garage | Future repair loop |
| `sinkor-homes` | 12th Street Homes | Fixed-catalog studio ownership and home upgrades |
| `coastal-cottages` | Atlantic Cottages | Fixed-catalog coastal home ownership and upgrades |
| `beach-access` | Beach Access | Exploration and tour hook |

## Environmental simulation

A compressed day/night cycle changes sun, sky, street lighting and NPC activity. Periodic tropical rain increases stopping distance and reduces steering grip, changes road materials, limits visibility, and applies a server-defined fare modifier. Weather is simulation state shared by server and client, not only a particle overlay.

## Expansion sequence

1. Polish Sinkor and connect a second Greater Monrovia district.
2. Add a separately streamed airport-inspired district with explicit fictionalization.
3. Add a port-inspired logistics zone with authorized gameplay areas.
4. Build regional road links only after geographic review; compress travel times intentionally.
5. Add Buchanan, Gbarnga, Ganta, Kakata, Greenville and Harper as production milestones, not menu-only destinations.

## Known slice limits

The district is procedural original geometry, not photogrammetry. Building interiors, boats, aircraft operation, regional highways and real-address accuracy are outside this vertical slice. The ocean is scenic and bounded; it is not a simulated maritime transport system yet.
