#!/usr/bin/env bash

set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR/frontend"

if [ ! -f .env ]; then
  cp .env.example .env
  printf 'Created frontend/.env from .env.example\n'
fi

if [ ! -d node_modules ]; then
  npm install
fi

exec npm run dev
