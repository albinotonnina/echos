import type { EchosPlugin, PluginContext } from '@echos/core';
import { join } from 'node:path';
import { StyleProfileStorage } from './style/storage.js';
import { createAnalyzeStyleTool } from './tools/analyze-style.js';
import { createContentTool } from './tools/create-content.js';
import { createGetStyleProfileTool } from './tools/get-style-profile.js';
import { createMarkVoiceExampleTool } from './tools/mark-voice-example.js';

/**
 * Content Creation Plugin
 *
 * Learns your authentic writing voice from curated examples and generates
 * content (blog posts, articles, threads, emails) that sounds like you wrote it.
 *
 * Key features:
 * - Curated voice learning from notes tagged as "voice-example"
 * - Hybrid style analysis (statistical + LLM)
 * - RAG-based content generation using your knowledge base
 * - Multiple content types (blog, thread, article, essay, tutorial, email)
 *
 * Tools provided:
 * - analyze_my_style: Learn writing voice from voice examples
 * - create_content: Generate content in your voice
 * - get_style_profile: View current style profile
 * - mark_as_voice_example: Tag a note as a voice example
 */
const contentCreationPlugin: EchosPlugin = {
  name: 'content-creation',
  description:
    'Generate content in your authentic voice using learned writing style and knowledge base',
  version: '0.1.0',

  setup(context: PluginContext) {
    const logger = context.logger.child({ plugin: 'content-creation' });

    // Determine storage path for style profile
    // Store in data/ directory (same level as core data files)
    const dataDir = process.env['ECHOS_DATA_DIR'] ?? './data';
    const profilePath = join(dataDir, 'style-profile.json');

    logger.info({ profilePath }, 'Content creation plugin initializing');

    // Create storage instance
    const storage = new StyleProfileStorage(profilePath, logger);

    // Create and return all tools
    const tools = [
      createAnalyzeStyleTool(context, storage),
      createContentTool(context, storage),
      createGetStyleProfileTool(storage),
      createMarkVoiceExampleTool(context),
    ];

    logger.info({ toolCount: tools.length }, 'Content creation plugin initialized');

    return tools;
  },
};

export default contentCreationPlugin;
