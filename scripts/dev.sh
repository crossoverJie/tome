#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  pnpm install
fi

pnpm tauri dev
