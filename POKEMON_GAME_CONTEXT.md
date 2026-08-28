# Route Catch Game — Canonical Engineering Handoff

> Current implementation baseline: PR #18, **Mobility & Travel Foundation**
>
> Merge commit: `d44655c67408b2feab64581fd9127aae144d7665`
>
> Development state: paused after the documentation-freeze handoff

This is the canonical engineering context for future developers and engineering
agents. It records what is implemented, why the boundaries exist, which
invariants must survive, what was historically validated, and where work should
resume.

Committed Git/source/configuration/migrations/tests are the ultimate
implementation truth. If this document conflicts with them, report and correct
the documentation; do not change source merely to match prose.

## Documentation Hierarchy

```text
POKEMON_GAME_CONTEXT.md       canonical detailed engineering handoff
docs/ARCHITECTURE.md          readable structural overview
docs/API.md                   public REST/STOMP reference
docs/ROADMAP.md               proposed/future work only
README.md                     public overview and setup
docs/TROUBLESHOOTING.md       operational diagnosis
docs/DEMO_SCRIPT.md           demo walkthrough
docs/screenshots/README.md    screenshot status/capture guidance

committed source/config/migrations/tests
                              ultimate implementation truth
```

README and Architecture intentionally summarize rather than repeat this file.

---

## 1. Pause / Resume Checkpoint

Last major merged architecture milestone:

```text
PR #18 — Mobility & Travel Foundation
d44655c — merge commit
```

Current checkpoint:

```text
SOLO modes                   CAR / MOTORCYCLE / WALKING
SOLO CAR routing             OSRM
SOLO MOTORCYCLE routing      Valhalla motorcycle
SOLO WALKING routing         Valhalla pedestrian
SOLO recovery                checkpoint schema v2
SOLO renderer                Leaflet default; MapLibre opt-in
multiplayer renderer         Leaflet
multiplayer routing          separate authoritative OSRM architecture
active multiplayer state     single-JVM / in-memory
completed multiplayer state  durable PostgreSQL history
```

Known non-blocking observations at pause:

- A recovered Leaflet route may have correct movement/route semantics while
  reopening with broader camera framing than desired.
- MapLibre productionization remains future work.
- MapLibre source/test travel-mode parity exists, but full browser live
  validation of all three mode flows was not completed during PR #18.
- The repository has no full browser E2E suite.
- Portable Valhalla startup/data/deployment is not repository-managed.
- Committed OSRM scripts contain author-machine binary/data paths.

Recommended future resume sequence, with details only in
[`docs/ROADMAP.md`](docs/ROADMAP.md):

1. MapLibre productionization.
2. Movement/avatar presentation foundation.
3. Speed-based presentation transformations.
4. Camera/game-feel polish.
5. Hunt Scan / Valhalla isochrones.
6. Larger game systems.
7. Deployment/distributed improvements as requirements demand.

This sequence is proposed, not implemented architecture.

---

## 2. Project Identity and Stack

Route Catch Game is a full-stack map-based creature-catching game with two
deliberately different modes:

```text
SOLO          responsive, mostly frontend-owned live gameplay
MULTIPLAYER   progressively backend-authoritative shared gameplay
```

Current stack:

```text
Frontend
  React 19 / Vite 8 / JavaScript
  Leaflet + React Leaflet
  MapLibre GL + React MapLibre
  React Router / STOMP.js / CSS / ESLint / Node test runner

Backend
  Java 21 / Spring Boot 4.1
  Spring MVC / Validation / Security / Data JPA
  WebSocket/STOMP / JWT (JJWT)
  Flyway / PostgreSQL
  Maven / JUnit / MockMvc / Mockito
  H2 PostgreSQL compatibility mode for automated integration tests
```

Flyway owns database schema changes. Hibernate validates the result with:

```properties
spring.jpa.hibernate.ddl-auto=validate
```

Do not edit already-applied migrations to change production schema.

---

## 3. Current Runtime Topology

```text
Browser / React / Vite
          |
          | REST + WebSocket/STOMP
          v
     Spring Boot
       /   |    \
      /    |     \
     v     v      v
   OSRM  Valhalla PostgreSQL
```

Default local ports:

```text
Vite           5173
Spring Boot    8080
OSRM           5000
Valhalla       8002
PostgreSQL     5432
```

Responsibilities:

```text
OSRM
  SOLO CAR route + nearest
  multiplayer authoritative movement routing
  multiplayer creature road snapping

Valhalla
  SOLO MOTORCYCLE route + nearest
  SOLO WALKING route + nearest

PostgreSQL
  users and creature catalog
  SOLO sessions, catches, stats, and history
  completed multiplayer rounds, participants, rankings, catches, and history
```

The browser does not call OSRM or Valhalla as authoritative routing providers.
Provider identity is a backend/configuration concern.

Current committed local scripts start PostgreSQL only through Docker Compose;
`run-all.sh` starts OSRM, Spring Boot, and Vite. Neither path starts Valhalla.
`check-system.sh` checks PostgreSQL, OSRM, application health, and missing-mode
CAR route/nearest behavior; it does not check Valhalla.

---

