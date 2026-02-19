# Image Storage and Tagging - Implementation Plan & Feasibility

**Status**: Planning Phase
**Created**: 2026-02-19
**Author**: Claude Code (based on architectural exploration)

## Executive Summary

Adding image storage to EchOS is **highly feasible** and aligns well with the existing architecture. The modular plugin system, three-layer storage approach, and Telegram integration patterns provide solid foundations for implementing image upload, storage, tagging, and search.

**Key Takeaways:**
- ✅ Architecture supports this feature without major refactoring
- ✅ Telegram integration already handles binary files (voice messages)
- ✅ Storage layers can extend to support image metadata and assets
- ✅ Plugin system is designed for this use case
- ⚠️ Requires careful security considerations (file validation, size limits)
- ⚠️ Image embeddings (visual search) would require additional API integration

---

## 1. Feasibility Assessment

### 1.1 Technical Feasibility: ✅ HIGH

**What Works in Our Favor:**

1. **Existing Binary File Handling**
   - Voice message handling (`packages/telegram/src/voice.ts`) demonstrates:
     - File download from Telegram API
     - Temporary file storage and cleanup
     - Size validation (25MB limit)
     - Processing pipeline integration

2. **Modular Plugin Architecture**
   - Plugin system (`packages/core/src/plugins/`) designed for new content types
   - PluginContext provides storage access (sqlite, markdown, vectorDb)
   - Existing plugins (YouTube, Article) show clear patterns to follow

3. **Three-Layer Storage Design**
   - Markdown: Can reference images via relative paths
   - SQLite: Can store image metadata (path, size, dimensions, MIME type)
   - LanceDB: Can store image embeddings (if using vision APIs)
   - Reconciliation system handles startup sync and live updates

4. **Telegram Bot Integration**
   - grammY library supports `message:photo`, `message:document`, `message:video`
   - Current handlers for text/voice demonstrate streaming pattern
   - Session management and rate limiting already implemented

5. **Search Infrastructure**
   - FTS5 full-text search can index image captions/tags
   - Hybrid search (keyword + semantic) can extend to image embeddings
   - Tag system already supports filtering across content types

**Architectural Alignment Score: 9/10**

### 1.2 Resource Feasibility: ✅ MEDIUM-HIGH

**Resource Requirements:**

1. **Storage Space**
   - Images are larger than text (avg 500KB-5MB per photo)
   - Need disk space planning (recommend 10GB+ allocation)
   - Thumbnail generation reduces display bandwidth
   - Optional: Compression pipeline for long-term storage

2. **API Costs**
   - Image embeddings: OpenAI doesn't offer image embedding API directly
   - Alternative: Use CLIP embeddings (open source, self-hosted)
   - Alternative: Use vision API for caption generation → embed captions
   - Whisper is already used for voice (similar cost pattern)

3. **Processing Time**
   - Image validation: <100ms
   - Thumbnail generation: ~200-500ms per image (using sharp/jimp)
   - Caption generation (optional): 2-5s via vision API
   - Embedding generation (optional): 1-3s

**Resource Impact: Manageable with proper limits**

### 1.3 Security Feasibility: ⚠️ MEDIUM (Needs Attention)

**Security Considerations (Critical):**

1. **File Upload Validation**
   - ✅ Size limits (recommend 25MB max, same as voice)
   - ✅ MIME type whitelist (image/jpeg, image/png, image/webp)
   - ⚠️ Magic byte validation (prevent MIME spoofing)
   - ⚠️ Image bomb prevention (decompression limits)
   - ⚠️ Malware scanning (if accepting untrusted uploads)

2. **Storage Security**
   - ✅ Store outside web root (data/assets/ already gitignored)
   - ✅ Use UUIDs for filenames (prevent directory traversal)
   - ✅ Sanitize user-provided captions/tags (already have sanitizeHtml)
   - ⚠️ Consider encryption at rest for sensitive images

3. **Privacy & Compliance**
   - User images may contain PII or sensitive content
   - Need clear data retention policy
   - GDPR considerations: Right to erasure → clean up asset files

4. **Rate Limiting**
   - ✅ Token bucket middleware already exists
   - Recommend: 10 images/hour per user limit
   - Prevent storage abuse

**Security Risk: Low-Medium (with proper implementation)**

---

## 2. Proposed Architecture

