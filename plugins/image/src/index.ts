import type { EchosPlugin, PluginContext } from '@echos/core';
import { createSaveImageTool } from './tool.js';

export { processImage } from './processor.js';

const imagePlugin: EchosPlugin = {
  name: 'image',
  description: 'Image storage and management with metadata extraction',
  version: '0.1.0',

  setup(context: PluginContext) {
    return [createSaveImageTool(context)];
  },
};

export default imagePlugin;
