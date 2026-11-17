# Creation Spec

The single contract between the AI and the engine (`src/spec/schema.ts`). The AI
never writes rendering code; the engine turns this into geometry, hand
interactions, sound and effects, and enforces its own rules on top.

## Creation

```typescript
interface Creation {
  id: string; title: string; version: number;
  palette: 'aurora' | 'ember' | 'lagoon' | 'candy' | 'forest' | 'dusk' | 'mono' | 'sunrise';
  style: 'glass' | 'clay' | 'neon' | 'wood' | 'metal';
  narration: string[];      // shown while building
  parts: Part[];            // 1..24
}

interface Part {
  id: string; label?: string;
  shape: { kind: 'cylinder', radius, height } | { kind: 'box', size: [w,h,d] }
       | { kind: 'sphere', radius } | { kind: 'torus', radius, tube }
       | { kind: 'cone', radius, height } | { kind: 'capsule', radius, length }
       // organic shapes
       | { kind: 'lathe', profile: [r, y][] }            // outline spun around y: bells, domes, vases
       | { kind: 'tube', length, radius, taper?, curl?, wave? }  // hangs down: tentacles, strings, vines
       | { kind: 'blob', radius, lumps?, squash? }       // soft lumpy bodies
       | { kind: 'frustum', top, bottom, height };       // flat-topped cone
  transform: { pos: [x,y,z]; rot?: [x,y,z] /* degrees */; scale?: number };
  material?: { color?: 'base'|'accent'|'glow'|'accentRed'|'accentBlue'; glow?: number; opacity?: number };
  verb: 'strike' | 'press' | 'pluck' | 'slide' | 'grab' | 'hover' | 'none';
  sound?: { voice: 'membrane'|'noise'|'metal'|'pluck'|'bell'|'pad'|'bass'|'theremin'|'fx';
            pitch?: number | string /* Hz or "C4" */; decay?: number; tone?: number; gain?: number };
  fx?: ('squash'|'flash'|'burst'|'ripple'|'spin'|'wobble')[];
  motion?: { type: 'pulse'|'sway'|'bob'|'spin'|'flutter'; amp?: number; freq?: number; phase?: number };
  repeat?: { count; mode?: 'line'|'radial'; step?: [x,y,z]; radius?; scale?; root?; shrink? }; // expanded by the engine
}
// styles also include 'jelly' | 'organic' | 'crystal' | 'pearl'
```

Coordinates: metres from the play-zone centre in front of a seated user;
x right (−0.32..0.32), y up (−0.12..0.42), z toward the user (−0.28..0.16).
Cylinders and boxes are played on their top (+y) face; spheres, rings and
capsules from any side. `SUPPORTED_VERBS` lists what the engine plays today.

## Worlds

```typescript
{ kind: 'world',
  terrain: { style: 'island'|'hill'|'crater'|'flat'|'floating', radius /*0.08–0.3*/, height /*0–0.15*/, roughness?, water? },
  ambient: { particles?: 'none'|'fireflies'|'snow'|'rain'|'bubbles'|'leaves'|'stars', light?: 'day'|'dusk'|'night' },
  parts: Part[] }   // pos.y = height above the ground at (x, z)
// Part additions
motion?: { type: ... | 'wander' | 'orbit', radius? }
react?: { do: 'burst'|'jump'|'grow'|'spin'|'glow'|'erupt'|'rain'|'daynight'|'bloom', target?: partId }[]
```

`src/engine/terrain.ts` (shared) computes ground height, so the server's
playtest and the headset place parts identically.