### 2.1 Data Model

**Extend NoteMetadata Interface** (`packages/shared/src/types/index.ts`):

```typescript
interface ImageAttachment {
  id: string;                    // UUID for the image
  assetPath: string;             // Relative path to asset
  mimeType: string;              // 'image/jpeg' | 'image/png' | 'image/webp'
  size: number;                  // File size in bytes
  dimensions?: {                 // Image dimensions (width x height)
    width: number;
    height: number;
  };
  thumbnailPath?: string;        // Path to thumbnail (optional)
  caption?: string;              // User-provided or AI-generated caption
  hash: string;                  // SHA-256 hash for deduplication
  created: string;               // ISO timestamp
}

interface NoteMetadata {
  // ... existing fields
  attachments?: ImageAttachment[]; // NEW: Support multiple images per note
}
```

**Alternative Approach: Dedicated Image ContentType**

```typescript
type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'reminder' | 'conversation' | 'image';

interface ImageMetadata extends NoteMetadata {
  type: 'image';
  assetPath: string;        // Required for image type
  mimeType: string;
  dimensions?: { width: number; height: number };
  hash: string;
}
```

**Recommendation**: Start with **attachments approach** (more flexible, images can be part of notes/articles). Can refactor to dedicated type later if needed.

### 2.2 Storage Layer Design

**File System Structure:**

```
data/
├── knowledge/                    # Existing markdown notes
│   ├── note/
│   ├── article/
│   └── youtube/
├── assets/                       # NEW: Image storage
│   ├── {image-uuid-1}/
│   │   ├── original.jpg         # Original image
│   │   └── thumbnail.jpg        # 200x200 thumbnail
│   ├── {image-uuid-2}/
│   │   ├── original.png
│   │   └── thumbnail.png
│   └── .gitkeep
└── echos.db                      # SQLite database
```

**Why per-image directories?**
- Allows multiple versions (original, thumbnail, medium, etc.)
- Supports future enhancements (OCR results, EXIF metadata)
- Clean deletion (remove entire directory)

**SQLite Schema Extension:**

**Option A: Add to notes table** (simpler, initial implementation)
```sql
-- Add JSON column to notes table
ALTER TABLE notes ADD COLUMN attachments TEXT; -- JSON array of ImageAttachment
```

**Option B: Separate attachments table** (more normalized, better for many images)
```sql
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  asset_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  thumbnail_path TEXT,
  caption TEXT,
  hash TEXT NOT NULL,
  created TEXT NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);

CREATE INDEX idx_attachments_note_id ON attachments(note_id);
CREATE INDEX idx_attachments_hash ON attachments(hash); -- For deduplication
CREATE UNIQUE INDEX idx_attachments_path ON attachments(asset_path);
```

**Recommendation**: Start with **Option A** (JSON column). Migrate to Option B if image usage grows significantly.

**Markdown Representation:**

```markdown
---
id: note-123
title: "Trip to Paris"
type: note
category: travel
tags: [vacation, 2026, paris]
created: 2026-02-19T10:00:00Z
updated: 2026-02-19T10:00:00Z
attachments:
  - id: img-abc-123
    assetPath: ../../assets/img-abc-123/original.jpg
    mimeType: image/jpeg
    size: 2048576
    dimensions:
      width: 1920
      height: 1080
    thumbnailPath: ../../assets/img-abc-123/thumbnail.jpg
    caption: Eiffel Tower at sunset
    hash: sha256:abc123...
    created: 2026-02-19T10:00:00Z
---

# Trip to Paris

Great trip! Here's a photo from the Eiffel Tower:

![Eiffel Tower at sunset](../../assets/img-abc-123/original.jpg)

More notes about the trip...
```

**LanceDB Integration (Optional - Visual Search):**

```typescript
interface ImageDocument {
  id: string;                    // Same as attachment.id
  type: 'image';
  embedding: number[];           // 512-dim CLIP embedding or vision API
  caption?: string;              // Searchable text
  tags: string[];
  note_id?: string;              // Reference to parent note
}
```

### 2.3 Plugin Architecture

**Create Image Plugin** (`plugins/images/`):

```
plugins/images/
├── src/
│   ├── index.ts              # Plugin definition
│   ├── processor.ts          # Image validation, hashing, thumbnails
│   ├── tool.ts               # save_image AgentTool
│   └── types.ts              # Plugin-specific types
├── package.json
├── tsconfig.json
└── README.md
```

