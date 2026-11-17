/**
 * Model registry: the only place that knows which provider serves which role.
 * Agents call chatModel / structuredModel / toolModel and never import a provider.
 *
 * Config (env):
 *   LLM_DEFAULT=meta:muse-spark-1.3        default for every role
 *   LLM_DESIGNER=gemini:<model>            per-role override (ROUTER, RESEARCHER, PLANNER, BUILDER, DESIGNER, EDITOR, REPAIRER, CRITIC)
 *   LLM_FALLBACK=gemini:<model>            used automatically if the primary call fails
 *   LLM_REASONING_<ROLE>=low               override the role's reasoning level
 *   LLM_PROFILE=hybrid|meta|gemini         hybrid (default when both keys exist): Gemini Flash for the
 *                                          roles you wait on, Muse Spark for judgment roles
 * Resolution order: LLM_<ROLE> > LLM_PROFILE > LLM_DEFAULT. Failed calls fall back to the
 * other provider automatically (LLM_FALLBACK=off to disable, or provider:model to pin it).
 * With no API key configured, every role runs in fixture (replay) mode.
 */
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { RunnableLambda, type Runnable } from '@langchain/core/runnables';
import type { StructuredToolInterface } from '@langchain/core/tools';
import type { BaseMessage, AIMessageChunk } from '@langchain/core/messages';
import type { z } from 'zod';
import { DEFAULT_GEMINI_MODEL, geminiProvider } from './providers/gemini.js';
import { metaProvider } from './providers/meta.js';
import { invokeStructured } from './structured.js';
import type { ModelChoice, ModelOptions, ProviderAdapter, ProviderId, Reasoning, Role } from './types.js';
import { ROLES } from './types.js';

const PROVIDERS: Record<Exclude<ProviderId, 'fixture'>, ProviderAdapter> = {
  meta: metaProvider,
  gemini: geminiProvider,
};

/** Fastest Muse Spark in our probe (Nov 11): ~17s for a full design vs ~41s on 1.3. */
export const DEFAULT_META_MODEL = 'muse-spark-1.2';

const ROLE_DEFAULTS: Record<Role, ModelOptions> = {
  router:   { reasoning: 'minimal', temperature: 0, maxTokens: 300 },
  researcher: { reasoning: 'minimal', temperature: 0.3, maxTokens: 2000 },
  critic:   { reasoning: 'minimal', temperature: 0.2, maxTokens: 3000 },
  planner:  { reasoning: 'minimal', temperature: 0.8, maxTokens: 1500 },
  builder:  { reasoning: 'minimal', temperature: 0.6, maxTokens: 3000 },
  designer: { reasoning: 'minimal', temperature: 0.8, maxTokens: 3500 },
  editor:   { reasoning: 'minimal', temperature: 0.2, maxTokens: 2000 },
  repairer: { reasoning: 'medium', temperature: 0.2, maxTokens: 3000 },
};

export function parseChoice(value: string | undefined): ModelChoice | null {
  if (!value) return null;
  const [provider, ...rest] = value.split(':');
  if (provider === 'fixture') return { provider: 'fixture', model: 'replay' };
  if (provider !== 'meta' && provider !== 'gemini') throw new Error(`Unknown LLM provider "${provider}" in "${value}"`);
  const model = rest.join(':') || (provider === 'meta' ? DEFAULT_META_MODEL : DEFAULT_GEMINI_MODEL);
  if (!model) throw new Error(`No model id given for "${value}"`);
  return { provider, model };
}

/** Roles on the critical path (the user is waiting) go to the fastest provider in hybrid mode. */
// Everything the user waits on goes to Gemini; Meta keeps the background judgment roles.
const FAST_ROLES: readonly Role[] = ['router', 'editor', 'designer', 'researcher', 'planner', 'builder'];

function profileChoice(role: Role): ModelChoice | null {
  const both = metaProvider.available() && geminiProvider.available();
  const profile = process.env.LLM_PROFILE ?? (both ? 'hybrid' : '');
  if (profile === 'meta') return { provider: 'meta', model: DEFAULT_META_MODEL };
  if (profile === 'gemini') return { provider: 'gemini', model: DEFAULT_GEMINI_MODEL };
  if (profile === 'hybrid') {
    return FAST_ROLES.includes(role) && geminiProvider.available()
      ? { provider: 'gemini', model: DEFAULT_GEMINI_MODEL }
      : { provider: 'meta', model: parseChoice(process.env.LLM_DEFAULT)?.model ?? DEFAULT_META_MODEL };
  }
  return null;
}

export function resolveRole(role: Role): ModelChoice {
  const explicit = parseChoice(process.env[`LLM_${role.toUpperCase()}`]) ?? profileChoice(role) ?? parseChoice(process.env.LLM_DEFAULT);
  const choice = explicit ?? (geminiProvider.available() && !metaProvider.available()
    ? { provider: 'gemini' as const, model: DEFAULT_GEMINI_MODEL }
    : { provider: 'meta' as const, model: DEFAULT_META_MODEL });
  if (choice.provider !== 'fixture' && !PROVIDERS[choice.provider].available()) {
    return { provider: 'fixture', model: 'replay' };
  }
  return choice;
}

