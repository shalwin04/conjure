# Architecture

Three tiers. The headset renders, tracks hands and makes sound locally; a thin,
stateless server runs the agent graph; the model only ever returns spec JSON.
Once a creation is built, playing it needs no network.

```mermaid
flowchart LR
  subgraph Quest["Quest browser (WebXR, IWSDK)"]
    V[Voice input] --> C[Conjure client]
    H[Hand tracking + verbs] --> S[Synth + FX]
    C --> R[Creation renderer]
    R --> H
  end
  subgraph Server["Agent server (Node, LangGraph.js)"]
    API["/api/conjure (SSE)"] --> G[Agent graph]
  end
  subgraph Model["LLM provider"]
    M[Meta Model API: Muse Spark]
    GM[Gemini (switch / fallback)]
  end
  C -- "POST text + current spec" --> API
  API -- "events: plan, part, playtest, commit" --> C
  G <--> M
  G -. config .-> GM
```

## Request flow

1. User speaks (or types in the desktop overlay). Client sends text, the current
   spec and the last-touched part to `POST /api/conjure`.
2. The graph routes it (create / edit / chat).
3. The Designer streams NDJSON; each line is validated and sent to the headset
   as a `part` event immediately, so parts appear while the model writes.
4. Validator and Playtester run; failures go to the Repairer (max 2 rounds),
   then engine auto-fix.
5. `commit` carries the final spec; the headset swaps in anything that changed.

## Code layout

```
src/                     headset (IWSDK app)
  spec/schema.ts         Creation Spec (zod) + engine rules        [shared]
  spec/edits.ts          apply edit ops                             [shared]
  spec/protocol.ts       request + server-sent event types          [shared]
  spec/presets.ts        hand-built creations / few-shot examples   [shared]
  engine/verbs.ts        strike/press hit logic                     [shared]
  engine/playtest.ts     virtual-fingertip self-test                [shared]
  engine/transform.ts    pure-TS part matrices                      [shared]
  engine/terrain.ts      island + endless height field              [shared]
  engine/chunks.ts       chunk grid, world kit, deterministic scatter [shared]
  engine/hands.ts        WebXR joints -> tips, pinch, palm pose
  world/navigator.ts     moves/turns/scales the world: table, palm, inside
  world/streamer.ts      streams chunks, props and AI areas around the user
  audio/soundscape.ts    wind, waves, birds, crickets, footsteps
  audio/synth.ts         Web Audio voices
  render/                meshes, styles, palettes, effects, field.ts (chunk ground, sea, sky)
  net/conjure-client.ts  POST + SSE reader
  ui/hud.ts              desktop/emulator overlay
  conjure-system.ts      ECS system tying it together
server/                  agent server
  graph/                 state, graph wiring, code nodes
  agents/                router, designer, editor, repairer, critic, area (endless worlds)
  llm/                   provider registry + adapters
  prompts/               system prompts (generated from the schema catalogue)
  http.ts                web-standard handlers (shared by dev + Vercel)
  dev-server.ts          local server; Vite proxies /api to it
api/                     Vercel function entry points
tests/                   vitest
```

Shared code is the key design choice: the server's playtest runs the exact
`verbs.ts` the headset runs, so what passes on the server plays on the headset.

## Biomes and cities (world variety)

Every world has a `terrain.biome`: meadow, forest, autumn, snow, desert, tropical, city, village or fantasy.
The World Planner sets it (the wish's own words win when they say city, desert or snow, see
`guessBiome`). The biome drives, in `src/engine/biome.ts`, the ground colours, grass density and colour,
sky haze and dust, and which props fill the endless land (`fillers` in `chunks.ts`): cacti and tents in a
desert, maples in autumn, frosted pines in snow, crystals and giant mushrooms in fantasy.

Cities follow the classic procedural-city pipeline, kept small (`src/engine/city.ts`): streets run along
every chunk edge (asphalt ribbons with sidewalks in `field.ts`), each chunk is one block of 3×3 lots,
perimeter lots get a building or (downtown, where a noise field is high) a glass tower facing the street,
the middle lot is a pocket park, plaza or market, and street lamps and parked cars line the streets.
The layout solver keeps the AI's own objects off the roads, turns buildings to face the street and lands
you in the avenue. Story places and AI areas clear the props around them (`WorldStreamer.clearAround`).

New procedural assets: building, skyscraper (canvas facade textures with lit windows that glow at dusk),
car, streetlamp, bench, cactus, tent, windmill, stall, fountain, balloon, maple, snowpine.

## Chapter flow

A chapter's goal counts whenever it is touched, even while the narrator is speaking (the line is cut short).
Places for wake and talk chapters always get an engine-placed goal (`g{i}-goal`), so a chapter never depends
on the AI remembering to include it. A flow token stops a stale narration from changing a newer chapter.

## Voice input

Push-to-talk from Space or the HUD orb (desktop), the left X/Y button (controllers), or a left-hand pinch held
with the palm toward your face (hands). `src/voice/mic.ts` records 16 kHz mono PCM and ends the clip after
0.9 s of silence or 12 s; the WAV goes to `POST /api/listen`, where one Gemini call returns the transcript
and a `VoiceCommand` (`src/spec/voice.ts`). The Quest browser has no Web Speech recognition, so the audio
path is used everywhere. Plain control phrases ("stop", "turn around", "go north", "take me to the fountain")
are matched by a local grammar (`parseLocal`), which wins over the model for those.

Commands: conjure (new world, add, edit), go (to a named thing or story place, resolved against nearby part
labels and chapter places), move, walk / stop, turn, speed, home, next (to the current chapter's place),
inside / outside, hint, repeat, choose. Travel is an eased glide (`Navigator.travelTo`, about 10 m/s, at
most 3.5 s) that turns you to face where you are going; "stop" or touching the stick cancels it.

## Race tracks and richer stories

`terrain.track` ("circuit" or "oval", set by the planner or by racing words in the wish, see `guessTrack`) adds a
closed loop around the world (`src/engine/track.ts`): asphalt with red-and-white kerbs and a chequered start line,
level ground beside it, and two layout places: `on_track` (the starting grid, the start-lights gantry) and
`trackside` (grandstands, pit garages, floodlights, tyre walls, facing the track). You land on the grid looking
down the start straight. New assets: racecar, grandstand, floodlight, gantry, tyres, garage.

Stories: `coerceStory` now repairs nulls and missing lines (before, most model stories were silently rejected
and every world fell back to the same template). Two new chapter kinds: `gates` (pass glowing gates in order;
on a race track at home they go round the lap) and `seek` (hide and seek: a shy friend hides three times). A
chapter's `item` picks what its items, goal or hider look like. Chapters 2–4 must be three different kinds, and
names and places must come from the wish. The offline template mixes its middle chapters per world.
