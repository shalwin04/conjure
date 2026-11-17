/**
 * Meta Model API (Muse Spark). OpenAI-compatible, so LangChain's ChatOpenAI
 * talks to it with a different base URL. Chat Completions, not Responses.
 */
import { ChatOpenAI } from '@langchain/openai';
import type { ProviderAdapter } from '../types.js';

export const META_BASE_URL = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

export const metaProvider: ProviderAdapter = {
  id: 'meta',
  // Meta only accepts tool_choice "auto", so no forced function calling.
  capabilities: { structuredOutput: 'jsonSchema', tools: true, reasoning: true },
  available: () => Boolean(process.env.MODEL_API_KEY),
  create(model, { reasoning, temperature, maxTokens }) {
    return new ChatOpenAI({
      model,
      apiKey: process.env.MODEL_API_KEY,
      configuration: { baseURL: META_BASE_URL },
      useResponsesApi: false,
      streaming: true,
      temperature,
      // Muse Spark counts hidden reasoning against the token cap, so a cap can
      // starve the visible answer. Only cap if explicitly configured.
      maxTokens: process.env.META_MAX_TOKENS ? Number(process.env.META_MAX_TOKENS) : undefined,
      // Sent as `reasoning_effort` (minimal | low | medium | high | xhigh).
      // META_REASONING=off omits it entirely (provider default).
      ...(process.env.META_REASONING === 'off' ? {} : { reasoning: { effort: (process.env.META_REASONING as typeof reasoning) || reasoning } }),
      maxRetries: 1,
      timeout: 90_000,
    });
  },
};
