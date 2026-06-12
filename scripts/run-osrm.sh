#!/usr/bin/env bash

set -e

OSRM_BUILD_DIR="/home/halfdimension/Projects/practice/osrm-backend/build"
OSRM_BINARY="$OSRM_BUILD_DIR/osrm-routed"
OSRM_DATA="/home/halfdimension/Projects/osrm-data/northern-zone-latest.osrm"

if [ ! -x "$OSRM_BINARY" ]; then
  printf 'OSRM executable not found or not executable: %s\n' "$OSRM_BINARY" >&2
  exit 1
fi

for suffix in ebg partition cells; do
  companion_file="${OSRM_DATA}.${suffix}"

  if [ ! -f "$companion_file" ]; then
    printf 'OSRM dataset is incomplete.\n' >&2
    printf 'Dataset prefix: %s\n' "$OSRM_DATA" >&2
    printf 'Missing companion file: %s\n' "$companion_file" >&2
    exit 1
  fi
done

cd "$OSRM_BUILD_DIR"
exec ./osrm-routed --algorithm mld "$OSRM_DATA"
