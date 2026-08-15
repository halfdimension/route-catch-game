# Route Catch Game — Canonical Engineering Context

> Living architecture and engineering handoff for the Route Catch Game
> project.
>
> This document is intended primarily for future GPT, Codex, Antigravity, and
> developer sessions working on this repository.
>
> Git and the current source code remain the ultimate implementation source of
> truth. This file records architectural intent, invariants, the verified
> current state, important decisions, and historical checkpoints so a new
> engineering session does not need the original chat history.
>
> Update this document after major architectural milestones. Before changing
> the system, verify the relevant implementation and tests because this living
> document can still lag behind Git.
>
> Baseline captured after PR #13:
>
> `Persist multiplayer round results and add match history`
>
> Main branch baseline at capture time:
>
> `c9e5f4c — merge commit for PR #13`

---

# 1. Project Identity

Repository:

```text
route-catch-game
```

Project name:

```text
Route Catch Game
```

The project is a full-stack location/map-based creature-catching game.

Players move across a real road network, chase creatures using routes calculated
by OSRM, catch creatures, score points, and participate in timed rounds.

The project currently contains two gameplay modes with deliberately different
architectures:

```text
SOLO
    mostly frontend-driven gameplay

MULTIPLAYER
    progressively backend-authoritative gameplay
```

This distinction is critical and must not be accidentally removed during future
refactors.

---

# 2. Repository Structure

High-level structure:

```text
route-catch-game/
├── frontend/
│   ├── src/
│   ├── test/
│   ├── package.json
│   └── ...
│
├── backend/
│   └── route-catch-api/
│       ├── src/main/java/com/routecatch/api/
│       ├── src/main/resources/
│       ├── src/test/
│       ├── pom.xml
│       └── ...
│
├── docs/
├── scripts/
├── .github/
│   └── workflows/
├── docker-compose.yml
├── README.md
└── POKEMON_GAME_CONTEXT.md
```

---

# 3. Current Technology Stack

## Frontend

Current important technologies:

```text
React 19
Vite 8
JavaScript
Leaflet
React Leaflet
MapLibre GL
React MapLibre
React Router
@stomp/stompjs
CSS
ESLint
Node test runner
```

Useful version families, verified from `package.json` and `package-lock.json`
at this checkpoint, are:

```text
react                 19.2.x
vite                  8.0.x
leaflet               1.9.x
react-leaflet         5.x
maplibre-gl           5.24.0
@vis.gl/react-maplibre 8.1.x
@stomp/stompjs        7.3.x
react-router-dom      7.18.x
```

Leaflet remains the default gameplay renderer.

MapLibre currently exists as an opt-in renderer for SOLO gameplay.

Enable MapLibre solo mode with:

```env
VITE_SOLO_MAP_RENDERER=maplibre
```

Development-only controls can be enabled with:

```env
VITE_ENABLE_DEBUG_CONTROLS=true
```

`RoomPlayPage` always renders the Leaflet-based shared `GameMap`; MapLibre has
not been wired into multiplayer.

Do not assume that a MapLibre change should automatically modify multiplayer.

---

## Backend

Backend stack, verified from `pom.xml`:

```text
Java 21
Spring Boot 4.1 (parent version 4.1.0 at this checkpoint)
Spring Web MVC
Spring Validation
Spring Data JPA
Spring Security
Spring WebSocket / STOMP
JWT via JJWT
Flyway
PostgreSQL
Maven
JUnit 5 / Spring Boot Test / MockMvc / Mockito
H2 for automated integration tests
```

Backend root:

```text
backend/route-catch-api/
```

---

## Routing Engine

Routing is provided by:

```text
OSRM
```

OSRM is used for:

```text
route calculation
nearest-road snapping
multiplayer authoritative movement routing
multiplayer creature spawn road snapping
solo route support through backend routing APIs
```

The browser should not directly own authoritative multiplayer routing.

---

## Database

Database:

```text
PostgreSQL
```

Schema evolution is owned by:

```text
Flyway
```

Hibernate uses:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Therefore:

```text
Flyway owns schema creation/change.
Hibernate validates the resulting schema.
```

Do not introduce ad-hoc Hibernate schema mutation.

---

# 4. Local Runtime Architecture

Current local-development topology (ports are defaults, not architectural
contracts):

```text
                 ┌──────────────────────────┐
                 │      React + Vite        │
                 │      Frontend            │
                 │      :5173               │
                 └────────────┬─────────────┘
                              │
                    REST + WebSocket/STOMP
                              │
                              ▼
                 ┌──────────────────────────┐
                 │      Spring Boot         │
                 │      Backend             │
                 │      :8080               │
                 └───────┬────────┬─────────┘
                         │        │
                  OSRM   │        │ JPA
                         │        │
              ┌──────────▼───┐ ┌──▼──────────────┐
              │     OSRM     │ │   PostgreSQL    │
              │     :5000    │ │     :5432       │
              └──────────────┘ └─────────────────┘
```

The browser does not communicate directly with PostgreSQL.

For authoritative multiplayer routing, the backend talks directly to OSRM.

---

# 5. Major Trust Boundary

The most important architectural principle in the project is:

```text
SOLO GAMEPLAY
    can remain responsive and frontend-driven.

MULTIPLAYER GAMEPLAY
    must increasingly use backend-authoritative state.
```

Do not convert multiplayer back into client-authoritative movement, score,
round lifecycle, or catch ownership simply because the frontend already has
similar solo functionality.

---

# 6. Authentication Architecture

Authentication is stateless and JWT-based. JJWT signs and validates the token;
Spring Security's REST filter extracts the user UUID claim, reloads that user
from PostgreSQL, and installs the `UserEntity` as the authenticated principal.
The immutable `users.user_id` UUID—not a username, display name, request field,
or room nickname—is the authoritative identity for protected data and
multiplayer commands.

Primary endpoints include:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

General flow:

```text
register/login
      │
      ▼
     JWT
      │
      ▼
Authorization: Bearer <token>
      │
      ▼
protected REST APIs
```

Passwords are stored using BCrypt hashing.

JWT is also used for WebSocket/STOMP. The HTTP handshake at `/ws` is permitted
so the STOMP connection can be established, but the inbound channel interceptor
requires a Bearer token on STOMP `CONNECT`, reloads the user by UUID, and keeps
that `Authentication` attached to later frames in the socket session.

The backend principal—not client-supplied player identity—is authoritative for
multiplayer commands.

`username` is a login handle and `displayName` is presentation data. Completed
rounds persist a display-name snapshot, while authorization continues to use
the participant's immutable UUID. The frontend restores a stored token by
calling `GET /api/auth/me`; failure clears the local authentication context.

Development-only JWT defaults exist in Spring configuration and must be
overridden for deployment. Never copy their values, real tokens, passwords, or
other secrets into this document.

---

# 7. Solo Gameplay Architecture

Solo gameplay predates the multiplayer authoritative architecture and remains
largely frontend-controlled.

This is intentional.

Solo flow is approximately:

```text
start solo round
      │
      ▼
frontend target spawning
      │
      ▼
backend nearest/route API
      │
      ▼
OSRM
      │
      ▼
route returned
      │
      ▼
frontend movement animation
      │
      ▼
frontend catch detection
      │
      ├── immediate UI/score/XP feedback
      │
      └── backend persistence/synchronization
```

Solo catches can update the local game immediately while backend synchronization
happens without blocking gameplay.

Do not automatically apply multiplayer's authoritative movement architecture to
solo mode unless a feature explicitly requires that redesign.

## Current implementation — active-round refresh recovery

An active SOLO round now survives a browser refresh/reload through a transient,
frontend-owned recovery checkpoint. Normal play remains memory-first. IndexedDB
stores recovery evidence for the current identity, while PostgreSQL remains the
durable store for backend sessions, catch history, and other historical data.
These are separate persistence concerns:

```text
live SOLO state               frontend memory
active-round recovery         versioned IndexedDB checkpoint
guest recovery identity       stable installation UUID in localStorage
backend/history durability    PostgreSQL
```

The SOLO recovery subsystem does not use Redis, Kafka, or any other broker.
Existing authentication-token and preference uses of localStorage are unrelated
to the recovery checkpoint; recovery state itself is not stored there.

The current checkpoint schema is version 1 and is scoped by an immutable
identity key: authenticated user UUID or guest installation UUID. It stores
semantic state needed to reconstruct a round, including:

```text
client round UUID and backend session UUID
round phase, duration, absolute start/end time, and storage expiry
settled player position and simulation speed
ROUTING or MOVING intent, route geometry, and a semantic movement anchor
active targets and already-caught targets
local score and XP
spawn paused state and next absolute spawn deadline
pending backend catch synchronization evidence
```

It deliberately does not store rendered animation frames or camera pose. A
checkpoint is validated as a complete versioned record rather than loosely
merged with defaults; malformed, unsupported-version, identity-mismatched, or
expired records are rejected, and cleanup is attempted through the guarded
writer path.

## Recovery bootstrap and lifecycle barrier

Recovery is not safe until authentication restoration has resolved whether the
browser represents an authenticated user or a guest installation. Bootstrap has
an explicit barrier:

```text
AUTH_UNRESOLVED -> RECOVERY_LOADING -> RECOVERY_READY
```

Round launch/restart, map movement, spawning, and catch detection are blocked
from creating fresh gameplay state until `RECOVERY_READY`. Hydration restores
targets, caught state, score/XP, spawning, movement, backend-session context, and
the original absolute round timeline before the recovered round is exposed as
ready. If IndexedDB is unavailable, gameplay is eventually released in a
degraded memory-only mode with a warning rather than remaining permanently
blocked.

Identity, bootstrap, gameplay-lifecycle, replay, route, spawn, and writer
generations prevent delayed asynchronous work from mutating a newer scope. This
includes ordinary A-to-B changes and ABA sequences:

```text
A -> B
A -> B -> A
```

Returning to the same identity does not make an A1 request current in A2.
Reset, restart, finish, logout/account change, and unmount invalidate their
captured scopes. IndexedDB replacements/deletions are serialized per identity.
A terminal deletion synchronously tombstones its writer generation, rejects
later stale replacements, and orders a replacement writer behind the old
generation's native write/delete barrier. This prevents a late reset or finish
from resurrecting an old checkpoint or deleting a newly established round.

The schema defines `STARTING`, `RUNNING`, and `RECONCILING` round phases. The
current normal production launch path writes its first `RUNNING` checkpoint only
after the backend session has been created and started; therefore a crash after
the backend responds but before that first checkpoint commits remains outside
the recovery guarantee. `STARTING` remains a validated/bootstrap-supported
transient phase, but the current launch path does not construct it.

## Epoch-anchored movement and absolute round time

SOLO movement is now derived from a measured route and an epoch-anchored
semantic movement plan, not from accumulated animation-frame progress:

```text
distance(at time) =
    clamp(
        anchor distance
        + elapsed wall-clock seconds * movement speed,
        0,
        measured route length
    )
```

The movement anchor records route distance and epoch time. Refresh downtime
therefore counts as real elapsed movement time. Recovery samples the measured
route at the reconstructed distance and either resumes from that position or
settles at the destination if the route completed while the browser was
unavailable. A speed change first resolves progress under the old anchor, then
re-anchors at the same distance/time with the new speed so progress is
continuous. Backward wall-clock observations cannot move the player backward.

The round clock likewise uses absolute `startedAt`/`endsAt` epoch timestamps.
Refresh never starts a new countdown. A delayed foreground callback or recovery
reconstructs round completion at the semantic end time, and movement is clamped
so it cannot apply events beyond that cutoff.

Leaflet and MapLibre consume this same recovered player, route, target, score,
and round truth. Leaflet has no MapLibre navigation-camera behavior; MapLibre
adds presentation only. Multiplayer remains Leaflet-based and is unaffected by
this SOLO recovery feature.

## Target, spawn, and catch timeline recovery

Known active targets survive refresh with semantic spawn and absolute expiry
times. Expiry does not restart on hydration. Spawn cadence also keeps an
absolute next deadline: a delayed callback advances from its prior cadence phase
and skips missed opportunities rather than producing a burst.

