# Product

**Pitch.** You describe anything out loud (a drum kit, a harp made of light, a
jellyfish that sings when touched). An agent builds it in passthrough in front
of you and you play it with your bare hands.

**Why VR.** The output is an object at real scale on your real desk that you
strike, pluck and press with tracked hands. On a phone it falls apart.

## Competition constraints

- Hands-first end to end; no controller ever needed.
- Seated: everything within a two-foot reach.
- Satisfying in under 10 minutes, fast cold start.
- Original code (ControlAnything inspired the pattern; none of its code is used).
- "Take it away" test: works without the AI service (preset gallery, shelf).
- Requires Meta Horizon Start membership.

Award targets: Best Agentic Interaction (primary), Boldest Original Concept,
Best First Five Minutes.

## Worlds: a living world in your palm

Say "a tiny floating island with a volcano and turtles". A miniature world
builds on the table; turn your left palm up and it floats onto your hand like
a snow globe (half size), and your right finger pokes it: the volcano erupts,
clouds rain, the sun switches day and night, turtles hop, trees shower leaves.
Every interaction is musical. Lower your hand and the world settles back.

Engine: terrain (island, hill, crater, flat, floating) coloured by height with
water; ambient particles (fireflies, snow, rain, bubbles, leaves, stars);
day / dusk / night; `wander` and `orbit` motion; reactions (`burst`, `jump`,
`grow`, `spin`, `glow`, `erupt`, `rain`, `daynight`, `bloom`) on the played part
or a linked one. Blueprint: Volcano Isle (key `5`).

## The game: describe a world, play a 5-chapter cozy quest

Type (or later, say) a world. In about 10 seconds it is built and you are inside it, and a warm narrator begins a
gentle 5-chapter quest written for that world. The tone is always cozy: no danger, no villains, only wonder.

| Chapter | Where | Play |
| --- | --- | --- |
| 1 | home (the world you made) | wake or talk: touch something there |
| 2-4 | new places built in a direction | a mix of collect (gather 3-4 glowing things), melody (listen to bells, play the tune back), choose (two options; changes the ending), find, talk |
| 5 | home again | the finale: talk to someone or wake something |

The next place is built while you play the current chapter, so there is no waiting. A chiming wisp leads the way.
The engine places collectibles, bells and choices itself, so every chapter is playable even if a place fails.
Each chapter earns up to 3 stars (minus one for asking a hint, minus one if it took long). Characters you touch give
hints in their own voice; after 50 s without progress the narrator offers one.

Interface: subtitles with the speaker's name, words lit as they are spoken; a transcript (T); a quest card with the
chapter, goal, progress, stars and a Hint button (H); chapter title cards; an end screen (ending, stars, time, play
again, create a new world). In the headset the subtitles and quest line float softly below your gaze.

## Story worlds (realistic, spoken)

Every wish becomes a world unless it is clearly an instrument ("a drum kit"),
and any creation can be stepped into. Worlds are built from **realistic
assets**: the AI only names what and how big (`{kind:'asset', type:'pine', size}`)
and the engine builds the real thing. This is the lesson of Holodeck
(CVPR 2024): language models choose objects well but write geometry badly.
Trees are procedural ez-tree models (oak, pine, aspen, ash, bush); there are
also palms, rocks, a volcano with smoke, lava and eruptions, mountains,
cottages with chimney smoke, towers, lighthouses with a turning beam, castles,
campfires, lanterns, mushrooms, crystals, flowers, characters, portals, wells,
boats, statues and clouds. Every asset comes with a sound and a reaction.

Inside, the world is life-size (40×: a 4 cm person is 1.6 m). It has a
physically based sky with clouds, a sun that moves between day, dusk and night,
stars, wind-blown grass, detailed ground, a sea and fog. Landmarks are solid,
and sounds carry as far as the world is big.

