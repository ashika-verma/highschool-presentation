# Mixed-Media Speech Designer — Agent Memory

## Client: Ashika Verma (highschool-presentation project)
- Speaker: MIT EECS grad, AI/software in NYC
- Recurring audience type: High school women interested in CS
- Format: Zoom from NYC → Texas classroom
- Hardware: 2 WiZ smart bulbs (UDP API, local relay required)
- App stack planned: Node.js WebSocket server + vanilla JS or React frontend

## Aesthetic Preferences Confirmed
- Tone: honest, human, fun — NOT corporate, NOT TED-talk
- Ashika likes matter-of-fact reveals, not theatrical gestures
- Real room + real bulbs visible on camera (no virtual background)
- App should feel "built by a person," not like a startup product

## Lighting Patterns That Work for This Speech Type
- "Only girl" / loneliness moment: dim to one bulb, turn off second — most powerful cue in talk
- Opening chaos: both bulbs responding to last two color inputs, instant transitions
- Introspection/flow state: indigo + violet, slow pulse, 55-65% brightness
- Belonging/joy: gold (#FFD54F) + violet (#7E57C2) together — signature combo
- Demo reveal: full white at 100% — "workbench lighting" aesthetic
- Close/warmth: slow fade to single warm pink (#FF69B4), breathing pulse for Q&A

## WiZ Bulb Architecture Note
- WiZ uses UDP broadcast on port 38899 to local IPs
- For remote control: need local relay on Ashika's laptop → cloud WebSocket server
- `speed` param: 0=instant, 100=4-5s fade, 200=1-2s fade
- Find bulb IPs in WiZ app → Device Settings

## App UX Modes (for this project)
lobby → color-control → ambient → collage → poll → reveal → qa
- Each mode is server-pushed via WebSocket; clients never navigate themselves
- Host dashboard at /host?key=XXXX with single-click mode buttons
- Ambient mode: phone screens mirror bulb colors passively (no input)
- Reveal mode: show aggregate counter + scrolling named WebSocket log
- Send-off screen: "Make something. Show someone. Keep going." — pink, hold during Q&A

## Co-Location Design Principle
- Students are physically together — design for the ROOM, not individual users
- "Last color sent wins" mechanic turns color picker into a social game
- Live vote counts with names drives negotiation before students vote
- Shared aggregate counter (total color changes) gives collective ownership at reveal

## Poll Color Assignments
- Health & Bio: #4CAF50 (green)
- Fashion & Design: #9C27B0 (deep purple)
- Space & Environment: #1565C0 (navy blue)
- People & Education: #F9A825 (amber gold)

## Zoom Staging Notes
- Bulb A: key-light side (left of Ashika, aimed at wall) — drives skin tone readability
- Bulb B: fill/accent (right, further back, aimed at ceiling) — can be more adventurous
- Camera at or slightly below eye level — never above
- Font size 18pt minimum for code screen share on student phones
- Rehearse screen share → webcam transition at least 5 times

## Patterns Confirmed Across Talk Design
- Emotional dimming (not just color) carries narrative weight — use brightness as punctuation
- Two-bulb offset pulsing (2-4s out of phase) reads as "two people going back and forth"
- Transition from warm amber → cool blue reliably signals a gear shift in emotional register
- Full white at 100% is rare and striking — save it for exactly one moment (the reveal)
- Long slow fade to final color (10+ seconds) makes the ending feel earned rather than cued

## Files in This Project
- `/Users/ashikaverma/highschool-presentation/script/talk.md` — full speech script
- `/Users/ashikaverma/highschool-presentation/app/` — app directory (empty, to be built)
- `/Users/ashikaverma/highschool-presentation/photos/highschool/` — collage photos
- `/Users/ashikaverma/highschool-presentation/photos/college/` — MIT photos