Only one asynchronous spawn-materialization operation can own the current
spawn generation at a time. Reset/restart, logout or identity change,
pause/resume, round ineligibility, hydration/replacement, and unmount invalidate
stale results before they can publish a target or release a newer generation's
ownership.

Random spawn opportunities missed while the browser is completely unavailable
are intentionally not replayed. After recovery, an overdue schedule continues
with one ordinary future cadence. There is no deterministic spawn PRNG/log, so
arbitrary downtime is not exactly reproducible.

Moving catch detection and recovery share the same route-distance/timeline
geometry. The system finds the first entry into a target's catch radius along a
measured route interval rather than relying on sampled rendered frames. This
means a large or delayed animation interval cannot jump across an otherwise
valid catch.

Terminal movement events use the same semantic model. A CHASE catch stops at
its exact route-entry distance; chased-target expiry stops at its absolute
expiry; round end stops at the round cutoff; and route completion is the
measured route endpoint. Events after the winning terminal event are not
applied. Equal-time priority is currently:

```text
ROUND_END
TARGET_EXPIRY
ROUTE_COMPLETION
TARGET_CATCH
```

Thus a catch exactly at target expiry or round end does not win, and a catch at
the route-completion instant is not applied after completion.

## Local catch state and pending-catch outbox

SOLO remains responsive and frontend-driven. A valid local catch immediately
removes the active target, adds the caught target, increments local score and XP
by the target's catalog score, updates presentation, and creates a stable catch
UUID. It does not wait for a backend network round-trip. This is intentionally
different from multiplayer's authoritative catch transition and scoring.

Each local catch also creates pending synchronization evidence containing that
stable catch identity, the target/creature identity, and logical caught time.
The normal successful path is:

```text
local semantic catch and stable catchId
        -> serialized durability-critical checkpoint replacement
        -> POST the same catchId to the backend
        -> require a response carrying the same catchId
        -> durably remove that pending entry
```

The live flow waits for the IndexedDB persistence attempt before POSTing. If the
write commits, the catch has durable replay evidence first. If storage fails or
the bounded application wait times out, the round enters explicit degraded mode
and permits only that one live submission; it does not falsely claim the catch
is recoverable. Recovered replay is stricter and runs only when the checkpoint
is durable and the backend session/identity has been verified.

Recovered pending catches replay automatically once recovery becomes eligible.
Replay uses the same `catchId`, performs backend synchronization only, and does
not re-award local score/XP or recreate catch presentation. It is guarded by
identity, lifecycle, replay, client-round, backend-session, writer-generation,
and catch identity. Live and recovered submission of the same operation share
single-flight ownership. Multiple pending catches are processed sequentially in
deterministic `caughtAt`, then `catchId`, order.

Network/no-response failures, HTTP 429, HTTP 5xx, and durable acknowledgement
write failures are retryable/uncertain. They leave evidence pending and stop the
current replay pass so the worker cannot hot-loop past uncertainty. Other
deterministic client failures and response-identity mismatches also remain
pending, but are suppressed for the current recovery lifecycle; a deterministic
failure for one catch does not prevent later pending catches in that pass.
Retries are triggered deliberately by a new eligible recovery lifecycle or the
browser `online` event. No timed exponential-backoff subsystem or new generic
fetch timeout was added.

`RECONCILING` is a non-resumable recovery phase used after gameplay has ended
while backend session/catch cleanup may still be incomplete. It contains no
active movement, active targets, or spawn schedule. Pending catch replay can
continue, and an exact durable acknowledgement can update the same
`RECONCILING` checkpoint, but this never changes the phase back to `RUNNING`.

## Recovery checkpoint retention

Checkpoints are transient evidence, not permanent history. Current version-1
retention is:

```text
STARTING        createdAt + 2 minutes
RUNNING         round endsAt + 15 minutes
RECONCILING     round endsAt + 15 minutes
```

A `RUNNING` checkpoint stops being resumable at `endsAt` even though its
reconciliation evidence may remain during the grace period. Pending catch
synchronization is therefore bounded recovery evidence, not a permanent outbox.

## Backend SOLO catch idempotency

The implemented catch endpoint remains:

```text
POST /api/game/sessions/{sessionId}/catches
```

The request accepts an optional client `catchId` UUID. When supplied, that UUID
is persisted as the logical catch identity and returned in the response. When
omitted, the backend generates a new UUID for compatibility with legacy callers;
separate legacy retries therefore remain separate catches and do not gain
cross-request idempotency.

No new migration or idempotency table was needed. The original
`V1__create_game_tables.sql` migration already made
`caught_creatures.catch_id` a UUID primary key, and the implementation reuses
that global uniqueness constraint.

After session ownership/authentication checks, backend semantics are:

```text
same catchId + same session + same creature
    -> idempotent success; no second score/count award

same catchId + different session or different creature
    -> HTTP 409 CATCH_ID_CONFLICT
```

An exact persisted replay succeeds even if the session has since ended. A new
catch ID against an ended session remains rejected. Authenticated sessions
require the same authenticated user UUID; an anonymous request cannot mutate an
authenticated session. Guest sessions retain the existing anonymous
session-UUID capability semantics.

The normal writer is transactional, takes a pessimistic lock on the session row,
checks for an existing catch, flushes the catch insert, and only then mutates and
flushes session score/count. The catch primary key is the global race arbiter.
If a concurrent insert loses that unique race, its writer transaction rolls
back; collision resolution then uses a fresh `REQUIRES_NEW` read transaction and
persistence context to return the exact winner or raise a catch-ID conflict.
Consequently concurrent identical requests cannot double-award, while
cross-session reuse has one winner and one conflict.

---

# 8. Solo Map Renderers

The application currently supports:

```text
Leaflet
MapLibre
```

Leaflet remains the default.

MapLibre is currently an opt-in SOLO renderer.

There are two MapLibre surfaces: the integrated solo renderer selected by
`VITE_SOLO_MAP_RENDERER=maplibre`, and a separate development-only lazy route at
`/dev/maplibre` for the prototype. Production routing does not expose the
prototype page. MapLibre-specific components/CSS live under
`components/maplibre` and `styles/maplibre*.css`; both renderers consume the
same solo game state/handlers rather than owning game rules.

The integrated renderer continues to provide player, creature, route,
destination, compact HUD, target/chase/routing, catch-feedback, manual
recentering, rarity-animation, and reduced-motion presentation. The navigation
camera described below extends that renderer without moving game rules into it.

## Current implementation — MapLibre SOLO navigation camera

The integrated MapLibre SOLO renderer now has a navigation-oriented camera
system. Camera presentation state is local to the MapLibre renderer; it is not
global gameplay state and it is not shared with Leaflet or multiplayer.

The three local presentation modes are:

```text
OVERVIEW -> FOLLOW -> FREE
               ^        |
               └ RESUME ┘
```

For a fresh route, `OVERVIEW` briefly frames the current player, complete route,
and destination before movement. Fresh route animation has an approximately
400 ms delay only when the configured SOLO renderer is MapLibre, giving the
renderer time to show this prelude. Bounds are calculated deliberately from the
player, route, and destination with responsive HUD padding and
antimeridian-safe longitude handling. The overview is wider than FOLLOW,
north-up, and capped at zoom 15.75. At the normal-motion checkpoint its
MapLibre fit transition is 240 ms with a 24-degree pitch; these are presentation
values, not gameplay timing contracts.

`FOLLOW` is driven imperatively with MapLibre `jumpTo` and brief `easeTo` calls.
The map remains uncontrolled through `initialViewState`; there is no React
`viewState` feedback loop. The player is framed approximately lower-center
with useful road space ahead, while bearing follows route direction. The
camera consumes navigation frames directly rather than copying full camera
state into React on every animation frame. React holds only coarse presentation
state such as the mode control, active destination, and accessibility setting,
not the per-frame camera pose.

`FREE` is entered when the user meaningfully detaches navigation framing, such
as panning, box zooming, pitching, or manually rotating. Player movement,
catching, scoring, spawning, and other gameplay continue, but the camera stops
being forced. Resume Follow uses the latest navigation frame and returns to the
current navigation pose; it does not restart movement or route calculation.

## Current implementation — navigation-frame stream

`useRouteAnimation` still owns SOLO route-animation semantics. It now
preprocesses valid route geometry into measured non-zero segments with
cumulative distances, so frame sampling does not repeatedly remeasure the
whole route. Duplicate/zero-length points are retained in the source geometry
but omitted from the measured segment plan.

The animation continues to publish existing React `playerPosition` updates
required by:

```text
catch detection
target spawning
score/gameplay state
HUD and marker rendering
Leaflet
other existing SOLO behavior
```

In parallel, it publishes an imperative navigation-frame stream through a
small stable channel. The channel replays its latest frame to a new subscriber,
isolates listener errors during publication, supports unsubscribe, and clears
listeners on player-state teardown. This lets the MapLibre camera consume
per-frame navigation data without introducing a new React camera-state render
cycle.

A current navigation frame contains these concepts:

```text
routeRevision
position
bearingDegrees
lookAheadPosition
lookAheadDistanceMeters
speedMetersPerSecond
progress
distanceTraveledMeters
distanceRemainingMeters
totalDistanceMeters
isMoving
navigationStartKind
timestampMs
```

The exact object shape may evolve, but route revision, measured progress, and
imperative delivery are important current boundaries.

## Current implementation — fresh versus recovered navigation

Navigation frames carry one ephemeral route-scoped start intent:

```text
FRESH
RECOVERED_ACTIVE
```

This is renderer input, not durable gameplay state. Current behavior is:

```text
fresh MapLibre route
    OVERVIEW -> approximately 400 ms route prelude -> FOLLOW

recovered already-MOVING MapLibre route
    reconstructed current navigation frame -> FOLLOW directly
```

`RECOVERED_ACTIVE` skips both a new overview and the fresh-route delay. A route
that was still `ROUTING` at refresh is re-requested through the normal route
path and is treated as `FRESH` when the new geometry arrives. Any later route
started after recovered navigation is also `FRESH` again.

Leaflet consumes the same recovered movement state but has no navigation start
intent, overview camera, or MapLibre prelude.

MapLibre camera state is intentionally presentation-only and is not included in
the SOLO checkpoint. Recovery does not persist or restore camera mode, center,
zoom, pitch, bearing, `FREE`, FOLLOW zoom override, transition state, or
`navigationStartKind`. Refreshing active MapLibre movement intentionally returns
to FOLLOW at the reconstructed position; a previously detached `FREE` camera is
not restored.

## Current implementation — heading and look-ahead

Route heading is calculated from distance-based samples along the measured
route, not from the previous animation frame's coordinate delta. This avoids
short-segment jitter and handles duplicate/zero-length route points. Near
completion, the heading window falls back to a useful look-behind sample so the
final heading remains stable instead of collapsing with remaining distance.

The current speed-aware look-ahead profile is:

```text
configuredLookAheadMeters = clamp(speedMetersPerSecond * 0.45, 20, 80)
actualLookAheadMeters = min(configuredLookAheadMeters, remainingRouteMeters)
```

This is a deterministic, bounded camera-input profile. It does not alter
gameplay speed. Short routes and completion cannot look beyond the destination.
The physical route bearing in a navigation frame is separate from camera
smoothing: FOLLOW applies elapsed-time smoothing with shortest-angle
interpolation, including wraparound such as 359 degrees to 1 degree.

## Current checkpoint — tunable camera profile

These values describe the current DEFAULT MapLibre SOLO presentation profile.
They are intentionally centralized and tunable, not permanent architectural
contracts or global MapLibre limits.

| Parameter | Current value |
|---|---:|
| FOLLOW minimum zoom | 16.5 |
| FOLLOW default zoom | 17.5 |
| FOLLOW maximum zoom | 18.3 |
| FOLLOW pitch | 55 degrees |
| FOLLOW look-ahead center fraction | 0.62 |
| OVERVIEW maximum zoom | 15.75 |