**Endless worlds.** Inside a world the headset sets `terrain.field = true`
(never sent by the AI): beyond the island's radius a seeded height field
continues forever, and the island itself is unchanged. The world is split into
square chunks of 0.64 world units (`src/engine/chunks.ts`). Each chunk gets
props scattered from the world's kit (its own static props and creatures, plus
stones and flowers), deterministic per chunk, transposed to the chunk's key.
AI areas are ordinary parts designed in play-zone coordinates and offset to
their spot by `placeArea` (ids prefixed, reaction targets kept inside the area,
orbits circle the area's centre).

## Engine rules (not trusted to the AI)

Clamp into the play zone, clamp sizes (0.5–40 cm) and scale (0.25–3), rename
duplicate ids, give every interactive part a sound, max 24 parts.

## Designer output: NDJSON

```
{"type":"header","title":"Glass Drum Kit","palette":"aurora","style":"glass","narration":["Kick","Snare"]}
{"type":"part","id":"kick","shape":{"kind":"cylinder","radius":0.13,"height":0.06},"transform":{"pos":[0,-0.02,-0.06],"rot":[8,0,0]},"verb":"strike","sound":{"voice":"membrane","pitch":52,"decay":0.55}}
```

## Edit ops (`src/spec/edits.ts`)

```typescript
{ op: 'update', id, patch: { transform?: {pos?, rot?, scale?}, material?, sound?, shape?, verb?, fx?, label? } }
{ op: 'add', part }
{ op: 'remove', id }
{ op: 'set', field: 'title' | 'palette' | 'style', value }
```

## Wire protocol (`src/spec/protocol.ts`)

`POST /api/conjure` with `{ text, spec?, focusPartId? }` → `text/event-stream`:

| Event | Payload |
| --- | --- |
| `stage` | `routing`, `researching`, `designing`, `editing`, `testing`, `fixing`, `critiquing`, `ready`, `error` |
| `plan` | creation header + `source` (`live` / `fixture`) |
| `part` | one validated part + index (create path) |
| `edit` | ops applied (edit / repair path) |
| `playtest` | per-part results + round |
| `say` | short line for the user |
| `reference` | researched reference card, origin (library / cache / web / model), verified, note |
| `critique` | Critic score 0–10, verdict, number of changes |
| `commit` | final spec, ms, repair rounds, source, reference |
| `area` | title + narration of a new area (`/api/area` only) |
| `error` | message |

`POST /api/critique` with `{ text, spec, image (JPEG data URL), reference }` →
the same event stream: `stage: critiquing`, `critique`, `edit`, `playtest`,
`commit` (version + 1), or no commit if the Critic is satisfied (score ≥ 8).

`POST /api/area` with `{ world: {title, palette, style, terrain, ambient}, kit,
chunk: {x, z}, neighbors, wish? }` → `stage`, `area`, `part`… (no commit: the
headset owns areas). 404 in replay mode, 429 past `AREA_RATE` areas per
10 minutes (default 40).

**Assets.** `{ kind: 'asset', type, size, variant? }`: a realistic thing the
engine builds (types and defaults in `ASSET_INFO`, `src/spec/schema.ts`). size
is its height; its base stands at `pos`. `sanitizePart` fills a missing sound,
verb and reaction from the catalogue, so every asset is playable.

**Stories.** `POST /api/story` with `{ world, parts: [{id, label, kind}], wish? }`
→ `{ story, source }` (`Story` in `src/spec/story.ts`). `POST /api/speak` with
`{ text, who: 'narrator'|'character' }` → `audio/wav` (404 when no Google key or
`TTS=off`). Story chapters ask `/api/area` for their place with
`story: { chapter, place, target }`; the area must contain a part with id `goal`.

**Scene plans (World Planner, `src/spec/scene.ts`).** Places are not designed with
coordinates. The model writes `{ title, palette, style, terrain: {style, size, water},
ambient, objects: [{ id, label, asset, count, size, place, target?, zone? }], story }`
and `solveScene` places everything: real heights (`REAL_HEIGHT`, metres, at
40 m per world unit), placement by relation with rejection sampling (dry land,
no overlaps, big landmarks on the horizon), a `spawn` with a clear sightline to
the centre, and things facing what they relate to. Worlds may be up to 0.56 units
in radius (about 45 m across inside); the table shows them scaled to fit.

