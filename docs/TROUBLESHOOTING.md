# Troubleshooting

This guide describes the committed PR #18 local topology. The important first
split is provider-specific:

```text
CAR routing problem                 inspect Spring Boot + OSRM
MOTORCYCLE/WALKING routing problem  inspect Spring Boot + Valhalla
```

There is no silent provider fallback.

## Expected Local Ports

| Port | Service |
|---:|---|
| 5173 | Vite frontend |
| 8080 | Spring Boot API |
| 5000 | OSRM |
| 8002 | Valhalla |
| 5432 | PostgreSQL |

Inspect listeners:

```bash
ss -ltnp | rg ':(5000|8002|8080|5173|5432)\b'
```

## Health Is UP but Routing Fails

`GET /api/health` reports only that the Spring Boot application is responding:

```bash
curl --fail http://localhost:8080/api/health
```

It does not call OSRM or Valhalla. `{"status":"UP"}` can therefore coexist
with a provider outage.

Test each public mode separately:

```bash
curl --fail-with-body \
  --header 'Content-Type: application/json' \
  --data '{
    "sourceLat":28.6139,
    "sourceLon":77.209,
    "destinationLat":28.62,
    "destinationLon":77.215,
    "travelMode":"CAR"
  }' \
  http://localhost:8080/api/routes
```

Repeat with `"MOTORCYCLE"` and `"WALKING"`. If only CAR fails, focus on
OSRM. If only the other two fail, focus on Valhalla.

## CAR / OSRM Failures

The committed OSRM URL is:

```properties
osrm.base-url=http://localhost:5000
```

Start the committed local OSRM wrapper:

```bash
./scripts/run-osrm.sh
```

Test OSRM directly:

```bash
curl --fail \
  'http://localhost:5000/nearest/v1/driving/77.2090,28.6139?number=1'
```

The script contains author-machine paths for the OSRM binary and data prefix.
If startup fails, inspect `scripts/run-osrm.sh` and verify the configured files:

```text
<dataset>.ebg
<dataset>.partition
<dataset>.cells
```

This machine-specific configuration is a current limitation. Do not assume the
script discovers an installation automatically. Coordinates outside the
prepared extract can return `NoRoute` or `NoSegment` while the process itself
is healthy.

## MOTORCYCLE / WALKING / Valhalla Failures

Committed backend defaults:

```properties
valhalla.base-url=http://localhost:8002
valhalla.connect-timeout=2s
valhalla.read-timeout=10s
```

The repository does not contain a Valhalla launcher, container service,
tile-build workflow, or readiness check. Start a separately prepared Valhalla
instance on `localhost:8002` before using `MOTORCYCLE` or `WALKING`.
Historical PR #18 validation used that local address.

Use backend requests to verify both Valhalla costings:

```bash
curl --fail-with-body \
  --header 'Content-Type: application/json' \
  --data '{"lat":28.6139,"lon":77.209,"travelMode":"MOTORCYCLE"}' \
  http://localhost:8080/api/nearest

curl --fail-with-body \
  --header 'Content-Type: application/json' \
  --data '{"lat":28.6139,"lon":77.209,"travelMode":"WALKING"}' \
  http://localhost:8080/api/nearest
```

If one mode has no suitable local edge, check that the Valhalla tiles cover the
coordinates and support the corresponding costing. The application will not
retry through OSRM driving.

## Routing Error Codes

| Error | Meaning / next check |
|---|---|
| `UNSUPPORTED_TRAVEL_MODE` (400) | Use exact uppercase `CAR`, `MOTORCYCLE`, or `WALKING` |
| `ROUTE_NOT_FOUND` (400) | Valhalla reported a known no-route condition or the normalized response contained no route |
| `NoRoute` / `NoSegment` (400) | OSRM could not route/snap within its current extract/profile |
| `ROUTING_ENGINE_UNAVAILABLE` (502) | Selected provider is not reachable |
| `ROUTING_ENGINE_TIMEOUT` (504) | Valhalla exceeded its connect/read timeout |
| `NEAREST_POINT_NOT_FOUND` (502) | Provider returned no usable nearest edge/point |
| `ROUTING_ENGINE_INVALID_RESPONSE` (502) | Valhalla rejected malformed JSON or normalized invalid route/locate data, or OSRM hit one of its recognized invalid-response checks |
| `ROUTING_ENGINE_ERROR` (502) | Selected provider returned another unsuccessful response |

The public CAR/OSRM adapter currently normalizes resource-access failures as
`ROUTING_ENGINE_UNAVAILABLE`; it does not expose the Valhalla-specific timeout
distinction. Valhalla comprehensively validates route/locate success bodies;
malformed JSON and the invalid structures, route metrics, or route geometry
handled by its normalizers use the 502 invalid-response contract. A locate
result with no usable edge retains the separate nearest-point error above. OSRM
coordinate-array/shape validation is less comprehensive, so an arbitrary
malformed OSRM payload is not guaranteed to produce that code; an unexpected
failure may reach the sanitized generic `500 INTERNAL_SERVER_ERROR` path.

## `run-all.sh` Does Not Provide the Whole Mobility Stack