## 4. Mobility Domain and Public Contract

`com.routecatch.api.routing.TravelMode` contains exactly:

```text
CAR
MOTORCYCLE
WALKING
```

There is no `BICYCLE`.

Public strings are provider-neutral and case-sensitive. Both
`POST /api/routes` and `POST /api/nearest` implement:

```text
travelMode missing   -> CAR
travelMode JSON null -> CAR
CAR                  -> valid
MOTORCYCLE           -> valid
WALKING              -> valid
other/lowercase      -> 400 UNSUPPORTED_TRAVEL_MODE
```

The request DTO stores `travelMode` as a nullable string. Controllers call
`TravelMode.fromApiValue`; this deliberately preserves legacy missing/null CAR
behavior while rejecting unknown values before any provider request.

Response DTOs do not echo travel mode:

```text
RouteResponse
  coordinates: [{lat, lon}]
  distanceMeters
  durationSeconds
  source: {lat, lon}
  destination: {lat, lon}

NearestResponse
  snappedPoint: {lat, lon}
  distanceMeters
  name (nullable)
```

Do not add internal costing strings or imaginary response fields to the public
contract in documentation.

---

## 5. Backend Routing Architecture

Exact current boundary:

```text
RoutingController / NearestController
                |
                v
       TravelRoutingService
                |
                v
       TravelRoutingProvider
          /             \
         v               v
OsrmRoutingService   ValhallaRoutingService
    CAR only         MOTORCYCLE / WALKING
```

`TravelRoutingService.providerFor` is a closed switch:

```text
CAR          -> qualifier osrmRoutingService
MOTORCYCLE   -> qualifier valhallaRoutingService
WALKING      -> qualifier valhallaRoutingService
```

The controller constructs provider-neutral `RouteQuery` and
`NearestPointQuery` values with non-null `TravelMode` and normalized
`RoutingCoordinate` values. `RouteResult` and `NearestPointResult` are likewise
provider-neutral.

### No Silent Fallback

There is no fallback provider in `TravelRoutingService`. The selected provider
is called once. Its failure propagates through normalized error handling.

Examples:

```text
WALKING + Valhalla unavailable
    -> request failure
    -> never OSRM driving

CAR + OSRM unavailable
    -> request failure
    -> never Valhalla
```

This is a critical semantic invariant: a successful route with the wrong
costing is worse than an explicit failure.

### OSRM Public Provider

`OsrmRoutingService` implements `TravelRoutingProvider` only for `CAR`. It:

- calls `GET /route/v1/driving/{lon,lat;lon,lat}` with full GeoJSON geometry;
- calls `GET /nearest/v1/driving/{lon,lat}?number=1`;
- converts OSRM `[lon, lat]` into public `{lat, lon}`;
- exposes OSRM route distance/duration; and
- retains direct `findDrivingRoute` / `findNearestDrivingPoint` methods used by
  explicit OSRM-only multiplayer integration.

The public OSRM adapter currently does not configure the Valhalla-style
connect/read timeout pair. A `ResourceAccessException`, including its current
timeout-like cases, maps to `502 ROUTING_ENGINE_UNAVAILABLE`.

---

## 6. Valhalla Integration

`ValhallaRoutingService` implements `TravelRoutingProvider` for:

```text
MOTORCYCLE -> costing "motorcycle"
WALKING    -> costing "pedestrian"
```

`CAR` passed directly to this provider raises `TravelModeUnavailableException`;
the normal façade never selects Valhalla for CAR.

### Route Operation

Valhalla request:

```text
POST /route
locations        source + destination
costing          motorcycle | pedestrian
units            kilometers
directions_type  none
```

Normalization:

- response/trip/status/units/summary/legs must be structurally valid;
- `summary.length` must be finite and non-negative, then converts km to m;
- `summary.time` must be finite and non-negative and stays in seconds;
- every leg must contain a nonblank polyline6 shape;
- shared `Polyline6Decoder` decodes each leg;
- multi-leg geometry is concatenated and one duplicate join point is skipped;
- empty, malformed, impossible, or non-finite data is rejected; and
- `RouteResult.source`/`destination` remain the requested coordinates.

### Nearest Operation

Valhalla request:

```text
POST /locate
locations  one point
costing    motorcycle | pedestrian
verbose    true
```

The adapter examines the first locate result, ignores unusable edges, and
selects the usable edge with the smallest finite non-negative distance.
Usability requires valid correlated latitude/longitude. It returns the first
nonblank stripped road name from `edge_info.names`, or `null`.

There is no raw candidate, filtered-edge, or invalid-coordinate fallback.

### Timeouts and Configuration

Committed defaults:

```properties
valhalla.base-url=http://localhost:8002
valhalla.connect-timeout=2s
valhalla.read-timeout=10s
```

Timeout values are validated as 1 ms through Java's maximum supported integer
millisecond duration. Historical PR #18 validation used an externally prepared
Valhalla instance on `localhost:8002`.

The repository does not contain a portable Valhalla startup contract, tile
build/data workflow, health probe, container service, or deployment workflow.

---

## 7. Routing Error Contract

