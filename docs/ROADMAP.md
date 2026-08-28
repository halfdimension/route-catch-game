# Route Catch Game Roadmap

> **PROPOSED / FUTURE WORK ONLY**
>
> Items in this document are not implemented unless they are later merged and
> moved into the current architecture documentation. Current behavior is
> described in [`POKEMON_GAME_CONTEXT.md`](../POKEMON_GAME_CONTEXT.md),
> [`ARCHITECTURE.md`](ARCHITECTURE.md), and the committed source.

The current pause checkpoint is PR #18, **Mobility & Travel Foundation**, merged
as `d44655c`. This roadmap deliberately keeps future ideas separate from that
committed baseline.

## Recommended Resume Order

1. Productionize MapLibre for SOLO.
2. Establish movement/avatar presentation primitives.
3. Add speed-based presentation transformations.
4. Polish camera behavior and game feel.
5. Explore Hunt Scan using Valhalla isochrones.
6. Expand encounters and larger game systems.
7. Improve deployment and distributed operation when product needs justify it.

This order is guidance, not approved scope or frozen architecture.

## MapLibre Productionization

The nearest-term direction is to make MapLibre the production/default SOLO
renderer while retaining Leaflet temporarily as a validation fallback.

Proposed work:

- Live-validate `CAR`, `MOTORCYCLE`, and `WALKING` across selection, routing,
  movement, catch, respawn, refresh recovery, and restart.
- Make MapLibre the default only after that validation.
- Keep multiplayer on Leaflet initially.
- Remove or rename “Prototype” terminology only after productionization.
- Preserve renderer-neutral gameplay truth; renderer code must not own routing
  mode, route authority, score, targets, or recovery state.
- Evaluate removal of the Leaflet SOLO path only after a stable fallback period.

Recovered active movement should normally open in `FOLLOW` around the
reconstructed player. The current source already requests direct recovered
`FOLLOW`; future polish should address any remaining broad or awkward framing
without storing raw camera pose as gameplay authority. Prefer reconstructing
camera presentation from semantic movement state unless the architecture is
deliberately redesigned.

## Travel-Mode Avatars

MapLibre presentation could represent the immutable active travel mode:

| Active mode | Possible presentation |
|---|---|
| `CAR` | Car or ground vehicle |
| `MOTORCYCLE` | Motorcycle |
| `WALKING` | Walking or running character |

The avatar consumes navigation-frame truth. It must not become routing,
movement, or recovery authority. Renderer-native animation should consume the
imperative navigation frame where practical instead of driving React state at
animation-frame frequency.

Possible presentation inputs and outputs include:

```text
inputs                                outputs
activeTravelMode                     avatarType
simulationSpeedMetersPerSecond       avatarScale
navigation position/bearing          bankAngle
route curvature                      animation/effects
movement state                       camera profile
```

## Speed-Based Presentation Transformation

`TravelMode` and simulation speed must remain independent. A future visual
resolver may transform the avatar at high game simulation speeds without
changing the route mode or provider.

One exploratory progression is:

```text
normal speed       -> selected ground avatar
higher speed       -> enhanced ground presentation
very high speed    -> helicopter / VTOL
higher still       -> plane / aircraft
extreme speed      -> jet / advanced aircraft
```

A threshold near `150 m/s` has been discussed as a possible point for
aircraft-style presentation. It is not a frozen constant and should be tuned
for game feel.

Example invariant:

```text
activeTravelMode = WALKING
simulationSpeedMetersPerSecond = 700

routing       remains WALKING through Valhalla pedestrian costing
presentation  may become aircraft-like
```

Changing an avatar must never silently change `activeTravelMode`, routing
costing, or provider. Fixed-wing presentation over road-shaped geometry may
need bearing smoothing and banking to avoid visually instantaneous turns.

## Camera and Game Feel

Exploratory presentation work:

- Mode-specific `FOLLOW` profiles and dynamic look-ahead.
- Car/motorcycle turning or lean behavior.
- Footsteps, dust, vehicle trails, rotor/hover effects, aircraft banking, and
  jet trails.
- Smooth avatar transformations.
- Catch camera punch, rarity effects, and cinematic legendary encounters.
- Sound, music, themes, weather, and richer world presentation.

These remain presentation ideas unless a future design explicitly changes
gameplay authority.

## Hunt Scan and Valhalla Isochrones

A future Hunt Scan could use Valhalla isochrones:

```text
active TravelMode
        -> matching Valhalla costing
        -> time-limited reachable region
        -> MapLibre visualization
        -> creature/encounter scan gameplay
```

Previously discussed scan windows are 3, 6, and 10 minutes. They are product
ideas, not API contracts.

The current application has no game isochrone endpoint, Hunt Scan UI, or scan
encounter logic. Valhalla's upstream capability does not make these Route Catch
features implemented.

## Larger Game Systems

Exploratory directions include gyms, raids, boss encounters, timed events,
legendary/special encounters, world themes, richer creature presentation,
cinematic encounters, and expanded progression. None is committed scope.

## Local Tooling and Deployment

The committed repository starts PostgreSQL, OSRM, the backend, and Vite through
separate or combined local workflows, but it does not provide a complete
portable Valhalla launcher, tile-build workflow, or provider readiness check.
OSRM scripts also contain machine-specific binary and dataset paths.

Future tooling may include:

- Environment-driven OSRM binary/data paths and routing URLs.
- A portable Valhalla launcher or container contract.
- A documented Valhalla tile-build/data workflow.
- Provider-specific health and full-stack readiness checks.
- An optional containerized local routing stack.
- Deployment automation and a hosted-routing strategy.
- A low-cost production plan for frontend, backend, PostgreSQL, routing, and
  WebSocket traffic.

No uncommitted local-tooling experiment is part of the current baseline.

## Multiplayer Evolution

SOLO `TravelMode` must not be copied into multiplayer without a separate design
for:

- authority and room-wide mode semantics;
- provider choice;
- concurrency, movement versions, sequencing, and generation guards;
- persistence and active-round recovery; and
- horizontal ownership/scaling.

Other possible distributed boundaries include Redis or another store/broker,
single-owner room coordination, durable active-state recovery, and durable
event publication. These technologies are not currently implemented and should
be selected only after the required consistency and failure model is defined.

Potential multiplayer hardening also includes resolving catch distance from
backend movement state, enforcing room membership on presence updates, and
correlating STOMP command rejections to client command IDs.
