import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createSqliteStorage, type SqliteStorage } from './sqlite.js';
import { createMarkdownStorage, type MarkdownStorage } from './markdown.js';
import { type VectorStorage } from './vectordb.js';
import { reconcileStorage, buildMetadata } from './reconciler.js';
import { createLogger } from '@echos/shared';

const logger = createLogger('test', 'silent');

// ---------------------------------------------------------------------------
// buildMetadata unit tests — covers the frontmatter coercion helpers
// ---------------------------------------------------------------------------
describe('buildMetadata', () => {
  it('coerces unquoted ISO timestamp (Date object) in created/updated to ISO string', () => {
    const date = new Date('2026-04-02T15:22:09.803Z');
    const data = {
      id: 'abc',
      type: 'youtube',
      title: 'Test',
      created: date,
      updated: date,
      tags: [],
      links: [],
      category: '',
    };
    const meta = buildMetadata(data);
    expect(typeof meta.created).toBe('string');
    expect(meta.created).toBe('2026-04-02T15:22:09.803Z');
    expect(typeof meta.updated).toBe('string');
    expect(meta.updated).toBe('2026-04-02T15:22:09.803Z');
  });

  it('preserves quoted ISO timestamp strings as-is', () => {
    const data = {
      id: 'abc',
      type: 'youtube',
      title: 'Test',
      created: '2026-04-02T15:36:13.124Z',
      updated: '2026-04-02T15:36:23.370Z',
      tags: [],
      links: [],
      category: '',
    };
    const meta = buildMetadata(data);
    expect(meta.created).toBe('2026-04-02T15:36:13.124Z');
    expect(meta.updated).toBe('2026-04-02T15:36:23.370Z');
  });

  it('falls back to current time when created/updated are absent', () => {
    const before = Date.now();
    const data = {
      id: 'abc',
      type: 'note',
      title: 'Test',
      tags: [],
      links: [],
      category: '',
    };
    const meta = buildMetadata(data);
    const after = Date.now();
    expect(typeof meta.created).toBe('string');
    expect(typeof meta.updated).toBe('string');
    const createdMs = new Date(meta.created).getTime();
    expect(createdMs).toBeGreaterThanOrEqual(before);
    expect(createdMs).toBeLessThanOrEqual(after);
  });

  it('handles YAML array tags correctly', () => {
    const data = {
      id: 'abc',
      type: 'youtube',
      title: 'Test',
      created: '2026-04-02T15:36:13.124Z',
      updated: '2026-04-02T15:36:23.370Z',
      tags: ['AI', 'quartz', 'youtube'],
      links: [],
      category: 'learning',
    };
    const meta = buildMetadata(data);
    expect(meta.tags).toEqual(['AI', 'quartz', 'youtube']);
  });

  it('handles empty YAML array for links', () => {
    const data = {
      id: 'abc',
      type: 'note',
      title: 'Test',
      created: '2026-04-02T15:36:13.124Z',
      updated: '2026-04-02T15:36:23.370Z',
      tags: [],
      links: [],
      category: '',
    };
    const meta = buildMetadata(data);
    expect(meta.links).toEqual([]);
  });

  it('handles YAML block scalar gist (>-) as a plain trimmed string', () => {
    const data = {
      id: 'abc',
      type: 'youtube',
      title: 'Test',
      created: '2026-04-02T15:36:13.124Z',
      updated: '2026-04-02T15:36:23.370Z',
      // gray-matter resolves >- block scalars to a plain string before we see it
      gist: 'Understanding the layered architecture of AI systems from hardware to user interface.',
      tags: [],
      links: [],
      category: '',
    };
    const meta = buildMetadata(data);
    expect(meta.gist).toBe(
      'Understanding the layered architecture of AI systems from hardware to user interface.',
    );
  });
});