The 0.62 look-ahead fraction produces the current lower-center player framing.
Speed changes look-ahead distance, but FOLLOW zoom itself is not currently
speed-aware; this avoids camera zoom pumping from small speed changes.

User zoom during FOLLOW does not by itself detach the camera. Wheel zoom,
supported +/- control zoom, and identifiable pure zoom interactions can remain
in FOLLOW. At the end of such a zoom, the renderer stores a FOLLOW-only zoom
override clamped to 16.5 through 18.3 and preserves it on subsequent FOLLOW
frames. A new route clears the override and returns to the 17.5 default.

FREE exploration is not globally clamped to the FOLLOW zoom range. Resume
Follow revalidates the stored navigation zoom before applying the current
frame. Pan or manual orientation changes enter FREE. Camera operations tagged
as programmatic, and events without genuine user input, do not accidentally
trigger FREE; this prevents camera feedback loops. Gesture classification is
limited to the MapLibre events and input types explicitly handled by the
renderer and covered by its tests.

## Current implementation — lifecycle and destination safeguards

SOLO route animation and MapLibre camera work use separate revision guards.
Route start, cancellation, replacement, reset, and animation teardown invalidate
stale route revisions and cancel both delayed-start timers and animation-frame
work. The camera controller has its own operation revision and timer manager;
invalidation clears scheduled overview/follow callbacks and can stop an active
MapLibre transition.

These guards ensure that callbacks belonging to a cancelled or replaced route
cannot manipulate a newer route. The same route-clearing path is used by
player/game reset, round end, target expiry, chase cancellation, and completed
chase cleanup. MapLibre component unmount marks the camera controller
unavailable, clears its scheduled work, and stops its transitions. Separately,
`useRouteAnimation` teardown clears animation work and invalidates its route
revision, while player-state teardown clears navigation-frame listeners.
Map-load checks and mounted refs prevent late work from updating an unavailable
map/component.

All imperative camera operations are gated until MapLibre emits its load/ready
signal. Fresh or recovered navigation frames may arrive earlier and are retained
as semantic input, but they cannot call map camera APIs before readiness. Once
ready, a current recovered-active frame enters FOLLOW directly. Route revisions
ensure an old pre-load frame cannot manipulate a replacement route.

The destination beacon is MapLibre-local presentation state. It remains
visible during the active route prelude and navigation, including while the
camera is FREE, then clears on completion, cancellation, or replacement. This
does not require globally clearing `routeCoordinates` at ordinary route
completion, and it does not change Leaflet destination behavior.

## Current implementation — reduced motion and buildings

With `prefers-reduced-motion: reduce`, decorative overview/follow/resume camera
durations become zero, FOLLOW is flat and north-up, and continuous cinematic
rotation is disabled. Functional positional tracking continues. CSS also
removes or simplifies continuous MapLibre marker, route, beacon, catch, and HUD
motion. The functional MapLibre-only route prelude remains part of fresh route
start; reduced motion removes its camera transition animation rather than
disabling navigation setup. Recovered already-moving routes intentionally skip
that fresh prelude under either motion preference.

Compatible MapLibre styles still receive the existing 3D building extrusion
layer. Its current opacity is tuned from the earlier 0.42 to 0.34 so buildings
retain environmental depth without visually dominating route, player, and
target overlays. This is presentation tuning, not an architectural invariant.

## Explicit non-changes

The original navigation-camera milestone was frontend-only and MapLibre
SOLO-only. The later active-round recovery milestone changed SOLO recovery and
backend SOLO catch synchronization, but still did **not** add or change:

```text
multiplayer MapLibre rendering or multiplayer architecture
Valhalla integration
WALK / BIKE / CAR travel modes
vehicle or person transport actors
Redis or Kafka
a routing-provider abstraction
route traveled-vs-remaining rendering
an approaching/arrival camera state
an arrival/catch cinematic
```

Leaflet remains the default gameplay renderer, the existing renderer setting
keeps MapLibre opt-in for SOLO, and `RoomPlayPage` remains Leaflet-based. A
separate local Valhalla experiment is not part of the current Route Catch
architecture and must not be described as integrated.

## Known limitations and future direction

Browser E2E coverage does not yet exist, and navigation-camera visual feel
still requires manual browser validation. The current closer FOLLOW framing has
been manually validated as a suitable baseline, not as a final profile for
every future transport type.

Camera persistence is intentionally absent. Refresh resets presentation to the
recovered FOLLOW default rather than restoring FREE mode or a FOLLOW zoom
override.

Possible future work, none of which is implemented by this milestone, includes:

```text
WALK / BIKE / CAR transport actors
mode-specific camera profiles
traveled-vs-remaining route visualization
approaching and arrival camera states
eventual mode-aware routing
eventual multiplayer MapLibre presentation driven by authoritative movement plans
```

Preserve the current renderer isolation unless a future task explicitly
redesigns it.

---

# 9. Multiplayer Architecture Overview

Multiplayer has evolved significantly beyond basic presence.

Current conceptual architecture:

```text
Authenticated user
      │
      ▼
Multiplayer room
      │
      ├── membership / host
      ├── presence
      ├── authoritative round lifecycle
      ├── authoritative movement plans
      ├── shared creature population
      ├── authoritative catches
      ├── authoritative scoring
      ├── round finalization
      ├── result publication
      └── PostgreSQL round-result persistence
```

The backend is authoritative for important multiplayer game state.

---

# 10. Multiplayer Room Lifecycle

Authenticated users can:

```text
create room
join room
leave room
close room
read room
list their rooms
```

Rooms contain:

```text
room code
host
members
room status: OPEN, IN_PROGRESS, or CLOSED
game status: WAITING, RUNNING, FINALIZING, or ENDED
gameplay settings
```

The creator is the initial host. When a host leaves a non-empty room, host
ownership transfers deterministically to the remaining member with the oldest
`joinedAt`, with user UUID as the tie-breaker. When the last member (necessarily
the host) leaves, the room closes. A host can also close explicitly. Closing an
active round finalizes it with `ROOM_CLOSED`; the room becomes `CLOSED` only
after successful result persistence. Closed room objects remain in the
in-memory map until process exit—they are marked closed rather than deleted.

Joining is currently allowed even while a room is `IN_PROGRESS`, but the round
participant roster was frozen when the round started. A mid-round joiner is a
room member yet cannot move, catch, or appear in that round's result. Leaving
does not remove a player from an already-frozen round roster.

Host-only operations include start, manual end, close, settings changes, and
manual creature spawning (when enabled). Gameplay reads such as game state,
scoreboard, creatures, and movement snapshots require membership in their
services. One important exception is `GET /api/multiplayer/rooms/{roomCode}`:
the route is authenticated but its controller currently reads the room without
a membership check. Do not treat knowledge of a room code as authorization for
historical results; those use persisted participation.

Rooms and membership are stored in a `ConcurrentHashMap` inside the single
Spring Boot process. They are not reconstructed after restart.

---

# 11. Multiplayer Presence

WebSocket endpoint:

```text
/ws
```

Presence publish destination:

```text
/app/rooms/{roomCode}/presence
```

Presence subscription:

```text
/topic/rooms/{roomCode}/presence
```

Presence originally carried frequently updated coordinates.

That is NO LONGER its main role after authoritative multiplayer movement was
introduced.

Current conceptual responsibility of presence:

```text
identity
username and display name
socket liveness
online membership
client-reported coordinate/status fallback
```

Presence must NOT again become the source of continuous authoritative player
movement.

Presence is in memory and is removed when the owning socket session
disconnects. It is useful as the initial/fallback position only when no
authoritative movement plan or settled position exists. Presence payloads are
therefore not suitable for scoring, finalization, or historical authorization.

Current boundary: the presence STOMP handler authenticates the principal but
does not call the room service to verify membership before accepting a room
code. This is a known authorization gap in the presence-only channel; it does
not grant access to protected room REST operations or completed results.

---

# 12. Authoritative Multiplayer Movement

This is one of the most important architectural milestones.

Multiplayer movement does NOT depend on continuously publishing browser
coordinates.

The architecture is:

```text
frontend movement intent
        │
        │ authenticated STOMP command
        ▼
Spring Boot
        │
        ├── authenticate player
        ├── validate room membership
        ├── validate running round
        ├── determine authoritative source position
        ├── resolve destination
        └── call OSRM
                │
                ▼
          authoritative route
                │
                ▼
          movement plan
                │
        ┌───────┴────────┐
        ▼                ▼
 scheduled completion   room event
```

The backend owns:

```text
source position
route used for multiplayer movement
movement identity
movement version
start timestamp
speed
completion semantics
cancellation
replacement/reroute semantics
client-command idempotency
```

Start and cancel intents carry a `clientCommandId`; reusing it for a different
intent is rejected. A start may include the client's last observed movement
version, and stale expected versions are rejected. Requested speed is bounded
by room settings; when player speed control is disabled, the room maximum is
used.

---

# 13. Movement Source Position Priority

When a new multiplayer route begins, the backend derives the source rather than
trusting a client coordinate.

Current conceptual priority:

```text
1. interpolated current position of active movement plan
2. stored authoritative terminal/stationary position
3. valid presence coordinate fallback
4. configured initial position
```

This enables replacement/rerouting from the player's actual authoritative
position.

---

# 14. Movement Plans

Movement plans are versioned.

Important properties include concepts such as:

```text
movement ID
player identity
room identity
movement version
encoded polyline6 route geometry
total route distance
simulation speed
startedAt and expectedEndAt
source, destination, and current position
MAP or CREATURE destination type
optional target creature instance ID
status
```

OSRM multiplayer routes use polyline6 geometry.

The frontend decodes movement geometry and interpolates player position from the
authoritative timeline.

The frontend must not move multiplayer players based solely on accumulated
animation frames.

---

# 15. Multiplayer Movement Events

Important event types:

```text
MOVEMENT_STARTED
MOVEMENT_CANCELLED
MOVEMENT_COMPLETED
```

Movement subscription topic:

```text
/topic/rooms/{roomCode}/movements
```

Authenticated snapshot recovery endpoint:

```text
GET /api/multiplayer/rooms/{roomCode}/movements
```

Movement events include protection mechanisms such as:

```text
movement IDs
movement versions
room sequencing
server timestamps
event UUIDs
```

The frontend rejects:

```text
duplicate events
old sequences
stale movement versions
stale snapshots
events from the wrong room
callbacks from an obsolete connection/subscription generation
```

A movement envelope does not currently carry the backend round generation, so
client-side movement filtering must not be described as a round-generation
check. Backend scheduled completion and route-commit paths do guard the actual
round UUID/generation. A detected room-sequence gap applies a valid complete
plan payload immediately, marks the state as needing recovery, and triggers
snapshot reconciliation rather than assuming every intermediate WebSocket
event was received. A snapshot older than the current room sequence is not
allowed to roll state back.

---

# 16. Multiplayer Movement Rendering

Frontend rendering is based on server-relative time.

Conceptually:

```text
elapsed = estimatedServerNow - plan.startedAt

routeFraction =
    clamp(
        elapsedSeconds * speedMps / backendRouteDistance,
        0,
        1
    )
```

The route fraction is mapped onto measured decoded geometry.

Polyline geometry is decoded/cached rather than repeatedly decoding on every
frame.

The frontend maintains an estimate of:

```text
server clock - client clock
```

and adjusts it using accepted server timestamps.

This design fixes the previous background-tab problem.

If a browser tab becomes hidden and animation frames pause:

```text
player does NOT stop moving authoritatively
```

When rendering resumes, the client calculates the correct position from the
timeline.

Therefore do NOT reintroduce frame-count-based multiplayer progression.

---

# 17. Movement Replacement / Rerouting

If the player begins another multiplayer movement while already moving:

```text
old movement
      │
      ▼
calculate the authoritative interpolated position at command preparation
      │
      ▼
cancel/replace previous plan
      │
      ▼
route from current authoritative point
      │
      ▼
new versioned movement plan
```

Guarded completion prevents an old scheduled callback from completing a newer
movement.

