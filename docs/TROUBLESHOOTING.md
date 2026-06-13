# Troubleshooting

## Backend Cannot Connect to PostgreSQL

Check PostgreSQL:

```bash
pg_isready -h localhost -p 5432
```

Verify the database and role:

```bash
sudo -u postgres psql -c "\du route_catch_user"
sudo -u postgres psql -c "\l route_catch_game"
```

Test the application credentials:

```bash
PGPASSWORD=route_catch_pass \
  psql -h localhost -U route_catch_user -d route_catch_game \
  -c "select current_database(), current_user;"
```

The defaults must match `application.properties`:

```text
Database: route_catch_game
User:     route_catch_user
Password: route_catch_pass
Port:     5432
```

## Permission Denied for Schema `public`

Connect as an administrator:

```bash
sudo -u postgres psql -d route_catch_game
```

Grant the application role access:

```sql
GRANT USAGE, CREATE ON SCHEMA public TO route_catch_user;
ALTER SCHEMA public OWNER TO route_catch_user;
\q
```

Then restart the backend so Flyway can run.

## OSRM Is Not Running

Start it directly:

```bash
./scripts/run-osrm.sh
```

Test the configured dataset:

```bash
curl --fail \
  "http://localhost:5000/nearest/v1/driving/77.2090,28.6139?number=1"
```

If startup fails, verify the binary and MLD companion files configured in
`scripts/run-osrm.sh`:

```text
${OSRM_DATA}.ebg
${OSRM_DATA}.partition
${OSRM_DATA}.cells
```

Coordinates outside the prepared map extract may return no route even when
OSRM is healthy.

## Vite Cannot Reach the Backend

Verify `frontend/.env`:

```env
VITE_API_BASE_URL=http://localhost:8080
```

Create it when missing:

```bash
cp frontend/.env.example frontend/.env
```

Restart Vite after changing environment variables. Confirm backend health:

```bash
curl --fail http://localhost:8080/api/health
```

## CORS or Wrong HTTP Method

The backend allows the local Vite origin `http://localhost:5173`. If Vite uses
another origin or port, update the backend CORS configuration or run Vite on
the expected port.

Opening a POST endpoint in a browser tab sends GET and returns `405`:

```text
/api/routes
/api/nearest
/api/game/sessions/{id}/catches
```

Use the curl examples in [API.md](API.md) with `--request POST` and JSON where
required.

## Node or Vite Version Errors

Vite 8 requires Node.js `20.19+` or `22.12+`:

```bash
node --version
npm --version
```

After changing Node versions, reinstall frontend dependencies:

```bash
cd frontend
rm -rf node_modules
npm install
```

Only remove `node_modules`; do not remove application source or environment
files.

## Port Already in Use

Inspect the expected ports:

```bash
ss -ltnp | grep -E ':(5000|8080|5173|5432)\b'
```

Ports:

- `5000`: OSRM
- `8080`: Spring Boot
- `5173`: Vite
- `5432`: PostgreSQL

Stop the conflicting process or configure the corresponding service to use
another port. If the backend or frontend port changes, update
`VITE_API_BASE_URL` and any affected local scripts.

## Frontend `.env` Is Missing

Both `run-all.sh` and `run-frontend.sh` create it automatically. To create it
manually:

```bash
cp frontend/.env.example frontend/.env
```

Do not commit a machine-specific `frontend/.env`.

## Flyway Validation or Migration Failure

Check migration history:

```bash
PGPASSWORD=route_catch_pass \
  psql -h localhost -U route_catch_user -d route_catch_game \
  -c "select installed_rank, version, description, success from flyway_schema_history order by installed_rank;"
```

Do not edit an already-applied migration. Add a new versioned migration for
future schema changes.

## Full Diagnostic Check

With all services running:

```bash
./scripts/check-system.sh
```

This checks local tools, PostgreSQL readiness, configured OSRM files, OSRM
HTTP access, backend health, nearest-road snapping, and route fetching.
