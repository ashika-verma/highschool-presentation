#!/bin/bash
# ────────────────────────────────────────────────────────
#  Light Room — Talk-day startup script
#  Run from the repo root: ./start.sh
# ────────────────────────────────────────────────────────

set -e

# ── Config ────────────────────────────────────────────────
HOST_KEY="ashika"

# Paste your WiZ bulb IPs here (comma-separated, no spaces)
# Find them in the WiZ app → Device Settings → IP address
WIZ_IPS=""   # e.g. "192.168.1.100,192.168.1.101"

PORT=3000

# Optional: set to a fixed subdomain if you have a Cloudflare named tunnel configured.
# Leave blank to use a free quick tunnel (random URL, no login required).
# Named tunnel example: TUNNEL_HOSTNAME="talk.ashikaverma.com"
TUNNEL_HOSTNAME=""

# ─────────────────────────────────────────────────────────

cd "$(dirname "$0")/app"

echo ""
echo "  ✦ Light Room — talk day"
echo ""

# Install deps if needed
if [ ! -d node_modules ]; then
  echo "  Installing dependencies..."
  npm install --silent
  echo ""
fi

# ── Start the Node server in the background ────────────────
HOST_KEY="$HOST_KEY" WIZ_IPS="$WIZ_IPS" PORT="$PORT" node server/server.js &
SERVER_PID=$!

# Give the server a moment to boot
sleep 1

echo "  ✓ Server running on port $PORT"
echo "  ✓ Host dashboard → http://localhost:$PORT/host?key=$HOST_KEY"
echo ""

# ── Tunnel — Cloudflare (free, no interstitial, no login needed) ──────────────
if command -v cloudflared &>/dev/null; then
  echo "  ✦ Starting Cloudflare Tunnel..."
  echo "    (no warning page, free, no account needed)"
  echo ""

  if [ -n "$TUNNEL_HOSTNAME" ]; then
    # Named tunnel (persistent URL) — requires cloudflared login + tunnel setup
    echo "  Using named tunnel → https://$TUNNEL_HOSTNAME"
    echo ""
    echo "  QR code: http://localhost:$PORT/qr?url=https://$TUNNEL_HOSTNAME"
    echo ""
    cloudflared tunnel run --url http://localhost:$PORT &
    TUNNEL_PID=$!
  else
    # Quick tunnel (random trycloudflare.com URL — no login required)
    # Extract URL from cloudflared output and print QR link
    TMPLOG=$(mktemp)
    cloudflared tunnel --url http://localhost:$PORT > "$TMPLOG" 2>&1 &
    TUNNEL_PID=$!

    # Wait up to 15s for the URL to appear
    TUNNEL_URL=""
    for i in $(seq 1 30); do
      TUNNEL_URL=$(grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com' "$TMPLOG" 2>/dev/null | head -1 || true)
      if [ -n "$TUNNEL_URL" ]; then break; fi
      sleep 0.5
    done
    rm -f "$TMPLOG"

    if [ -n "$TUNNEL_URL" ]; then
      echo "  ✓ Tunnel live → $TUNNEL_URL"
      echo ""
      echo "  QR code for students: http://localhost:$PORT/qr?url=$TUNNEL_URL"
      echo "  (open this URL in your browser, then share your screen)"
      echo ""
    else
      echo "  ⚠️  Could not detect tunnel URL — check cloudflared output above"
      echo ""
    fi
  fi

  # Clean up both processes on exit
  trap "echo ''; echo '  Shutting down...'; kill $SERVER_PID $TUNNEL_PID 2>/dev/null; wait 2>/dev/null" EXIT INT TERM
  wait $SERVER_PID

else
  # ── Fallback: ngrok (has browser interstitial warning) ──────────────────────
  echo "  ⚠️  cloudflared not found — falling back to ngrok instructions"
  echo ""
  echo "  To remove the ngrok warning page (free, no account):"
  echo "    brew install cloudflared"
  echo "  Then re-run ./start.sh"
  echo ""
  echo "  Or use ngrok in a second terminal:"
  echo "    npx ngrok http $PORT"
  echo "  Then visit: http://localhost:$PORT/qr?url=<your-ngrok-url>"
  echo ""
  echo "  ─────────────────────────────────────────────────────"
  echo "  For a persistent URL using ashikaverma.com (optional):"
  echo "    1. Add ashikaverma.com to Cloudflare (free)"
  echo "    2. Run: cloudflared tunnel login"
  echo "    3. Run: cloudflared tunnel create talk"
  echo "    4. Set TUNNEL_HOSTNAME=talk.ashikaverma.com in this script"
  echo "  ─────────────────────────────────────────────────────"
  echo ""

  trap "kill $SERVER_PID 2>/dev/null; wait 2>/dev/null" EXIT INT TERM
  wait $SERVER_PID
fi