Movement completion checks identifiers/version/current-plan ownership before
transitioning state. OSRM runs outside the room mutation section; on return the
service revalidates room/round identity, target identity, and a per-player state
revision before it commits the new plan. A superseded active plan emits
`MOVEMENT_CANCELLED` before the replacement emits `MOVEMENT_STARTED`.

---

# 18. Multiplayer Shared Creatures

Multiplayer creatures are backend-owned shared instances.

All players in a room observe the same authoritative creature instances.

The system supports:

```text
automatic backend spawning
manual host spawn override for development/admin use
creature expiry
catch transitions
shared disappearance after catch
```

Creature state remains in-memory during the active round.

---

# 19. Automatic Multiplayer Creature Spawning

Normal multiplayer gameplay uses backend-controlled automatic spawning.

One spawn coordinator operates for a running room/round.

Conceptual lifecycle:

```text
round starts
    │
    ▼
generation-guarded spawn coordinator
    │
    ├── determine desired population
    ├── resolve authoritative player positions
    ├── choose fair player anchor
    ├── generate candidate location
    ├── OSRM /nearest
    ├── validate separation
    └── commit creature if round still valid
```

Current configuration defaults at the PR #13 checkpoint (tuning values, not
architectural contracts) are:

```text
interval                         5 seconds
base active creatures           4
per-player active creatures     2
maximum active creatures        30
maximum spawns per cycle        5

minimum spawn radius            150 m
maximum spawn radius            1200 m

minimum creature separation     100 m
maximum placement attempts      8

creature TTL                    2 minutes
```

Population target:

```text
desired =
    clamp(
        baseActiveCount + eligiblePlayerCount * perPlayerActiveCount,
        0,
        maxActiveCount
    )
```

Spawn work is generation-guarded.

An OSRM request started for an old round must not be allowed to create a creature
after that round has ended or restarted.

Eligible spawn anchors are current room members with a resolvable valid
position. Anchor selection favors the player with the fewest active creatures
within the fairness radius, then UUID for deterministic ties. Because room
membership may change during a round, this population input is not identical
to the frozen result participant roster.

---

# 20. Spawn Position Authority

Automatic spawning resolves player position using authoritative state.

Conceptually:

```text
active movement plan position
        ↓
stored authoritative stationary position
        ↓
presence fallback
```

OSRM `/nearest` is used to snap generated creature locations to routable road
locations.

OSRM calls should remain outside critical state mutation locks where possible.

---

# 21. Multiplayer Catch Architecture

The multiplayer creature state transition and score award are
backend-authoritative.

The backend validates concepts including:

```text
authentication
room membership
start-time round participation
running round
creature state
creature expiry
catch distance
duplicate/concurrent catch
```

A creature catch should behave atomically.

Conceptually:

```text
ACTIVE creature
      │
      │ valid winning catch
      ▼
CAUGHT
      │
      ├── catch record
      ├── score update
      ├── catch count update
      └── event/state update
```

Concurrent players cannot both receive credit for the same creature.

The winning coordinated transition is authoritative.

Important current limitation: the catch REST request supplies `playerLat` and
`playerLon`, and the backend computes the 75 m distance against those submitted
coordinates. The normal frontend submits its rendered authoritative movement
position, but the catch service does not yet resolve the player's position from
`RoomPlayerPositionResolver`. Thus creature ownership, the one-winner state
transition, score award, and catch snapshot are server-owned, while the distance
input is not fully tamper-resistant. Do not overstate catch-position authority;
closing this gap is a possible future hardening task.

---

# 22. Multiplayer Scoring

Multiplayer score is backend-owned.

Successful authoritative catches update:

```text
player score
catch count
round catch history
```

Zero-score round participants are still represented in final results.

Frontend code must not independently calculate the authoritative final
multiplayer score.

At finalization, final score is recomputed from each frozen catch record's
`scoreAwarded` rather than trusting a separate mutable total. The persistence
mapper also verifies that catch scores, rarity counts, catch totals, personal
results, and public leaderboard entries agree before writing.

---

# 23. Round Identity

Each multiplayer round has a unique round identity.

Important concepts:

```text
round UUID / round instance ID
room code
room-local generation
startedAt
endsAt
participant roster
```

Generation protection is used extensively to stop stale asynchronous work from
an earlier round affecting a later round.

Do not remove generation checks casually.

They protect against delayed:

```text
scheduler callbacks
OSRM requests
movement completion
spawn operations
round timeout operations
```

---

# 24. Authoritative Round Lifecycle

`RoomGameStatus` has exactly four values:

```text
WAITING -> RUNNING -> FINALIZING -> ENDED
ENDED  -> RUNNING (a later generation started by the host)
```

This is distinct from `MultiplayerRoomStatus` (`OPEN`, `IN_PROGRESS`,
`CLOSED`). Starting increments a room-local `generation`, creates a new random
round UUID, freezes the start-time participant roster, stores the requested
duration, and records `startedAt`/`endsAt`. Normal completion reopens the room;
`ROOM_CLOSED` completion closes it.

End reasons are exactly:

```text
HOST_ENDED
TIME_EXPIRED
ROOM_CLOSED
```

The host can end manually. The round scheduler invokes `TIME_EXPIRED` at
`endsAt`, while reads also detect an expired running round. Closing an active
room routes through the same finalizer. Expected round UUID and generation are
checked before transition; stale callbacks fail without mutating a later round.

`FINALIZING` exists so gameplay cannot continue while immutable results are
being constructed or persistence is being retried. Movement and catch services
reject this state. A process restart cannot recover an active or `FINALIZING`
round because the room, live score/catches, and finalization context are in
memory.

Late gameplay mutations must be rejected once finalization begins.

---

# 25. Round Finalization

`RoomRoundFinalizationService` is the central finalization path.

The actual successful ordering is important:

```text
1. Under the room coordinator, validate the expected round UUID/generation.
2. Transition `RUNNING -> FINALIZING` and create an in-memory finalization
   context with the first end reason, ended time, duration, and room
   disposition.
3. Publish the internal Spring `FINALIZING` lifecycle event once.
4. Freeze matching active movement plans at the authoritative end time,
   invalidate/clear active creatures, and stop the generation's spawn loop.
5. Snapshot the start-time participant roster, catches, and scores; calculate
   deterministic competition ranking; cache one immutable
   `FinalizedRoomRound` in the finalization context.
6. Call `CompletedRoundPersistenceService.persistIfAbsent`. Its writer runs in
   a Spring transaction; returning to the finalizer means the round, player,
   and catch rows have committed (or an already-committed identical round UUID
   was recovered).
7. Only after that commit, set game status to `ENDED`, expose the immutable
   result in the bounded in-memory result store, and set room status to `OPEN`
   or `CLOSED`.
8. Remove the finalization context and publish the internal Spring `STOPPED`
   or `CLOSED` lifecycle event.
9. Hand the already-stored immutable result to the publication-only service,
   which attempts the WebSocket `GAME_ENDED` envelope.
```

The internal lifecycle events in steps 3 and 8 are not themselves WebSocket
payloads. `GAME_ENDED` is the WebSocket notification. The database transaction
must commit before in-memory completion, room disposition, `STOPPED`/`CLOSED`,
or `GAME_ENDED` is exposed; otherwise a client could observe completion that
cannot survive restart.

Preparation progress and the immutable result are cached in the finalization
context. A persistence failure leaves the round `FINALIZING`, does not store or
publish completion, and a retry reuses the same result, round UUID, ended time,
scores, ranks, and catches. If failure occurs before immutable result
construction, completed preparation flags are reused and unfinished
preparation is attempted again. A later close request can upgrade the pending
room disposition to `CLOSED`, but it does not rewrite the first frozen end
reason/result.

The timeout scheduler automatically retries
`ROUND_PERSISTENCE_UNAVAILABLE`/`ROUND_FINALIZATION_UNAVAILABLE` at most three
total attempts with one-second then two-second backoff intervals. An explicit
API request can also resume an existing in-process `FINALIZING` context. After
scheduler exhaustion the round remains `FINALIZING`; no completion is exposed.
There is no durable recovery for this state after process restart.

Database idempotency is anchored by the unique round instance UUID. The writer
first reads for an existing UUID. If concurrent writers race, only the specific
named round-UUID unique violation is treated as an idempotency race; after the
losing transaction rolls back, a fresh read transaction returns the winner.
Other integrity failures are not swallowed. This is retry-safe, but it is not a
general distributed active-round coordinator.

Publication failure is deliberately outside this path: it must never trigger
re-scoring, lifecycle replay, or re-persistence.

---

# 26. Participant Roster

The result participant roster is frozen from the round rather than dynamically
derived from whichever users happen to remain in the room afterward.

This matters for:

```text
authorization
leaderboards
personal results
zero-score participants
historical results
```

Do not authorize historical participation using only current mutable room
membership.

---

# 27. Final Ranking

Multiplayer final results use competition-style ranking.

Conceptually:

```text
score descending
```

Players tied on score share the same numeric rank.

Positions after a tie are skipped.

Example:

```text
100 points → rank 1
100 points → rank 1
 80 points → rank 3
```

Within equal scores, leaderboard presentation is ordered by catches descending,
case-insensitive display name, then player UUID. `leaderboard_position` persists
that 1-based presentation order; `final_rank` persists the competition rank and
can therefore contain ties/skips. Secondary ordering must not silently change
the score-defined numeric ranking semantics.

---

# 28. GAME_ENDED Event

Round completion publishes:

```text
GAME_ENDED
```

on the room events channel:

```text
/topic/rooms/{roomCode}/events
```

The event tells clients that an authoritative result is available.

The WebSocket event itself is NOT the durable result.

Clients recover the actual result through REST.

This distinction is important:

```text
WebSocket = timely notification
REST/PostgreSQL = recovery + durable result
```

---

# 29. GAME_ENDED Publication Retry

PR #13 introduced bounded publication-only retries.

Conceptually:

```text
final result persisted once
        │
        ▼
publish GAME_ENDED
        │
        ├── immediate attempt
        ├── after failure, retry about 1 second later
        └── after another failure, retry about 2 seconds later
```

Maximum:

```text
3 publication attempts
```

The second and third lines are backoff intervals, not absolute offsets: in a
real clock the attempts are approximately t=0, t=+1 s, and t=+3 s. The retry
service constructs one event UUID, room sequence, timestamp, payload, and
`RoomEventEnvelope`, then reuses that exact immutable envelope object for all
attempts. It never creates a new event identity for a retry.

Duplicate publish calls for the same room/round share the in-flight attempt.
After success, a bounded in-memory recent-publication tracker suppresses later
duplicates by room code plus round UUID. Scheduled callbacks are version-guarded
so an obsolete callback becomes a no-op. Shutdown marks the service as stopping,
cancels pending futures, and makes late callbacks no-ops; it does not flush them
durably.

These retries must NOT rerun:

```text
scoring
catch processing
round lifecycle changes
persistence
finalization
```

They retry notification publication only.

---

# 30. Important GAME_ENDED Limitation

Publication retry state is currently in memory.

Therefore:

```text
backend crashes during retry window
        │
        ▼
outstanding WebSocket notification may be lost
```

However:

```text
persisted completed round remains in PostgreSQL
```

Clients can recover through result/history REST APIs.

Guaranteed event delivery across process crashes would require something such
as:

```text
transactional outbox
durable broker workflow
equivalent durable publication mechanism
```

That is not currently implemented.

---

# 31. Multiplayer Result Persistence

Completed multiplayer round results are now durable in PostgreSQL.

This was added in Flyway:

```text
V5__create_multiplayer_round_results.sql
```

Tables:

```text
game_rounds
game_round_players
game_round_player_catches
```

This replaced the previous limitation where completed multiplayer results were
available only from in-memory storage after process lifetime.

---

# 32. `game_rounds`

Stores round-level durable information including concepts such as:

```text
game round DB ID
round instance UUID
room code
round generation
status
end reason
started time
ended time
duration
participant count
created time
```

The public/authoritative round instance UUID is unique and is distinct from the
table's internal UUID primary key. Current writes always persist status
`ENDED`; end reason is one of the round enum values. Indexes support global and
room-scoped deterministic latest-result ordering by `ended_at DESC,
round_instance_id DESC`.

