import { describe, it, expect } from 'vitest';
import {
  buildGraph,
  getSubgraph,
  getTopology,
  exportMermaid,
  exportDot,
  exportJson,
  parseCommaSeparated,
} from './index.js';
import type { SqliteStorage } from '../storage/sqlite.js';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeNote(id: string, title: string, links: string[], tags: string[] = []) {
  return {
    id,
    title,
    type: 'note',
    tags: tags.join(','),
    links: links.join(','),
    category: '',
    content: '',
    filePath: '',
    sourceUrl: null,
    author: null,
    gist: null,
    created: '',
    updated: '',
    contentHash: null,
    status: null,
    inputSource: null,
    imagePath: null,
    imageUrl: null,
    imageMetadata: null,
    ocrText: null,
    deletedAt: null,
  };
}

function makeSqlite(notes: ReturnType<typeof makeNote>[]): Pick<SqliteStorage, 'listNotes'> {
  return {
    listNotes: () => notes as ReturnType<SqliteStorage['listNotes']>,
  };
}

// ── parseCommaSeparated ───────────────────────────────────────────────────────

describe('parseCommaSeparated', () => {
  it('returns empty array for empty string', () => {
    expect(parseCommaSeparated('')).toEqual([]);
  });

  it('splits on commas', () => {
    expect(parseCommaSeparated('a,b,c')).toEqual(['a', 'b', 'c']);
  });

  it('trims whitespace around entries', () => {
    expect(parseCommaSeparated(' a , b , c ')).toEqual(['a', 'b', 'c']);
  });

  it('filters empty tokens', () => {
    expect(parseCommaSeparated(',,')).toEqual([]);
  });

  it('does not attempt JSON parsing (treats JSON-like strings literally)', () => {
    // A tag that looks like JSON should be treated as a plain string
    const result = parseCommaSeparated('["foo","bar"]');
    expect(result).toEqual(['["foo"', '"bar"]']);
  });
});

// ── buildGraph ────────────────────────────────────────────────────────────────