**Plugin Interface:**

```typescript
// plugins/images/src/index.ts
import type { EchosPlugin, PluginContext } from '@echos/core';
import { createSaveImageTool } from './tool.js';

const imagePlugin: EchosPlugin = {
  name: 'echos-image-processor',
  description: 'Handles image upload, storage, and tagging',
  version: '0.1.0',

  async setup(context: PluginContext) {
    const logger = context.logger.child({ plugin: 'images' });
    logger.info('Image plugin initializing');

    // Return agent tools
    return [
      createSaveImageTool(context),
      // Future: createImageSearchTool(context),
    ];
  },

  async teardown() {
    // Cleanup if needed
  },
};

export default imagePlugin;
```

**Image Processor** (`plugins/images/src/processor.ts`):

```typescript
import sharp from 'sharp'; // Image processing library
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { ValidationError } from '@echos/shared/errors';

interface ProcessImageOptions {
  filePath: string;           // Path to uploaded file
  userId: string;             // For logging/auditing
  caption?: string;           // User-provided caption
  tags?: string[];            // User-provided tags
}

interface ProcessedImage {
  id: string;
  assetPath: string;
  thumbnailPath: string;
  mimeType: string;
  size: number;
  dimensions: { width: number; height: number };
  hash: string;
  caption?: string;
}

export async function processImage(
  options: ProcessImageOptions,
  assetsDir: string,
): Promise<ProcessedImage> {
  const { filePath, caption, tags } = options;

  // 1. Validate file exists
  const stats = await fs.stat(filePath);
  if (stats.size > 25 * 1024 * 1024) { // 25MB limit
    throw new ValidationError('Image exceeds 25MB limit');
  }

  // 2. Validate image format and get metadata
  const image = sharp(filePath);
  const metadata = await image.metadata();

  // Whitelist formats
  const allowedFormats = ['jpeg', 'png', 'webp', 'gif'];
  if (!metadata.format || !allowedFormats.includes(metadata.format)) {
    throw new ValidationError(`Unsupported image format: ${metadata.format}`);
  }

  // Prevent image bombs (excessive dimensions)
  if (metadata.width && metadata.width > 10000 ||
      metadata.height && metadata.height > 10000) {
    throw new ValidationError('Image dimensions too large');
  }

  // 3. Generate content hash for deduplication
  const fileBuffer = await fs.readFile(filePath);
  const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');

  // 4. Generate UUID and create asset directory
  const imageId = `img-${crypto.randomUUID()}`;
  const assetDir = path.join(assetsDir, imageId);
  await fs.mkdir(assetDir, { recursive: true });

  // 5. Copy original to asset directory
  const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format;
  const originalPath = path.join(assetDir, `original.${ext}`);
  await fs.copyFile(filePath, originalPath);

  // 6. Generate thumbnail (200x200, maintain aspect ratio)
  const thumbnailPath = path.join(assetDir, `thumbnail.${ext}`);
  await image
    .resize(200, 200, { fit: 'inside', withoutEnlargement: true })
    .toFile(thumbnailPath);

  // 7. Return processed image metadata
  return {
    id: imageId,
    assetPath: path.relative(process.cwd(), originalPath),
    thumbnailPath: path.relative(process.cwd(), thumbnailPath),
    mimeType: `image/${metadata.format}`,
    size: stats.size,
    dimensions: {
      width: metadata.width || 0,
      height: metadata.height || 0,
    },
    hash: `sha256:${hash}`,
    caption,
  };
}

// Deduplication: Check if image hash already exists
export async function findDuplicateImage(
  hash: string,
  sqlite: SqliteStorage,
): Promise<string | null> {
  // Query attachments by hash
  // Return existing note_id if found
  // Allows linking to existing image instead of re-uploading
}
```

**Agent Tool Definition** (`plugins/images/src/tool.ts`):