---

# 33. `game_round_players`

Stores each persisted participant's final round result.

Includes concepts such as:

```text
user ID
display name
leaderboard position
final score
final rank
total catches
common catches
rare catches
legendary catches
nullable joined_at column (currently unpopulated)
```

A user can occur only once per persisted round, and each leaderboard
presentation position is unique within the round. `joined_at` is nullable and
the current mapper writes it as `NULL`; start-time membership is captured by
the participant row itself, but the join timestamp is not currently part of
the finalized result model.

Catch totals are database-constrained to remain consistent with rarity totals.
The player row has a foreign key to `users` without delete cascade. Its round
foreign key cascades deletes from `game_rounds`.

---

# 34. `game_round_player_catches`

Stores immutable persisted catch details for a participant.

Includes:

```text
creature instance ID
creature catalog ID
creature name
rarity
score awarded
caught timestamp
```

The persisted row represents the historical snapshot rather than depending on
future mutable creature catalog values.

Each player/caught-creature-instance pair is unique. The catch row cascades
from its player row and is indexed in caught-time/instance order for detail
reconstruction. Creature ID/name/rarity/score are relational snapshot columns,
not a JSONB blob and not a foreign-key lookup to mutable catalog content.

---

# 35. Multiplayer Result Read APIs

Important result endpoints include:

```text
GET /api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result

GET /api/multiplayer/rooms/{roomCode}/rounds/latest/result
```

Result reads now have durable PostgreSQL recovery.

Therefore completed results can remain available even when:

```text
room disappears from memory
backend restarts
in-memory result cache disappears
WebSocket completion event was missed
```

Authorization must ensure that the requesting authenticated user actually
participated in the persisted round.

Exact and latest lookups intentionally have different precedence:

```text
exact round UUID:
    matching immutable in-memory result first
    -> otherwise PostgreSQL ENDED result

latest for room:
    PostgreSQL latest ENDED result first
    -> only if absent, bounded in-memory latest result
```

Memory-first exact lookup is safe because a result enters memory only after its
same round UUID has committed, and it lets an exact live result remain readable
during a later database outage. Latest lookup must query PostgreSQL first so an
old in-memory cache cannot mask a newer committed round (including one written
before a restart/other process lifetime). Latest ordering is `endedAt DESC,
roundInstanceId DESC`.

“Latest” means the latest committed `ENDED` round for the room, selected before
authorization; it is not rewritten to mean “latest round in this room that the
requester happened to play.” A requester who did not participate in that latest
room round receives forbidden and should use personal history to navigate their
own rounds.

Durable authorization is evaluated against `game_round_players.user_id`. The
detail mapper loads the ordered public participant rows and only the requesting
participant's catches; it does not reveal other players' private catch
collections. A room-code mismatch for an existing round is returned as not
found. An outsider receives forbidden.

Database/persistence/transaction failures fail closed as
`ROUND_RESULT_UNAVAILABLE` (HTTP 500). Latest does not fall back to potentially
stale memory when the database read fails. Exact lookup only avoids the database
when that exact immutable result is already in memory; once it attempts a
durable read, infrastructure failure is not converted to not-found.

---

# 36. Multiplayer History API

Authenticated player history:

```text
GET /api/multiplayer/me/rounds?page=0&size=20
```

History is scoped to the authenticated user's UUID.

Server-side pagination is used.

The controller defaults to page `0`, size `20`; page must be non-negative and
size must be `1..100`. The frontend deliberately requests a fixed size of `10`.
The repository filters by the server-derived authenticated UUID and persisted
status `ENDED`, then orders deterministically by:

```text
endedAt DESC
roundInstanceId DESC
```

The database returns a summary projection directly; this endpoint does not
hydrate catches, load exact result details, or cause an N+1 series of result
calls. Historical records contain exactly:

```text
roundId
roomCode
startedAt
endedAt
end reason
durationSeconds
participantCount
rank
score
creaturesCaught
```

The response adds `content`, `page`, `size`, `totalElements`, and `totalPages`.
Exact catch snapshots remain behind the room-scoped detail endpoint. Database
failures are sanitized as a multiplayer-history-unavailable server error.

---

# 37. Frontend End-of-Game Result Flow

The multiplayer frontend does not calculate authoritative results.

Normal live flow:

```text
GAME_ENDED
     │
     ▼
fetch exact authoritative result
     │
     ▼
RoundResultsModal
     │
     ├── personal rank
     ├── personal score
     ├── catches
     ├── rarity breakdown
     ├── caught-creature collection
     └── public leaderboard
```

Recovery exists for scenarios such as:

```text
missed GAME_ENDED event
reconnect
page reload
polling observes completed round
```

The REST result endpoints are the authoritative recovery path.

---

# 38. Historical Result UI

Stats now includes multiplayer match history.

Important frontend files include:

```text
frontend/src/api/multiplayerAuthenticatedClient.js
frontend/src/api/multiplayerRoundHistoryClient.js
frontend/src/api/multiplayerRoundResultClient.js

frontend/src/components/MultiplayerRoundHistoryPanel.jsx
frontend/src/components/multiplayerRoundHistoryFormatters.js
frontend/src/components/multiplayerRoundHistoryState.js

frontend/src/components/roundResults/RoundResultsModal.jsx
frontend/src/components/roundResults/roundResultsFocus.js
frontend/src/components/roundResults/roundResultsViewModel.js

frontend/src/pages/StatsPage.jsx
```

Historical `View result` reuses the existing multiplayer round-result UI in a
view-only mode rather than creating a separate incompatible result model.

Stats keeps the existing solo stats/session history panels separate from the
new Multiplayer history section. History pages are fetched server-side with a
fixed UI page size of 10. Selecting `View result` performs the durable exact
room+round read; the historical modal labels itself as a saved round and offers
only Close/retry. It never exposes live `View Map`, `Return to Lobby`, `Play
Again`, or waiting-for-host controls.

---

# 39. Result Client Safety

The multiplayer result/history frontend includes safeguards for:

```text
authentication changes
logout
account switching
stale requests
duplicate requests
React StrictMode behavior
room switching
historical result identity
cache isolation
```

Personal result cache/data from one authenticated identity must never leak into
another authentication generation.

Do not weaken these guards while simplifying frontend code.

Implementation details worth preserving:

```text
- auth identity + token + a token-derived context marker reset all state
- logout/account/token changes abort history and detail requests and clear cache
- cache key is normalized room code + round ID
- response identity is checked in both public and personal result objects
- detail cache is LRU-like and bounded to five entries
- request/auth generations suppress stale responses after abort or account swap
- duplicate same-page and same-detail in-flight requests are suppressed
- StrictMode setup -> cleanup -> setup causes a fresh request; old completion is ignored
- committed page/rows remain visible while a requested page is pending or retryable
- if totals shrink, one correction request selects the last valid page
```

---

# 40. In-Memory vs Durable State

This distinction is fundamental.

## Durable PostgreSQL state

Currently includes major data such as:

```text
users
solo/backend game sessions
solo/backend caught-creature snapshots
creature catalog
completed multiplayer rounds
completed multiplayer round participants
completed multiplayer round catches
```

## Transient browser recovery state

IndexedDB stores the current identity's versioned SOLO active-round checkpoint,
including pending catch synchronization evidence. This state is TTL-bound and
exists to reconstruct an interrupted live round; it is not historical truth and
does not replace PostgreSQL. Recovery uses localStorage only for a stable guest
installation UUID, not for the checkpoint itself.

## In-memory runtime multiplayer state

Still includes major runtime concepts such as:

```text
rooms
room presence
active multiplayer movement plans
movement event sequences
shared active creatures
automatic spawn coordinators
live round coordination
publication retry state
```

Therefore the system remains primarily:

```text
single Spring Boot process for active multiplayer ownership
```

Completed result durability does NOT mean active multiplayer state is durable.

---

# 41. Single-JVM Assumption

Current multiplayer coordination is designed around one active backend JVM.

Important coordination currently relies on local process state and locks.

Do not assume that simply running two backend replicas behind a load balancer is
safe.

Before horizontal multiplayer scaling, state ownership/coordination would need
a deliberate distributed architecture.

Possible future technologies may include:

```text
Redis
durable message broker
distributed room ownership
distributed locks or equivalent ownership semantics
```

These are future architectural directions, not currently implemented features.

## Current intentional design decisions

- PostgreSQL, not Redis, is the durable store for users, solo sessions, and
  completed multiplayer history. The completed model benefits from relational
  constraints, participant authorization, deterministic pagination, and restart
  reads alongside existing application data.
- Active rooms remain in memory. PR #13 deliberately added completed-result
  durability without pretending to solve distributed live-room ownership.
- Catch details are normalized immutable snapshot rows rather than JSONB, so
  historical names/rarity/scores do not depend on later catalog changes and can
  be constraint-checked.
- There is no Kafka, RabbitMQ, Redis coordinator, or transactional outbox. Add
  infrastructure only after defining the required ownership/order/recovery
  model.
- Exact detail remains room-scoped and participation-authorized. Personal
  history remains summary-only so pagination does not hydrate catches or call
  exact detail N times.
- The frontend reuses live result presentation components in explicit
  historical/view-only mode instead of maintaining a second result schema.

These are current choices, not promises that future deployment requirements
can never justify a redesign.

---

# 42. Room Coordination / Concurrency

Important multiplayer mutations are coordinated per room rather than relying on
independent uncoordinated operations.

This boundary protects interactions among:

```text
catches
score updates
catch history
round finalization
movement freeze/commit
creature lifecycle
```

The key correctness principle is:

```text
whichever coordinated operation wins the room race
must complete consistently
```

Example:

```text
catch vs finalization
```

must never result in:

```text
creature caught
but score missing

or

score added
but immutable result missing catch

or

late catch modifying already-finalized result
```

Preserve atomicity across these transitions.

---

# 43. OSRM Locking Principle

Network routing/snap calls can be slow.

Do not hold critical room mutation locks while waiting unnecessarily for OSRM.

Preferred pattern:

```text
capture expected round/generation/state
        │
        ▼
release critical mutation boundary
        │
        ▼
perform OSRM request
        │
        ▼
re-enter coordinated boundary
        │
        ▼
revalidate identity/generation/state
        │
        ▼
commit only if still valid
```

Generation/identity rechecks are what make this safe.

---

# 44. Backend Error Handling

`GlobalExceptionHandler` provides centralized API error handling.

API failures should expose sanitized and stable errors rather than raw database
or server internals.

Database failures related to multiplayer history/results should not expose
internal SQL details to the client.

---

# 45. Database Migration History

Current important Flyway migrations include:

```text
V1__create_game_tables.sql
V2__seed_creature_catalog.sql
V3__add_player_name_to_game_sessions.sql
V4__create_users_and_link_sessions.sql
V5__create_multiplayer_round_results.sql
```

The SOLO catch-idempotency milestone required no new migration.
`V1__create_game_tables.sql` already defines `caught_creatures.catch_id` as a
UUID primary key, and the current backend uses that existing key as the stable
catch-operation identity and global uniqueness arbiter.

When adding schema changes:

```text
DO NOT edit an already-applied migration merely to change production schema.

Create a new migration:
V6__...
V7__...
etc.
```

---

# 46. Important Backend Areas

Important packages/services include the following conceptual areas.

## Auth

```text
com.routecatch.api.auth
```

Responsible for:

```text
registration
login
JWT
current user
security
user persistence
```

## Routing

Backend routing services/controllers wrap OSRM.

Responsible for:

```text
route
nearest
multiplayer route calculation
road snapping
```

## Multiplayer Room

```text
com.routecatch.api.multiplayer.room
```

Responsible for room membership, lifecycle, host behavior, and multiplayer
coordination.

## Multiplayer Movement

Contains authoritative movement planning, routing, snapshots, events,
sequencing, completion scheduling, and state.

## Multiplayer Round

Important classes include:

```text
RoomRoundFinalizationService
RoomRoundScheduler
RoomRoundResultService
GameEndedPublicationRetryService
RecentRoundPublicationTracker
WebSocketRoomRoundEventPublisher
```

## Multiplayer Persistence

Important classes include:

```text
CompletedRoundPersistenceCommand
CompletedRoundPersistenceMapper
CompletedRoundPersistenceOutcome
CompletedRoundPersistenceReader
CompletedRoundPersistenceService
CompletedRoundPersistenceWriter

DurableCompletedRoundReadService
DurableCompletedRoundResultMapper

GameRoundEntity
GameRoundPlayerEntity
GameRoundPlayerCatchEntity

GameRoundRepository
GameRoundPlayerRepository
GameRoundPlayerCatchRepository
```

## Multiplayer History

Important classes include:

```text
MultiplayerRoundHistoryController
MultiplayerRoundHistoryService
MultiplayerRoundHistoryProjection
MultiplayerRoundHistoryItemResponse
MultiplayerRoundHistoryResponse
```

---

# 47. Important Frontend Architectural Areas

Conceptual frontend responsibilities are divided among:

```text
api/
components/
hooks/
config/
data/
styles/
utils/
pages/
```

Important multiplayer frontend concerns include:

```text
STOMP connection ownership
presence synchronization
movement command publishing
movement snapshot recovery
movement event application
movement-plan timeline rendering
shared creature markers
round event handling
result recovery
historical result loading
authentication-safe state
```

Important MapLibre SOLO frontend concerns include:

```text
renderer-local OVERVIEW / FOLLOW / FREE camera modes
imperative navigation-frame delivery
measured SOLO route animation and distance-based heading
programmatic-vs-user camera event classification
camera and route revision cleanup
reduced-motion camera policy
MapLibre-local destination presentation
```

Important SOLO active-round recovery concerns include:

```text
identity-gated recovery bootstrap and READY barrier
versioned IndexedDB checkpoint validation/retention
serialized writers, tombstones, and lifecycle/ABA guards
absolute round time and epoch-anchored route movement
absolute target expiry and spawn cadence
live/recovered route-interval catch equivalence
pending catch durability, replay, and acknowledgement
RECONCILING cleanup without gameplay resume
```

The central current implementation areas are:

```text
components/maplibre/MapLibreSoloGameMap.jsx
components/maplibre/useMapLibreSoloCamera.js
components/maplibre/mapLibreSoloGameState.js
hooks/useRouteAnimation.js
hooks/navigationFrameChannel.js
hooks/usePlayerState.js
config/soloMapRenderer.js
```

The central recovery implementation areas are:

```text
hooks/useSoloRoundRecovery.js
recovery/soloRecoveryCheckpoint.js
recovery/soloRecoveryIdentity.js
recovery/soloRecoveryRuntime.js
recovery/soloRecoveryStore.js
recovery/soloRecoveryWriter.js
recovery/soloRoundClock.js
recovery/soloTargetRecoveryTimeline.js
recovery/soloTargetState.js
recovery/soloCatchSubmission.js
utils/soloCatchGeometry.js
utils/soloRouteCatchEvents.js
```

Backend SOLO catch idempotency is coordinated by the game-session catch
service/writer/reader boundary and the existing caught-creature primary key.

Do not create a second parallel WebSocket architecture for a new multiplayer
feature without first checking whether the existing authenticated STOMP
connection can be reused.

---

# 48. WebSocket Recovery Philosophy

WebSocket transport is used for timely realtime updates.

Clients must not assume:

```text
every event is always delivered
```

Recovery mechanisms are intentionally part of the architecture.

Examples:

```text
movement:
    snapshot reconciliation

round result:
    exact/latest REST recovery

historical results:
    PostgreSQL REST reads
```

Future realtime features should follow the same principle:

```text
event stream for freshness
+
authoritative snapshot/read model for recovery
```

where practical.

---

# 49. Critical Architecture Invariants

Future coding agents MUST preserve these unless explicitly asked to redesign
them.

## Invariant 1 — Backend owns multiplayer identity

Never trust a client-provided multiplayer `playerId` when authenticated
principal identity is available.

---

## Invariant 2 — Backend owns multiplayer movement route/source

Do not return to continuous browser-coordinate authority.

---

## Invariant 3 — Multiplayer movement is timeline-based

Do not derive authoritative progress from animation frame accumulation.

---

## Invariant 4 — Movement versions matter

Old movement events/callbacks must not overwrite newer plans.

---

## Invariant 5 — Room/event sequence protection matters

Out-of-order realtime messages must not blindly mutate current state.

---

## Invariant 6 — Generation protection matters

Delayed work from round N must not mutate round N+1.

---

## Invariant 7 — Multiplayer catch transition/scoring is atomic

One shared creature must not award multiple players due to races.

This does not imply that submitted catch coordinates are currently
server-authoritative; see the catch-position limitation above.

---

## Invariant 8 — Multiplayer score is backend authoritative

Do not independently generate final multiplayer scoring on the client.

---

## Invariant 9 — Finalization is retry-safe/idempotent within its current boundary

Retries must not double-finalize a round.

The boundary is the single-JVM room coordinator plus the database's unique
round UUID; active finalization recovery across process restart is not
implemented.

---

## Invariant 10 — Persistence precedes durable completion

A round should not be considered durably completed while authoritative result
persistence has failed.

---

## Invariant 11 — Publication retry is publication-only

Retrying `GAME_ENDED` must never repeat persistence or finalization.

---

## Invariant 12 — Historical authorization uses participation

Do not grant result access merely because a user currently knows or belongs to
a room code.

---

## Invariant 13 — Authentication caches are isolated

Result/history state must not cross user/account generations.

---

## Invariant 14 — Solo architecture should not be casually rewritten

Multiplayer authority work must not unnecessarily destabilize working solo
gameplay.

---

## Invariant 15 — SOLO recovery is identity- and generation-scoped

Do not hydrate or create gameplay before authentication/recovery reaches READY,
and do not weaken lifecycle/writer/ABA guards around delayed work.

---

## Invariant 16 — SOLO movement, round time, targets, and catches share semantic time

Do not replace epoch-anchored route distance, absolute round/target deadlines,
or interval catch geometry with frame-count or rendered-position truth.

---

## Invariant 17 — One logical SOLO catch keeps one stable catch ID

Replay must use the original `catchId`, must not re-award local score/XP, and
must not remove pending evidence until the matching acknowledgement is durably
checkpointed.

---

## Invariant 18 — SOLO recovery truth is renderer-independent

Leaflet and MapLibre must consume the same recovered gameplay state. Camera
state and navigation start intent remain ephemeral MapLibre presentation.

---

# 50. Known Limitations

Current known architectural limitations include:

### Active multiplayer runtime state is not durable

These remain in-memory:

```text
rooms
presence
movement plans
movement sequences
active creatures
spawn loops
some live round coordination
```

A backend restart therefore does not reconstruct an active multiplayer game.

The same applies to a round stuck in `FINALIZING`: even if its database commit
has not occurred, the frozen result and retry context exist only in that JVM.
There is no active multiplayer-round recovery log.

---

### Single backend process assumption

Active multiplayer is not ready for arbitrary horizontal scaling.

---

### WebSocket publication is not durable

`GAME_ENDED` retry is bounded and in-memory.

A backend crash during the retry interval may lose the outstanding realtime
notification.

The persisted result remains recoverable through REST.

---

### Catch position is not fully server-authoritative

The backend owns creature state, concurrency, catch recording, and scoring, but
distance is calculated from client-submitted coordinates. A hardened design
would resolve the authenticated player's current position from authoritative
movement state inside the coordinated catch operation.

---

### Presence membership enforcement

STOMP `CONNECT` and the presence principal are authenticated, but the presence
message handler does not currently verify that the user belongs to the supplied
room code. Presence must remain non-authoritative and must not be used as an
authorization signal.

---

### STOMP command rejection correlation

Movement command rejection/error responses are not yet cleanly correlated back
to the specific initiating browser command.

The frontend may therefore depend on timeout/snapshot reconciliation in some
rejection scenarios.

This is a known candidate for future improvement.

---

### SOLO active-round recovery is transient and bounded

SOLO checkpoints expire under the two-minute `STARTING` or post-round
15-minute grace policies. They are recovery evidence, not permanent local
history or an indefinitely durable catch outbox.

Missed random spawn opportunities during complete browser downtime are not
deterministically replayed. Recovery preserves known targets and the absolute
cadence, then skips missed opportunities without a burst.

A permanently hung spawn materialization request occupies the one in-flight
slot for its generation until it settles or the lifecycle is invalidated by
pause/reset/restart/identity change/round ineligibility/unmount. The recovery
milestone did not add a lower-level request timeout for it.

Catch replay uses recovery eligibility and browser-online triggers rather than
a timed exponential-backoff scheduler. It added no generic fetch timeout, so a
never-settling catch POST retains its single-flight ownership until the request
settles or its lifecycle becomes stale; it does not block READY or create
duplicate requests on rerender.

Legacy catch requests that omit `catchId` still receive a newly generated UUID
per request and are not idempotent across retries. Guest sessions retain the
existing anonymous session-UUID capability semantics; this milestone did not
redesign guest authorization.

Active SOLO recovery still depends on the existing backend-session lifecycle.
In particular, it does not make session creation idempotent or recover the
crash window after the backend starts a session but before the first `RUNNING`
checkpoint commits.

This milestone does not recover active multiplayer state. Multiplayer rooms,
rounds, movement, creatures, and finalization retain their existing single-JVM
recovery limitations.

---

### MapLibre scope

MapLibre is currently an opt-in SOLO implementation.

Multiplayer currently always uses the existing Leaflet `GameMap` architecture.

The navigation camera has automated geometry, state-transition, interaction,
reduced-motion, lifecycle, and source-integration coverage, but it has no
browser E2E suite. Camera composition and visual feel therefore still require
manual browser validation. Future transport actors and mode-specific camera
profiles are not implemented. SOLO refresh also does not persist MapLibre FREE
mode, camera pose, or FOLLOW zoom override; recovered active navigation defaults
to FOLLOW.

---

### Test/runtime gaps

Backend automated integration tests use H2 in PostgreSQL compatibility mode,
including a `TIMESTAMPTZ` compatibility domain. This is valuable but not a full
substitute for PostgreSQL behavior under every constraint, locking, query-plan,
or transaction edge case. The repository has no full browser end-to-end suite;
frontend tests are primarily Node tests of clients/controllers/state and source
integration assertions.

GitHub CI currently builds and lints the frontend but does not execute the Node
test files. PR #13 had 20 such files; the MapLibre navigation-camera feature
branch checkpoint had 22; the SOLO recovery milestone has 37. These are
historical/checkpoint counts, not permanent project guarantees. The current
production build also crosses Vite's default large-chunk advisory (notably the
lazy MapLibre dependency chunk); this is an optimization warning, not a build
failure.

---

### Local OSRM configuration

OSRM scripts currently contain machine-specific binary/data paths.

They must be adjusted when running on another machine.

---

### Deployment

The project is currently optimized for local development/demo operation.

There is not yet a complete hosted production deployment pipeline for:

```text
frontend
backend
PostgreSQL
OSRM
realtime infrastructure
```

---

# 51. Existing Documentation Can Lag Behind Code

Files such as:

```text
README.md
docs/ARCHITECTURE.md
docs/API.md
```

were created progressively during earlier milestones.

Some sections may describe older architecture.

Examples of old statements that must NOT be treated as current truth include:

```text
"multiplayer is presence only"

"shared targets/scoring are future work"

"multiplayer results are only in memory"

"no multiplayer result tables exist"
```

Those statements were true in earlier milestones but are obsolete after later
PRs.

When documentation conflicts:

```text
current implementation
        >
latest merged feature contracts/tests
        >
this canonical context
        >
older milestone documentation
```

The long-term goal should be to update public documentation so these no longer
diverge.

---

# 52. Historical Verification Checkpoints

## PR #13 checkpoint

The following numbers are explicitly a **PR #13 verification checkpoint**, not
permanent project guarantees. Later milestones legitimately increased them.