The committed helper starts:

```text
OSRM -> Spring Boot -> Vite
```

It does not start PostgreSQL or Valhalla. Start PostgreSQL first and separately
provide Valhalla when needed:

```bash
docker compose up -d postgres
./scripts/run-all.sh
```

Likewise, `./scripts/check-system.sh` checks PostgreSQL, the configured OSRM
files/process, backend health, and default-mode CAR route/nearest behavior. It
does not verify Valhalla or either Valhalla-backed mode.

## PostgreSQL Container Does Not Start

Inspect state and logs:

```bash
docker compose ps
docker compose logs postgres
docker compose config
```

Common causes are Docker not running, port 5432 already occupied, or an old
volume initialized with different credentials.

The repository-documented local defaults are:

```text
database  route_catch_game
user      route_catch_user
password  route_catch_pass
```

Initialization environment variables apply only when the volume is created.
Changing them later does not update the existing PostgreSQL role.

Test the Compose database:

```bash
docker compose exec postgres \
  psql -U route_catch_user -d route_catch_game \
  -c 'select current_database(), current_user;'
```

## Port 5432 Is Already in Use

```bash
ss -ltnp | rg ':5432\b'
systemctl status postgresql
```

A local PostgreSQL service and the Compose container cannot both bind the same
host port. Choose one.

## Reset the PostgreSQL Volume

Stop without deleting data:

```bash
docker compose down
```

Only when a destructive local reset is intended:

```bash
docker compose down -v
docker compose up -d postgres
```

`-v` permanently deletes local users, sessions, catches, and completed
multiplayer history in the named volume. Flyway recreates the schema when the
backend starts.

## Backend Cannot Connect to PostgreSQL

```bash
pg_isready -h localhost -p 5432

PGPASSWORD=route_catch_pass \
  psql -h localhost -U route_catch_user -d route_catch_game \
  -c 'select current_database(), current_user;'
```

Verify the datasource values in
`backend/route-catch-api/src/main/resources/application.properties`. A backend
startup failure before `/api/health` usually points to datasource, Flyway, or
Hibernate validation rather than routing.

## Flyway or Hibernate Validation Fails

Inspect migration history:

```bash
PGPASSWORD=route_catch_pass \
  psql -h localhost -U route_catch_user -d route_catch_game \
  -c 'select installed_rank, version, description, success from flyway_schema_history order by installed_rank;'
```

Do not edit an already-applied migration. Add a later migration for a future
schema change. Current committed migrations are V1 through V5.

## Completed Multiplayer History Disappeared

Completed rounds are durable in PostgreSQL. Active room state is not.

- A backend restart normally removes rooms, active movement, creatures,
  sequences, and a running/finalizing round.
- A completed, successfully committed result remains queryable through exact,
  latest, and current-user history endpoints.
- If completed history is missing after restart, inspect PostgreSQL/Flyway and
  confirm the round reached `ENDED`; a round stuck/lost in `FINALIZING` may not
  have committed.

Do not diagnose loss of an active room as failure of completed-result
persistence; they are separate storage models.

## Vite Cannot Reach Spring Boot

Create or inspect `frontend/.env`:

```bash
cp frontend/.env.example frontend/.env
```

```env
VITE_API_BASE_URL=http://localhost:8080
```

Restart Vite after changing environment variables. Confirm Spring Boot:

```bash
curl --fail http://localhost:8080/api/health
```

The committed CORS configuration expects the normal local Vite origin. Opening
`/api/routes` or `/api/nearest` directly in a tab sends GET and returns 405;
use POST with JSON as shown in [`API.md`](API.md).

## Renderer Is Not the Expected One

Leaflet is the default. MapLibre is enabled only for SOLO and only when Vite
starts with:

```env
VITE_SOLO_MAP_RENDERER=maplibre
```

Restart Vite after changing the flag. Multiplayer remains Leaflet regardless
of this value.

If recovered Leaflet movement and route state are correct but the camera opens
at a broad zoom/frame, treat that as known presentation polish rather than
checkpoint corruption. MapLibre recovered active movement should enter
`FOLLOW`; its camera pose and prior `FREE` state are intentionally not
persisted.

## SOLO Recovery Does Not Resume

Checkpoints are deliberately strict and transient:

- schema v2 requires `round.travelMode`;
- a genuine v1 record migrates in memory to v2 with `CAR`;
- identity mismatch, malformed data, unsupported versions, and storage expiry
  are rejected;
- `RUNNING` is resumable only before `endsAt`;
- `RECONCILING` replays cleanup but never resumes gameplay; and
- IndexedDB failure releases gameplay in memory-only degraded mode with a
  warning.

Provider identity and camera pose are not recovery fields. A failed provider
request after recovery is a routing failure, not necessarily recovery-state
corruption.

## Node, Build, or Lint Errors

CI uses Node 22. Verify the local versions:

```bash
node --version
npm --version
```

Install and run checks from `frontend/`:

```bash
npm install
node --test test/*.test.js
npm run test:maplibre
npm run lint
npm run build
```

The complete Node suite is not run by current GitHub CI, and there is no full
browser E2E suite.
