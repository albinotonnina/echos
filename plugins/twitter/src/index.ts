import type { EchosPlugin, PluginContext } from '@echos/core';
import { createSaveTweetTool } from './tool.js';

export { processTweet, extractTweetId } from './processor.js';

const twitterPlugin: EchosPlugin = {
  name: 'twitter',
  description: 'Twitter/X tweet and thread extraction',
  version: '0.1.0',

  setup(context: PluginContext) {
    return { tools: [createSaveTweetTool(context)] };
  },
};

export default twitterPlugin;
