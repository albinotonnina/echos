import type { EchosPlugin, PluginContext } from '@echos/core';
import { createSaveYoutubeTool } from './tool.js';

export { processYoutube, extractVideoId } from './processor.js';

const youtubePlugin: EchosPlugin = {
  name: 'youtube',
  description: 'YouTube video transcript extraction and saving',
  version: '0.1.0',

  setup(context: PluginContext) {
    return [createSaveYoutubeTool(context)];
  },
};

export default youtubePlugin;
