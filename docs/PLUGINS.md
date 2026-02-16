# Creating a Plugin

Plugins add content processors and agent tools to EchOS without modifying core code. Each plugin is a separate workspace package in `plugins/`.

## Steps

### 1. Scaffold the package

```bash
mkdir -p plugins/my-plugin/src
```

Create `plugins/my-plugin/package.json`:

```json
{
  "name": "@echos/plugin-my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "typecheck": "tsc --noEmit",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@echos/shared": "workspace:*",
    "@echos/core": "workspace:*",
    "@mariozechner/pi-agent-core": "^0.52.12",
    "@mariozechner/pi-ai": "^0.52.12",
    "pino": "^9.14.0",
    "uuid": "^13.0.0"
  },
  "devDependencies": {
    "@types/node": "^25.2.3",
    "@types/uuid": "^11.0.0",
    "typescript": "^5.7.0"
  }
}
```

Create `plugins/my-plugin/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src"]
}
```

### 2. Write the processor

Create `plugins/my-plugin/src/processor.ts` — the logic that fetches/transforms external content:

```typescript
import type { Logger } from 'pino';
import { validateUrl, sanitizeHtml } from '@echos/shared';
import type { ProcessedContent } from '@echos/shared';

export async function processMyContent(
  url: string,
  logger: Logger,
): Promise<ProcessedContent> {
  const validatedUrl = validateUrl(url); // SSRF prevention — required
  logger.info({ url: validatedUrl }, 'Processing content');

  // Fetch and extract content...
  const title = sanitizeHtml(rawTitle);   // Always sanitize external content
  const content = sanitizeHtml(rawContent);

  return {
    title,
    content,
    metadata: {
      type: 'note', // Use an existing ContentType or extend types
      sourceUrl: validatedUrl,
    },
    embedText: `${title}\n\n${content.slice(0, 3000)}`,
  };
}
```

**Security rules** (non-negotiable):
- Always use `validateUrl()` before fetching any URL
- Always use `sanitizeHtml()` on external content
- Never use `eval()`, `Function()`, or `vm`
- Never log secrets

### 3. Create the agent tool

Create `plugins/my-plugin/src/tool.ts` — defines the tool the LLM agent can call:

```typescript
import { Type, type Static } from '@mariozechner/pi-ai';
import type { AgentTool } from '@mariozechner/pi-agent-core';
import { v4 as uuidv4 } from 'uuid';
import type { NoteMetadata } from '@echos/shared';
import type { PluginContext } from '@echos/core';
import { processMyContent } from './processor.js';

const schema = Type.Object({
  url: Type.String({ description: 'URL to process' }),
  tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags' })),
  category: Type.Optional(Type.String({ description: 'Category' })),
});

type Params = Static<typeof schema>;

export function createMyTool(
  context: PluginContext,
): AgentTool<typeof schema> {
  return {
    name: 'save_my_content',
    label: 'Save My Content',
    description: 'Describe what this tool does — the agent reads this to decide when to use it.',
    parameters: schema,
    execute: async (_toolCallId, params: Params, _signal, onUpdate) => {
      onUpdate?.({
        content: [{ type: 'text', text: `Processing ${params.url}...` }],
        details: { phase: 'fetching' },
      });

      const processed = await processMyContent(params.url, context.logger);

      const now = new Date().toISOString();
      const id = uuidv4();

      const metadata: NoteMetadata = {
        id,
        type: 'note',
        title: processed.title,
        created: now,
        updated: now,
        tags: params.tags ?? [],
        links: [],
        category: params.category ?? 'uncategorized',
        sourceUrl: params.url,
      };

      // Save to all three storage layers
      const filePath = context.markdown.save(metadata, processed.content);
      context.sqlite.upsertNote(metadata, processed.content, filePath);

      if (processed.embedText) {
        try {
          const vector = await context.generateEmbedding(processed.embedText);
          await context.vectorDb.upsert({
            id,
            text: processed.embedText,
            vector,
            type: metadata.type,
            title: processed.title,
          });
        } catch {
          // Embedding failure is non-fatal
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: `Saved "${processed.title}" (id: ${id})`,
          },
        ],
        details: { id, filePath, title: processed.title },
      };
    },
  };
}
```

### 4. Export the plugin

Create `plugins/my-plugin/src/index.ts`:

```typescript
import type { EchosPlugin, PluginContext } from '@echos/core';
import { createMyTool } from './tool.js';

const myPlugin: EchosPlugin = {
  name: 'my-plugin',
  description: 'What this plugin does',
  version: '0.1.0',

  setup(context: PluginContext) {
    return [createMyTool(context)];
  },

  // Optional: cleanup on shutdown
  // teardown() { ... },
};

export default myPlugin;
```

### 5. Register it

In `src/index.ts`, import and register:

```typescript
import myPlugin from '@echos/plugin-my-plugin';

// After creating the PluginRegistry:
pluginRegistry.register(myPlugin);
```

### 6. Wire up the workspace

Add the path mapping to root `tsconfig.json`:

```json
{
  "compilerOptions": {
    "paths": {
      "@echos/plugin-my-plugin": ["./plugins/my-plugin/src/index.ts"]
    }
  }
}
```

Install dependencies:

```bash
pnpm install
```

Build and verify:

```bash
pnpm -r build
pnpm test
```

## PluginContext API

Every plugin receives a `PluginContext` with:

| Property | Type | Description |
|----------|------|-------------|
| `sqlite` | `SqliteStorage` | Metadata DB (upsert, query, FTS5 search) |
| `markdown` | `MarkdownStorage` | Markdown file storage (save, read, delete) |
| `vectorDb` | `VectorStorage` | Vector embeddings (upsert, search) |
| `generateEmbedding` | `(text: string) => Promise<number[]>` | Generate embedding vectors |
| `logger` | `Logger` (Pino) | Structured logger |
| `config` | `Record<string, unknown>` | App config (API keys, etc.) |

## Existing plugins

| Plugin | Package | Description |
|--------|---------|-------------|
| YouTube | `@echos/plugin-youtube` | Transcript extraction via Python + Whisper fallback |
| Article | `@echos/plugin-article` | Web article extraction via Readability + DOMPurify |