```typescript
import { Type } from '@sinclair/typebox';
import type { AgentTool } from 'pi-agent-core';
import type { PluginContext } from '@echos/core';
import { processImage } from './processor.js';
import path from 'node:path';

export function createSaveImageTool(context: PluginContext): AgentTool {
  const logger = context.logger.child({ tool: 'save_image' });
  const assetsDir = path.join(process.cwd(), 'data', 'assets');

  return {
    name: 'save_image',
    description: 'Save an uploaded image with caption and tags. Creates a new note with the image attached.',

    parameters: Type.Object({
      filePath: Type.String({ description: 'Path to uploaded image file' }),
      title: Type.String({ description: 'Title for the image note' }),
      caption: Type.Optional(Type.String({ description: 'Image caption or description' })),
      tags: Type.Optional(Type.Array(Type.String(), { description: 'Tags for categorization' })),
      category: Type.Optional(Type.String({ description: 'Category (defaults to uncategorized)' })),
    }),

    async execute(params) {
      const { filePath, title, caption, tags, category } = params;

      try {
        logger.info({ filePath }, 'Processing image upload');

        // 1. Process image (validate, hash, thumbnail)
        const processed = await processImage(
          { filePath, caption, tags, userId: 'telegram-user' },
          assetsDir,
        );

        // 2. Create note metadata
        const noteId = `note-${crypto.randomUUID()}`;
        const now = new Date().toISOString();

        const metadata: NoteMetadata = {
          id: noteId,
          type: 'note', // Or 'image' if using dedicated type
          title,
          category: category || 'uncategorized',
          tags: tags || [],
          created: now,
          updated: now,
          inputSource: 'file',
          attachments: [{
            id: processed.id,
            assetPath: processed.assetPath,
            mimeType: processed.mimeType,
            size: processed.size,
            dimensions: processed.dimensions,
            thumbnailPath: processed.thumbnailPath,
            caption,
            hash: processed.hash,
            created: now,
          }],
        };

        // 3. Create markdown content
        const imageMarkdown = `![${caption || title}](${processed.assetPath})`;
        const content = caption
          ? `${imageMarkdown}\n\n${caption}`
          : imageMarkdown;

        // 4. Save to all storage layers
        const savedPath = await context.markdown.save(metadata, content);
        await context.sqlite.upsertNote(metadata, content, savedPath);

        // 5. Generate embedding (from caption or title)
        const embedText = [title, caption].filter(Boolean).join(' ');
        const embedding = await context.generateEmbedding(embedText);

        await context.vectorDb.upsert({
          id: noteId,
          text: embedText,
          vector: embedding,
          type: 'note',
          title,
        });

        logger.info({ noteId, imageId: processed.id }, 'Image saved successfully');

        return {
          success: true,
          message: `Image saved successfully: ${title}`,
          noteId,
          imageId: processed.id,
          path: savedPath,
        };

      } catch (error) {
        logger.error({ error }, 'Failed to save image');
        throw error;
      }
    },
  };
}
```

### 2.4 Telegram Integration

**Add Photo Message Handler** (`packages/telegram/src/index.ts`):

```typescript
import { downloadTelegramFile } from './download.js'; // New utility

// Inside bot.on() handlers, add:

bot.on('message:photo', async (ctx) => {
  const userId = ctx.from.id.toString();

  // Auth check
  if (!isAllowedUser(userId)) {
    await ctx.reply('Unauthorized');
    return;
  }

  // Rate limit check
  if (!rateLimitMiddleware(userId)) {
    await ctx.reply('Rate limit exceeded. Please try again later.');
    return;
  }

  try {
    // Get largest photo size (Telegram sends multiple resolutions)
    const photos = ctx.message.photo;
    const largestPhoto = photos[photos.length - 1];

    // Download to temp file
    const tempFile = await downloadTelegramFile(
      ctx.api,
      largestPhoto.file_id,
      userId,
      logger,
    );

    // Extract caption from message
    const caption = ctx.message.caption || undefined;

    // Build agent message
    const message = caption
      ? `User uploaded an image with caption: "${caption}". File path: ${tempFile}`
      : `User uploaded an image. File path: ${tempFile}`;

    // Stream agent response
    await streamAgentResponse(
      ctx,
      message,
      userId,
      agentDeps,
      logger.child({ handler: 'photo' }),
    );

    // Cleanup handled by agent/plugin

  } catch (error) {
    logger.error({ error, userId }, 'Failed to process photo');
    await ctx.reply('Sorry, failed to process your image. Please try again.');
  }
});
```

**Download Utility** (`packages/telegram/src/download.ts`):

