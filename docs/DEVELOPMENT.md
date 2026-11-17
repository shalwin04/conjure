# Development

## Setup

```bash
npm install
cp .env.example .env.local   # add MODEL_API_KEY; leave empty for replay mode
```

## Run (two terminals)

```bash
npm run server   # agent server on :8787 (tsx watch)
npm run dev      # IWSDK dev server + emulator; proxies /api to :8787
```

In the browser: type a wish in the bottom bar ("a crystal marimba") or edit
what's there ("make the snare red"). In XR, tap parts with the emulated hands.
Keys outside the text box: `1` kalimba, `2` drums, `3` jellyfish, `4` xylophone, `5` Volcano Isle, `a` replay assembly, `r` recenter.
Worlds in XR: turn your left palm up to hold the world; `conjure.palm(false)` keeps it on the table, `conjure.palmSign = -1` flips palm detection.

Console helpers: `conjure.ask("a gong")`, `conjure.spec()`,
`conjure.tuning.zoneScale = 1.5`, `conjure.recenter()`.

## Check

```bash
npm run typecheck   # client + server
npm test            # verbs, playtest, edits, schema, parser, router, autofix
curl localhost:8787/api/health   # which provider/model each role uses
curl -N -X POST localhost:8787/api/conjure -H 'content-type: application/json' \
  -d '{"text":"build me a drum kit"}'
```

## Environment

See `.env.example`. Keys live only on the server; the headset never sees them.

## Deploy (Day 4)

Vercel: static build from `npm run build` (`dist/`) plus functions in `api/`
(`conjure.ts`, `health.ts`). Set `MODEL_API_KEY` (and optional Gemini vars) in
the Vercel dashboard. Confirm the function duration limit covers the 25 s budget.
