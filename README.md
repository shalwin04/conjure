# Conjure

Say it, play it: describe an instrument or toy out loud, an AI agent builds it
in mixed reality, and you play it with your bare hands.

Entry for the Meta VR Start Developer Competition 2026 (Entertainment track,
New Experience). Built on the Immersive Web SDK (IWSDK, WebXR).

## Run it

```bash
npm install
cp .env.example .env.local    # add MODEL_API_KEY (dev.meta.ai); empty = replay mode
npm run server                # agent server (LangGraph.js) on :8787
npm run dev                   # IWSDK dev server + emulator, proxies /api
npm test && npm run typecheck
```

Type a wish in the bottom bar, or enter XR and play with the emulated hands.
Keys: `1` kalimba, `2` drum kit, `3` jellyfish, `4` xylophone, `5` Volcano Isle (world), `a` replay assembly, `r` recenter.

## How it works

The AI never writes rendering code. A LangGraph.js agent graph (Router →
Designer or Editor → validate → self-playtest → Repairer) produces a
**Creation Spec**: parts with a shape, position, interaction verb and sound.
The headset turns it into geometry, hand interactions, sound and effects, and
parts stream in while the model is still writing. Models are swappable per
role (Meta Muse Spark by default, Gemini by config).

Docs: [docs/](docs/README.md) — product, architecture, agents, providers,
creation spec, plan, development.