```typescript
import { Api } from 'grammy';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Logger } from 'pino';

export async function downloadTelegramFile(
  api: Api,
  fileId: string,
  userId: string,
  logger: Logger,
): Promise<string> {
  // Similar to voice.ts download logic
  const file = await api.getFile(fileId);

  if (!file.file_path) {
    throw new Error('File path not available');
  }

  // Validate size (25MB limit)
  const fileSize = file.file_size || 0;
  if (fileSize > 25 * 1024 * 1024) {
    throw new ValidationError('File exceeds 25MB limit');
  }

  // Download to temp directory
  const tempDir = path.join(process.cwd(), 'data', 'temp');
  await fs.mkdir(tempDir, { recursive: true });

  const tempId = crypto.randomUUID();
  const ext = path.extname(file.file_path) || '.jpg';
  const tempFile = path.join(tempDir, `${tempId}${ext}`);

  // Download file
  const url = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new ExternalServiceError('Failed to download file from Telegram');
  }

  const buffer = await response.arrayBuffer();
  await fs.writeFile(tempFile, Buffer.from(buffer));

  logger.info({ fileId, tempFile, size: fileSize }, 'Downloaded Telegram file');

  return tempFile;
}
```

### 2.5 Search Integration

**Extend Search to Include Image Captions:**

The existing FTS5 search already indexes note content, which will include image captions embedded in markdown. No changes needed for basic search.

**Optional: Image Similarity Search**

For visual search (finding similar images):

1. **Generate Image Embeddings**: Use CLIP model or vision API
2. **Store in LanceDB**: Separate table or merged with text embeddings
3. **Search Tool**: New tool `search_images` with visual similarity

```typescript
// Pseudocode - not implemented initially
const searchImagesTool = {
  name: 'search_images',
  description: 'Search for images by visual similarity or caption',
  parameters: Type.Object({
    query: Type.String(),
    queryType: Type.Union([
      Type.Literal('text'),    // Search by caption/tags
      Type.Literal('image'),   // Search by uploading reference image
    ]),
  }),
  async execute(params) {
    if (params.queryType === 'text') {
      // Use existing hybrid search (FTS5 + semantic on captions)
    } else {
      // Generate embedding from reference image
      // Query LanceDB for similar image embeddings
    }
  },
};
```

---

## 3. Implementation Phases

### Phase 1: Core Image Storage (MVP) ✅ **Recommended First**

**Scope:**
- File system storage for images (data/assets/)
- Image plugin with validation, hashing, thumbnail generation
- save_image agent tool
- Telegram photo message handler
- SQLite metadata storage (JSON column in notes table)
- Markdown file references

**Deliverables:**
- Users can upload images via Telegram
- Images stored with auto-generated thumbnails
- Images tagged and searchable by caption/tags
- Basic deduplication (hash-based)

**Effort Estimate**: 2-3 days (1 developer)

**Dependencies:**
- `sharp` library for image processing
- Update `@echos/shared/types` for ImageAttachment
- Update Telegram package for photo handler

### Phase 2: Enhanced Search & Display

**Scope:**
- Web UI to display images in notes
- Gallery view for image-type notes
- Tag-based filtering in search
- Image-specific search tool

**Deliverables:**
- Browse images in web interface
- Filter notes by "has images"
- Image gallery mode

**Effort Estimate**: 3-4 days

**Dependencies:**
- Phase 1 complete
- Web UI framework setup (Fastify + pi-web-ui)

### Phase 3: Advanced Features (Optional)

**Scope:**
- Visual similarity search (CLIP embeddings)
- OCR for searchable text in images
- Image compression pipeline
- EXIF metadata extraction
- Caption generation via vision API

**Deliverables:**
- "Find similar images" feature
- Search text within images (OCR)
- Auto-caption generation

**Effort Estimate**: 5-7 days

**Dependencies:**
- Phase 1 & 2 complete
- Vision API integration (OpenAI GPT-4 Vision or similar)
- OCR library (Tesseract.js or cloud API)

---

## 4. Technical Requirements

### 4.1 Dependencies

**New Package Dependencies:**

```json
{
  "dependencies": {
    "sharp": "^0.33.0",           // Image processing (resize, convert, thumbnail)
  },
  "devDependencies": {
    "@types/sharp": "^0.32.0"
  }
}
```