export function isFixture(role: Role) {
  return resolveRole(role).provider === 'fixture';
}

function optionsFor(role: Role): ModelOptions {
  const override = process.env[`LLM_REASONING_${role.toUpperCase()}`] as Reasoning | undefined;
  return { ...ROLE_DEFAULTS[role], ...(override ? { reasoning: override } : {}) };
}

function build(choice: ModelChoice, role: Role): { model: BaseChatModel; adapter: ProviderAdapter } {
  if (choice.provider === 'fixture') throw new Error(`Role ${role} is in fixture mode; no model to build`);
  const adapter = PROVIDERS[choice.provider];
  return { model: adapter.create(choice.model, optionsFor(role)), adapter };
}

/** The backup for a role: LLM_FALLBACK if pinned, otherwise the other provider. */
export function fallbackChoice(role: Role): ModelChoice | null {
  const setting = process.env.LLM_FALLBACK ?? 'auto';
  if (setting === 'off') return null;
  if (setting !== 'auto') return parseChoice(setting);
  const primary = resolveRole(role);
  if (primary.provider === 'meta') return geminiProvider.available() ? { provider: 'gemini', model: DEFAULT_GEMINI_MODEL } : null;
  if (primary.provider === 'gemini') return metaProvider.available() ? { provider: 'meta', model: parseChoice(process.env.LLM_DEFAULT)?.model ?? DEFAULT_META_MODEL } : null;
  return null;
}

function fallbackFor(role: Role) {
  const fb = fallbackChoice(role);
  if (!fb || fb.provider === 'fixture') return null;
  const primary = resolveRole(role);
  if (fb.provider === primary.provider && fb.model === primary.model) return null;
  if (!PROVIDERS[fb.provider].available()) return null;
  return build(fb, role);
}

/** Plain chat model for text streaming (Designer NDJSON). */
export function chatModel(role: Role): Runnable<BaseMessage[], AIMessageChunk> {
  const primary = build(resolveRole(role), role).model;
  const fb = fallbackFor(role);
  return (fb ? primary.withFallbacks([fb.model]) : primary) as unknown as Runnable<BaseMessage[], AIMessageChunk>;
}

/**
 * Model that returns a zod-validated object. Uses each provider's preferred
 * structured-output mode and falls back to prompt-and-parse if it is rejected,
 * then to LLM_FALLBACK if the primary provider fails entirely.
 */
export function structuredModel<T extends z.ZodTypeAny>(role: Role, schema: T, name: string): Runnable<BaseMessage[], z.infer<T>> {
  const primaryChoice = resolveRole(role);
  const primary = build(primaryChoice, role);
  const fb = fallbackFor(role);
  const fbChoice = fallbackChoice(role);
  // Each attempt gets its own time limit, so a slow fallback can't eat the whole request budget.
  const limit = Number(process.env.STRUCTURED_TIMEOUT_MS ?? 30_000);
  const bounded = (signal?: AbortSignal) => (signal ? AbortSignal.any([signal, AbortSignal.timeout(limit)]) : AbortSignal.timeout(limit));
  return RunnableLambda.from(async (messages: BaseMessage[], config) => {
    const signal = config?.signal;
    try {
      return await invokeStructured(`${primaryChoice.provider}:${primaryChoice.model}`, primary.model,
        primary.adapter.capabilities.structuredOutput, schema, name, messages, bounded(signal));
    } catch (err) {
      if (!fb || signal?.aborted) throw err;
      console.warn(`[llm] ${role} primary failed, trying fallback`, err instanceof Error ? err.message : err);
      return invokeStructured(`${fbChoice!.provider}:${fbChoice!.model}`, fb.model,
        fb.adapter.capabilities.structuredOutput, schema, name, messages, bounded(signal));
    }
  }) as unknown as Runnable<BaseMessage[], z.infer<T>>;
}

/** Model bound to tools (Repairer). */
export function toolModel(role: Role, tools: StructuredToolInterface[]): Runnable<BaseMessage[], AIMessageChunk> {
  const bind = ({ model }: ReturnType<typeof build>) => {
    if (!model.bindTools) throw new Error('Model does not support tool calling');
    return model.bindTools(tools);
  };
  const primary = bind(build(resolveRole(role), role));
  const fb = fallbackFor(role);
  return (fb ? primary.withFallbacks([bind(fb)]) : primary) as unknown as Runnable<BaseMessage[], AIMessageChunk>;
}

/** Safe summary for /api/health (no keys). */
export function describeModels() {
  return Object.fromEntries(ROLES.map((r) => {
    const c = resolveRole(r);
    const fb = fallbackChoice(r);
    return [r, { ...c, reasoning: optionsFor(r).reasoning, fallback: fb && fb.provider !== 'fixture' ? `${fb.provider}:${fb.model}` : '-' }];
  }));
}