// ---------------------------------------------------------------------------
// reconcileStorage integration tests — uses real SQLite + markdown files
// ---------------------------------------------------------------------------
describe('reconcileStorage — frontmatter edge cases', () => {
  let tempDir: string;
  let knowledgeDir: string;
  let storage: SqliteStorage;
  let markdown: MarkdownStorage;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'echos-reconciler-test-'));
    knowledgeDir = join(tempDir, 'knowledge');
    mkdirSync(knowledgeDir, { recursive: true });
    storage = createSqliteStorage(join(tempDir, 'test.db'), logger);
    markdown = createMarkdownStorage(knowledgeDir, logger);
  });

  afterEach(() => {
    storage.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  const noopEmbedding = async () => [];
  const noopVectorDb = {
    upsert: async () => {},
    search: async () => [],
    findByVector: async () => [],
    remove: async () => {},
    close: () => {},
  } satisfies VectorStorage;

  it('successfully reconciles a note with unquoted ISO timestamps (Date objects)', async () => {
    // gray-matter / js-yaml parses unquoted timestamps as Date objects
    const raw = `---
id: b15e3104-a0ea-4a41-99a6-2b7d29807a16
type: youtube
title: 'What Is an AI Stack?'
created: 2026-04-02T15:22:09.803Z
updated: '2026-04-02T15:26:58.159Z'
gist: >-
  Understanding the layered architecture of AI systems.
status: saved
inputSource: url
tags: []
links: []
category: ''
---

Some content here.
`;
    writeFileSync(join(knowledgeDir, 'test-unquoted-ts.md'), raw, 'utf-8');

    await expect(
      reconcileStorage({
        baseDir: knowledgeDir,
        sqlite: storage,
        vectorDb: noopVectorDb,
        markdown,
        generateEmbedding: noopEmbedding,
        logger,
      }),
    ).resolves.toMatchObject({ scanned: 1, added: 1 });

    const note = storage.getNote('b15e3104-a0ea-4a41-99a6-2b7d29807a16');
    expect(note).toBeDefined();
    expect(note!.title).toBe('What Is an AI Stack?');
    // created should be stored as an ISO string, not throw
    expect(typeof note!.created).toBe('string');
    expect(note!.created).toBe('2026-04-02T15:22:09.803Z');
  });

  it('successfully reconciles a note with YAML array tags', async () => {
    const raw = `---
id: 277a44a0-f536-415a-8e96-bbb787b7f917
type: youtube
title: Build AI Skills and Stay Relevant
created: '2026-04-02T15:36:13.124Z'
updated: '2026-04-02T15:36:23.370Z'
tags:
  - AI
  - quartz
  - youtube
category: learning
source_url: 'https://youtu.be/x1hyuvUUR0w'
status: saved
inputSource: url
links: []
---

Content about AI skills.
`;
    writeFileSync(join(knowledgeDir, 'test-array-tags.md'), raw, 'utf-8');

    await expect(
      reconcileStorage({
        baseDir: knowledgeDir,
        sqlite: storage,
        vectorDb: noopVectorDb,
        markdown,
        generateEmbedding: noopEmbedding,
        logger,
      }),
    ).resolves.toMatchObject({ scanned: 1, added: 1 });

    const note = storage.getNote('277a44a0-f536-415a-8e96-bbb787b7f917');
    expect(note).toBeDefined();
    expect(note!.tags).toBe('AI,quartz,youtube');
  });

  it('successfully reconciles a note with a YAML block scalar gist (>-)', async () => {
    const raw = `---
id: c0ffee00-1234-5678-abcd-000000000001
type: youtube
title: AI Architecture Deep Dive
created: '2026-04-02T15:00:00.000Z'
updated: '2026-04-02T16:00:00.000Z'
gist: >-
  Understanding the layered architecture of AI systems from hardware to user
  interface.
status: saved
inputSource: url
tags: []
links: []
category: ''
---

Deep dive content.
`;
    writeFileSync(join(knowledgeDir, 'test-block-scalar.md'), raw, 'utf-8');

    await expect(
      reconcileStorage({
        baseDir: knowledgeDir,
        sqlite: storage,
        vectorDb: noopVectorDb,
        markdown,
        generateEmbedding: noopEmbedding,
        logger,
      }),
    ).resolves.toMatchObject({ scanned: 1, added: 1 });

    const note = storage.getNote('c0ffee00-1234-5678-abcd-000000000001');
    expect(note).toBeDefined();
    expect(note!.gist).toContain('Understanding the layered architecture');
  });

  it('does not crash when created field is missing (falls back to current time)', async () => {
    const raw = `---
id: c0ffee00-0000-0000-0000-000000000002
type: note
title: Note Without Created
updated: '2026-04-02T15:00:00.000Z'
tags: []
links: []
category: ''
---

No created timestamp.
`;
    writeFileSync(join(knowledgeDir, 'test-no-created.md'), raw, 'utf-8');

    await expect(
      reconcileStorage({
        baseDir: knowledgeDir,
        sqlite: storage,
        vectorDb: noopVectorDb,
        markdown,
        generateEmbedding: noopEmbedding,
        logger,
      }),
    ).resolves.toMatchObject({ scanned: 1, added: 1 });

    const note = storage.getNote('c0ffee00-0000-0000-0000-000000000002');
    expect(note).toBeDefined();
    expect(typeof note!.created).toBe('string');
    expect(note!.created).toBeTruthy();
  });
});