Backend:

```text
355 tests passing
45 test suites
```

Frontend:

```text
20/20 test files passing
175 declared test cases
ESLint passing
production build passing
```

The 20 frontend files are Node test-runner suites focused on clients,
controllers/state reducers, timing/geometry logic, formatters, and source-level
integration assertions; they are not full browser E2E tests. The 175 number is
the declared `test(...)` count, while a globbed `node --test` invocation reports
the 20 files as top-level subtests.

Backend integration tests use the test profile's H2 in PostgreSQL compatibility
mode with Flyway and Hibernate validation. JUnit 5/Spring Boot Test, MockMvc,
Mockito, repository tests, transaction tests, and focused unit tests cover the
backend.

The PR handoff also recorded the following manual/repository verification. This
is historical checkpoint evidence and cannot be conclusively re-derived from
source alone:

```text
git diff --check passing
PostgreSQL persistence/restart verification passed
multiplayer historical result UI verification passed
```

## MapLibre SOLO navigation-camera feature-branch checkpoint

The following is a later, checkpoint-specific verification record for
`feature/maplibre-navigation-camera`. It is not a permanent test-count promise
and does not imply that frontend Node tests run in GitHub CI:

```text
npm run test:maplibre           passing
node --test test/*.test.js      22/22 test files passing
npm run lint                    passing
npm run build                   passing
git diff --check                passing
```

The strengthened behavioral coverage includes measured route preprocessing,
progress/distance consistency, duplicate and degenerate geometry, bounded
speed-aware look-ahead, stable completion heading, shortest-angle camera
smoothing, FOLLOW/FREE transitions, pure zoom behavior and FOLLOW zoom clamps,
Resume Follow, new-route reset, destination cleanup, latest-frame replay and
unsubscribe, stale timer/revision invalidation, unmount cleanup, reduced
motion, the MapLibre-only prelude, and conservative 3D-building presentation.

This remains Node-level behavior/source-integration coverage rather than
browser E2E. Manual browser validation confirmed that the closer FOLLOW
composition is suitable as the baseline for future transport actors; future
actors and their camera profiles remain unimplemented.

## SOLO active-round refresh/recovery checkpoint

The later `feature/solo-active-round-recovery` milestone delivered transient
IndexedDB recovery, epoch movement reconstruction, absolute round/target time,
target and catch recovery, the pending-catch outbox, backend catch idempotency,
recovered catch replay, Leaflet/MapLibre gameplay parity, and direct MapLibre
FOLLOW for recovered active movement.

The milestone handoff recorded:

```text
npm run test:maplibre           passing
node --test test/*.test.js      37/37 test files passing
npm run lint                    passing
npm run build                   passing
backend full suite              366 tests passing
git diff --check                passing
```

The frontend full-suite file count and the backend Surefire total were also
confirmed from the current worktree/reports during this context update. These
remain checkpoint evidence, not permanent test-count guarantees. Frontend Node
tests are still not browser E2E and are still not run by the current GitHub CI
workflow.

As an additional Slice 3A verification checkpoint, the backend idempotency and
concurrency behavior was exercised against a disposable real PostgreSQL
instance using the actual Flyway migrations. That reviewed run covered first
submission, exact retry, concurrent identical submission, and unique-constraint
collision behavior. Normal automated backend integration tests continue to use
H2 in PostgreSQL compatibility mode; do not infer that every CI run uses real
PostgreSQL.

Manual browser validation separately passed both the Leaflet and MapLibre
recovery matrices. Manual-only cases included refresh and repeated refresh
during movement, speed change plus refresh, targets/catches, CHASE, expiry,
round end, route completion during reload, catch synchronization/replay,
MapLibre direct recovered FOLLOW, and a later new fresh route. These are manual
verification records, not claims of automated browser coverage.

---

# 53. GitHub CI

GitHub Actions currently runs for:

```text
push to main
pull requests targeting main
```

Backend CI:

```text
Java 21
./mvnw clean test
```

Frontend CI:

```text
Node 22
npm ci
npm run build
npm run lint
```

The workflow does **not** currently run the frontend Node test files. They are
used during feature verification but must be invoked separately (for example,
`node --test test/*.test.js`). Do not claim that GitHub CI enforces those tests
until the workflow changes.

---

# 54. Development Git Workflow

Use short-lived branches.

Preferred lifecycle:

```text
main
 │
 ├── feature/<feature-name>
 │        │
 │        ▼
 │       PR
 │        │
 │        ▼
 ├────── main
 │
 └── delete merged feature branch
```

Typical categories:

```text
feature/...
fix/...
docs/...
refactor/...
```

Do not continue unrelated development on an already-merged feature branch.

Before new work:

```bash
git switch main
git pull --ff-only origin main
git switch -c <new-branch>
```

After merge:

```bash
git switch main
git pull --ff-only origin main
git branch -d <merged-branch>
git fetch --prune
```

---

# 55. Major Completed Milestones

The system evolved approximately through these milestones:

```text
1. authenticated WebSocket/STOMP presence

2. multiplayer room lifecycle and lobby

3. shared room game state / timer

4. shared room creature instances

5. authoritative shared creature catching

6. shared room scoring

7. backend-authoritative multiplayer movement

8. backend-controlled automatic creature spawning

9. authoritative round finalization

10. multiplayer end-game results UI

11-12. MapLibre solo renderer / gameplay polish

13. PostgreSQL multiplayer result persistence + player match history

14. MapLibre SOLO navigation camera with OVERVIEW / FOLLOW / FREE presentation

15. SOLO active-round refresh/recovery with IndexedDB checkpointing,
    epoch movement/time reconstruction, catch outbox/replay, backend catch
    idempotency, renderer parity, and recovered MapLibre FOLLOW
```

These milestones are already implemented.

Milestone 14 is the frontend-only, MapLibre SOLO-only feature-branch checkpoint
documented in Section 8. It does not change the completed multiplayer
architecture described by the earlier milestones.

Milestone 15 adds transient SOLO recovery and backend SOLO catch-idempotency
support. It does not make SOLO server-authoritative and does not add active
multiplayer recovery.

Do not propose them as future work without checking current code.

PR #13 historical commits (SHAs are checkpoints, not architectural IDs):

```text
5f2f2f8  Add completed round persistence foundation
33de4fe  Persist authoritative multiplayer round results
5910cad  Remove accidental terminal output files
1aad124  Add durable multiplayer round result reads
eaf895d  Add paginated multiplayer round history
8b28c58  Add multiplayer round history UI
43571fb  Retry failed GAME_ENDED publication
c9e5f4c  Merge PR #13 into main
```

---

# 56. Current High-Level Multiplayer Data Flow

```text
                         AUTHENTICATED PLAYER
                                  │
                                  ▼
                         MULTIPLAYER ROOM
                                  │
        ┌─────────────────────────┼────────────────────────┐
        │                         │                        │
        ▼                         ▼                        ▼
    Presence                 Movement Intent          Room Lifecycle
        │                         │                        │
        │                         ▼                        ▼
        │                 Backend OSRM Route        Running Round
        │                         │                        │
        │                         ▼                        ▼
        │                 Movement Plan        Automatic Creature Spawn
        │                         │                        │
        │                         │                        ▼
        │                         │                Shared Creatures
        │                         │                        │
        │                         │                        ▼
        │                         │              Authoritative Catch
        │                         │                        │
        │                         │                        ▼
        │                         │                Score + Catch Log
        │                         │                        │
        └─────────────────────────┴──────────────┬─────────┘
                                                │
                                                ▼
                                        Round Finalization
                                                │
                                                ▼
                                       PostgreSQL Persistence
                                                │
                                      ┌─────────┴──────────┐
                                      ▼                    ▼
                               GAME_ENDED event       REST Results
                                                           │
                                                           ▼
                                                 Multiplayer History
```

---

# 57. Current Authority Matrix

| Concern | Solo | Multiplayer |
|---|---|---|
| Player movement | Frontend-owned epoch-anchored route plan | Backend movement plan |
| Route source | Backend/OSRM API used by frontend | Backend directly controls authoritative OSRM route |
| Creature spawning | Frontend-oriented | Backend |
| Creature location authority | Primarily solo frontend flow | Backend shared instance |
| Catch transition | Immediate frontend transition + stable-ID backend synchronization | Backend state/concurrency/scoring; distance currently uses submitted coordinates |
| Score during game | Frontend-local + idempotent backend session sync | Backend authoritative |
| Round timer | Frontend-owned absolute epoch timeline | Shared backend round |
| Final ranking | Solo/session-specific | Backend |
| Completed result | Persisted session model | PostgreSQL multiplayer result model |
| Realtime presence | Not required | STOMP |
| Active-round refresh recovery | Identity-scoped transient IndexedDB checkpoint | Not implemented |
| Reconnect movement recovery | Epoch-anchor reconstruction from SOLO checkpoint | Backend snapshot |
| Historical multiplayer result | Not applicable | PostgreSQL + REST |

Do not blur this matrix accidentally.

---

# 58. Recommended Next Engineering Priorities

These are recommendations, not already-approved requirements.

## Priority 0 — Close current multiplayer trust-boundary gaps

Before describing catching/presence as fully authoritative, consider resolving
catch distance from backend movement state and enforcing room membership in the
presence handler. These are recommendations for hardening, not implemented
behavior or a committed roadmap.

## Priority 1 — Correlated multiplayer command rejection

Improve STOMP command acknowledgement/error handling so a browser can correlate
a backend rejection directly to the command that initiated it.

Desired concept:

```text
client command
    commandId
       │
       ▼
backend
       │
       ├── accepted → authoritative event
       │
       └── rejected → user-specific correlated response
```

This would reduce reliance on pending-command timeouts and snapshot recovery for
known immediate failures.

---

## Priority 2 — Documentation reconciliation

Bring:

```text
README.md
docs/ARCHITECTURE.md
docs/API.md
```

up to the current multiplayer architecture so public GitHub documentation does
not describe early presence-only behavior.

---

## Priority 3 — Active multiplayer durability/distribution design

Only when needed for deployment/scaling, design explicit ownership for:

```text
rooms
presence
movement plans
active creatures
spawn coordinators
event sequencing
live rounds
```

Do not introduce Redis/RabbitMQ merely because they are common technologies.

First define:

```text
ownership
consistency model
failure behavior
recovery model
ordering requirements
```

then choose infrastructure.

---

## Priority 4 — Durable event delivery, if product requirements demand it

If guaranteed `GAME_ENDED` delivery becomes necessary, evaluate a transactional
outbox or equivalent mechanism.

Current REST recovery may already be sufficient for the project's actual
requirements.

---

## Priority 5 — Deployment

Create a practical deployment architecture for:

```text
React frontend
Spring Boot backend
PostgreSQL
OSRM dataset/runtime
WebSocket traffic
environment secrets
```

Initially favor low-cost deployment suitable for a portfolio project rather
than premature enterprise infrastructure.

---

# 59. Important API and Realtime Inventory

This is the architectural surface, not an exhaustive controller dump.

## Auth and routing

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me

