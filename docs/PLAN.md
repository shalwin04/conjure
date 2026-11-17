# Build plan

Deadline: **Nov 18, 2026, 12:00 PM PST** (Nov 19, 1:30 AM IST). No changes
after submission; judging uses the build at the deadline. We're ahead of the
original plan: days 1–3 of server and engine work landed on Nov 10.

## Status

- [x] **Day 1 (Nov 10):** IWSDK scaffold, hand tracking, `strike` / `press`
      with forgiving rules, synth voices, kalimba + drum kit presets, assembly
      animation, hit effects.
- [x] **Day 2–3 work (Nov 10):** LangGraph.js agent graph (Router, Designer,
      Editor, Repairer + validate / playtest / autofix / commit nodes), provider
      registry (Meta + Gemini adapters, per-role config, fallbacks), replay mode,
      SSE API + local dev server + Vite proxy, headset streaming client and
      desktop overlay, 24 tests.
- [x] **Nov 11–13:** live Meta path working (Muse Spark 1.2 default after latency
      probes), `repeat` shortcut, orb + status label + ghosts, instant edits,
      stage + framing + materials pass. Split design measured slower → opt-in.
- [x] **Nov 14 (realism):** organic shapes (lathe, tube, blob, frustum), radial
      repeat, motion, jelly / organic / crystal / pearl styles, jellyfish
      blueprint, multi-side playtest; Researcher + Verify (library / cache /
      web-grounded search) and snapshot Critic refinement round.
- [x] **Nov 14 (night):** latency fixes (blueprint fast path, timeline logs,
      budgets 90 s / 75 s, one repair round), Gemini + Meta hybrid profile with
      cross-provider fallback, worlds (terrain, ambient, wander/orbit,
      reactions, palm holding, Volcano Isle blueprint, world-aware prompt).
- [x] **Sun 15 (early):** Gemini measured 7-8x faster than Meta on design (4.5 s vs
      33-40 s): router + editor moved to Gemini too. Spatial worlds: step inside
      (life-size, sky + fog), endless chunked terrain, deterministic kit scatter,
      AI areas (`/api/area`) streamed ahead of the user, wishes build where you
      look, world navigation for hands / controllers / keyboard, soundscape.
- [x] **Sun 15 (night):** fixed "can't move" (every wish is a world now, any creation
      can be entered, keyboard works in the emulator) and silent eruptions (sound
      distance scales with the world). Realistic assets (ez-tree trees + procedural
      volcano, houses, characters…), Preetham sky, sun/moon lighting, grass, ground
      detail, collision, 40× scale. Story worlds: Story Director, Gemini TTS narrator,
      chapters with generated places and a guiding wisp. Verified rendering headlessly.
- [x] **Mon 16 (night):** Gemini structured fix (one system message), router fast path.
      Holodeck-style World Planner: scene plan + story in one call, layout solver
      (relations, real sizes, sightline, spawn), worlds up to ~45 m, table fit, auto
      step-inside, Step inside button, prompt bar gives the keyboard back.
- [x] **Mon 16 (early):** the game: 5-chapter cozy quests (wake, talk, find, collect, melody, choose), next place
      prebuilt, engine-placed pieces, stars + hints, endings by choice; subtitles, transcript, quest card, title
      cards, end screen; headset captions.
- [ ] **Mon 16:** playtest the game end to end with generated worlds; deploy; voice input later.
- [ ] **Mon 16:** voice (pinch-to-talk + transcription), Vercel deploy, outside testers.
- [ ] **Tue 17:** demo video + Devpost write-up. **Wed 18:** submit (by Nov 19, 1:30 AM IST).
- Dropped for time: shelf + share codes, grab/hover verbs, split design tuning.

Older day-by-day plan (kept for reference):

- [ ] **Day 2 (Nov 11):** Add `MODEL_API_KEY`; run the live path; tune the
      Designer prompt on 10 wishes; measure Muse Spark latency per reasoning
      level; headset stage UI around the orb (Listening → Designing → Building
      n → Testing → Fixing → Ready). Apply for Horizon Start; try emulator hands.
- [ ] **Day 3 (Nov 12):** Voice: pinch-to-talk on the orb, `/api/transcribe`
      with Muse Voice Transcribe (Web Speech API first try). Undo.
      **Gate: a creation built from voice in the emulator.**
- [ ] **Day 4 (Nov 13):** Provider contract tests on 5 hero prompts; Gemini
      fallback wired and tested; deploy to Vercel (functions + static build);
      rate limit per session. **Gate: hosted URL works end to end.**
- [ ] **Day 5 (Nov 14):** `pluck`, `slide`, `hover` verbs (+ `grab` stretch);
      remaining voices tuned; particles. Post URL for testers (Developer Forum,
      Start community).
- [ ] **Day 6 (Nov 15):** 5 hero creations polished; shelf + figurines + share
      codes; first-five-minutes flow (ghost hand, suggestion chips).
      **Gate: outside tester feedback in hand.**
- [ ] **Day 7 (Nov 16):** Apply tester feedback via tuning; bugs; record replay
      fixtures for the hero creations.
- [ ] **Day 8 (Nov 17):** Demo video (< 3 min) and Devpost write-up; final build.
- [ ] **Day 9 (Nov 18):** Submit by the evening (IST); stop deploying.

Cut list if behind (in order): script escape hatch → share codes → `grab` →
"surprise me" → combine figurines → parallel part builders.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Hit feel untested on a real headset | High | Forgiving defaults, live tuning, borrowed-headset testers by day 6 |
| Muse Spark latency for our prompts | High | Measure day 2; lower reasoning per role; move a slow role to Gemini by config |
| LLM output malformed or ugly | Medium | Per-line zod validation, playtest + Repairer, curated palettes/styles |
| Provider switch breaks output | Medium | Plain-text NDJSON, flat edit schema, contract tests |
| Voice unavailable in Quest browser | Medium | Server transcription; typed overlay; preset chips |
| Vercel functions can't host WebSockets | Low | One transcription request per utterance |
| Vercel bundling of shared `src/` imports | Low | Verify on day 4; fall back to a single bundled function |
| API cost during judging | Low | Rate limit, spending cap, replay fixtures |

## Submission checklist

- [ ] Hosted WebXR build on Vercel, stable URL, works in Quest browser
- [ ] Demo video < 3 min, public YouTube, headset or IWSDK emulator
- [ ] Tagline (140 chars): "Say it, play it: describe any instrument or toy and an AI builds it in mixed reality for your bare hands to play."
- [ ] Description ≤ 500 words; track Entertainment; division New Experience
- [ ] How hand interactions work (from PRODUCT.md)
- [ ] Team names, emails, roles
