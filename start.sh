#!/bin/bash
# ────────────────────────────────────────────────────────
#  Talk-day startup script
#  Run this from the repo root: ./start.sh
# ────────────────────────────────────────────────────────

set -e

# ── Config ────────────────────────────────────────────────
HOST_KEY="ashika"

# Paste your WiZ bulb IPs here (comma-separated, no spaces)
# Find them in the WiZ app → Device Settings → IP address
WIZ_IPS=""   # e.g. "192.168.1.100,192.168.1.101"

PORT=3000

# ─────────────────────────────────────────────────────────

cd "$(dirname "$0")/app"

echo ""
echo "  ✦ Light Room — talk day startup"
echo ""

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "  Installing dependencies..."
  npm install --silent
fi

echo "  Starting server on port $PORT..."
echo "  Host dashboard: http://localhost:$PORT/host?key=$HOST_KEY"
echo ""
echo "  ┌─────────────────────────────────────────┐"
echo "  │  In a second terminal, run:             │"
echo "  │  npx ngrok http $PORT                      │"
echo "  │  Then QR-code the ngrok URL             │"
echo "  └─────────────────────────────────────────┘"
echo ""

HOST_KEY="$HOST_KEY" WIZ_IPS="$WIZ_IPS" PORT="$PORT" node server/server.js
