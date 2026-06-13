#!/usr/bin/env bash

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OSRM_URL="http://localhost:5000"
API_URL="http://localhost:8080"
OSRM_BUILD_DIR="/home/halfdimension/Projects/practice/osrm-backend/build"
OSRM_BINARY="$OSRM_BUILD_DIR/osrm-routed"
OSRM_DATA="/home/halfdimension/Projects/osrm-data/northern-zone-latest.osrm"
FAILURES=0

check_command() {
  local label="$1"
  local command_name="$2"

  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'OK   %s\n' "$label"
  else
    printf 'FAIL %s (%s not found)\n' "$label" "$command_name"
    FAILURES=$((FAILURES + 1))
  fi
}

check_executable() {
  local label="$1"
  local path="$2"

  if [ -x "$path" ]; then
    printf 'OK   %s\n' "$label"
  else
    printf 'FAIL %s (%s)\n' "$label" "$path"
    FAILURES=$((FAILURES + 1))
  fi
}

check_file() {
  local label="$1"
  local path="$2"

  if [ -f "$path" ]; then
    printf 'OK   %s\n' "$label"
  else
    printf 'FAIL %s (%s)\n' "$label" "$path"
    FAILURES=$((FAILURES + 1))
  fi
}

check_postgres() {
  if ! command -v pg_isready >/dev/null 2>&1; then
    printf 'FAIL PostgreSQL readiness (pg_isready not found)\n'
    FAILURES=$((FAILURES + 1))
    return
  fi

  if pg_isready --host localhost --port 5432 >/dev/null 2>&1; then
    printf 'OK   PostgreSQL readiness (localhost:5432)\n'
  else
    printf 'FAIL PostgreSQL readiness (localhost:5432)\n'
    FAILURES=$((FAILURES + 1))
  fi
}

check_get() {
  local label="$1"
  local url="$2"

  if curl --silent --show-error --fail --max-time 10 "$url" >/dev/null; then
    printf 'OK   %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

check_post() {
  local label="$1"
  local url="$2"
  local body="$3"

  if curl --silent --show-error --fail --max-time 10 \
    --header "Content-Type: application/json" \
    --data "$body" \
    "$url" >/dev/null; then
    printf 'OK   %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label"
    FAILURES=$((FAILURES + 1))
  fi
}

printf 'Route Catch Game system checks\n'
printf '%s\n' '------------------------------'

check_command "Java" "java"
check_executable \
  "Maven wrapper" \
  "$ROOT_DIR/backend/route-catch-api/mvnw"
check_command "Node.js" "node"
check_command "npm" "npm"
check_command "psql client" "psql"
check_postgres
check_executable "OSRM executable" "$OSRM_BINARY"
check_file "OSRM MLD edge data" "${OSRM_DATA}.ebg"
check_file "OSRM MLD partition data" "${OSRM_DATA}.partition"
check_file "OSRM MLD cell data" "${OSRM_DATA}.cells"

printf '%s\n' '------------------------------'

check_get \
  "OSRM nearest endpoint ($OSRM_URL)" \
  "$OSRM_URL/nearest/v1/driving/77.2090,28.6139?number=1"

check_get \
  "Backend health ($API_URL/api/health)" \
  "$API_URL/api/health"

check_post \
  "Backend nearest ($API_URL/api/nearest)" \
  "$API_URL/api/nearest" \
  '{"lat":28.6139,"lon":77.2090}'

check_post \
  "Backend route ($API_URL/api/routes)" \
  "$API_URL/api/routes" \
  '{"sourceLat":28.6139,"sourceLon":77.2090,"destinationLat":28.6200,"destinationLon":77.2150}'

printf '%s\n' '------------------------------'

if [ "$FAILURES" -eq 0 ]; then
  printf 'OK   All system checks passed\n'
  exit 0
fi

printf 'FAIL %s system check(s) failed\n' "$FAILURES"
exit 1
