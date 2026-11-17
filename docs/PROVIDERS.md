# LLM provider layer

Meta's Muse Spark runs the agents today; switching any role to Gemini is a
config change. Agents only use LangChain's chat-model interface
(`.stream()`, `.withStructuredOutput()`, `.bindTools()`), and
`server/llm/models.ts` is the only file that knows which provider serves which role.

## Meta Model API

OpenAI-compatible at `https://api.meta.ai/v1`, so `ChatOpenAI` works with a
custom base URL (`server/llm/providers/meta.ts`). Supports streaming, tool
calling, structured output and `reasoning_effort` (`minimal` … `xhigh`), which
LangChain sends from `reasoning: { effort }`. Key: `MODEL_API_KEY` from dev.meta.ai.

## Hybrid profile (default with both keys)

| Roles | Provider | Why |
| --- | --- | --- |
| router, editor, designer, researcher, planner, builder | Gemini Flash (`GEMINI_MODEL`) | On the critical path: the user is waiting |
| repairer, critic | Meta Muse Spark | Judgment roles, off the waiting path; the critic runs after the user can already play |

Measured Nov 14 (`npm run probe`, designer prompt, minimal reasoning): Gemini 3.6 Flash 4.5–4.8 s total (first text 1.3–1.8 s); Muse Spark 1.2 32.7–39.9 s (first text 29.7–36.2 s); a tiny reply took 2.4 s on Gemini and 3.7 s on Meta.

Each role automatically falls back to the other provider (`LLM_FALLBACK=auto`).
Research uses each provider's own grounding: Gemini `google_search` or Meta's
Responses API `web_search`. Gemini thinking is set with `thinkingLevel`
(`GEMINI_THINKING=level|budget|off`). Gemini structured output uses
prompt-and-validate (`text` mode) because its function schemas reject some zod unions.

## Configuration

```bash
LLM_PROFILE=hybrid                     # hybrid | meta | gemini
LLM_DEFAULT=meta:muse-spark-1.2        # every role not covered above
LLM_DESIGNER=gemini:<model id>         # per role: ROUTER, PLANNER, BUILDER, DESIGNER, EDITOR, REPAIRER
LLM_REASONING_DESIGNER=minimal         # per-role reasoning override
LLM_FALLBACK=gemini:<model id>         # automatic fallback on errors / rate limits
GOOGLE_API_KEY=...                     # needed for gemini
```

A role whose provider has no key runs in replay mode. `GET /api/health` shows
the resolved provider, model and settings for every role (never keys).

| Role | Default | Reasoning | Temperature |
| --- | --- | --- | --- |
| router | muse-spark-1.2 | minimal | 0 |
| planner | muse-spark-1.2 | minimal | 0.8 |
| builder | muse-spark-1.2 | minimal | 0.6 |
| designer | muse-spark-1.2 | minimal | 0.8 |
| editor | muse-spark-1.2 | minimal | 0.2 |
| repairer | muse-spark-1.2 | medium | 0.2 |

Measured Nov 11 (designer prompt, "crystal marimba"): Spark 1.2 ≈ 9 s, Spark
1.3 ≈ 22–27 s. Almost all of it is hidden reasoning before the first token;
`reasoning_effort` barely changes it, so the levers are model choice, smaller
tasks per call (planner + parallel builders) and less to work out (`repeat`).
Muse Spark counts reasoning against the token cap, so Conjure sends no cap by
default (`META_MAX_TOKENS` to set one).

## Rules that keep switching cheap

- Designer output is plain-text NDJSON parsed by our own `NdjsonParser`, not
  provider JSON streaming, so it behaves the same on any model.
- Edit ops use a flat schema (no unions at the top level) so every provider's
  structured output / function calling can produce them.
- Each adapter declares capabilities (structured-output method, tools, reasoning).
- Structured output (`server/llm/structured.ts`): Meta's API only accepts
  `tool_choice: "auto"`, so LangChain's forced function calling fails there.
  Meta uses `response_format` JSON schema; if a provider rejects a mode at
  runtime, that provider drops to text mode (prompt for JSON, parse, validate
  with zod, retry once) for the rest of the process.
- One abstract reasoning level per role; adapters map it (Gemini currently ignores it).
- `withFallbacks()` wraps primary + fallback for text, structured and tool calls.
- Contract tests (Day 4): the 5 hero prompts must pass validate + playtest on
  every configured provider before a switch is accepted.

## Voice

Primary: `muse-voice-transcribe-1.0`, push-to-talk; the headset records 16 kHz
mono PCM, `/api/transcribe` forwards it (realtime socket
`wss://api.meta.ai/v1/asr/realtime` in push-to-talk mode, or batch if available).
First try: the browser's Web Speech API.

## Cost and limits (third-party summary of Meta list prices, Oct 14, 2026)

- Muse Spark 1.3 Standard: $1.25 in / $4.25 out per 1M tokens; 3,000 req/min,
  4M tokens/min per team.
- Contributor tier: $0.10 / $0.20, but Meta may train on prompts. Dev only.
- Voice transcription: $0.18 / hour. No free tier: set a spending cap.

Sources: developer.meta.com/ai/products/meta-model-api ·
docs.litellm.ai/docs/providers/meta · orcarouter.ai/blog/muse-api