**Optional (Phase 3):**
```json
{
  "dependencies": {
    "@xenova/transformers": "^2.0.0",  // CLIP embeddings (local)
    "tesseract.js": "^5.0.0"            // OCR (local)
  }
}
```

### 4.2 Configuration Changes

**Extend Config Schema** (`packages/shared/src/config/index.ts`):

```typescript
const ConfigSchema = z.object({
  // ... existing fields

  images: z.object({
    enabled: z.boolean().default(true),
    maxSizeMB: z.number().default(25),
    allowedFormats: z.array(z.string()).default(['jpeg', 'png', 'webp', 'gif']),
    thumbnailSize: z.number().default(200),
    enableOCR: z.boolean().default(false),
    enableVisualSearch: z.boolean().default(false),
  }).optional(),
});
```

**.env Updates:**

```bash
# Images
IMAGES_ENABLED=true
IMAGES_MAX_SIZE_MB=25
IMAGES_ALLOWED_FORMATS=jpeg,png,webp,gif
IMAGES_THUMBNAIL_SIZE=200
IMAGES_ENABLE_OCR=false
IMAGES_ENABLE_VISUAL_SEARCH=false
```

### 4.3 Database Migrations

**SQLite Migration:**

```sql
-- Migration: 001_add_attachments.sql
-- Add attachments column to notes table

ALTER TABLE notes ADD COLUMN attachments TEXT; -- JSON array

-- Optional: Create index for searching attachments
-- (SQLite JSON functions: json_each, json_extract)
CREATE INDEX idx_notes_attachments ON notes(attachments) WHERE attachments IS NOT NULL;
```

**Apply Migration:**
- Use existing migration system or manual ALTER TABLE
- Backfill existing notes with NULL or empty array

---

## 5. Security & Privacy Considerations

### 5.1 Security Checklist

- [x] **File Upload Validation**
  - Size limit: 25MB (configurable)
  - MIME type whitelist: jpeg, png, webp, gif
  - Magic byte validation (sharp library handles this)
  - Dimension limits: max 10000x10000px

- [x] **Storage Security**
  - Store in data/assets/ (outside web root, gitignored)
  - Use UUIDs for filenames (prevent enumeration/traversal)
  - Per-image directories (clean isolation)

- [x] **Input Sanitization**
  - Sanitize user captions (use existing sanitizeHtml)
  - Validate tags (alphanumeric + hyphens)

- [x] **Rate Limiting**
  - Use existing token bucket middleware
  - Recommend: 10 images/hour per user

- [ ] **Malware Scanning** (Phase 3)
  - Consider ClamAV integration for untrusted uploads
  - Not critical for single-user Telegram bot

- [ ] **NSFW Detection** (Phase 3)
  - Optional: Use vision API to detect inappropriate content
  - Useful for shared/multi-user deployments

### 5.2 Privacy Considerations

**Data Retention:**
- Images persist until manually deleted
- Deletion must remove:
  - Asset files (original + thumbnails)
  - SQLite metadata
  - Markdown references
  - Vector embeddings

**GDPR Compliance:**
- User has right to erasure → implement clean deletion
- No telemetry on image content (unless explicitly enabled)
- Log minimal metadata (size, MIME type, not content)

**Storage Location:**
- Self-hosted: User controls data
- No cloud uploads (unless vision API used for captions)

---

## 6. Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Storage exhaustion | High | Medium | Implement storage quotas per user |
| Image bomb attack | High | Low | Dimension validation, decompression limits |
| Malware upload | Medium | Low | MIME validation, optional ClamAV scan |
| API cost spike (vision) | Medium | Low | Make vision API optional, rate limit |
| Performance degradation | Medium | Medium | Thumbnail generation, lazy loading in UI |
| Data loss (asset files) | High | Low | Include assets/ in backup scripts |

---

## 7. Testing Strategy

### 7.1 Unit Tests

**Image Processor Tests** (`plugins/images/src/processor.test.ts`):
- Valid image upload (JPEG, PNG, WebP)
- Invalid format rejection (e.g., BMP, SVG)
- Size limit enforcement
- Dimension limit enforcement
- Hash generation and deduplication
- Thumbnail generation

**Tool Tests** (`plugins/images/src/tool.test.ts`):
- save_image tool execution
- Metadata creation
- Storage layer integration (mock)

