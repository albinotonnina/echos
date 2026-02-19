/**
 * Resolves a user-supplied model spec string to a pi-ai Model object.
 *
 * Supported formats:
 *   "claude-3-5-haiku-20241022"        → inferred provider (anthropic)
 *   "gpt-4o"                           → inferred provider (openai)
 *   "anthropic/claude-sonnet-4-5"      → explicit provider
 *   "openai/gpt-4o"                    → explicit provider
 *
 * Falls back to anthropic for unrecognised prefixes.
 */

import { getModel } from '@mariozechner/pi-ai';
import type { Model } from '@mariozechner/pi-ai';

function inferProvider(modelId: string): string {
  if (modelId.startsWith('claude-') || modelId.startsWith('claude')) return 'anthropic';
  if (
    modelId.startsWith('gpt-') ||
    modelId.startsWith('o1') ||
    modelId.startsWith('o3') ||
    modelId.startsWith('o4') ||
    modelId.startsWith('chatgpt-')
  )
    return 'openai';
  if (modelId.startsWith('gemini-')) return 'google';
  if (modelId.startsWith('grok-')) return 'xai';
  if (modelId.startsWith('mistral-') || modelId.startsWith('mixtral-')) return 'mistral';
  return 'anthropic';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveModel(spec: string): Model<any> {
  let provider: string;
  let modelId: string;

  if (spec.includes('/')) {
    const slashIndex = spec.indexOf('/');
    provider = spec.slice(0, slashIndex);
    modelId = spec.slice(slashIndex + 1);
  } else {
    provider = inferProvider(spec);
    modelId = spec;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return getModel(provider as any, modelId as any) as Model<any>;
}

export const MODEL_PRESETS = {
  fast: 'claude-3-5-haiku-20241022',
  balanced: 'claude-sonnet-4-5',
  deep: 'claude-opus-4-5',
} as const;

export type ModelPreset = keyof typeof MODEL_PRESETS;

export const MODEL_PRESET_NAMES = Object.keys(MODEL_PRESETS) as ModelPreset[];
