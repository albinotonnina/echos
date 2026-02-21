import type { EchosPlugin, PluginContext } from '@echos/core';
import { createSaveArticleTool } from './tool.js';

export { processArticle } from './processor.js';

const articlePlugin: EchosPlugin = {
  name: 'article',
  description: 'Web article extraction and saving using Readability',
  version: '0.1.0',

  setup(context: PluginContext) {
    return { tools: [createSaveArticleTool(context)] };
  },
};

export default articlePlugin;
