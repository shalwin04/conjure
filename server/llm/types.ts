import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/** Each agent asks for a model by role; config decides provider + model. */
export type Role = 'router' | 'researcher' | 'planner' | 'builder' | 'designer' | 'editor' | 'repairer' | 'critic';
export const ROLES: readonly Role[] = ['router', 'researcher', 'planner', 'builder', 'designer', 'editor', 'repairer', 'critic'];

export type ProviderId = 'meta' | 'gemini' | 'fixture';

/** One abstract reasoning level; each provider maps it to its own parameter. */
export type Reasoning = 'minimal' | 'low' | 'medium' | 'high';

export interface ModelChoice {
  provider: ProviderId;
  model: string;
}

export interface Capabilities {
  /**
   * How to get JSON from this provider. 'functionCalling' forces a named tool
   * (unsupported by Meta); 'jsonSchema' uses response_format; 'text' asks in
   * the prompt and validates with zod. Rejected modes downgrade to 'text'.
   */
  structuredOutput: 'functionCalling' | 'jsonSchema' | 'text';
  tools: boolean;
  reasoning: boolean;
}

export interface ModelOptions {
  reasoning: Reasoning;
  temperature: number;
  maxTokens: number;
}

export interface ProviderAdapter {
  id: Exclude<ProviderId, 'fixture'>;
  capabilities: Capabilities;
  /** True when the provider's API key is configured. */
  available(): boolean;
  create(model: string, options: ModelOptions): BaseChatModel;
}
