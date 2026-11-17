/**
 * Google Gemini via LangChain. In the default hybrid profile Gemini Flash
 * runs the latency-critical roles (designer, researcher). GEMINI_MODEL sets
 * the model; GEMINI_THINKING=level|budget|off controls how its thinking is set.
 */
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import type { ProviderAdapter, Reasoning } from '../types.js';

export const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.6-flash';

function thinking(reasoning: Reasoning) {
  const mode = process.env.GEMINI_THINKING ?? 'level';
  if (mode === 'off') return undefined;
  if (mode === 'budget') return { thinkingBudget: reasoning === 'minimal' ? 0 : reasoning === 'low' ? 512 : reasoning === 'medium' ? 2048 : 8192 };
  return { thinkingLevel: (reasoning === 'high' ? 'HIGH' : reasoning === 'medium' ? 'MEDIUM' : 'LOW') as 'LOW' | 'MEDIUM' | 'HIGH' };
}

export const geminiProvider: ProviderAdapter = {
  id: 'gemini',
  // Gemini's function schemas reject some zod shapes (unions); prompt-and-validate is robust and fast.
  capabilities: { structuredOutput: 'text', tools: true, reasoning: true },
  available: () => Boolean(process.env.GOOGLE_API_KEY),
  create(model, { temperature, maxTokens, reasoning }) {
    const thinkingConfig = thinking(reasoning);
    return new ChatGoogleGenerativeAI({
      model,
      apiKey: process.env.GOOGLE_API_KEY,
      temperature,
      maxOutputTokens: Math.max(maxTokens, 4096),
      streaming: true,
      maxRetries: 1,
      ...(thinkingConfig ? { thinkingConfig } : {}),
    });
  },
};