`GlobalExceptionHandler` serializes `RoutingEngineException` using its embedded
status/code and handles unsupported/unavailable travel-mode exceptions.

Current public behavior:

| Condition | HTTP | Error code |
|---|---:|---|
| Unsupported/case-mismatched public mode | 400 | `UNSUPPORTED_TRAVEL_MODE` |
| Valhalla known no-path errors (170, 171, 441, 442) | 400 | `ROUTE_NOT_FOUND` |
| OSRM no-route/no-segment response | 400 | provider code such as `NoRoute` / `NoSegment` |
| Provider unreachable | 502 | `ROUTING_ENGINE_UNAVAILABLE` |
| Valhalla timeout | 504 | `ROUTING_ENGINE_TIMEOUT` |
| No usable nearest point/edge | 502 | `NEAREST_POINT_NOT_FOUND` |
| Malformed JSON or normalized invalid Valhalla response | 502 | `ROUTING_ENGINE_INVALID_RESPONSE` |
| Recognized invalid OSRM response | 502 | `ROUTING_ENGINE_INVALID_RESPONSE` |
| Other provider failure | 502 | `ROUTING_ENGINE_ERROR` |
| Internal provider/mode mismatch | 503 | `TRAVEL_MODE_UNAVAILABLE` |

Valhalla comprehensively validates route/locate success bodies. Malformed JSON
and the invalid structures, route metrics, or route geometry handled by its
normalizers use the invalid-response contract; a locate result with no usable
edge remains the separate nearest-point error above. OSRM recognizes some
invalid responses, such as missing route geometry/coordinates or a short
nearest-point location array, but its coordinate-array/shape validation is not
as comprehensive. Arbitrary malformed OSRM payloads are therefore not
guaranteed to return this 502; unexpected failures can reach the sanitized
generic `500 INTERNAL_SERVER_ERROR` path.

Provider error bodies are sanitized. Valhalla's private message is not exposed.
The 503 mismatch is a defensive internal boundary and is not expected from the
normal controller/facade selection.

---

## 8. SOLO Travel-Mode Authority

Two values must not be collapsed:

```text
selectedTravelMode
  setup choice and next-round preference

activeTravelMode
  immutable authority for the active or reconciling round
```

### Synchronous Capture

`beginRoundOperation` and `beginRestartOperation` synchronously capture the
selected mode before backend session creation/replacement can yield:

```text
selectedTravelMode
        |
        v
activeTravelMode + operation owner + scope.travelMode
        |
        v
buildSoloRunningCheckpoint(... travelMode)
        |
        v
checkpoint.round.travelMode
```

The active owner carries identity, lifecycle generation, operation ID, and
eventually client-round/backend-session IDs. Establishment rejects a stale
owner or a mode mismatch.

### Selection Lock and Reconciliation

Selection is locked while:

```text
activeRoundLaunchRef has synchronous launch ownership
round.phase == STARTING
round.phase == RUNNING
```

Selection is editable in `RECONCILING`.

Valid example:

```text
old checkpoint.round.phase       = RECONCILING
old checkpoint.round.travelMode  = WALKING
activeTravelMode                 = WALKING

selectedTravelMode               = MOTORCYCLE  # next-round preference
```

The old checkpoint builder preserves its existing `round.travelMode`. A new
selection never rewrites old reconciliation truth. Old asynchronous callbacks
must still satisfy identity, lifecycle, replay, round/session, operation,
route/spawn, and writer-generation guards; equality of a newly selected value
does not make an old callback current.

### TravelMode Is Not Simulation Speed

```text
TravelMode
  provider-neutral routing semantics

simulationSpeedMetersPerSecond
  game movement-speed authority

provider durationSeconds
  informational route metric, not animation authority
```

The game intentionally supports accelerated simulation. Do not infer real-world
car/motorcycle/walking animation speed from mode. Future presentation must not
change routing mode merely because its avatar changes.

---

## 9. Active SOLO Routing Plumbing

`frontend/src/api/routingClient.js` sends the exact mode when supplied. It omits
the field only for legacy/optional callers. `requireTravelMode` prevents
frontend active code from sending an unsupported value.

`useSoloRoundRecovery.captureRuntimeOperation` returns a scope containing the
checkpoint's immutable `round.travelMode` only while the round is current,
RUNNING, READY, and before its end epoch.

That captured operation is used by:

```text
map-confirmed route          usePlayerState.moveToDestination
target chase route          usePlayerState.moveToDestination
spawn nearest               useTargetSpawner -> createSoloTarget
spawn compatibility route   useTargetSpawner -> createSoloTarget
later spawn cadence         captureRuntimeOperation at each opportunity
recovered ROUTING intent     checkpoint.round.travelMode
restart/new round            synchronous selected-mode capture
```

Recovered already-MOVING geometry resumes its stored semantic route without a
new provider request. Recovered ROUTING intent reissues the route with
`checkpoint.round.travelMode`.

Active SOLO gameplay must not accidentally rely on the backend's missing-mode
CAR default. Optional/missing mode remains only for intentional legacy or
non-active callers.

---

## 10. Mode-Compatible SOLO Target Spawning

Current pipeline in `useTargetSpawner`:

```text
random rarity/creature/distance/bearing
        |
        v
raw geographic candidate
        |
        | nearest(raw, captured activeTravelMode)
        v
snapped candidate
        |
        | route(player -> snapped, same captured activeTravelMode)
        v
validate route
        |
        v
publish target and calculate game difficulty
```

Invariants:

- no raw-coordinate fallback;
- no snapped-only fallback;
- nearest and route use the same captured mode;
- currentness is checked before and after each async provider request;
- a stale nearest result cannot start/publish current route work;
- a stale route result cannot publish;
- the route must have at least two finite, range-valid coordinates;
- provider `distanceMeters` must be finite and greater than zero;
- measured geometry must be finite and greater than `0.01 m`;
- the final route coordinate must be within `25 m` of the snapped target;
- the 25 m endpoint tolerance is independent of catch radius; and
- difficulty uses provider route distance divided by game simulation speed.

Current candidate-attempt limit per spawn opportunity:

```text
3
```

After exhaustion, no target publishes. The normal later spawn cadence may
retry; the implementation does not permanently disable spawning. Only one
in-flight operation owns a spawn generation. Pause/resume, reset/restart,
identity change, round ineligibility, hydration/replacement, and unmount
invalidate stale ownership.

---

## 11. SOLO Recovery Schema v2

Current checkpoint:

```text
schemaVersion = 2
round.travelMode is required
valid: CAR | MOTORCYCLE | WALKING
```

IndexedDB database metadata remains:

```text
database name     route-catch-recovery
database version  1
object store      solo-checkpoints
```

No IndexedDB database-version bump was needed because only record schema
validation changed, not object-store layout.

### Legacy v1 Migration

```text
candidate schemaVersion == 1
        |
        v
validate complete genuine v1 shape
        |
        v
clone in memory
schemaVersion = 2
round.travelMode = CAR
        |
        v
validate complete v2 shape
```

A malformed record cannot gain legitimacy merely by claiming v1. A store read
returns the migrated in-memory checkpoint and migration metadata but does not
rewrite the raw v1 record solely because it was read. Any subsequent write is a
normal validated v2 replacement through the identity-scoped serialized writer.

Provider identity is not persisted. `activeTravelMode` restores from
`round.travelMode`. `selectedTravelMode` is not stored as separate active
gameplay truth; hydration sets the selector to the recovered mode as a UI
starting point.

### Stored Semantic State

The checkpoint records:

- schema/identity and created/updated/expiry epochs;
- client round UUID and backend session UUID;
- phase, duration, absolute `startedAt`/`endsAt`, and travel mode;
- settled player position and simulation speed;
- `ROUTING` or `MOVING` intent, purpose, destination, route geometry, and
  epoch/distance anchor;
- active/caught targets, score, XP;
- spawn paused state and absolute next spawn deadline; and
- stable pending catch synchronization evidence.

It does not record provider identity, rendered frames, random-spawn history,
Leaflet/MapLibre camera pose, MapLibre `FREE`, zoom override, or ephemeral
navigation-start intent.

### Identity and Bootstrap Barrier

Recovery identity is authenticated user UUID or stable guest installation UUID.
Authentication must resolve first:

```text
AUTH_UNRESOLVED -> RECOVERY_LOADING -> RECOVERY_READY
```

Round launch/restart, movement, spawn, and catch work remain blocked until
READY. If IndexedDB is unavailable, gameplay eventually proceeds in explicit
memory-only degraded mode with a warning rather than staying blocked.

### Generation / Writer Safety

Preserve these scopes:

```text
identity generation
bootstrap generation
lifecycle generation
replay generation
route request/revision
spawn generation and in-flight owner
client round/backend session identity
writer object + writer generation
catch ID + single-flight owner
```

They protect ordinary A-to-B and ABA transitions. Returning to the same
identity/value does not revive an earlier scope.

IndexedDB replacement/deletion is serialized per identity. Terminal deletion
tombstones its writer generation, rejects stale replacements, and orders the
new writer behind the prior native barrier. Old acknowledgement, reset, finish,
or bootstrap work cannot resurrect/delete a newer checkpoint.

### Wall-Clock Movement and Round Time

Movement is epoch-anchored:

```text
distance(at time) = clamp(
  anchorDistanceMeters
  + elapsedWallClockSeconds * simulationSpeedMetersPerSecond,
  0,
  measuredRouteLength
)
```

Reload downtime advances movement. A speed change settles under the old anchor
then re-anchors without discontinuity. Backward clock observations cannot move
the player backward.

Round time uses absolute start/end epochs. Refresh does not create a new
countdown. Delayed callbacks and recovery clamp semantic events at the original
round cutoff.

### Target/Catch Timeline

Known targets preserve absolute spawn/expiry times. Spawn cadence preserves its
absolute next deadline and skips missed opportunities instead of bursting.
Random opportunities missed while completely offline are not replayed because
there is no deterministic PRNG/log.

Live movement and recovery share measured route-interval catch geometry. The
system can detect crossing a catch radius between frames. Terminal events use
semantic distances/times, with equal-time priority:

```text
ROUND_END
TARGET_EXPIRY
ROUTE_COMPLETION
TARGET_CATCH
```

A catch exactly at round end or target expiry does not win.

### Pending Catch Outbox and Backend Idempotency

SOLO remains frontend-responsive:

```text
local semantic catch
  -> immediate target/score/XP/presentation update
  -> stable catch UUID + pending evidence
  -> durability-critical checkpoint attempt
  -> POST same catchId
  -> require matching acknowledgement
  -> durably remove pending evidence
```

Recovered replay synchronizes only; it never re-awards local score/XP. Live and
recovered submissions share single-flight ownership. Pending catches are ordered
deterministically by `caughtAtEpochMs`, then `catchId`, and replayed sequentially
with maximum concurrency one. This ordering and serialization are deliberate. A
retryable failure or acknowledgement-persistence uncertainty stops the current
replay pass rather than advancing to later catches. A deterministic/non-retryable
failure leaves that catch's evidence pending, but later pending catches in the
same pass may continue. Replay is triggered by recovery eligibility or
browser-online lifecycle, not a generic timed backoff loop.

Backend catch semantics:

```text
same catchId + same session + same creature
  -> idempotent success, no second aggregate award

same catchId + different session/creature
  -> 409 CATCH_ID_CONFLICT
```

The catch UUID primary key from V1 is the global race arbiter. Transactional
session lock/insert/aggregate ordering and a fresh `REQUIRES_NEW` collision read
handle concurrent identical and conflicting requests.

### Phases and Retention

```text
STARTING        createdAt + 2 minutes
RUNNING         endsAt + 15 minutes storage grace
RECONCILING     endsAt + 15 minutes storage grace
```

RUNNING is resumable only before `endsAt`. RECONCILING contains no movement,
active targets, or spawn schedule and never returns to RUNNING; it retains only
post-round synchronization evidence.

The normal launch path creates the first RUNNING checkpoint after backend
session start. A crash between backend success and the first checkpoint commit
remains outside the guarantee. STARTING is validated/bootstrap-supported but is
not constructed by the normal current launch path.

---

## 12. Renderer Status

### Leaflet

Leaflet is:

- the default SOLO renderer; and
- the multiplayer renderer.

It consumes the same recovered SOLO state and active travel mode as MapLibre.
It does not have the MapLibre navigation-camera state machine.

Known presentation observation: a recovered route can be semantically correct
while Leaflet opens at a broader route frame than desired. Do not diagnose this
alone as recovery corruption.

### MapLibre

MapLibre is opt-in for SOLO:

```env
VITE_SOLO_MAP_RENDERER=maplibre
```

It is not wired into multiplayer. Renderer-specific components consume shared
SOLO gameplay state rather than owning routing, catches, score, or recovery.

Current local presentation modes:

```text
OVERVIEW -> FOLLOW -> FREE
               ^        |
               +--------+ Resume Follow
```

Fresh routes use a short MapLibre-only overview/prelude and then FOLLOW.
Recovered already-MOVING routes carry ephemeral `RECOVERED_ACTIVE` intent and
enter FOLLOW directly at the reconstructed navigation frame. Recovered ROUTING
work requests fresh mode-correct geometry and is treated as fresh navigation.

Camera state is not checkpoint truth. Refresh intentionally does not restore
FREE, raw center/zoom/pitch/bearing, FOLLOW zoom override, or transition state.

MapLibre camera and route revisions, readiness gates, timer cancellation,
unmount cleanup, user-vs-programmatic interaction classification, and reduced
motion handling prevent stale presentation callbacks from controlling a newer
route. Navigation frames are delivered imperatively to avoid a per-animation-
frame React camera-state loop.

Historical PR #18 source/tests established travel-mode plumbing parity. Do not
claim complete browser live validation for all three MapLibre mode flows.

---

## 13. Multiplayer Isolation

Mobility PR #18 deliberately did not add TravelMode to multiplayer.

Current authoritative movement path:

```text
authenticated STOMP movement intent
        |
        v
RoomMovementService / InMemoryRoomMovementService
        |
        v
MovementRouteClient
        |
        v
OsrmMovementRouteClient
        |
        v
OSRM driving polyline6
```

Current creature road snapping:

```text
RoomCreatureSpawnCoordinator / RoomCreatureService
        -> OsrmRoomCreatureRoadSnapper
        -> OsrmRoutingService.findNearestDrivingPoint
        -> OSRM
```

`RoutingBoundaryTests` explicitly assert:

- multiplayer movement has no `TravelRoutingService`, Valhalla, or TravelMode
  dependency;
- multiplayer creature road snapping/service has no Valhalla or TravelMode
  dependency; and
- public routing controllers depend only on `TravelRoutingService`.

`Polyline6Codec` now reuses the shared `Polyline6Decoder` but retains separate
multiplayer coordinate/interpolation semantics. Utility reuse does not merge
authority.

Do not document multiplayer as having mode selection, Valhalla routing,
TravelMode STOMP fields, or a provider-neutral room mode. Any such feature
requires a separate design for room authority, concurrency, sequencing,
persistence, and recovery.

---