**Every world has a story.** The Story Director (Gemini) writes it from the
world's own parts: an intro, then 3 chapters. Chapter 1 is on the world itself
("Wake the sleeping volcano"). Each later chapter is a new place the world
builder creates in a direction, and a glowing wisp that chimes leads you there.
Arriving narrates the place; touching its goal plays the payoff. Characters
repeat the hint in their own voice. The ending is a celebration, then you keep
exploring. A narrator (Gemini text-to-speech) speaks every line; the text is
always shown too. Offline, a template story is used.

## Step inside: an endless world

Pull the miniature apart with both hands (or push the right stick up, or press
`I` on desktop) and the world grows around you to life size: you land on the
island's shore with the volcano towering ahead. And it never ends. Walk in any
direction and new land keeps forming:

1. **Ground, instantly.** One seeded height field, so hills and seas continue
   seamlessly in every direction.
2. **The world's own things, instantly.** Its kit (palm trees, turtles) plus
   stones and flowers, scattered deterministically per chunk. Each chunk plays
   in a slightly different key, so walking is musical.
3. **New places, a few seconds ahead of you.** The Area builder (Gemini) designs
   a landmark for the chunks you're heading toward ("Singing Tide Pools"), and
   they grow in part by part. When you reach one, it chimes and announces itself;
   nearby areas sing softly to draw you over.

Every wish you make inside builds right where you're looking: "a lighthouse
that sings" appears a few steps ahead. Edits ("make it night") still edit the
world. The soundscape changes with the world: wind gusts, waves near water,
birds by day, crickets at night, footsteps as you travel. A sky dome and fog
turn the room into the world; `K` (or `conjure.sky(false)`) keeps your room
visible around it instead.

| | Hands | Controllers (emulator keys in Play mode) | Desktop |
| --- | --- | --- | --- |
| Play something near | tap it | trigger (left mouse) | click |
| Play something far | point + pinch | trigger (left mouse) | click |
| Hold the miniature | left palm up | | |
| Step inside / out | two-hand pinch, pull apart / squeeze | right stick up / down (↑ / ↓) | `I` |
| Walk | pinch the air and pull | left stick (W A S D) or grip + drag (right mouse) | `W` / `S` |
| Turn | two-hand pinch and twist | right stick left / right (← / →), 30° snaps | `A` / `D` |
| Build here | voice (next) / prompt bar | prompt bar | prompt bar |

## First five minutes

1. **0:00** Passthrough, a glowing orb, a kalimba already on the desk.
2. **0:05** A ghost hand shows a tap; you copy it and hear a note.
3. **0:30** Pinch the orb, say "build me a drum kit", release.
4. **0:35** Parts fly in one by one while the agent narrates.
5. **0:45** Play it.
6. **1:30** "Make the snare glow red": the edit lands in seconds.
7. **3:00** Pinch-and-hold to shrink it onto your shelf.

Core loop: speak → watch it assemble → play → edit by voice → keep → recall.

## Interaction verbs

Every creation is built from hand-written verbs; the AI only chooses which verb
each part gets.

| Verb | Hand action | Status |
| --- | --- | --- |
| `strike` | Hit with speed | Done |
| `press` | Push down / release | Done |
| `pluck` | Pinch then release, or strum | Day 5 |
| `slide` | Drag along a track or twist | Day 5 |
| `grab` | Pick up, shake, throw | Day 5 (stretch) |
| `hover` | Open-palm distance | Day 5 |

Forgiving rules (tuned blind, no headset): hit zones 1.3× the visible shape,
velocity averaged over 4 frames, 60 ms cooldown per part, approach-direction
check, audible velocity floor. All live-tunable via `conjure.tuning` in the
browser console.

## Art and sound

- One style family: luminous glass and soft clay; 5 material styles and 8
  curated palettes so any AI output looks coherent.
- Every touch: squash, emissive flash, (soon) particles. No silent interaction.
- All sound synthesized live (Web Audio), spatialised per part. No samples.
