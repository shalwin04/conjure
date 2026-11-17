# Conjure documentation

Say it, play it: describe an instrument or toy out loud, an AI agent builds it in
mixed reality, and you play it with your bare hands. Entry for the Meta VR Start
Developer Competition 2026 (Entertainment track, New Experience; deadline
Nov 18, 2026, 12:00 PM PST).

| Doc | What's in it |
| --- | --- |
| [PRODUCT.md](PRODUCT.md) | Experience, first five minutes, interaction verbs, art and sound direction |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System overview: headset, agent server, model provider, data flow |
| [AGENTS.md](AGENTS.md) | Agent architecture decision, the LangGraph.js graph, each agent and node |
| [PROVIDERS.md](PROVIDERS.md) | LLM provider layer: Meta Model API, switching to Gemini, fallbacks, cost |
| [CREATION-SPEC.md](CREATION-SPEC.md) | The JSON contract the AI writes, edit ops, server-sent events |
| [PLAN.md](PLAN.md) | 9-day build plan, status, gates, risks, submission checklist |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Running locally, env vars, tests, deploying |
| [TESTING.md](TESTING.md) | Step-by-step testing for VR newcomers: agent, desktop, emulator, Quest |

The living product spec (with diagrams and comments) is the shared Claude doc
"Conjure — Product & Architecture Spec". These files are the in-repo copy for
developers; keep them in step when decisions change.