## 14. Multiplayer Authority and Concurrency

Authenticated principal UUID is authoritative. Presence supplies identity,
socket liveness, and coordinate fallback; it is not continuous movement truth.

Backend movement plans contain movement UUID, player/room identity, per-player
version, OSRM polyline6, route distance, simulation speed, start/end timestamps,
source/destination/current position, destination type, optional creature target,
and status.

Source priority:

```text
1. interpolated active movement plan position
2. stored authoritative terminal/stationary position
3. valid presence coordinate fallback
4. configured initial position
```

Movement uses server-relative time rather than frame accumulation. Client
reconnect/gap recovery uses `GET /api/multiplayer/rooms/{roomCode}/movements`.
Public movement event envelopes carry no backend round-generation field. When a
valid complete plan arrives across a room-sequence gap, the client applies it
immediately while marking/requesting snapshot reconciliation. A snapshot older
than the currently accepted room sequence is rejected and cannot roll movement
state backward. Backend round UUID/generation guards instead protect route
commit after OSRM, scheduled completion, spawning, and finalization authority
paths; clients must not infer such a field from movement envelopes.

Preserve:

- immutable authenticated player identity;
- client command IDs and expected movement versions;
- movement UUID/version ownership;
- room event sequences and event UUID dedupe;
- server timestamp/clock-offset rendering;
- connection/subscription/auth generations;
- round UUID and room-local generation checks;
- per-player state revisions around OSRM calls; and
- scheduled completion guards.

Network routing stays outside the room mutation boundary where possible. Work
captures expected identity/state, performs OSRM, then re-enters and revalidates
before commit.

Shared creatures, one-winner catch transition, scoring, and catch snapshots are
backend-owned. Current limitation: the catch endpoint still computes 75 m
distance from client-submitted `playerLat`/`playerLon` rather than resolving the
position within the catch operation from `RoomPlayerPositionResolver`.

---

## 15. Multiplayer Round Lifecycle and Results

Room and game states are distinct:

```text
room status  OPEN / IN_PROGRESS / CLOSED
game status  WAITING -> RUNNING -> FINALIZING -> ENDED
```

Start assigns a unique round UUID, increments room-local generation, records
absolute timing, and freezes the start-time participant roster. End reasons:

```text
HOST_ENDED
TIME_EXPIRED
ROOM_CLOSED
```

`RoomRoundFinalizationService` is the central path:

```text
1. Under RoomRoundCoordinator, validate round UUID/generation.
2. RUNNING -> FINALIZING; freeze first end reason/time/disposition.
3. Freeze matching movement, invalidate creatures, stop spawn generation.
4. Snapshot frozen participants/catches and calculate competition ranking.
5. Cache one immutable FinalizedRoomRound.
6. CompletedRoundPersistenceService.persistIfAbsent commits PostgreSQL rows.
7. Only after commit expose ENDED, in-memory result, and room disposition.
8. Attempt publication-only GAME_ENDED notification.
```

Persistence failure leaves the round FINALIZING and exposes no durable
completion. In-process retry reuses the same UUID/result/times/scores/ranks.
There is no process-restart recovery for active/finalizing state.

`GAME_ENDED` retry is bounded, in-memory, and publication-only. It reuses the
same envelope. It must never repeat scoring, catches, lifecycle transition, or
persistence. REST/PostgreSQL is completed-result truth.

### Competition Ranking

Score descending defines numeric rank. Ties share rank and skip following
positions:

```text
100 -> rank 1
100 -> rank 1
 80 -> rank 3
```

Catch count, case-insensitive display name, and player UUID provide stable
equal-score presentation order without changing numeric rank.

---

## 16. Durable Completed Multiplayer Results

Flyway V5 creates:

```text
game_rounds
game_round_players
game_round_player_catches
```

`game_rounds` stores unique public round instance UUID, room code, generation,
ENDED status, end reason, timestamps, duration, and participant count.

`game_round_players` stores one row per frozen participant with UUID,
display-name snapshot, presentation position, score, competition rank, catch
total, and rarity totals. Zero-score participants remain represented.

`game_round_player_catches` stores immutable per-participant catch snapshots:
creature instance/catalog ID, name, rarity, score awarded, and caught time.

Current durable reads:

```text
GET /api/multiplayer/rooms/{roomCode}/rounds/{roundId}/result
GET /api/multiplayer/rooms/{roomCode}/rounds/latest/result
GET /api/multiplayer/me/rounds?page=0&size=20
```

Authorization uses authenticated user UUID in persisted participant rows, not
display name or current mutable room membership. Public leaderboard totals do
not expose other participants' catch details; personal detail includes only the
requester's catches.

Exact read preference:

```text
matching committed immutable in-memory result
    -> otherwise PostgreSQL
```

Latest read preference:

```text
PostgreSQL latest ENDED result
    -> only if absent, bounded in-memory latest result
```

Database-first latest prevents an older memory cache from masking a newer
commit. “Latest” is latest completed round for the room before authorization,
not latest round the requester personally played.

History is an ENDED-only paginated projection ordered by `endedAt DESC,
roundInstanceId DESC`. It does not hydrate catches or perform N+1 exact reads.

