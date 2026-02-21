# Light Room App — Setup Guide

## Before the talk

### 1. Install and run the server

```bash
cd app
npm install

# Set your WiZ bulb IPs (find them in the WiZ app → Device Settings)
HOST_KEY=ashika2025 WIZ_IPS=192.168.1.100,192.168.1.101 npm start
```

The server prints:
```
Student app: http://localhost:3000/
Host dash:   http://localhost:3000/host?key=ashika2025
```

### 2. Make the app accessible over the internet

Students need to reach your server from their phones in Texas.

Options (pick one):
- **ngrok** (easiest): `ngrok http 3000` → gives you a public URL
- **Tailscale** (if you have it set up)
- Deploy to Railway/Render/Fly.io (use the Dockerfile below)

```bash
# ngrok
npx ngrok http 3000
# Copy the https://xxx.ngrok.io URL
```

### 3. Generate the QR code

Once you have your public URL, generate a QR code pointing to it.
Free options: qr-code-generator.com or `qrencode -o qr.png "https://xxx.ngrok.io"`

Email the QR code image to the classroom coordinator the day before.

### 4. Add photos for the collage

Drop images into:
```
photos/highschool/    ← CSHS photos
photos/college/       ← MIT photos
```

Supported: `.jpg`, `.jpeg`, `.png`, `.webp`, `.gif`
The server auto-discovers them on startup.

### 5. Open the host dashboard

```
http://localhost:3000/host?key=ashika2025
```

Change the `HOST_KEY` env var to something only you know.

---

## App modes and when to switch

| Mode | When | What students see |
|------|------|-------------------|
| lobby | Before talk starts | Name entry + color picker |
| color | Opening (0:00) | Full-screen color grid |
| ambient | During story (~2:00) | Dithered background, reactions |
| photos | Photo collage | Polaroid slideshow |
| text | Open question (12:30) | "What do you love?" form + live feed |
| demo | Demo reveal (14:00) | Counter + terminal log + confetti |
| qa | Q&A (18:00) | Question form + feed |
| sendoff | End | "Make something. Show someone. Keep going." |

Switch modes from the host dashboard — big buttons, one tap each.

---

## WiZ bulb UDP protocol

The server sends UDP packets to port 38899 on each bulb IP:

```json
{
  "method": "setPilot",
  "params": { "r": 255, "g": 110, "b": 180, "dimming": 90 }
}
```

Test it manually:
```bash
echo '{"method":"setPilot","params":{"r":255,"g":0,"b":128,"dimming":80}}' | nc -u 192.168.1.100 38899
```

---

## Design system reference

Open `public/design-system-showcase.html` directly in a browser — no server needed.
All components, animations, and the palette are live there.

---

## File structure

```
app/
  package.json
  SETUP.md                    ← you are here
  public/
    index.html                ← student app
    host.html                 ← host dashboard
    design-system-showcase.html
    css/
      design-system.css       ← all CSS components + tokens
    js/
      app.js                  ← student app controller
      host.js                 ← host dashboard controller
      ws-client.js            ← WebSocket singleton
      palette.js              ← 30-color palette data
      icons.js                ← pixel art SVG icons
  server/
    server.js                 ← Node.js WS + HTTP server
```
