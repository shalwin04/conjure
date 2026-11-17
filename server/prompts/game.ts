/** The story-game rules, shared by the World Planner and the Story Director. */
import { ASSETS } from '../../src/spec/schema.js';

export const GAME_RULES = `A short, gentle, cozy quest of 5 chapters, spoken aloud by a warm narrator and played by walking
and touching. Tone: kind, cozy and full of wonder (think Studio Ghibli or a bedtime story): no danger, no villains, no
fear; mysteries are gentle and everyone is friendly. Short sentences written for the ear.
- title, intro (1-2 sentences that set up a gentle mystery that belongs to THIS world), ending (1-2 sentences).
- chapters (exactly 5), each with "title", "kind", "goal" (short instruction), "hint" (one sentence), "payoff" (1-2
  sentences that give a REASON to go on: a clue, a sound far away, someone asking for help). Kinds:
    wake:    touch "target"                  talk: touch a character "target" who speaks the payoff ("speaker")
    collect: gather "count" (3-4) items named "target" ("Lost star", "Spare wheel nut")
    melody:  hear a tune on bells and play it back
    choose:  "options": exactly 2 of {"label", "payoff", "ending"}; both kind; the choice changes the ending
    gates:   pass through "count" (3-5) glowing gates in order: a race, a parade, a flight, a lap of honour
    seek:    hide and seek with a shy friend named "target" who hides 3 times ("Pip the pit-lane puppy")
  "item" (optional): what the items / goal / hider look like, one of: ${ASSETS.join(', ')}.
- Chapter 1 and chapter 5 happen HOME (no "place"); their "target" is one of the world's things (its id).
  Chapter 1 = wake or talk (a gentle start). Chapter 5 = the finale back home (talk or wake).
- Chapters 2, 3, 4: THREE DIFFERENT kinds chosen from collect, melody, choose, gates, seek (choose at most once).
  Each happens in a NEW place: "direction" (north|east|south|west, vary them), "place" (one vivid sentence about a
  spot that belongs to this world, e.g. for a race circuit: the pit lane garages, the old grandstand, the paddock
  at night) and "arrive" (said when the user gets there).
  In a world with a race track a gates chapter may instead happen HOME (no place): its gates go round the track.
- Everything must come from THIS wish: names, items, characters and places. Never reuse generic "lost lights" or
  "glass bells" unless the world is about them. The engine places the items, gates, bells, hiders and choices.`;