The frontend's personal multiplayer history/result-detail controller scopes its
protected requests, cache, and display state to an authentication generation.
Logout or an authenticated identity/token change invalidates and aborts prior
history/detail work, clears protected personal cache/state, and prevents stale
responses from an older auth generation from populating current state. Before a
personal detail is cached or applied, its returned public/personal room and round
identities must match the requested room and round. This invariant is specific
to this protected result/history flow and prevents one account's personal
result or catch details from appearing under another account/token generation.

### Fundamental Storage Split

```text
ACTIVE ROOM/RUNNING STATE
  rooms, membership, presence, movement plans, sequences, active creatures,
  spawn coordinators, live score/catches, finalization context
  -> in-memory / single Spring Boot JVM

COMPLETED ROUND HISTORY
  result, participants, rankings, immutable catch snapshots, personal history
  -> durable PostgreSQL
```

Completed-result durability does not make active multiplayer state durable or
safe for arbitrary horizontal replicas.

---

## 17. Authentication and Trust Boundaries

JWT authentication is stateless. REST authentication reloads the UUID-identified
user and installs `UserEntity` as principal. STOMP CONNECT requires bearer JWT
through the inbound channel interceptor; later frames retain Authentication.

**Current security/deployment invariant:** committed JWT configuration defaults
are for local development only. Every non-local or deployed environment **must**
override `auth.jwt.secret`; the committed signing secret is not production-safe
and must not be copied into documentation or deployment configuration.

Never trust a client-supplied multiplayer player ID when the principal exists.
Username is a login handle and display name is presentation. Historical result
authorization uses immutable UUID participation.

Current presence limitation: the STOMP presence handler authenticates the
principal but does not independently enforce membership for the submitted room
code. Presence must remain non-authoritative and not become an authorization or
scoring signal.

---

## 18. Critical Architecture Invariants

Future work must preserve these unless explicitly redesigning them:

1. Public TravelMode values remain provider-neutral and exactly CAR,
   MOTORCYCLE, WALKING.
2. Provider selection is deterministic; no silent fallback.
3. Active SOLO travel mode is synchronously captured and immutable per round.
4. RECONCILING next-round selection cannot rewrite old round/checkpoint mode.
5. Travel mode and simulation speed are independent.
6. All active SOLO route/nearest/spawn operations use captured active mode.
7. Target nearest and validation route use the same active mode; no degraded
   raw/snapped-only publication.
8. SOLO recovery validates complete records and remains identity/generation/
   lifecycle/replay/writer/ABA scoped.
9. SOLO movement/time/target/catch truth is semantic wall-clock/route truth,
   not accumulated rendered frames.
10. One logical SOLO catch keeps one stable catch ID; replay never re-awards
    local score/XP.
11. Renderer/camera state does not become gameplay or routing authority.
12. Multiplayer remains isolated from SOLO TravelMode/Valhalla until separately
    designed.
13. Backend principal owns multiplayer identity.
14. Backend owns multiplayer movement source/route and shared catch/score/round
    transitions.
15. Movement versions, room sequences, round UUID/generation, and stale
    callback guards remain authoritative.
16. Room-coordinated catch/finalization races must produce one consistent
    outcome.
17. Persistence precedes durable completion.
18. GAME_ENDED retry is publication-only.
19. Historical authorization uses frozen/persisted participation.
20. Completed history durability must not be confused with active-state
    durability.

---

## 19. Current Known Limitations

- Valhalla startup, tiles/data, readiness, and deployment are external to the
  committed repository.
- Committed OSRM scripts have machine-specific binary/data paths.
- `/api/health` does not probe providers.
- Public OSRM resource-access failures do not have Valhalla's distinct 504
  timeout normalization.
- Active multiplayer state, event sequences, spawn loops, and FINALIZING
  context are not durable/reconstructable after backend restart.
- Active multiplayer assumes one owner JVM and is not horizontally scalable as
  configured.
- Multiplayer catch distance trusts client-submitted position input.
- Presence handler membership enforcement is incomplete.
- STOMP movement rejection is not cleanly correlated to the initiating browser
  command in every case.
- GAME_ENDED publication retry/dedup is in-memory; no durable outbox/broker.
- SOLO checkpoints are TTL-bound recovery evidence, not permanent history or a
  permanent outbox.
- Missed random SOLO spawn opportunities during complete downtime are not
  deterministically replayed.
- The post-backend-session/pre-first-checkpoint SOLO launch crash window remains
  outside recovery.
- MapLibre is opt-in SOLO-only and was not fully browser-live-validated across
  all PR #18 modes.
- Leaflet recovered camera framing can be broader than desired despite correct
  semantic state.
- There is no full browser E2E suite.
- H2 PostgreSQL compatibility tests do not prove every PostgreSQL locking,
  constraint, query-plan, or transaction behavior.
- There is no Redis/distributed broker authority or complete hosted deployment
  pipeline.

---

## 20. Historical Validation Checkpoints

These are historical evidence, not permanent test-count guarantees.

### PR #18 — Mobility & Travel Foundation

Recorded before merge/final review:

```text
backend automated suite              407 tests passed
frontend full suite                  passed
MapLibre source tests                passed
frontend lint                        passed
production build                     passed

live route + nearest
  CAR -> OSRM                         passed
  MOTORCYCLE -> Valhalla             passed
  WALKING -> Valhalla                passed

Leaflet SOLO live
  CAR selection/route/move/catch/respawn          passed
  MOTORCYCLE selection/route/move/catch/respawn   passed
  WALKING selection/route/move/catch/respawn      passed
  WALKING active-round refresh recovery           passed

MapLibre
  source/test parity                 passed
  full browser live mode matrix      not completed
```

Post-merge GitHub CI history:

- The initial merged-main run had one concurrent catch-idempotency test
  failure.
- The exact test, its class, and repeated full backend suites passed extensively
  in local stress runs.
- GitHub Actions rerun passed with unchanged source.
- Treat this as a historical transient CI observation, not a confirmed
  production concurrency defect.

Do not modify catch implementation based only on that historical rerun.

### SOLO Active-Round Recovery Milestone (PR #16)

Historical checkpoint recorded:

```text
backend suite                366 tests passed
frontend Node suite          37/37 test files passed
MapLibre source suite        passed
lint/build                   passed
```

Manual matrices covered Leaflet/MapLibre recovery, repeated refresh during
movement, speed changes, targets/catches, CHASE, expiry, round end, route
completion during reload, catch replay, and direct recovered MapLibre FOLLOW.
Those were manual evidence, not browser E2E automation.

### MapLibre Navigation Camera Milestone (PR #15)

Historical checkpoint recorded frontend Node/MapLibre tests, lint, build, and
manual camera feel validation. It established renderer-local OVERVIEW/FOLLOW/
FREE architecture without changing multiplayer.

### Durable Multiplayer Results Milestone (PR #13)

PR #13 (`c9e5f4c`) introduced PostgreSQL completed-round persistence, durable
exact/latest reads, current-user multiplayer history, historical result UI, and
bounded GAME_ENDED publication retry.

Historical test checkpoint:

```text
backend              355 tests / 45 suites passed
frontend             20/20 test files / 175 declared tests passed
lint/build           passed
```

This historical milestone remains useful because it explains why completed
results are durable while active multiplayer state stays in memory.

---

## 21. Important Implementation Locations

Backend mobility:

```text
controller/RoutingController.java
controller/NearestController.java
dto/RouteRequest.java / NearestRequest.java
routing/TravelMode.java
routing/TravelRoutingService.java
routing/TravelRoutingProvider.java
routing/RouteQuery.java / NearestPointQuery.java
routing/Polyline6Decoder.java
service/OsrmRoutingService.java
routing/valhalla/ValhallaRoutingService.java
exception/GlobalExceptionHandler.java
```

Frontend mobility/recovery:

```text
config/travelMode.js
api/routingClient.js
components/TravelModeSelector.jsx
hooks/usePlayerState.js
hooks/useTargetSpawner.js
hooks/useSoloRoundRecovery.js
recovery/soloRecoveryCheckpoint.js
recovery/soloRecoveryRuntime.js
recovery/soloRecoveryStore.js
recovery/soloRecoveryWriter.js
recovery/soloGameplayLifecycle.js
```

Multiplayer isolation and routing:

```text
multiplayer/.../movement/routing/MovementRouteClient.java
multiplayer/.../movement/routing/OsrmMovementRouteClient.java
multiplayer/.../movement/routing/Polyline6Codec.java
multiplayer/.../movement/service/RoomMovementService.java
multiplayer/.../movement/service/InMemoryRoomMovementService.java
multiplayer/.../creature/OsrmRoomCreatureRoadSnapper.java
multiplayer/.../creature/RoomCreatureSpawnCoordinator.java
multiplayer/.../round/RoomRoundFinalizationService.java
multiplayer/.../round/persistence/*
```

Protection tests include `RoutingTravelModeApiTests`,
`TravelRoutingServiceTests`, `ValhallaRoutingServiceTests`,
`RoutingBoundaryTests`, `soloTravelMode.test.js`,
`soloTravelModeSpawnLifecycle.test.js`, `soloTargetCompatibility.test.js`, and
the schema/recovery test suites.

---

## 22. Instructions for a Future Engineering Session

1. Read this document.
2. Read [`docs/ROADMAP.md`](docs/ROADMAP.md) if resuming future work.
3. Verify the current branch/commit and inspect relevant committed source/tests.
4. Identify the authoritative state owner before changing behavior.
5. Identify mode, identity, lifecycle, generation, concurrency, persistence,
   recovery, renderer, and multiplayer-isolation implications.
6. Preserve the invariants above or explicitly propose a redesign.
7. Update current docs only after implementation merges; keep proposals in the
   roadmap.

Do not treat historical statements as current behavior. In particular, these
are now stale when presented as current:

```text
OSRM is the only routing engine
SOLO checkpoint schema is version 1
Valhalla is not integrated
completed multiplayer results are only in memory
MapLibre is the default renderer
TravelMode exists in multiplayer
```

The accurate current baseline is PR #18 at `d44655c`.
