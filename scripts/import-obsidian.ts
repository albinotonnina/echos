#!/usr/bin/env pnpm tsx

/**
 * Import Obsidian vault notes into EchOS format.
 *
 * Usage:
 *   pnpm import:obsidian --source /path/to/vault
 *   pnpm import:obsidian --source /path/to/vault --target ./data/knowledge
 *   pnpm import:obsidian --source /path/to/vault --type note --dry-run
 *   pnpm import:obsidian --source /path/to/vault --copy
 *
 * Options:
 *   --source <path>   Path to Obsidian vault (required)
 *   --target <path>   Output directory (default: ./data/knowledge)
 *   --type <type>     Default ContentType for all notes (default: note)
 *   --dry-run         Preview only, no writes
 *   --copy            Copy files to --target instead of modifying in place
 */

import { readFileSync, writeFileSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, relative, dirname, basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import matter from 'gray-matter';

// ─── Types ───────────────────────────────────────────────────────────────────

type ContentType = 'note' | 'journal' | 'article' | 'youtube' | 'reminder' | 'conversation';
type ContentStatus = 'saved' | 'read' | 'archived';

const VALID_TYPES = new Set<ContentType>(['note', 'journal', 'article', 'youtube', 'reminder', 'conversation']);
const VALID_STATUSES = new Set<ContentStatus>(['saved', 'read', 'archived']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WIKI_LINK_RE = /\[\[([^\]|#]+?)(?:[|#][^\]]*)?\]\]/g;
const INLINE_TAG_RE = /(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)/g;
const DATE_PREFIX_RE = /^\d{4}-\d{2}-\d{2}[-_\s]/;

// ─── CLI parsing ──────────────────────────────────────────────────────────────

function parseArgs(): { source: string; target: string; type: ContentType; dryRun: boolean; copy: boolean } {
  const args = process.argv.slice(2);
  let source = '';
  let target = './data/knowledge';
  let type: ContentType = 'note';
  let dryRun = false;
  let copy = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--source': source = args[++i] ?? ''; break;
      case '--target': target = args[++i] ?? target; break;
      case '--type': {
        const t = args[++i] ?? '';
        if (VALID_TYPES.has(t as ContentType)) type = t as ContentType;
        else { console.error(`Unknown type: ${t}. Valid: ${[...VALID_TYPES].join(', ')}`); process.exit(1); }
        break;
      }
      case '--dry-run': dryRun = true; break;
      case '--copy': copy = true; break;
      default:
        if (args[i]?.startsWith('--')) { console.error(`Unknown flag: ${args[i]}`); process.exit(1); }
    }
  }

  if (!source) {
    console.error('Error: --source is required');
    console.error('Usage: pnpm import:obsidian --source /path/to/vault [--target ./data/knowledge] [--type note] [--dry-run] [--copy]');
    process.exit(1);
  }

  return { source, target, type, dryRun, copy };
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
    // Month D, YYYY (e.g. "January 1, 2023")
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return fallback.toISOString();
}

// ─── Slug helpers ─────────────────────────────────────────────────────────────

function makeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 55);
}

function stripDatePrefix(name: string): string {
  return name.replace(DATE_PREFIX_RE, '');
}

// ─── WikiLink + inline tag extraction ────────────────────────────────────────

function extractWikiLinks(content: string): string[] {
  const links: string[] = [];
  let m: RegExpExecArray | null;
  WIKI_LINK_RE.lastIndex = 0;
  while ((m = WIKI_LINK_RE.exec(content)) !== null) {
    links.push(m[1]!.trim());
  }
  return [...new Set(links)];
}

function extractInlineTags(content: string): string[] {
  const tags: string[] = [];
  let m: RegExpExecArray | null;
  INLINE_TAG_RE.lastIndex = 0;
  while ((m = INLINE_TAG_RE.exec(content)) !== null) {
    tags.push(m[1]!.toLowerCase());
  }
  return tags;
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
      // Quote if contains special chars
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
  defaultType: ContentType,
  copy: boolean,
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

  // Skip if already EchOS-native (has a UUID id)
  const existingId = data['id'] as string | undefined;
  if (existingId && UUID_RE.test(existingId)) {
    return { status: 'skipped', reason: 'already has EchOS id' };
  }

  // Determine file stats for fallback dates
  let stat = { birthtimeMs: Date.now(), mtimeMs: Date.now() };
  try { stat = statSync(filePath); } catch { /* use defaults */ }
  const birthtime = new Date(stat.birthtimeMs);
  const mtime = new Date(stat.mtimeMs);

  // Map fields
  const id = randomUUID();

  // type
  const rawType = data['type'] as string | undefined;
  const type: ContentType = rawType && VALID_TYPES.has(rawType as ContentType)
    ? (rawType as ContentType)
    : defaultType;

  // title
  const rawTitle = data['title'] ?? (data['aliases'] as string[] | undefined)?.[0];
  const filename = basename(filePath, extname(filePath));
  const title = typeof rawTitle === 'string' && rawTitle.trim()
    ? rawTitle.trim()
    : stripDatePrefix(filename);

  // created / updated
  const createdRaw = data['created'] ?? data['date'] ?? data['dateCreated'];
  const updatedRaw = data['updated'] ?? data['modified'] ?? data['dateModified'];
  const created = parseFlexibleDate(createdRaw, birthtime);
  const updated = parseFlexibleDate(updatedRaw, mtime);

  // tags: frontmatter tags + inline #tags
  const fmTags = Array.isArray(data['tags'])
    ? (data['tags'] as unknown[]).map(String).map(t => t.toLowerCase().trim())
    : typeof data['tags'] === 'string'
      ? (data['tags'] as string).split(/[\s,]+/).map(t => t.toLowerCase().trim()).filter(Boolean)
      : [];
  const inlineTags = extractInlineTags(content);
  const tags = [...new Set([...fmTags, ...inlineTags])].filter(Boolean);

  // category
  const relPath = relative(sourceRoot, filePath);
  const firstSegment = relPath.split('/')[0] ?? 'uncategorized';
  const rawCategory = data['category'] as string | undefined;
  const category = typeof rawCategory === 'string' && rawCategory.trim()
    ? rawCategory.trim()
    : dirname(relPath) !== '.' ? firstSegment : 'uncategorized';

  // links: frontmatter links + WikiLink extraction
  const fmLinks = Array.isArray(data['links'])
    ? (data['links'] as unknown[]).map(String)
    : [];
  const wikiLinks = extractWikiLinks(content);
  const links = [...new Set([...fmLinks, ...wikiLinks])];

  // status
  const rawStatus = data['status'] as string | undefined;
  const status = rawStatus && VALID_STATUSES.has(rawStatus as ContentStatus)
    ? rawStatus
    : undefined;

  const frontmatter: Record<string, unknown> = {
    id,
    type,
    title,
    created,
    updated,
    tags,
    links,
    category,
    ...(status !== undefined ? { status } : {}),
  };

  const outContent = `${buildFrontmatter(frontmatter)}\n\n${content.trimStart()}`;

  // Determine output path
  let outPath: string;
  if (copy) {
    const datePrefix = new Date(created).toISOString().slice(0, 10);
    const slug = makeSlug(title);
    const outDir = join(targetRoot, type, category);
    outPath = join(outDir, `${datePrefix}-${slug}.md`);
  } else {
    outPath = filePath;
  }

  if (!dryRun) {
    if (copy) {
      const outDir = dirname(outPath);
      mkdirSync(outDir, { recursive: true });
    }
    writeFileSync(outPath, outContent, 'utf-8');
  }

  return { status: 'converted', outPath };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { source, target, type, dryRun, copy } = parseArgs();

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
    const result = processFile(file, source, target, type, copy, dryRun);

    if (result.status === 'converted') {
      const dest = result.outPath ?? file;
      const destRel = copy ? relative(process.cwd(), dest) : rel;
      console.log(`  [convert] ${rel}${copy ? ` → ${destRel}` : ''}`);
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
