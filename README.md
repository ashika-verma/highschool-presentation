# High School Presentation

A 20-minute talk for high school women interested in coding, delivered over Zoom.

## Folder Structure

```
script/         → The talk script (edit this!)
photos/
  highschool/   → Drop high school photos here
  college/      → Drop college/MIT photos here
slides/         → Slide assets and content
app/            → The interactive web app (lobby, slides, chat, lights)
```

## The App

The presentation runs through a custom web app students open on their phones via QR code. It handles:
- **Lobby** — animated waiting room before the talk starts
- **Slides** — slides displayed on students' phones, advanced remotely
- **Chat** — custom chat instead of Zoom chat
- **Lights** — students control WiZ LED bulbs in the presenter's NYC room in real time

## Setup Before the Talk

1. Find your WiZ bulb IP addresses in the WiZ app (Device Settings → IP Address)
2. Run the app server: `cd app && npm start`
3. Share the QR code with the coordinator the day before
4. Test lights the night before
