#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OSRM_PID=""
BACKEND_PID=""
CLEANED_UP=0

stop_process_group() {
  local name="$1"
  local pid="$2"

  if [ -z "$pid" ] || ! kill -0 "$pid" 2>/dev/null; then
    return
  fi

  printf 'Stopping %s...\n' "$name"
  kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true

  for _ in $(seq 1 20); do
    if ! kill -0 "$pid" 2>/dev/null; then
      wait "$pid" 2>/dev/null || true
      return
    fi
    sleep 0.25
  done

  kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  if [ "$CLEANED_UP" -eq 1 ]; then
    return
  fi

  CLEANED_UP=1
  printf '\nShutting down Route Catch Game services...\n'
  stop_process_group "Spring Boot backend" "$BACKEND_PID"
  stop_process_group "OSRM" "$OSRM_PID"
}

wait_for_service() {
  local name="$1"
  local url="$2"
  local pid="$3"
  local require_success_status="$4"

  printf 'Waiting for %s' "$name"

  for _ in $(seq 1 120); do
    if ! kill -0 "$pid" 2>/dev/null; then
      printf '\n%s stopped before becoming ready.\n' "$name" >&2
      return 1
    fi

    if [ "$require_success_status" = "true" ]; then
      if curl --silent --output /dev/null --fail --max-time 2 "$url"; then
        printf ' OK\n'
        return 0
      fi
    elif curl --silent --output /dev/null --max-time 2 "$url"; then
      printf ' OK\n'
      return 0
    fi

    printf '.'
    sleep 1
  done

  printf '\nTimed out waiting for %s at %s\n' "$name" "$url" >&2
  return 1
}

trap cleanup EXIT
trap 'exit 130' INT TERM

printf 'Starting Route Catch Game\n'
printf '%s\n' '-------------------------'

printf 'Starting OSRM on http://localhost:5000...\n'
setsid "$ROOT_DIR/scripts/run-osrm.sh" &
OSRM_PID=$!
wait_for_service "OSRM" "http://localhost:5000" "$OSRM_PID" "false"

printf 'Starting Spring Boot backend on http://localhost:8080...\n'
setsid "$ROOT_DIR/scripts/run-backend.sh" &
BACKEND_PID=$!
wait_for_service \
  "Spring Boot backend" \
  "http://localhost:8080/api/health" \
  "$BACKEND_PID" \
  "true"

cd "$ROOT_DIR/frontend"

if [ ! -f .env ]; then
  cp .env.example .env
  printf 'Created frontend/.env from .env.example\n'
fi

if [ ! -d node_modules ]; then
  printf 'Installing frontend dependencies...\n'
  npm install
fi

printf 'Starting Vite frontend...\n'
printf 'App URL: http://localhost:5173\n'
printf 'Press Ctrl+C to stop all services.\n'
npm run dev
