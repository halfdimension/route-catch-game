#!/usr/bin/env bash

OSRM_URL="http://localhost:5000"
API_URL="http://localhost:8080"
FAILURES=0

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
