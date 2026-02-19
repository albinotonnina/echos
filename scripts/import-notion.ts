#!/usr/bin/env pnpm tsx

/**
 * Import Notion markdown exports into EchOS format.
 *
 * Usage:
 *   pnpm import:notion --source /path/to/notion/export
 *   pnpm import:notion --source /path/to/notion/export --target ./data/knowledge
 *   pnpm import:notion --source /path/to/notion/export --dry-run
 *
 * Options:
 *   --source <path>   Path to Notion export directory (required)
 *   --target <path>   Output directory (default: ./data/knowledge)
 *   --dry-run         Preview only, no writes
 *
 * Notion export format notes:
 *   - Filenames often have a trailing UUID: "My Note abc123def456.md"
 *   - Dates may be "January 1, 2023", ISO 8601, or file mtime
 *   - Tags are often comma-separated strings: "Tags: ai, productivity"
 *   - No ContentType equivalent — all notes default to 'note'
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';

// ─── Types ────────────────────────────────────────────────────────────────────

type ContentType = 'note';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Notion appends a short hex ID to filenames: "My Note abc123def456.md"
const NOTION_FILENAME_UUID_RE = /\s+[0-9a-f]{8,32}$/i;

// ─── CLI parsing ─────────────────────────────────────────────────────────────

function parseArgs(): { source: string; target: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  let source = '';
  let target = './data/knowledge';
  let dryRun = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source': source = args[++i] ?? ''; break;
      case '--target': target = args[++i] ?? target; break;
      case '--dry-run': dryRun = true; break;
      default:
        if (args[i]?.startsWith('--')) { console.error(`Unknown flag: ${args[i]}`); process.exit(1); }
    }
  }

  if (!source) {
    console.error('Error: --source is required');
    console.error('Usage: pnpm import:notion --source /path/to/notion-export [--target ./data/knowledge] [--dry-run]');
    process.exit(1);
  }

  return { source, target, dryRun };
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

function parseFlexibleDate(val: unknown, fallback: Date): string {
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'string' && val.trim()) {
    const s = val.trim();
    // Already ISO 8601
    if (/^\d{4}-\d{2}-\d{2}T/.test(s) || /^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    // YYYY/MM/DD
    const slash = s.replace(/\//g, '-');
    if (/^\d{4}-\d{2}-\d{2}$/.test(slash)) {
      const d = new Date(slash);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
    // Month D, YYYY (e.g. "January 1, 2023") — JS Date parses this
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

// Notion date fields to try, in priority order
function findNotionDate(data: Record<string, unknown>, keys: string[], fallback: Date): string {
  for (const k of keys) {
    const v = data[k];
    if (v !== undefined && v !== null) {
      const result = parseFlexibleDate(v, fallback);
      if (result !== fallback.toISOString()) return result;
    }
  }
  return fallback.toISOString();
}

// ─── Tag parsing ──────────────────────────────────────────────────────────────

function parseNotionTags(val: unknown): string[] {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).map(t => t.toLowerCase().trim()).filter(Boolean);
  if (typeof val === 'string') {
    return val.split(/[,，]+/).map(t => t.toLowerCase().trim()).filter(Boolean);
  }
  return [];
}

// ─── Title extraction ─────────────────────────────────────────────────────────

function extractFirstHeading(content: string): string | undefined {
  const match = /^#\s+(.+)$/m.exec(content);
  return match?.[1]?.trim();
}

function stripNotionUuidSuffix(filename: string): string {
  return filename.replace(NOTION_FILENAME_UUID_RE, '').trim();
}

// ─── Slug helpers ─────────────────────────────────────────────────────────────

function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55);
}

// ─── Frontmatter stringify ────────────────────────────────────────────────────

function buildFrontmatter(fields: Record<string, unknown>): string {
  const lines: string[] = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      if (v.length === 0) {
        lines.push(`${k}: []`);
      } else {
        lines.push(`${k}:`);
        for (const item of v) lines.push(`  - ${String(item)}`);
      }
    } else {
      const s = String(v);
      const needsQuote = /[:#\[\]{},|>&*!%@`]/.test(s) || s.includes("'") || s.startsWith(' ') || s.endsWith(' ');
      lines.push(`${k}: ${needsQuote ? `'${s.replace(/'/g, "''")}'` : s}`);
    }
  }
  lines.push('---');
  return lines.join('\n');
}

// ─── File scanner ─────────────────────────────────────────────────────────────

function scanMarkdownFiles(dir: string): string[] {
  const result: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) result.push(...scanMarkdownFiles(full));
    else if (entry.name.endsWith('.md')) result.push(full);
  }
  return result;
}

// ─── Per-file processing ──────────────────────────────────────────────────────

interface ProcessResult {
  status: 'converted' | 'skipped' | 'error';
  reason?: string;
  outPath?: string;
}

function processFile(
  filePath: string,
  sourceRoot: string,
  targetRoot: string,
  dryRun: boolean,
): ProcessResult {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf-8');
  } catch (err) {
    return { status: 'error', reason: `Cannot read file: ${String(err)}` };
  }

  let parsed: matter.GrayMatterFile<string>;
  try {
    parsed = matter(raw);
  } catch (err) {
    return { status: 'error', reason: `Frontmatter parse error: ${String(err)}` };
  }

  const data = parsed.data as Record<string, unknown>;
  const content = parsed.content;

  // Skip if already EchOS-native
  const existingId = data['id'] as string | undefined;
  if (existingId && UUID_RE.test(existingId)) {
    return { status: 'skipped', reason: 'already has EchOS id' };
  }

  // File stats for date fallbacks
  let stat = { birthtimeMs: Date.now(), mtimeMs: Date.now() };
  try { stat = statSync(filePath); } catch { /* use defaults */ }
  const birthtime = new Date(stat.birthtimeMs);
  const mtime = new Date(stat.mtimeMs);

  const id = randomUUID();
  const type: ContentType = 'note';

  // Title: frontmatter > first H1 > filename (strip Notion UUID suffix)
  const fmTitle = data['title'] as string | undefined;
  const filename = basename(filePath, extname(filePath));
  const cleanFilename = stripNotionUuidSuffix(filename);
  const title = (typeof fmTitle === 'string' && fmTitle.trim())
    ? fmTitle.trim()
    : extractFirstHeading(content) ?? cleanFilename;

  // Dates
  const created = findNotionDate(
    data,
    ['Created', 'created', 'created_time', 'Date', 'Date Created', 'dateCreated'],
    birthtime,
  );
  const updated = findNotionDate(
    data,
    ['Last Edited Time', 'updated', 'updated_time', 'Modified', 'modified', 'dateModified'],
    mtime,
  );

  // Tags
  const tags = parseNotionTags(data['Tags'] ?? data['tags'] ?? data['tag']);

  // Category: frontmatter > parent folder name > 'uncategorized'
  const relPath = relative(sourceRoot, filePath);
  const parentDir = dirname(relPath);
  const rawCategory = data['Category'] ?? data['Type'] ?? data['category'];
  const category = typeof rawCategory === 'string' && rawCategory.trim()
    ? rawCategory.trim()
    : parentDir !== '.' ? parentDir.split('/')[0] ?? 'uncategorized' : 'uncategorized';

  const frontmatter: Record<string, unknown> = {
    id,
    type,
    title,
    created,
    updated,
    tags,
    links: [],
    category,
  };

  // Output path: always write to target
  const datePrefix = new Date(created).toISOString().slice(0, 10);
  const slug = makeSlug(title);
  const outDir = join(targetRoot, type, category);
  const outPath = join(outDir, `${datePrefix}-${slug}.md`);

  const outContent = `${buildFrontmatter(frontmatter)}\n\n${content.trimStart()}`;

  if (!dryRun) {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, outContent, 'utf-8');
  }

  return { status: 'converted', outPath };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { source, target, dryRun } = parseArgs();

  if (dryRun) console.log('DRY RUN — no files will be written\n');

  let files: string[];
  try {
    files = scanMarkdownFiles(source);
  } catch {
    console.error(`Error: cannot read source directory: ${source}`);
    process.exit(1);
  }

  if (files.length === 0) {
    console.log('No markdown files found in source directory.');
    return;
  }

  console.log(`Found ${files.length} markdown file(s) in ${source}\n`);

  let converted = 0;
  let skipped = 0;
  let errors = 0;

  for (const file of files) {
    const rel = relative(source, file);
    const result = processFile(file, source, target, dryRun);

    if (result.status === 'converted') {
      const destRel = result.outPath ? relative(process.cwd(), result.outPath) : rel;
      console.log(`  [convert] ${rel} → ${destRel}`);
      converted++;
    } else if (result.status === 'skipped') {
      console.log(`  [skip]    ${rel} (${result.reason ?? ''})`);
      skipped++;
    } else {
      console.error(`  [error]   ${rel}: ${result.reason ?? 'unknown error'}`);
      errors++;
    }
  }

  console.log(`
Summary:
  Processed : ${files.length}
  Converted : ${converted}
  Skipped   : ${skipped}
  Errors    : ${errors}
`);

  if (!dryRun && converted > 0) {
    console.log('Next step: index the imported notes:');
    console.log('  pnpm reconcile');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
