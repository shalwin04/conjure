# Testing Conjure (no headset needed)

**Terms.** *WebXR* is the browser API for VR/AR. *Entering XR* switches the page
from a normal 3D view into an immersive session. *IWER* is Meta's emulator that
fakes a Quest headset (head, hands, controllers) inside desktop Chrome, so you
can test without a headset.

Test in three layers, from simplest to most realistic. If something breaks,
the layer where it first breaks tells you where the bug is.

## 1. The agent alone (no 3D)

```bash
npm run server
```

The table should show `provider: meta` for every role. In another terminal:

```bash
curl localhost:8787/api/health
curl -N -X POST localhost:8787/api/conjure -H 'content-type: application/json' \
  -d '{"text":"build me a crystal marimba"}'
```

You should see `event: stage`, `event: plan`, several `event: part`,
`event: playtest`, then `event: commit`. Errors print in the server terminal.
If the commit says `"source":"fixture"`, the API key wasn't loaded.

## 2. Desktop 3D view (no XR)

```bash
npm run dev     # leave `npm run server` running
```

A browser window opens at `https://localhost:8081` with an emulated room and
the kalimba in front of you.

1. Click once anywhere on the page (browsers only allow sound after a click).
2. Click a kalimba tine: you should hear a note and see it flash.
3. Keys `1` / `2` switch kalimba / drum kit (click outside the text box first).
4. Type in the bottom bar: `a crystal marimba`. Watch the chip go
   Thinking → Designing 1, 2, 3… → Testing → Ready while parts fly in.
5. Edit it: `make the bars bigger`, `make it glow red`, `add a cowbell`.
6. Open DevTools (Cmd+Option+I) → Console for `[conjure]` logs.

## 3. XR in the emulator

The prompt bar sits at the bottom of the page and stays on top of the
emulator's XR view (press Esc to leave play mode, then click it). On a real
headset, voice replaces it (next step).

1. Click **Enter XR** on the welcome panel. The creation re-centres about
   40 cm in front of you and below eye level. Press `r` to re-centre.
2. In the IWER toolbar, use **Toggle input mode** to switch from controllers
   to hands.
3. Play it, two ways:
   - **Aim and pinch:** open **Select input mode** → **Gaze + Hands**. Move the
     mouse to aim, hold the left button to pinch. The part you aim at plays.
   - **Hit it with a hand:** drag a hand's transform handle down through a
     drum. Emulator drags are slow, so first lower the strike threshold in the
     console: `conjure.tuning.minStrikeSpeed = 0.05`.
4. Look around: **Play mode** locks the mouse for head look (Esc to leave);
   Shift + W/A/S/D moves the headset; **Reset device transforms** resets poses.

## 4a. The game (5 chapters)

Make a world ("a cozy fox village in autumn"), let it step you inside, and play: the quest card (top left) says what
to do, the wisp leads, T opens the transcript, H gives a hint. Console helpers for testing: `conjure.game()`
(chapter, kind, state, location), `conjure.touch(id)`, `conjure.goto(x, z)`, `conjure.parts('g1-')` (game pieces of
chapter 2), `conjure.voice(false)`.

## 4. Story worlds

1. Run `npm install` once (new dependency: `@dgreenheck/ez-tree`), then restart
   `npm run server` and `npm run dev`.
2. Press `5` (Volcano Isle), or type any place: "an erupting volcano",
   "a snowy village with a frozen lake", "a sleepy fox forest".
3. Press `I` (or right stick up). You land on the shore and the narrator begins
   (server log: `[story] "…" 3 chapters in …ms`, `[tts] … chars in …ms`).
4. Chapter 1: touch what it names (for Volcano Isle, the volcano: it erupts).
5. Chapter 2: follow the glowing wisp (it chimes). A new place builds ahead
   (`[area] … parts`). Arriving narrates it; touch its glowing goal.
6. Touch characters for hints. `conjure.voice(false)` mutes the narrator;
   `conjure.story()` prints the story.

## 5. Inside a world (endless, spatial)

Desktop first (fastest):
1. Press `5` (Volcano Isle) or make a world ("a snowy village with a frozen pond").
2. Press `I`: the world grows around you and you land on its shore.
3. `W`/`S` walk, `A`/`D` turn. Watch new land form ahead; after a few seconds
   AI areas grow in on nearby chunks (server log: `[area] chunk 1,-1: 9 parts ...`).
4. Click things to play them. Type "a lighthouse that sings" in the bar at the
   bottom: it is built a few steps ahead of you. `I` again to step out.

In the emulator (controllers are the default input):
1. Enter XR, then click **Play mode** (circle-play icon) so the keyboard drives
   the controllers. Esc leaves play mode.
2. `↑` (right stick up) steps inside, `↓` steps out.
3. `W A S D` (left stick) walks, `←`/`→` (right stick) snap-turns 30°.
4. Left mouse = right trigger: aim the ray and play things far away.
   Right mouse = right grip: hold and move the mouse to pull the world.
5. Shift + W/A/S/D moves the headset itself; the world streams around that too.
6. To type a wish inside, press Esc, click the bar at the bottom, type, Enter.

Hands in the emulator: **Toggle input mode** → hands. Pinch-drag in the air to
pull the world; pinch with both hands and pull apart to step inside.

Console helpers: `conjure.enter()`, `conjure.exit()`, `conjure.sky(false)`
(see your room around the world), `conjure.nav.speed = 3`,
`conjure.nav.immersiveScale = 16`, `conjure.stream.aiAreas = false`,
`conjure.ambience(false)`.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| No sound | Click the page once; check the Mac's volume |
| "Could not reach the Conjure server" | `npm run server` isn't running |
| Error text in the bottom bar | Read the server terminal for the full error |
| Creation shows "replay" | `MODEL_API_KEY` not loaded: check `.env` / `.env.local`, restart the server |
| Creation is behind you or too low | Press `r` |
| `Unsupported Node.js version` | Use Node 22.12+ or 24 (`nvm use`) |
| Server says "using text mode from now on" | Fine: the provider rejected a structured-output mode and Conjure adapted |

## Real Quest (when you borrow one)

1. Quest and Mac on the same Wi-Fi; both `npm run server` and `npm run dev` running.
2. `npx iwsdk dev status` → copy the **Network** URL (like `https://192.168.1.x:8081`).
3. Open it in the Quest browser, accept the certificate warning, tap **Enter XR**.
4. Put the controllers down: hands are tracked automatically. Tap the parts.