POST /api/routes
POST /api/nearest
GET  /api/health
```

## Solo/backend session model

```text
GET  /api/game/creatures
POST /api/game/sessions
GET  /api/game/sessions?limit=...
GET  /api/game/sessions/{sessionId}
POST /api/game/sessions/{sessionId}/start
POST /api/game/sessions/{sessionId}/end
POST /api/game/sessions/{sessionId}/catches
GET  /api/game/sessions/{sessionId}/catches
GET  /api/game/me/stats
GET  /api/game/me/sessions?limit=...
GET  /api/game/me/sessions/{sessionId}/catches
GET  /api/game/leaderboard?limit=...
GET  /api/game/players/{playerName}/stats
```

The general session routes support guest-compatible solo behavior; `/me`
routes use authenticated UUID scoping.

`POST /api/game/sessions/{sessionId}/catches` accepts optional UUID `catchId`.
Supplying it enables exact retry idempotency for the same session/creature;
omitting it preserves legacy per-request UUID generation. An exact reuse with a
different session or creature returns HTTP 409 `CATCH_ID_CONFLICT`.

## Rooms, rounds, and score

```text
POST  /api/multiplayer/rooms
GET   /api/multiplayer/rooms/me
GET   /api/multiplayer/rooms/{roomCode}
POST  /api/multiplayer/rooms/{roomCode}/join
POST  /api/multiplayer/rooms/{roomCode}/leave
POST  /api/multiplayer/rooms/{roomCode}/close
PATCH /api/multiplayer/rooms/{roomCode}/settings
POST  /api/multiplayer/rooms/{roomCode}/game/start
GET   /api/multiplayer/rooms/{roomCode}/game
POST  /api/multiplayer/rooms/{roomCode}/game/end
GET   /api/multiplayer/rooms/{roomCode}/scoreboard
```

## Movement and creatures

```text
GET  /api/multiplayer/rooms/{roomCode}/movements
GET  /api/multiplayer/rooms/{roomCode}/creatures
POST /api/multiplayer/rooms/{roomCode}/creatures/spawn
POST /api/multiplayer/rooms/{roomCode}/creatures/{instanceId}/catch
```

Movement starts/cancels are STOMP commands rather than REST writes.

## Completed results and personal history

```text
GET /api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result
GET /api/multiplayer/rooms/{roomCode}/rounds/latest/result
GET /api/multiplayer/me/rounds?page=0&size=20
```

## STOMP endpoint, commands, and topics

```text
WebSocket/STOMP endpoint: /ws

SEND /app/rooms/{roomCode}/presence
SEND /app/rooms/{roomCode}/movements/start
SEND /app/rooms/{roomCode}/movements/cancel

SUBSCRIBE /topic/rooms/{roomCode}/presence
SUBSCRIBE /topic/rooms/{roomCode}/creatures
SUBSCRIBE /topic/rooms/{roomCode}/movements
SUBSCRIBE /topic/rooms/{roomCode}/events      # GAME_ENDED
```

All multiplayer REST routes require authentication through the security chain.
Per-operation membership/host/participant checks are service-specific as
documented above.

---

# 60. Failure and Recovery Model

| Failure | Current behavior | Recovery/durability |
|---|---|---|
| Browser refresh during active SOLO round | Authentication resolves before checkpoint hydration; fresh gameplay stays behind RECOVERY_READY | Valid identity-scoped IndexedDB state reconstructs absolute round time, targets/catches, route distance, and pending sync; Leaflet/MapLibre use the same gameplay truth |
| Invalid, mismatched, or expired SOLO checkpoint | Record is rejected and guarded cleanup is attempted | Bootstrap reaches READY with a clean/degraded state; invalid state is never merged into gameplay |
| IndexedDB unavailable/write fails | SOLO remains playable in memory with a recovery warning; a live catch may submit once after its failed/timed-out persistence attempt | No false durability claim; recovered replay requires durable evidence |
| SOLO round/route/target deadline passes while browser is unavailable | Recovery applies semantic event ordering and exact cutoff positions; expired gameplay does not resume | Post-round pending evidence may remain as RECONCILING until acknowledgement or TTL expiry |
| Recovered catch POST has no response, HTTP 429/5xx, or ACK persistence fails | Pending catch remains and the current uncertain pass stops without hot-looping | Browser-online or a new eligible recovery lifecycle retries the same catchId; no timed backoff exists |
| Recovered catch has deterministic client failure or mismatched response ID | Evidence remains pending and that catch is suppressed for the current lifecycle | A later lifecycle may retry; no local score/XP is re-awarded |
| Concurrent identical backend SOLO catch requests | Session lock/primary key/transaction ordering produces one catch and one aggregate award | Exact loser resolves from a fresh transaction as idempotent success |
| Cross-session reuse of one SOLO catchId | One insert wins; the other cannot mutate its session aggregate | Fresh collision read returns HTTP 409 catch-ID conflict |
| Random SOLO spawn opportunities missed during complete downtime | Missed opportunities are skipped rather than burst-replayed | Known targets and the next absolute cadence recover; random history is not deterministic |
| Result preparation failure | Round remains `FINALIZING`; no `ENDED`, result-store entry, completion lifecycle event, or `GAME_ENDED` | In-process retry resumes completed preparation steps; timeout scheduler retries eligible failures up to three total attempts |
| Persistence failure | Same frozen result/UUID remains in the in-memory finalization context; durable completion is not exposed | Retry calls `persistIfAbsent`; after scheduler exhaustion it stays `FINALIZING`; restart recovery is unsupported |
| Concurrent unique round insert | Named round-UUID unique loser rolls back | Fresh transaction reads the winner; unrelated constraint failures propagate |
| `GAME_ENDED` publication failure | Round is already committed/`ENDED`; no lifecycle/persistence/scoring replay | Same envelope is retried, maximum three total publication attempts; REST remains authoritative |
| Publication retry exhaustion or shutdown | Realtime notification may never arrive | Exact/latest result and history remain durable; no outbox/durable retry exists |
| Restart after completed-round commit | All live caches/rooms are lost | PostgreSQL exact/latest/history reads reconstruct committed results and authorize persisted participants |
| Restart during active or `FINALIZING` round | Room, movement, creatures, score/catch logs, and finalization context are lost | Intentionally unsupported; no active-round journal/recovery |
| PostgreSQL unavailable during latest/history read | Sanitized server error; latest does not use stale memory as a substitute | Retry after database recovery |
| PostgreSQL unavailable during exact read | An already-present exact in-memory immutable result can still be served; otherwise sanitized server error | Retry after database recovery or process the durable result later |
| Movement WebSocket event missed/disconnected | Client marks movement snapshot stale and reconnects | Authenticated movement snapshot reconciles plans; timeline rendering catches up by server-relative time |
| `GAME_ENDED` missed/disconnected | Client can observe `ENDED` through room polling/reconnect | Live result controller performs exact/latest REST recovery; history is another durable entry point |
| Historical detail unavailable | View-only modal shows a safe retryable message; stale/foreign identity is rejected | Retry exact room+round request; account changes abort and clear cached detail |
| OSRM route/snap failure | Movement plan or that spawn placement is rejected/not committed | User can retry movement; later spawn cycles try again |

---

# 61. Instructions for Future AI/Coding Agents

When starting a new GPT, Codex, or Antigravity session, give the agent this
instruction:

```text
Read POKEMON_GAME_CONTEXT.md before making architectural changes.

Treat it as the current architectural baseline.

Then inspect the actual files relevant to the requested task before coding.

If the code differs from this document, report the discrepancy before assuming
either side is correct.

Preserve established multiplayer authority, sequencing, versioning, generation,
idempotency, persistence, and authentication invariants unless the task
explicitly requires redesigning them.
```

For a new feature, also tell the agent:

```text
Do not implement immediately.

First:
1. locate the relevant existing architecture,
2. identify the authoritative state owner,
3. identify concurrency/reconnect implications,
4. identify persistence implications,
5. identify tests that protect the current behavior,
6. propose the smallest compatible change,
7. then implement after the plan is accepted.
```

---

# 62. Updating This Document

Update this file after a significant architecture-changing merge.

Examples:

```text
new persistence subsystem
new multiplayer authority model
new realtime transport model
Redis/distributed ownership introduction
major deployment architecture
MapLibre multiplayer migration
major authentication redesign
new game mode
```

Do not update it for every minor CSS or bug-fix commit.

When updating:

```text
1. merge feature
2. update local main
3. create docs branch
4. update this context
5. review against actual code
6. merge documentation PR
```

---

# Quick Context for a New AI Session

- Route Catch Game is a Pokémon-style road-route creature-catching game with
  solo play and competitive multiplayer rooms.
- The frontend is React 19/Vite 8/JavaScript; Leaflet is the default map.
- MapLibre is opt-in for solo only via `VITE_SOLO_MAP_RENDERER=maplibre`;
  multiplayer remains on the shared Leaflet `GameMap` path.
- MapLibre SOLO has a renderer-local navigation camera with `OVERVIEW`,
  `FOLLOW`, and `FREE` modes. Resume Follow returns from manual exploration to
  the latest current navigation pose.
- Recovered already-moving MapLibre routes use ephemeral `RECOVERED_ACTIVE`
  intent to skip fresh OVERVIEW/prelude and enter FOLLOW directly; camera pose,
  FREE mode, zoom override, and start intent are not persisted.
- SOLO route animation publishes measured navigation frames imperatively to the
  MapLibre camera while preserving React player-position updates for existing
  gameplay and Leaflet behavior; MapLibre remains uncontrolled without a
  per-frame React `viewState` loop.
- Spring Boot 4.1/Java 21 provides REST, authenticated STOMP/WebSocket,
  multiplayer coordination, JPA persistence, and OSRM adapters.
- PostgreSQL schema changes are Flyway-owned; do not edit applied migrations.
- OSRM supplies solo route/nearest calls, authoritative multiplayer routes, and
  automatic shared-creature road snapping.
- Solo gameplay is intentionally frontend-oriented, with backend session/catch
  persistence and catalog-backed scoring synchronization.
- Active SOLO rounds recover from a version-1 identity-scoped IndexedDB
  checkpoint after auth resolution and a RECOVERY_READY barrier. The checkpoint
  is transient; PostgreSQL remains durable history and localStorage only holds
  the stable guest installation UUID for recovery identity.
- SOLO route progress is measured from epoch-anchored route distance and speed;
  round/target deadlines are absolute. Refresh downtime therefore advances
  movement/time and live/recovered catches share interval geometry and terminal
  event ordering.
- A SOLO catch updates local target/score/XP immediately, persists a stable
  catchId as pending evidence, and synchronizes separately. Recovered replay
  reuses that ID without local re-award; backend catch_id idempotency prevents
  double scoring.
- Multiplayer rooms, membership, presence, movement plans, live creatures,
  scoring/catch logs, schedulers, sequences, and finalization contexts are
  single-JVM/in-memory state.
- Multiplayer movement is a backend-created, versioned polyline6 plan rendered
  by client server-relative timeline interpolation; snapshots recover gaps.
- Shared creature state, one-winner catch transition, scoring, and snapshots are
  backend-owned, but current catch distance uses client-submitted coordinates.
- Round game states are `WAITING -> RUNNING -> FINALIZING -> ENDED`; room status
  is separately `OPEN`, `IN_PROGRESS`, or `CLOSED`.
- Finalization freezes gameplay and constructs one immutable result, commits it
  to PostgreSQL, then exposes `ENDED`/memory/lifecycle completion, then attempts
  `GAME_ENDED`.
- Persistence failure leaves the round `FINALIZING`; retries reuse the frozen
  result and round UUID. Active/finalizing restart recovery is not implemented.
- V5 stores rounds, participant/rank/score aggregates, and relational immutable
  caught-creature snapshots in three tables.
- Exact result reads use matching memory first then PostgreSQL; latest reads use
  PostgreSQL first so stale memory cannot hide a newer committed round.
- Result authorization and `/api/multiplayer/me/rounds` history use the
  authenticated immutable participant UUID, not display name/current room
  membership.
- History is an ENDED-only paginated summary projection; exact detail loads only
  the requesting participant's catch collection.
- Stats adds a separate multiplayer history panel and auth-isolated five-entry
  exact-detail cache with stale-request/StrictMode/page-correction guards.
- `GAME_ENDED` publication is notification-only: one immediate attempt, then
  one- and two-second backoff intervals, maximum three attempts, same envelope.
- Publication retry/dedup is in memory; there is no transactional outbox, broker,
  or guarantee across process restart. REST/PostgreSQL is completed-result truth.
- Transport modes/actors, mode-specific camera profiles, Valhalla integration,
  and multiplayer MapLibre presentation are future directions, not current
  implementation.
- PR #13 merged at `c9e5f4c`; its test counts and the later MapLibre camera and
  SOLO recovery branch counts are separate historical checkpoints, not
  permanent guarantees.
- Before changing architecture, inspect current source/tests and preserve
  authority, UUID/generation/version, transaction ordering, and auth isolation.