### 7.2 Integration Tests

- End-to-end: Upload image via Telegram → verify storage + search
- Reconciler test: Image note sync on startup
- File watcher test: External image addition/deletion

### 7.3 Manual Testing Checklist

- [ ] Upload JPEG via Telegram
- [ ] Upload PNG via Telegram
- [ ] Upload image with caption
- [ ] Upload image with tags
- [ ] Search for image by caption
- [ ] Search for image by tag
- [ ] Verify thumbnail generation
- [ ] Test duplicate upload (same image)
- [ ] Test oversized image rejection
- [ ] Test invalid format rejection
- [ ] Verify markdown rendering
- [ ] Test deletion (cleanup asset files)

---

## 8. Documentation Updates

After implementation, update:

1. **docs/ARCHITECTURE.md**
   - Add section on image storage architecture
   - Update storage layer diagram

2. **docs/INTERFACES.md**
   - Document Telegram photo handler
   - Document save_image tool

3. **docs/PLUGINS.md**
   - Add image plugin documentation
   - Example usage and configuration

4. **README.md**
   - Add "Image Storage" to features list
   - Update setup instructions (sharp dependencies)

5. **docs/SECURITY.md**
   - Document image validation security measures
   - Privacy considerations for image storage

6. **New: docs/IMAGE_USAGE.md**
   - User guide for uploading and managing images
   - Search examples
   - Tag conventions

---

## 9. Recommended Implementation Order

**Phase 1: MVP (Days 1-3)**

1. **Day 1: Foundation**
   - Update types (ImageAttachment, NoteMetadata)
   - Create plugins/images/ structure
   - Implement processor.ts (validation, hashing, thumbnails)
   - Add sharp dependency

2. **Day 2: Agent Integration**
   - Implement tool.ts (save_image)
   - Update SQLite schema (add attachments column)
   - Test storage layer integration
   - Write unit tests

3. **Day 3: Telegram Integration**
   - Add photo message handler
   - Implement download utility
   - Test end-to-end flow
   - Update documentation

**Phase 2: Enhancement (Days 4-7)**
- Web UI gallery view
- Image-specific search filters
- Tag management UI

**Phase 3: Advanced (Days 8-14)**
- Visual similarity search (CLIP)
- OCR integration
- Caption generation (vision API)

---

## 10. Conclusion

**Feasibility Verdict: ✅ HIGHLY FEASIBLE**

Adding image storage to EchOS is a natural extension of the existing architecture. The modular plugin system, three-layer storage design, and Telegram integration patterns provide a solid foundation.

**Key Success Factors:**
1. Follow existing patterns (plugin architecture, storage layers)
2. Prioritize security (validation, sanitization, rate limiting)
3. Start simple (MVP), iterate (advanced features)
4. Leverage existing infrastructure (SQLite FTS5, LanceDB, grammY)

**Recommended Next Steps:**
1. Review this plan with stakeholders
2. Approve Phase 1 scope
3. Set up development environment (install sharp)
4. Begin implementation with processor.ts and types
5. Iterate with frequent testing and validation

**Estimated Timeline:**
- Phase 1 (MVP): 2-3 days
- Phase 2 (Enhanced): 3-4 days
- Phase 3 (Advanced): 5-7 days
- **Total**: 10-14 days (1 developer, part-time)

---

## 11. Open Questions for Discussion

1. **Content Type Design**: Use `attachments[]` on notes or dedicated `type: 'image'`?
   - **Recommendation**: Start with attachments (more flexible)

2. **Vision API Integration**: Auto-generate captions or user-provided only?
   - **Recommendation**: User-provided initially, vision API optional (Phase 3)

3. **Visual Search Priority**: High value or low priority?
   - **Recommendation**: Phase 3 (nice-to-have, not critical)

4. **Storage Limits**: Per-user quotas or global limit?
   - **Recommendation**: Start with global (simple), add per-user later

5. **Image Formats**: Support GIF/SVG or raster only?
   - **Recommendation**: Raster only (JPEG/PNG/WebP), no SVG (security risk)

6. **Compression**: Auto-compress large images or store as-is?
   - **Recommendation**: Store as-is initially, add compression in Phase 3

---

**Document Version**: 1.0
**Last Updated**: 2026-02-19
**Status**: Awaiting Review