describe('buildGraph', () => {
  it('builds nodes from all returned notes', () => {
    const sqlite = makeSqlite([makeNote('a', 'A', []), makeNote('b', 'B', [])]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  });

  it('creates edges from comma-separated links', () => {
    const sqlite = makeSqlite([
      makeNote('a', 'A', ['b']),
      makeNote('b', 'B', ['a']),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    // Bidirectional links → one deduplicated edge
    expect(graph.edges).toHaveLength(1);
    const [edge] = graph.edges;
    expect([edge!.source, edge!.target].sort()).toEqual(['a', 'b']);
  });

  it('deduplicates bidirectional links into a single edge', () => {
    const sqlite = makeSqlite([
      makeNote('x', 'X', ['y', 'z']),
      makeNote('y', 'Y', ['x']),
      makeNote('z', 'Z', ['x']),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    // x↔y and x↔z → 2 edges
    expect(graph.edges).toHaveLength(2);
  });

  it('ignores links pointing to unknown note ids', () => {
    const sqlite = makeSqlite([makeNote('a', 'A', ['missing'])]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    expect(graph.edges).toHaveLength(0);
  });

  it('parses tags correctly', () => {
    const sqlite = makeSqlite([makeNote('a', 'A', [], ['tech', 'ai'])]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    expect(graph.nodes[0]!.tags).toEqual(['tech', 'ai']);
  });
});

// ── getSubgraph ───────────────────────────────────────────────────────────────

describe('getSubgraph', () => {
  // Graph: a -- b -- c -- d
  const sqlite = makeSqlite([
    makeNote('a', 'A', ['b']),
    makeNote('b', 'B', ['a', 'c']),
    makeNote('c', 'C', ['b', 'd']),
    makeNote('d', 'D', ['c']),
  ]);

  it('depth 1 returns only direct neighbors', () => {
    const full = buildGraph(sqlite as unknown as SqliteStorage);
    const sub = getSubgraph(full, 'a', 1);
    const ids = sub.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('depth 2 extends to 2 hops', () => {
    const full = buildGraph(sqlite as unknown as SqliteStorage);
    const sub = getSubgraph(full, 'a', 2);
    const ids = sub.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('depth 3 reaches the full chain', () => {
    const full = buildGraph(sqlite as unknown as SqliteStorage);
    const sub = getSubgraph(full, 'a', 3);
    const ids = sub.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('subgraph edges are a subset of the full graph edges', () => {
    const full = buildGraph(sqlite as unknown as SqliteStorage);
    const sub = getSubgraph(full, 'a', 1);
    const nodeIds = new Set(sub.nodes.map((n) => n.id));
    for (const e of sub.edges) {
      expect(nodeIds.has(e.source)).toBe(true);
      expect(nodeIds.has(e.target)).toBe(true);
    }
  });
});

// ── exportMermaid ─────────────────────────────────────────────────────────────

describe('exportMermaid', () => {
  it('starts with "graph TD"', () => {
    const graph = { nodes: [], edges: [] };
    expect(exportMermaid(graph)).toMatch(/^graph TD/);
  });

  it('includes node labels', () => {
    const graph = {
      nodes: [{ id: 'abc-123', title: 'Hello World', type: 'note', tags: [], category: '' }],
      edges: [],
    };
    const output = exportMermaid(graph);
    expect(output).toContain('Hello World');
  });

  it('uses undirected edge syntax (---)', () => {
    const graph = {
      nodes: [
        { id: 'a', title: 'A', type: 'note', tags: [], category: '' },
        { id: 'b', title: 'B', type: 'note', tags: [], category: '' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    };
    const output = exportMermaid(graph);
    expect(output).toContain(' --- ');
    expect(output).not.toContain(' --> ');
  });

  it('sanitizes special characters in node IDs', () => {
    const graph = {
      nodes: [{ id: 'my-id/1', title: 'T', type: 'note', tags: [], category: '' }],
      edges: [],
    };
    const output = exportMermaid(graph);
    // IDs must not contain hyphens or slashes in Mermaid
    expect(output).toMatch(/n_[a-zA-Z0-9_]+/);
  });
});

// ── exportDot ─────────────────────────────────────────────────────────────────

describe('exportDot', () => {
  it('starts with "graph knowledge {"', () => {
    const graph = { nodes: [], edges: [] };
    expect(exportDot(graph)).toMatch(/^graph knowledge \{/);
  });

  it('uses undirected edge syntax (--)', () => {
    const graph = {
      nodes: [
        { id: 'a', title: 'A', type: 'note', tags: [], category: '' },
        { id: 'b', title: 'B', type: 'note', tags: [], category: '' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    };
    const output = exportDot(graph);
    expect(output).toContain(' -- ');
    expect(output).not.toContain(' -> ');
  });

  it('escapes backslashes in node labels', () => {
    const graph = {
      nodes: [{ id: 'a', title: 'C:\\path\\file', type: 'note', tags: [], category: '' }],
      edges: [],
    };
    const output = exportDot(graph);
    expect(output).toContain('C:\\\\path\\\\file');
  });

  it('closes with "}"', () => {
    const graph = { nodes: [], edges: [] };
    expect(exportDot(graph).trim()).toMatch(/\}$/);
  });
});

// ── exportJson ────────────────────────────────────────────────────────────────

describe('exportJson', () => {
  it('produces valid JSON', () => {
    const graph = {
      nodes: [{ id: 'a', title: 'A', type: 'note', tags: [], category: '' }],
      edges: [{ source: 'a', target: 'b' }],
    };
    expect(() => JSON.parse(exportJson(graph))).not.toThrow();
  });

  it('uses "links" key (D3 node-link convention)', () => {
    const graph = {
      nodes: [
        { id: 'a', title: 'A', type: 'note', tags: [], category: '' },
        { id: 'b', title: 'B', type: 'note', tags: [], category: '' },
      ],
      edges: [{ source: 'a', target: 'b' }],
    };
    const parsed = JSON.parse(exportJson(graph)) as Record<string, unknown>;
    expect(parsed).toHaveProperty('links');
    expect(parsed).not.toHaveProperty('edges');
    expect(Array.isArray(parsed['links'])).toBe(true);
  });

  it('includes nodes array with id/label/type/tags/category', () => {
    const graph = {
      nodes: [{ id: 'a', title: 'My Note', type: 'article', tags: ['x'], category: 'tech' }],
      edges: [],
    };
    const parsed = JSON.parse(exportJson(graph)) as { nodes: Record<string, unknown>[] };
    const node = parsed.nodes[0]!;
    expect(node['id']).toBe('a');
    expect(node['label']).toBe('My Note');
    expect(node['type']).toBe('article');
    expect(node['tags']).toEqual(['x']);
    expect(node['category']).toBe('tech');
  });
});

// ── getTopology ───────────────────────────────────────────────────────────────

describe('getTopology', () => {
  it('counts isolated nodes as orphans', () => {
    const sqlite = makeSqlite([
      makeNote('a', 'A', []),
      makeNote('b', 'B', []),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    const topo = getTopology(graph);
    expect(topo.orphanNodes).toHaveLength(2);
    expect(topo.totalEdges).toBe(0);
  });

  it('identifies hubs by degree', () => {
    const sqlite = makeSqlite([
      makeNote('hub', 'Hub', ['a', 'b', 'c']),
      makeNote('a', 'A', ['hub']),
      makeNote('b', 'B', ['hub']),
      makeNote('c', 'C', ['hub']),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    const topo = getTopology(graph);
    expect(topo.hubNodes[0]!.node.id).toBe('hub');
    expect(topo.hubNodes[0]!.degree).toBe(3);
  });

  it('counts clusters via union-find', () => {
    // Two disconnected pairs
    const sqlite = makeSqlite([
      makeNote('a', 'A', ['b']),
      makeNote('b', 'B', ['a']),
      makeNote('c', 'C', ['d']),
      makeNote('d', 'D', ['c']),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    const topo = getTopology(graph);
    expect(topo.clusterCount).toBe(2);
  });

  it('counts a fully connected graph as one cluster', () => {
    const sqlite = makeSqlite([
      makeNote('a', 'A', ['b', 'c']),
      makeNote('b', 'B', ['a', 'c']),
      makeNote('c', 'C', ['a', 'b']),
    ]);
    const graph = buildGraph(sqlite as unknown as SqliteStorage);
    const topo = getTopology(graph);
    expect(topo.clusterCount).toBe(1);
  });
});
